<div align="center">

# Bilibili Downloader GUI

![App Image](<public/app-image(searched)_en_light.png>)

[English](README.md) | [日本語](README.ja.md) | 简体中文 | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![Windows](https://img.shields.io/badge/Windows-Supported-0078D6?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+V2luZG93cyAxMTwvdGl0bGU+PHBhdGggZmlsbD0iIzAwQTRFRiIgZD0iTTAsMEgxMS4zNzdWMTEuMzcySDBaTTEyLjYyMywwSDI0VjExLjM3MkgxMi42MjNaTTAsMTIuNjIzSDExLjM3N1YyNEgwWm0xMi42MjMsMEgyNFYyNEgxMi42MjMiLz48L3N2Zz4=)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_Windows_x64-setup.exe)
[![macOS](https://img.shields.io/badge/macOS-Supported-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_macOS_arm64.dmg)
[![Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=for-the-badge&color=blue&logo=github&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases)<br/>
[![Latest Release](https://img.shields.io/github/v/release/j4rviscmd/bilibili-downloader-gui?style=for-the-badge&color=green&label=Latest&logo=github&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![Last Commit](https://img.shields.io/github/last-commit/j4rviscmd/bilibili-downloader-gui/main?style=for-the-badge&color=1F6FEB&label=Last%20Update&logo=git&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/commits/main)
[![CI](https://img.shields.io/github/actions/workflow/status/j4rviscmd/bilibili-downloader-gui/ci.yml?style=for-the-badge&label=CI&color=brightgreen&logo=githubactions&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-018FF5?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)

## Windows 和 macOS Bilibili 视频下载器

无广告，无追踪。100% 免费。

</div>

## 功能特性

### 下载

- **高品质视频下载** - 可选择 4K/1080p/720p/HDR 等任意画质
- **多部分视频批量保存** - 自动下载课程、番剧等所有部分
- **高速稳定下载** - CDN 自动切换
- **后台处理** - 队列管理，实时显示下载进度
- **字幕嵌入** - 软/硬字幕选择，多语言支持
- **高解析度音频** - 支持 Dolby Atmos 和 Hi-Res Lossless

### 易用性

- **6语言界面** - 英语 / 日语 / 法语 / 西班牙语 / 中文 / 韩语
- **一键安装** - FFmpeg 自动安装，无需手动配置
- **历史搜索与导出** - 支持将下载历史导出为 JSON/CSV
- **暗色模式支持** - 亮色/暗色主题切换
- **无广告体验** - 无广告、无追踪、完全免费

### 认证方式

- **Firefox Cookie 自动检测** - 自动检测 Firefox 浏览器的 Cookie，无需手动登录即可下载高清视频
- **二维码登录** - 在应用内扫描二维码即可轻松登录
  - 仅在未检测到 Firefox Cookie 时可用

> [!TIP]
> 如果系统提示输入密码以访问安全存储，请输入后选择"始终允许"。这将使后续的二维码登录更加顺畅。
> ![Secure storage sample](public/session-keychain-dialog_ja.png)

### 隐私与安全

- **安全的凭证管理** - 二维码登录的凭证由操作系统安全存储（macOS: Keychain，Windows: Credential Manager）管理。应用本身不存储凭证。
- **不访问其他应用数据** - 应用绝不会访问安全存储中其他应用程序的信息，请放心使用。
- **本地存储** - 下载的视频仅保存在您的电脑上

## 安装

| 平台                      | 下载                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **macOS (Apple Silicon)** | [bilibili-downloader-gui_macOS_arm64.dmg](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_macOS_arm64.dmg)             |
| **macOS (Intel)**         | [bilibili-downloader-gui_macOS_x64.dmg](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_macOS_x64.dmg)                 |
| **Windows**               | [bilibili-downloader-gui_Windows_x64-setup.exe](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_Windows_x64-setup.exe) |

> [!NOTE]
> macOS 构建未签名。首次启动时运行：
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
> ```

## 贡献

欢迎 Issue 和 PR。

也欢迎翻译贡献 — 开发环境设置和指南请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 致谢

- Tauri 团队和社区
- shadcn/ui、Radix UI、sonner 等开源项目

## 许可证

> [!WARNING]
> 本应用仅供个人和教育使用。请遵守服务条款和版权法。<br/>
> 未经版权所有者许可，请勿下载或重新分发内容。<br/>
> 作者不对因使用本软件而产生的任何问题承担责任。

MIT License — 详情请参阅 [LICENSE](./LICENSE)。
