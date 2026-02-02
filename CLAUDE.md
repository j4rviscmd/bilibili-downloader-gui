# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Bilibili動画ダウンローダーのデスクトップアプリケーション。フロントエンドはReact + Vite + TypeScript、バックエンドはTauri (Rust)で構築されたクロスプラットフォームアプリ。

## 開発コマンド

### 基本コマンド

```bash
# 開発サーバー起動 (Tauri + Vite HMR)
npm run tauri dev

# ビルド (配布用バイナリ生成)
npm run tauri build

# TypeScript型チェック
npm run typecheck

# ESLint実行
npm run lint

# フロントエンドのみのプレビュー (Tauri機能は動作しない)
npm run preview
```

### Tauri コマンド

```bash
# Tauri CLI直接実行
npm run tauri -- <command>

# 例: ビルド設定確認
npm run tauri info
```

### 環境変数

開発時のGA4アナリティクスを有効化する場合は、リポジトリルートに`.env`を作成:

```env
GA_MEASUREMENT_ID=G-XXXXXXX
GA_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

**注意**: `.env`は`.gitignore`に含まれており、コミット禁止。本番ビルドではCIの環境変数を使用。

## アーキテクチャ

### フロントエンド構造 (src/)

**Feature-based Co-location**アーキテクチャを採用。

```
src/
├── app/                      # アプリケーション設定
│   ├── providers/            # グローバルProvider (Theme, Listener)
│   └── store/                # Redux store設定
├── pages/                    # ルートレベル画面
│   ├── home/index.tsx
│   ├── init/index.tsx
│   └── error/index.tsx
├── features/                 # 機能モジュール
│   ├── video/                # 動画ダウンロード機能
│   │   ├── ui/               # VideoForm1, VideoForm2, DownloadButton等
│   │   ├── model/            # videoSlice, inputSlice, selectors
│   │   ├── hooks/            # useVideoInfo
│   │   ├── api/              # fetchVideoInfo, downloadVideo
│   │   ├── lib/              # utils, formSchema, constants
│   │   ├── types.ts
│   │   └── index.ts          # Public API
│   ├── init/                 # 初期化処理
│   │   ├── model/hooks/
│   │   └── index.ts
│   ├── settings/             # アプリ設定
│   │   ├── ui/dialog/api/
│   │   └── index.ts
│   ├── user/                 # ユーザー情報
│   │   ├── model/hooks/api/
│   │   └── index.ts
│   └── preference/           # テーマ設定
│       ├── ui/
│       └── index.ts
├── shared/                   # 横断的共通リソース
│   ├── ui/                   # shadcn/ui, AppBar, Progress等
│   ├── animate-ui/           # アニメーション付きUI
│   ├── hooks/                # useIsMobile等
│   ├── lib/                  # cn()等のユーティリティ
│   ├── progress/             # 進捗状態管理
│   ├── downloadStatus/       # ダウンロード状態
│   ├── queue/                # キュー管理
│   └── os/                   # OS検出API
├── i18n/                     # 多言語対応 (en/ja/fr/es/zh/ko)
└── styles/                   # グローバルスタイル
```

**設計パターン**:

- **Redux Toolkit**: 状態管理にはすべて`@reduxjs/toolkit`を使用
- **Feature Co-location**: 各featureは`ui/`, `model/`, `hooks/`, `api/`, `lib/`を内包
- **Public API**: 各featureの`index.ts`経由でインポート（深いパスは避ける）
- **Shared modules**: `shared/`は横断的なUI/ユーティリティのみ（ドメインロジックは`features/`へ）
- **Path alias**: `@/`で`src/`を参照

**インポートルール**:

- `pages` → `features`, `shared` からインポート可
- `features` → `pages` からインポート禁止
- `features` → 他の`features` からの直接インポートは避ける
- `index.ts` (Public API) 経由でインポートすることを推奨

### バックエンド構造 (src-tauri/src/)

```
src-tauri/src/
├── main.rs              # エントリーポイント (薄く保つ)
├── lib.rs               # アプリルートモジュール、Tauri commandの定義
├── handlers/            # Tauri commandの実装
│   ├── bilibili.rs     # 動画情報取得・ダウンロード
│   ├── cookie.rs       # Firefoxからのcookie取得
│   ├── ffmpeg.rs       # ffmpegバイナリ管理
│   └── settings.rs     # 設定の永続化
├── models/              # データ構造 (Request/Response DTOなど)
├── utils/               # ユーティリティ関数
│   └── analytics.rs    # GA4送信処理
├── emits.rs             # フロントエンドへのイベント送信
└── constants.rs         # 定数定義
```

**重要な実装パターン**:

- **Tauri commands**: `lib.rs`で`#[tauri::command]`として定義し、実装は`handlers/`に配置
- **State management**: `CookieCache`などのグローバルステートは`.manage()`で管理
- **Error handling**: すべての非同期処理で`Result<T, String>`を返す (エラーは`.map_err(|e| e.to_string())`で文字列化)
- **Event emission**: `emits.rs`経由でフロントエンドに進捗状況などを通知

### フロントエンド ↔ バックエンド通信

```typescript
// フロントエンド (TypeScript)
import { invoke } from '@tauri-apps/api/core'

const result = await invoke<Video>('fetch_video_info', {
  videoId: 'BV1234567890',
})
```

```rust
// バックエンド (Rust)
#[tauri::command]
async fn fetch_video_info(app: AppHandle, video_id: String) -> Result<Video, String> {
    bilibili::fetch_video_info(&app, &video_id)
        .await
        .map_err(|e| e.to_string())
}
```

**重要**:

- Rust側の関数名とTypeScript側の文字列は一致させる
- すべてのcommandは`lib.rs`の`invoke_handler`に登録が必要
- 複雑な型は`models/frontend_dto.rs`でserialize/deserialize可能な構造体として定義

## 重要なルール

### shadcn/uiコンポーネント

**絶対に手動でコンポーネントファイルを作成しない**。必ず以下のコマンド経由でインストール:

```bash
npx shadcn@latest add <component>
```

例:

```bash
npx shadcn@latest add button
npx shadcn@latest add checkbox
npx shadcn@latest add dialog
```

### コードスタイル

- **TypeScript**: スペース2文字インデント、Prettier + ESLint
- **Rust**: `cargo fmt`のデフォルト設定
- **行の長さ**: 最大80文字 (可能な限り)
- **インポート順**: Prettierの`prettier-plugin-organize-imports`で自動整理

### 多言語対応 (i18n)

- すべてのユーザー向けテキストは`react-i18next`経由で表示
- 翻訳キーは`src/i18n/locales/{lang}/translation.json`に追加
- エラーメッセージもi18n対応が必要 (Rust側のエラーコードを`ERR::*`形式で返す)

#### 翻訳ファイルの変更ルール

**絶対ルール**: いずれかの言語ファイルにキーを追加・変更する場合、**すべての言語ファイル**に同じ変更を適用すること

- **対象言語**: `en`, `ja`, `zh`, `ko`, `es`, `fr`
- **検証方法**: 変更後に各言語ファイルのキー数が同一であることを確認
- **確認コマンド**:
  ```bash
  # 各言語ファイルのキー数を確認
  for f in src/i18n/locales/*.json; do
    echo "$f: $(grep -c '":' "$f")"
  done
  ```
- **禁止事項**: 一部の言語のみにキーを追加すること（実行時エラーの原因となる）

#### ハードコード防止

- UIテキストは必ず`t()`関数経由で表示
- 定数（CSSクラス、icon名、技術用語など）を除くすべてのユーザー向け文字列はi18n化
- 新機能追加時は最初からi18nを意識した実装を心がける

## テスト

現時点ではテストフレームワークは未導入。新規追加する場合は以下を推奨:

- **フロントエンド**: Vitest + React Testing Library
- **バックエンド**: Rustの標準`#[cfg(test)]` + `cargo test`

## ビルド成果物

```bash
npm run tauri build
```

成果物は以下に生成される:

- **Windows**: `src-tauri/target/release/bundle/nsis/*.exe` (インストーラー)
- **macOS**: `src-tauri/target/release/bundle/dmg/*.dmg`, `*.app` (アプリバンドル)

## トラブルシューティング

### 開発サーバーが起動しない

- Viteのポート1420が使用中の可能性 → 他のプロセスを終了
- Rustのコンパイルエラー → `src-tauri/`で`cargo build`を実行してエラー詳細を確認

### Cookie取得が失敗する

- Firefox DBファイルのロック → Firefoxを一度終了してから再試行
- handler: `src-tauri/src/handlers/cookie.rs`で実装

### ffmpegが見つからない

- `validate_ffmpeg` commandで確認 → `install_ffmpeg` commandで自動ダウンロード
- handler: `src-tauri/src/handlers/ffmpeg.rs`

## CI/CD

- **GitHub Actions**: `.github/workflows/release.yml`でリリースビルドを自動化
- タグプッシュ時に各OS向けバイナリを自動ビルド・リリース
- GA4の環境変数 (`GA_MEASUREMENT_ID`, `GA_API_SECRET`) はGitHub Secretsで管理

## 参考リンク

- [Tauri公式ドキュメント](https://tauri.app/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Redux Toolkit](https://redux-toolkit.js.org/)
