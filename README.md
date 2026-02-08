# BILIBILI-DOWNLOADER-GUI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8DB)
![React + Vite + TS](https://img.shields.io/badge/React%20%2B%20Vite-TypeScript-2ea44f)
![GitHub Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=flat-square)

<table>
  <tr>
    <td width="75%">
      <p><strong>Windows and macOS Bilibili video downloader GUI.</strong></p>
      <p>Frontend is built with React + Vite; the desktop app is powered by Tauri (Rust).</p>
    </td>
    <td width="25%">
      <img src="public/icon.png" alt="App Icon" width="128">
    </td>
  </tr>
</table>

> Notice: This app is intended for educational and personal use. Respect the terms of service and copyright laws. Do not download or redistribute content without permission from rights holders.

![App Image](public/app-image_en.png)

## Star this repo to keep me motivated ⭐

I build this in my spare time. Every star shows that my work is valued and keeps me going!

![Star](docs/images/star-github.gif)

## 🎯 Features

- Fetch Bilibili video info and assist downloads
- Lightweight and fast desktop app built with Tauri
- Light/Dark theme toggle (shadcn/ui based)
- Progress indicator and toast notifications
- Multi-language UI (English / 日本語 / Français / Español / 中文 / 한국어)

## 💻 Installation

Download from the latest release: [Releases › Latest](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)

- Windows (x64)
  - Installer (recommended):
  - EXE: [bilibili-downloader-gui_0.1.0_x64-setup.exe](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_0.1.0_x64-setup.exe)
  - MSI (alternative):
  - MSI: [bilibili-downloader-gui_0.1.0_x64_en-US.msi](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_0.1.0_x64_en-US.msi)

- macOS (Intel x64 and Apple Silicon aarch64)
  - DMG (Intel x64): [bilibili-downloader-gui_0.1.0_x64.dmg](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_0.1.0_x64.dmg)
  - DMG (Apple Silicon aarch64): [bilibili-downloader-gui_0.1.0_aarch64.dmg](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_0.1.0_aarch64.dmg)
  - App archive (unsigned alternative):
    - TAR.GZ (Intel x64): [bilibili-downloader-gui_x64.app.tar.gz](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_x64.app.tar.gz)
    - TAR.GZ (Apple Silicon aarch64): [bilibili-downloader-gui_aarch64.app.tar.gz](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_aarch64.app.tar.gz)

Note: For unsigned builds on macOS, see the section below about Gatekeeper and xattr.

## 🍎 macOS: First Launch of Unsigned Builds

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

---

## 👨‍💻 For Developers

The following sections are intended for developers who want to build, modify, or contribute to this project.

## 📦 Requirements

- Node.js 18+ (LTS recommended)
- Rust (stable)
- Toolchain required by Tauri builds (e.g., Xcode Command Line Tools on macOS)

See: [Tauri official docs](https://tauri.app/)

## 💻 Supported OS

- Windows 10/11
- macOS 12+ (Intel and Apple Silicon)

## 🚀 Quick Start (Development)

1. Install dependencies
   - `npm i`
2. Start the Tauri development server
   - `npm run tauri dev`

## 🔨 Build (Distributable Binaries)

- `npm run tauri build`
  - Artifacts are typically generated under `src-tauri/target/release/` (varies by OS).

## Directory Structure (Co-location)

We use a **feature-based, co-located** folder strategy.

```txt
src/
  ├── app/                      # Application wiring
  │   ├── providers/            # Global providers (Theme, Listener)
  │   └── store/                # Redux store configuration
  ├── pages/                    # Route-level screens
  │   ├── home/
  │   │   └── index.tsx
  │   ├── init/
  │   │   └── index.tsx
  │   └── error/
  │       └── index.tsx
  ├── features/                 # Feature modules
  │   ├── video/
  │   │   ├── ui/               # VideoForm1, VideoForm2, DownloadButton, etc.
  │   │   ├── model/            # videoSlice, inputSlice, selectors
  │   │   ├── hooks/            # useVideoInfo
  │   │   ├── api/              # fetchVideoInfo, downloadVideo
  │   │   ├── lib/              # utils, formSchema, constants
  │   │   ├── types.ts
  │   │   └── index.ts          # Public API
  │   ├── init/
  │   │   ├── model/            # initSlice
  │   │   ├── hooks/            # useInit
  │   │   └── index.ts
  │   ├── settings/
  │   │   ├── ui/               # SettingsDialog, LanguagesDropdown
  │   │   ├── model/            # settingsSlice
  │   │   ├── api/              # settingApi
  │   │   └── index.ts
  │   ├── user/
  │   │   ├── model/            # userSlice
  │   │   ├── hooks/            # useUser
  │   │   ├── api/              # fetchUser
  │   │   └── index.ts
  │   └── preference/
  │       ├── ui/               # ToggleThemeButton
  │       └── index.ts
  ├── shared/                   # Shared resources
  │   ├── ui/                   # shadcn/ui components, AppBar, Progress
  │   ├── animate-ui/           # Animated UI components
  │   ├── hooks/                # useIsMobile, etc.
  │   ├── lib/                  # cn(), utilities
  │   ├── progress/             # Progress state management
  │   ├── downloadStatus/       # Download status state
  │   ├── queue/                # Queue state
  │   └── os/                   # OS detection API
  ├── i18n/                     # Internationalization
  │   └── locales/              # Translation files
  ├── styles/                   # Global styles
  └── assets/                   # Static assets
```

### Directory Responsibilities

#### `src/app/`

Application wiring at the root level. This is where the application is assembled:
global providers and store setup.

#### `src/pages/`

Route-level screens. Pages should mainly **compose** features and shared UI.
Keep business logic/state inside `features/`.

#### `src/features/`

Reusable product features (user-facing behavior). Each feature co-locates its
Redux logic, API calls, and UI.

A typical feature folder contains:

- `ui/` — feature-specific UI components
- `model/` — Redux Toolkit slice, selectors
- `hooks/` — feature hooks
- `api/` — feature-specific API functions
- `lib/` — internal utilities for the feature
- `types.ts` — feature-local types
- `index.ts` — feature **public API** (recommended entry point for imports)

#### `src/shared/`

Reusable, non-domain-specific building blocks used across the app.

- `shared/ui/` — App-wide reusable UI primitives (shadcn/ui, custom components)
- `shared/animate-ui/` — Animated UI components
- `shared/lib/` — Generic utilities (e.g., `cn()`)
- `shared/hooks/` — Reusable React hooks

### Import Rules

- `pages` may import from `features` and `shared`.
- `features` must not import from `pages`.
- Avoid importing directly from other `features`. Prefer composition in `pages`.
- Prefer importing from a feature's `index.ts` (public API) instead of deep paths.

### Path Aliases

- `@/app/*`
- `@/pages/*`
- `@/features/*`
- `@/shared/*`

### Backend (Tauri / Rust)

```txt
src-tauri/src/
  main.rs            ← Entry point (kept thin)
  lib.rs             ← App root module / command definitions
  handlers/          ← Implementations of commands
  models/            ← Data structures (requests/responses, etc.)
  utils/             ← Utilities
```

## ⚙️ Scripts

- Dev: `npm run tauri dev`
- Build: `npm run tauri build`

## 🛠️ Tech Stack

- Frontend: React, Vite, TypeScript, Redux Toolkit, shadcn/ui, animate‑ui
- Desktop: Tauri (Rust)

## ❌ Error Codes

Returned error codes (mapped to i18n in the frontend):

- `ERR::COOKIE_MISSING` Missing or invalid cookie
- `ERR::QUALITY_NOT_FOUND` Requested quality ID not available
- `ERR::DISK_FULL` Insufficient free disk space
- `ERR::FILE_EXISTS` File conflict not auto-resolvable
- `ERR::NETWORK::<detail>` Network failure after retries
- `ERR::MERGE_FAILED` ffmpeg merge process failed

## 🔮 Future

- [ ] Select download destination
- [ ] Allow overwriting existing files
- [ ] Queueing multiple items for download
- [ ] Download history retention
- [ ] Single-instance app launch (prevent multiple concurrent launches)

## 🌍 Localization (i18n)

Current supported languages:

- English (en)
- 日本語 (ja)
- Français (fr)
- Español (es)
- 中文 (zh)
- 한국어 (ko)

Contributions welcome for additional languages. If you find an unnatural or awkward phrase, please open a Pull Request.

不自然な言い回しや表現を見つけた場合は、遠慮なく Pull Request を送ってください。

## 🤝 Contributing

Issues and PRs are welcome. For large changes, please start a discussion in an Issue first. Small fixes (docs, typos, minor UI tweaks) are appreciated.

## 📜 License

MIT License — see [LICENSE](./LICENSE) for details.

## 🙏 Acknowledgements

- The Tauri team and community
- OSS such as shadcn/ui, Radix UI, sonner

---

If you find this project useful, please consider starring the repo — it really helps motivate continued development.
