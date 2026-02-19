# BILIBILI-DOWNLOADER-GUI

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8DB)
![React + Vite + TS](https://img.shields.io/badge/React%20%2B%20Vite-TypeScript-2ea44f)
![GitHub Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=flat-square)

<table width="100%">
  <tr>
    <td width="80%">
      <p><strong>Windows and macOS Bilibili video downloader GUI.</strong></p>
      <p>Frontend is built with React + Vite; the desktop app is powered by Tauri (Rust).</p>
    </td>
    <td width="20%">
      <img src="public/icon.png" alt="App Icon" width="128">
    </td>
  </tr>
</table>

> [!WARNING]
> This app is intended for educational and personal use. Respect the terms of service and copyright laws. Do not download or redistribute content without permission from rights holders.

![App Image(searched)](<public/app-image(searched)_en.png>)
![App Image(merged)](<public/app-image(merging)_en.png>)

## Star this repo to keep me motivated ⭐

I build this as a hobby. No stars, I'll shut it down 😄

![Star](docs/images/star-github.gif)

## 🎯 Features

### Download

- **High-quality video download** - Choose any quality from 4K/1080p/720p
- **Multi-part video batch save** - Automatically download all parts of courses, series, etc.
- **Fast & stable downloads** - Auto CDN switching when slow, up to 5 retries
- **Background processing** - Queue management with real-time progress

### Ease of Use

- **6-language UI** - English / 日本語 / Français / Español / 中文 / 한국어
- **One-click setup** - FFmpeg auto-install, no manual configuration needed
- **History search & export** - Export download history to JSON/CSV
- **Dark mode support** - Light/dark theme toggle

### No Login Required & Privacy First

- **Firefox cookie auto-detection** - High-quality downloads without manual login
- **Local-only storage** - All data stored only on your PC

## 💻 Installation

Download from the [latest release](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest).

### macOS

- **Apple Silicon**: `bilibili-downloader-gui_<version>_aarch64.dmg`
- **Intel x64**: `bilibili-downloader-gui_<version>_x64.dmg`

### Windows

- **Installer** (recommended): `bilibili-downloader-gui_<version>_x64-setup.exe`
- **MSI** (alternative): `bilibili-downloader-gui_<version>_x64_en-US.msi`

> [!NOTE]
> macOS builds are not signed. On first launch, run:
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
> ```

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

## 🤝 Contributing

Issues and PRs are welcome. Translations are also appreciated — see [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## 📜 License

MIT License — see [LICENSE](./LICENSE) for details.

## 🙏 Acknowledgements

- The Tauri team and community
- OSS such as shadcn/ui, Radix UI, sonner
