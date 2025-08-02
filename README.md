# BILIBILI-DOWNLOADER-GUI

## Development

### Local startup

1. `npm i`
2. `npm run tauri dev`

### Directory structures

```plain text
/src
  /components
    /ui                    ← animate‑ui由来の共通UI
      button.tsx
      dialog.tsx
      index.ts
    /lib                   ← プロジェクト内共通コンポーネント
      FeedCard/
        FeedCard.tsx
        FeedCard.module.css
        index.ts
      Avatar/
        Avatar.tsx
        index.ts
  /features                ← ドメイン単位のロジックと連携UI
    /auth
      authSlice.ts         ← Redux slice / state
      useAuth.ts           ← カスタムhook
      types.ts
      LoginForm.test.tsx   ← テスト(Jest / Testing Library)
    /player
      PlayerView.tsx
      usePlayer.ts
      player.css
    /downloader
      DownloaderForm.tsx
      useDownload.ts
  /pages                   ← ルートビュー（React Router etc.）
    index.tsx
    settings.tsx
  /utils
    date.ts
  /styles
    globals.css
  index.tsx
```
