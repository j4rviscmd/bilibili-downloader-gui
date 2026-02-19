# BILIBILI-DOWNLOADER-GUI

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8DB)
![React + Vite + TS](https://img.shields.io/badge/React%20%2B%20Vite-TypeScript-2ea44f)
![GitHub Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=flat-square)

<table width="100%">
  <tr>
    <td width="80%">
      <p><strong>Windows 和 macOS Bilibili 视频下载器图形界面应用</strong></p>
      <p>前端使用 React + Vite 构建，桌面应用由 Tauri (Rust) 驱动。</p>
    </td>
    <td width="20%">
      <img src="public/icon.png" alt="App Icon" width="128">
    </td>
  </tr>
</table>

> [!WARNING]
> 注意：本应用仅供教育和个人使用。请遵守服务条款和版权法。未经版权所有者许可，请勿下载或重新分发内容。

![应用截图（搜索）](<public/app-image(searched)_en.png>)
![应用截图（合并中）](<public/app-image(merging)_en.png>)

## ⭐ 给这个仓库点个 Star 吧

这是我的业余爱好项目。没有 Star 的话就关了 😄

![Star](docs/images/star-github.gif)

## 🎯 功能特性

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

## 💻 安装

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

## 🍎 macOS: 未签名构建的首次启动

如果使用未经 Apple Developer 证书签名/公证的构建（例如 CI 构建产物），macOS Gatekeeper 可能会阻止应用。您可以：

- 右键点击应用 → 打开 → 打开，或
- 移除隔离属性/扩展属性：

```bash
# 将路径替换为您的实际安装应用名称/位置
xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
# 或清除所有扩展属性
xattr -c "/Applications/bilibili-downloader-gui.app"
```

如果安装到 /Applications 以外的位置，请相应调整路径。

## 🤝 贡献

欢迎 Issue 和 PR。也欢迎翻译贡献 — 详情请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 📜 许可证

MIT License — 详情请参阅 [LICENSE](./LICENSE)。

## 🙏 致谢

- Tauri 团队和社区
- shadcn/ui、Radix UI、sonner 等开源项目
