# CLAUDE.md

本リポジトリで Claude Code が作業する際の必須ルール。アーキテクチャ・コードスタイル・
ブランチ/コミット規約は CONTRIBUTING.md を参照。

## コマンド

| コマンド              | 用途                        |
| --------------------- | --------------------------- |
| `npm run tauri dev`   | Tauri アプリ起動（HMR）     |
| `npm run dev`         | フロントのみ（Vite）        |
| `npm run build`       | 型チェック + ビルド         |
| `npm run typecheck`   | TypeScript 型チェック       |
| `npm run lint`        | ESLint                      |
| `npm run test`        | Vitest 実行                 |
| `npm run tauri build` | 配布バイナリ作成            |
| `cargo build` / `fmt` | Rust（`src-tauri/` で実行） |

## 必須ルール

### shadcn/ui

**IMPORTANT**: UI コンポーネントファイルを手動作成しないこと。必ず以下でインストール:

```bash
npx shadcn@latest add <component>
```

### i18n（多言語対応）

- ユーザー向けテキストは必ず `react-i18next` 経由
- 翻訳キー命名: `{feature}.{description}`（例: `video.video_not_found`）
- **IMPORTANT**: いずれかの言語ファイルにキーを追加・変更する場合は、
  **全6言語（`en`/`ja`/`zh`/`ko`/`es`/`fr`）に同じ変更を適用**すること。
  一部のみの追加は実行時エラーの原因。検証:

  ```bash
  for f in src/i18n/locales/*.json; do echo "$f: $(grep -c '":' "$f")"; done
  ```

- バックエンドの `ERR::*` エラーコードは翻訳キーへマッピング
  （例: `ERR::VIDEO_NOT_FOUND` → `video.video_not_found`）

### Tauri command（フロント ↔ バック）

- Rust command 名と TS 側 `invoke()` の文字列は一致（snake_case）
- 新規 command は `src-tauri/src/lib.rs` の `invoke_handler`
  （`generate_handler!`）に登録が必須
- 開発専用機能は `#[cfg(debug_assertions)]` で分離

### Tauri API モック（テスト）

```typescript
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
```

## 動作確認前チェック

- `@hypothesi/tauri-mcp-server` を利用してログや HTML 要素取得を行うこと
- 動確前は以下をチェックすること
  - `npm run lint` でエラーがないこと
  - `cargo build` でコンパイルが通ること
- 動確は原則、ヒトが行う
- `animate-ui` コンポーネントについては `shadcn` mcp を利用すること
- Rust のコンパイルエラー → `src-tauri/` で `cargo build` を実行しエラー詳細を確認

## 参照（必要時に読む）

- **CONTRIBUTING.md** — アーキテクチャ・ディレクトリ構造・インポートルール・
  コードスタイル・ブランチ/コミット規約
- **README.md** — プロジェクト概要・機能一覧
- **references/bilibili-API-collect/** — bilibili API 仕様
