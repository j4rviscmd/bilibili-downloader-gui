# BILIBILI-DOWNLOADER-GUI

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![Windows](https://img.shields.io/badge/Windows-支持-0078D6?style=flat-square&logo=windows)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-支持-000000?style=flat-square&logo=apple)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
![Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=flat-square&label=下载)
[![Latest Release](https://img.shields.io/github/v/release/j4rviscmd/bilibili-downloader-gui?style=flat-square&label=最新版本)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![CI](https://github.com/j4rviscmd/bilibili-downloader-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/j4rviscmd/bilibili-downloader-gui/actions/workflows/ci.yml)
[![Last Commit](https://img.shields.io/github/last-commit/j4rviscmd/bilibili-downloader-gui/main?style=flat-square&label=最后更新)](https://github.com/j4rviscmd/bilibili-downloader-gui/commits/main)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

<table width="100%">
  <tr>
    <td width="80%">
      <p><strong>Windows 和 macOS Bilibili 视频下载器图形界面应用</strong></p>
      <p>无需配置。安装后即可立即开始下载视频。</p>
    </td>
    <td width="20%">
      <img src="public/icon.png" alt="App Icon" width="128">
    </td>
  </tr>
</table>

![应用截图（搜索）](<public/app-image(searched)_en.png>)
![应用截图（合并中）](<public/app-image(merging)_en.png>)

> [!WARNING]
> 注意：本应用仅供教育和个人使用。请遵守服务条款和版权法。未经版权所有者许可，请勿下载或重新分发内容。

## ⭐ 给这个仓库点个 Star 吧

这是我的业余爱好项目。没有 Star 的话就关了 😄

<div align="center">
  <img src="assets/star-github.gif" alt="Star">
</div>

## 功能特性

### 下载

- **高品质视频下载** - 可选择 4K/1080p/720p 等任意画质
- **多 P 视频批量保存** - 自动下载课程、番剧等多部分视频的全部内容
- **高速稳定下载** - 低速时自动切换 CDN，最多重试 5 次
- **后台处理** - 队列管理，实时显示下载进度

### 易用性

- **6 语言界面** - English / 日本語 / Français / Español / 中文 / 한국어
- **一键安装** - FFmpeg 自动安装，无需手动配置
- **历史搜索与导出** - 支持将下载历史导出为 JSON/CSV
- **暗色模式支持** - 亮色/暗色主题切换

### 无需登录 & 隐私优先

- **Firefox Cookie 自动检测** - 无需手动登录即可下载高清视频
- **本地存储** - 所有数据仅保存在您的电脑上

## 安装

从[最新发布](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)下载。

### macOS

- **Apple Silicon**: `bilibili-downloader-gui_<version>_aarch64.dmg`
- **Intel x64**: `bilibili-downloader-gui_<version>_x64.dmg`

### Windows

- **安装程序**（推荐）: `bilibili-downloader-gui_<version>_x64-setup.exe`
- **MSI**（备选）: `bilibili-downloader-gui_<version>_x64_en-US.msi`

> [!NOTE]
> macOS 构建未签名。首次启动时运行：
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
> ```

## 贡献

欢迎 Issue 和 PR。

也欢迎翻译贡献 — 详情请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 致谢

- Tauri 团队和社区
- shadcn/ui、Radix UI、sonner 等开源项目

## 许可证

MIT License — 详情请参阅 [LICENSE](./LICENSE)。
