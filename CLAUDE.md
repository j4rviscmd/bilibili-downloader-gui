# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Bilibili動画ダウンローダーのデスクトップアプリケーション。フロントエンドはReact + Vite + TypeScript、バックエンドはTauri (Rust)で構築されたクロスプラットフォームアプリ。

## アーキテクチャ

### フロントエンド構造 (src/)

**Feature-based Co-location**アーキテクチャを採用。

```
src/
├── app/                      # アプリケーション設定
│   ├── providers/            # グローバルProvider (Theme, Listener)
│   └── store/                # Redux store設定
├── pages/                    # ルートレベル画面
├── features/                 # 機能モジュール
│   └── {feature}/
│       ├── ui/               # プレゼンテーションコンポーネント
│       ├── model/            # Redux slice, selectors, types
│       ├── hooks/            # カスタムフック
│       ├── api/              # 外部API呼び出し
│       ├── lib/              # ユーティリティ、定数
│       └── index.ts          # Public API
├── shared/                   # 横断的共通リソース
│   ├── ui/                   # shadcn/ui, 共通UI
│   ├── hooks/                # 共通フック
│   └── lib/                  # 共通ユーティリティ
├── i18n/                     # 多言語対応
└── styles/                   # グローバルスタイル
```

**設計パターン**:

- **Redux Toolkit**: 状態管理にはすべて`@reduxjs/toolkit`を使用
- **Public API**: 各featureの`index.ts`経由でインポート（深いパスは避ける）
- **Shared modules**: `shared/`は横断的なUI/ユーティリティのみ（ドメインロジックは`features/`へ）
- **Path alias**: `@/`で`src/`を参照

**インポートルール**:

- `pages` → `features`, `shared` からインポート可
- `features` → `pages` からインポート禁止
- `features` → 他の`features` からの直接インポートは避ける
- `index.ts` (Public API) 経由でインポートすることを推奨

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

- Rust側の関数名とTypeScript側の文字列は一致させる（snake_case）
- すべてのcommandは`lib.rs`の`invoke_handler`に登録が必要
- 複雑な型は`models/`でserialize/deserialize可能な構造体として定義

## 重要なルール

### shadcn/uiコンポーネント

**絶対に手動でコンポーネントファイルを作成しない**。必ず以下のコマンド経由でインストール:

```bash
npx shadcn@latest add <component>
```

### コードスタイル

- **TypeScript**: スペース2文字インデント、Prettier + ESLint
- **Rust**: `cargo fmt`のデフォルト設定
- **行の長さ**: 最大80文字 (可能な限り)
- **インポート順**: Prettierの`prettier-plugin-organize-imports`で自動整理

### 多言語対応 (i18n)

- すべてのユーザー向けテキストは`react-i18next`経由で表示
- 翻訳キーは`src/i18n/locales/{lang}/translation.json`に追加
- 翻訳キー命名: `{feature}.{description}`形式（例: `video.video_not_found`）

#### 翻訳ファイルの変更ルール

**絶対ルール**: いずれかの言語ファイルにキーを追加・変更する場合、**すべての言語ファイル**に同じ変更を適用すること

- **対象言語**: `en`, `ja`, `zh`, `ko`, `es`, `fr`
- **検証方法**: 変更後に各言語ファイルのキー数が同一であることを確認
- **確認コマンド**:
  ```bash
  for f in src/i18n/locales/*.json; do
    echo "$f: $(grep -c '":' "$f")"
  done
  ```
- **禁止事項**: 一部の言語のみにキーを追加すること（実行時エラーの原因となる）

#### エラーコードマッピング

バックエンドから返される`ERR::*`形式のエラーコードをフロントエンドで翻訳キーにマッピング:

```typescript
const ERROR_MAP: Record<string, string> = {
  'ERR::VIDEO_NOT_FOUND': 'video.video_not_found',
  'ERR::COOKIE_MISSING': 'video.cookie_missing',
  'ERR::API_ERROR': 'video.api_error',
  // ...
}
```

### Redux/Hook設計指針

- **Slice**: 単純な状態のみ管理。複雑なロジックはhookに分離
- **Selector**: 基本的なselectorは直接stateから取得、計算が必要な場合は`createSelector`を使用
- **Hook**: 状態管理ロジックをカプセル化し、コンポーネントからは純粋なUI処理のみを行わせる
- **禁止**: sliceファイル内での複雑なビジネスロジック、コンポーネント内での直接的なdispatch

### バックエンド (Rust) 設計指針

- **グローバルステート**: `app.manage()`で登録、`app.try_state::<T>()`でアクセス
- **データ永続化**: `tauri-plugin-store`を使用（例: HistoryStore）
- **開発モード制御**: `#[cfg(debug_assertions)]`で開発専用機能を分離
- **DTO命名**: `#[serde(rename_all = "camelCase")]`でフロントエンドと整合
- **エラーコード**: `ERR::*`形式で定義（例: `ERR::COOKIE_MISSING`）

## テスト

### フロントエンド

- **フレームワーク**: Vitest + React Testing Library
- **テスト環境**: happy-dom
- **配置**: `src/__tests__/` および feature内の`.test.ts`ファイル

### Tauri APIモックパターン

```typescript
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// テスト内でモックを設定
const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>
mockInvoke.mockResolvedValue({ data: 'test' })
```

### バックエンド

- **フレームワーク**: Rust標準`#[cfg(test)]` + `cargo test`

## トラブルシューティング

### 開発サーバーが起動しない

- Viteのポート1420が使用中 → 他のプロセスを終了
- Rustのコンパイルエラー → `src-tauri/`で`cargo build`を実行してエラー詳細を確認

### Cookie取得が失敗する

- Firefox DBファイルのロック → Firefoxを一度終了してから再試行
- プロファイル位置: macOS `~/Library/Application Support/Firefox/Profiles/`

### ffmpegが見つからない

- `validate_ffmpeg` commandで確認 → `install_ffmpeg` commandで自動ダウンロード

### 設定ファイルの初期化エラー

- **エラーコード 6**: 設定ファイル読み込み失敗
- **対処法**: アプリを再起動（エラーページに再起動ボタン表示）

### ダウンロード関連のエラー

- **低速CDN**: 初期1MBの速度が1MB/s未満の場合、自動的にCDN切り替え（最大5回）
- **ディスク容量不足**: `ERR::DISK_FULL` - ダウンロード先に十分な空き容量を確保

## 参考リンク

- [Tauri公式ドキュメント](https://tauri.app/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Redux Toolkit](https://redux-toolkit.js.org/)
