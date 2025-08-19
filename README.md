# BILIBILI-DOWNLOADER-GUI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8DB)
![React + Vite + TS](https://img.shields.io/badge/React%20%2B%20Vite-TypeScript-2ea44f)

Windows and macOS Bilibili video downloader GUI. Frontend is built with React + Vite; the desktop app is powered by Tauri (Rust).

> Notice: This app is intended for educational and personal use. Respect the terms of service and copyright laws. Do not download or redistribute content without permission from rights holders.

![App Icon](public/icon.png)

## Features

- Fetch Bilibili video info and assist downloads
- Lightweight and fast desktop app built with Tauri
- Light/Dark theme toggle (shadcn/ui based)
- Progress indicator and toast notifications

## Requirements

- Node.js 18+ (LTS recommended)
- Rust (stable)
- Toolchain required by Tauri builds (e.g., Xcode Command Line Tools on macOS)

See: [Tauri official docs](https://tauri.app/)

## Supported OS

- Windows 10/11
- macOS 12+ (Intel and Apple Silicon)

## Quick Start (Development)

1. Install dependencies
   - `npm i`
2. Start the Tauri development server
   - `npm run tauri dev`

## Build (Distributable Binaries)

- `npm run tauri build`
  - Artifacts are typically generated under `src-tauri/target/release/` (varies by OS).

## macOS: First Launch of Unsigned Builds

If you run a build that is not notarized/signed with an Apple Developer certificate (e.g., CI artifacts), macOS Gatekeeper may block the app. You can either:

- Right-click the app → Open → Open, or
- Remove the quarantine/extended attributes:

```bash
# Replace the path with your actual installed app name/location
xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
# or clear all extended attributes
xattr -c "/Applications/bilibili-downloader-gui.app"
```

If you installed the app outside /Applications, adjust the path accordingly.

## Project Structure (Excerpt)

Top-level overview:

```plain text
components.json
eslint.config.js
index.html
package.json
vite.config.ts
public/
  icon.png
src/
  App.tsx
  main.tsx
  app/
    store.ts
    contexts/
  components/
    animate-ui/
    ui/
    lib/
  features/
    video/
    init/
    count/
  pages/
  shared/
  styles/
src-tauri/
  Cargo.toml
  tauri.conf.json
  src/
    main.rs
    lib.rs
    handlers/
    models/
    utils/
```

Frontend (React + Vite):

```plain text
/src
  /app                  ← Redux store / React context
  /components           ← Shared UI (animate‑ui / shadcn/ui) and project-level components
  /features             ← Domain logic + connected UI (Redux slices, hooks, UI)
  /shared               ← Cross-cutting logic/state (progress, user, etc.)
  /pages                ← Routed pages
  /styles               ← Global styles
```

Backend (Tauri / Rust):

```plain text
src-tauri/src/
  main.rs            ← Entry point (kept thin)
  lib.rs             ← App root module / command definitions
  handlers/          ← Implementations of commands
  models/            ← Data structures (requests/responses, etc.)
  utils/             ← Utilities
```

(The prior README’s development steps and structure notes are integrated above.)

## Scripts

- Dev: `npm run tauri dev`
- Build: `npm run tauri build`

## Tech Stack

- Frontend: React, Vite, TypeScript, Redux Toolkit, shadcn/ui, animate‑ui
- Desktop: Tauri (Rust)

## Contributing

Issues and PRs are welcome. For large changes, please start a discussion in an Issue first. Small fixes (docs, typos, minor UI tweaks) are appreciated.

## License

MIT License — see [LICENSE](./LICENSE) for details.

## Acknowledgements

- The Tauri team and community
- OSS such as shadcn/ui, Radix UI, sonner
