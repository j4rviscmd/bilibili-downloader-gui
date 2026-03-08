<div align="center">

# Bilibili Downloader GUI

![App Image](<public/app-image(searched)_en_light.png>)

English | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![Windows](https://img.shields.io/badge/Windows-Supported-0078D6?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+V2luZG93cyAxMTwvdGl0bGU+PHBhdGggZmlsbD0iIzAwQTRFRiIgZD0iTTAsMEgxMS4zNzdWMTEuMzcySDBaTTEyLjYyMywwSDI0VjExLjM3MkgxMi42MjNaTTAsMTIuNjIzSDExLjM3N1YyNEgwWm0xMi42MjMsMEgyNFYyNEgxMi42MjMiLz48L3N2Zz4=)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-Supported-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=for-the-badge&color=blue&logo=github&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases)<br/>
[![Latest Release](https://img.shields.io/github/v/release/j4rviscmd/bilibili-downloader-gui?style=for-the-badge&color=green&label=Latest&logo=github&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![Last Commit](https://img.shields.io/github/last-commit/j4rviscmd/bilibili-downloader-gui/main?style=for-the-badge&color=1F6FEB&label=Last%20Update&logo=git&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/commits/main)
[![CI](https://img.shields.io/github/actions/workflow/status/j4rviscmd/bilibili-downloader-gui/ci.yml?style=for-the-badge&label=CI&color=brightgreen&logo=githubactions&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-018FF5?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)

## Windows and macOS Bilibili Video Downloader

No ads, no tracking. 100% free.

</div>

> [!WARNING]
> This app is intended for personal and educational use. Respect the terms of service and copyright laws.<br/>
> Do not download or redistribute content without permission from rights holders.

## Features

### Download

- **High-quality video download** - Choose any quality from 4K/1080p/720p/HDR
- **Multi-part video batch save** - Automatically download all parts of courses, series, etc.
- **Fast & stable downloads** - Auto CDN switching
- **Background processing** - Queue management with real-time progress
- **Subtitle embedding** - Soft/hard subtitle selection with multi-language support
- **Hi-Res Audio** - Dolby Atmos and Hi-Res Lossless audio quality support

### Ease of Use

- **6-language UI** - English / 日本語 / Français / Español / 中文 / 한국어
- **One-click setup** - FFmpeg auto-install, no manual configuration needed
- **History search & export** - Export download history to JSON/CSV
- **Dark mode support** - Light/dark theme toggle
- **Ad-free experience** - No ads, no tracking, completely free

### Authentication Methods

- **Firefox Cookie Auto-detection** - Automatically detects Firefox browser cookies for high-quality downloads without manual login
- **QR Code Login** - Simply scan the QR code in the app to log in
  - Only available when Firefox cookies are not detected

  > [!TIP]
  > If prompted for a password to access OS secure storage, enter it and select `Always Allow`. This will make future QR code logins smoother.
  > ![Secure storage sample](public/session-keychain-dialog_ja.png)

### Privacy & Security

- **Secure Credential Management** - QR code login credentials are managed by OS secure storage (macOS: Keychain, Windows: Credential Manager). The app does not store credentials.
- **No Access to Other Apps' Data** - The app never accesses information about other applications in secure storage, so you can rest assured.
- **Local-only Storage** - Downloaded videos are stored only on your PC

## Installation

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

## Contributing

Issues and PRs are welcome.

Translations are also appreciated — see [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## Acknowledgements

- The Tauri team and community
- OSS such as shadcn/ui, Radix UI, sonner

## License

MIT License — see [LICENSE](./LICENSE) for details.
