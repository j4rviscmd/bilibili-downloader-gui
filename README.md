# BILIBILI-DOWNLOADER-GUI

## Development

### Local startup

1. `npm i`
2. `npm run tauri dev`

### Directory structures

#### Frontend

```plain text
/src
  /app
      store.ts
  /components
    /animate-ui/           ← animate‑ui由来の共通UI
    /ui                    ← shadcn由来の共通UI
      button.tsx
      dialog.tsx
      index.ts
    /lib                   ← プロジェクト内共通コンポーネント(Redux直接接続NG)
      Progress/
      FeedCard/
        FeedCard.tsx
        FeedCard.module.css
        index.ts
      Avatar/
        Avatar.tsx
        index.ts
  /shared                  ← 共通ロジックと連携UI(features同様)
  /features                ← ドメイン単位のロジックと連携UI
    /auth
      authSlice.ts         ← Redux slice / state useAuth.ts           ← カスタムhook
      types.ts
      LoginForm.test.tsx   ← テスト(Jest / Testing Library)
    /player
      /ui
        PlayerView.tsx     ← ドメイン固有コンポーネント
      usePlayer.ts
      player.css
    /downloader
      DownloaderForm.tsx
      useDownload.ts
  /pages                   ← ルートビュー（React Router etc.）
    index.tsx
    settings.tsx
  /lib
    utils.ts               ← shadcn utils(自動生成)
    date.ts
  /styles
    globals.css
  index.tsx
```

#### Backend

```plain text
src-tauri/src/
  main.rs            ← エントリポイント、できるだけ薄く保つ
  lib.rs             ← アプリ本体の root module（サービスの統括）,各APIのエンドポイント定義
  handlers/          ← handler関数たち（実際のロジック）
  services/          ← ビジネスロジック（DB操作、外部API呼び出しなど）
  models/            ← データ構造（リクエスト/レスポンス/DB構造）
  db/                ← DB接続、マイグレーション、クエリラッパーなど
  config.rs          ← 設定読み込み（dotenvなど）
  errors.rs          ← 共通エラーハンドリング
  utils.rs           ← 補助ツール
```
