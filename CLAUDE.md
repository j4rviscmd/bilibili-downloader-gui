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

```
src/
├── app/                    # Redux store設定
│   └── store.ts           # すべてのsliceを統合
├── components/            # 再利用可能UIコンポーネント
│   ├── ui/               # shadcn/ui コンポーネント
│   ├── animate-ui/       # アニメーション付きUI
│   └── lib/              # プロジェクト固有のコンポーネント
├── features/             # ドメインロジック + Redux slice
│   ├── video/           # 動画情報取得・ダウンロード機能
│   ├── init/            # 初期化処理
│   └── count/           # カウンター機能
├── shared/              # 横断的な共通機能
│   ├── progress/        # ダウンロード進捗管理
│   ├── settings/        # アプリ設定
│   ├── user/            # ユーザー情報
│   ├── queue/           # ダウンロードキュー
│   └── downloadStatus/  # ダウンロード状態管理
├── pages/               # ルーティングされるページ
└── i18n/                # 多言語対応 (en/ja/fr/es/zh/ko)
```

**重要な設計パターン**:

- **Redux Toolkit**: 状態管理にはすべて`@reduxjs/toolkit`を使用
- **Feature-based**: `features/`配下は機能ごとにslice + hooks + UI + APIを同じディレクトリに配置
- **Shared modules**: `shared/`配下は複数のfeatureから使用される横断的な機能
- **Path alias**: `@/`で`src/`を参照 (vite.config.tsで設定済み)

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
  videoId: 'BV1234567890'
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
