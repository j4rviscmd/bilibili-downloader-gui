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

> 注意：本应用仅供教育和个人使用。请遵守服务条款和版权法。未经版权所有者许可，请勿下载或重新分发内容。

![应用截图（搜索）](<public/app-image(searched)_en.png>)
![应用截图（合并中）](<public/app-image(merging)_en.png>)

## ⭐ 给这个仓库点个 Star 吧

我在业余时间开发这个项目。每一个 Star 都表明我的工作受到重视，激励我继续前进！

![Star](docs/images/star-github.gif)

## 🎯 功能特性

- 获取 Bilibili 视频信息并辅助下载
- 基于 Tauri 构建的轻量级快速桌面应用
- 亮色/暗色主题切换（基于 shadcn/ui）
- 进度指示器和 Toast 通知
- 多语言界面（English / 日本語 / Français / Español / 中文 / 한국어）

## 💻 安装

从[最新发布](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)下载。

### macOS

- **Apple Silicon**: `bilibili-downloader-gui_<version>_aarch64.dmg`
- **Intel x64**: `bilibili-downloader-gui_<version>_x64.dmg`

### Windows

- **安装程序**（推荐）: `bilibili-downloader-gui_<version>_x64-setup.exe`
- **MSI**（替代）: `bilibili-downloader-gui_<version>_x64_en-US.msi`

> **注意**：macOS 构建未签名。首次启动时，右键点击应用 → 打开 → 打开，或运行：
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
> ```

## 🍎 macOS：未签名构建的首次启动

如果您运行的是未经 Apple Developer 证书公证/签名的构建（例如 CI 构建产物），macOS Gatekeeper 可能会阻止该应用。您可以：

- 右键点击应用 → 打开 → 打开，或
- 移除隔离/扩展属性：

```bash
# 将路径替换为您实际安装的应用名称/位置
xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
# 或清除所有扩展属性
xattr -c "/Applications/bilibili-downloader-gui.app"
```

如果您将应用安装在 /Applications 之外，请相应调整路径。

---

## 👨‍💻 开发者专区

以下部分适用于想要构建、修改或为该项目做出贡献的开发者。

## 📦 系统要求

- Node.js 18+（推荐 LTS）
- Rust（stable）
- Tauri 构建所需的工具链（例如 macOS 上的 Xcode Command Line Tools）

详见：[Tauri 官方文档](https://tauri.app/)

## 💻 支持的操作系统

- Windows 10/11
- macOS 12+（Intel 和 Apple Silicon）

## 🚀 快速开始（开发模式）

1. 安装依赖
   - `npm i`
2. 启动 Tauri 开发服务器
   - `npm run tauri dev`

## 🔨 构建（可分发的二进制文件）

- `npm run tauri build`
  - 构建产物通常生成在 `src-tauri/target/release/`（因操作系统而异）。

## 目录结构（Co-location）

我们采用**基于功能的共置**文件夹策略。

```txt
src/
  ├── app/                      # 应用程序配置
  │   ├── providers/            # 全局 Provider (Theme, Listener)
  │   └── store/                # Redux store 配置
  ├── pages/                    # 路由级页面
  │   ├── home/
  │   │   └── index.tsx
  │   ├── init/
  │   │   └── index.tsx
  │   └── error/
  │       └── index.tsx
  ├── features/                 # 功能模块
  │   ├── video/
  │   │   ├── ui/               # VideoForm1, VideoForm2, DownloadButton 等
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
  ├── shared/                   # 共享资源
  │   ├── ui/                   # shadcn/ui 组件, AppBar, Progress
  │   ├── animate-ui/           # 动画 UI 组件
  │   ├── hooks/                # useIsMobile 等
  │   ├── lib/                  # cn(), 工具函数
  │   ├── progress/             # 进度状态管理
  │   ├── downloadStatus/       # 下载状态管理
  │   ├── queue/                # 队列状态
  │   └── os/                   # OS 检测 API
  ├── i18n/                     # 国际化
  │   └── locales/              # 翻译文件
  ├── styles/                   # 全局样式
  └── assets/                   # 静态资源
```

### 目录职责

#### `src/app/`

根级别的应用程序配置。这是组装应用程序的地方：全局提供者和存储设置。

#### `src/pages/`

路由级页面。页面主要应该**组合**功能和共享 UI。将业务逻辑/状态保持在 `features/` 内。

#### `src/features/`

可复用的产品功能（面向用户的行为）。每个功能共置其 Redux 逻辑、API 调用和 UI。

典型的功能文件夹包含：

- `ui/` — 功能特定的 UI 组件
- `model/` — Redux Toolkit slice、selectors
- `hooks/` — 功能钩子
- `api/` — 功能特定的 API 函数
- `lib/` — 功能内部工具
- `types.ts` — 功能本地类型
- `index.ts` — 功能**Public API**（推荐的导入入口点）

#### `src/shared/`

在整个应用中使用的可复用、非领域特定的构建块。

- `shared/ui/` — 应用范围的可复用 UI 原语（shadcn/ui、自定义组件）
- `shared/animate-ui/` — 动画 UI 组件
- `shared/lib/` — 通用工具（例如 `cn()`）
- `shared/hooks/` — 可复用的 React hooks

### 导入规则

- `pages` 可以从 `features` 和 `shared` 导入
- `features` 不能从 `pages` 导入
- 避免直接从其他 `features` 导入。建议在 `pages` 中进行组合
- 建议从功能的 `index.ts`（Public API）导入，而不是深层路径

### 路径别名

- `@/app/*`
- `@/pages/*`
- `@/features/*`
- `@/shared/*`

### 后端（Tauri / Rust）

```txt
src-tauri/src/
  main.rs            ← 入口点（保持精简）
  lib.rs             ← 应用根模块 / 命令定义
  handlers/          ← 命令实现
  models/            ← 数据结构（请求/响应等）
  utils/             ← 工具函数
```

## ⚙️ 脚本

- 开发: `npm run tauri dev`
- 构建: `npm run tauri build`

## 🛠️ 技术栈

- 前端: React, Vite, TypeScript, Redux Toolkit, shadcn/ui, animate‑ui
- 桌面: Tauri (Rust)

## ❌ 错误代码

返回的错误代码（在前端映射到 i18n）：

- `ERR::COOKIE_MISSING` Cookie 缺失或无效
- `ERR::QUALITY_NOT_FOUND` 请求的质量 ID 不可用
- `ERR::DISK_FULL` 磁盘空间不足
- `ERR::FILE_EXISTS` 文件冲突无法自动解决
- `ERR::NETWORK::<detail>` 重试后网络失败
- `ERR::MERGE_FAILED` ffmpeg 合并进程失败

## 🔮 未来计划

- [ ] 选择下载目标
- [ ] 允许覆盖现有文件
- [ ] 多项目队列下载
- [ ] 下载历史记录保留
- [ ] 单实例应用启动（防止多次并发启动）

## 🌍 本地化（i18n）

当前支持的语言：

- English (en)
- 日本語 (ja)
- Français (fr)
- Español (es)
- 中文 (zh)
- 한국어 (ko)

欢迎贡献其他语言。如果您发现不自然或别扭的表达，请提交 Pull Request。

## 🤝 贡献

欢迎 Issue 和 PR。对于重大更改，请先在 Issue 中讨论。小的修复（文档、错别字、轻微 UI 调整）也非常感谢。

## 📜 许可证

MIT License — 详见 [LICENSE](./LICENSE)。

## 🙏 致谢

- Tauri 团队和社区
- shadcn/ui、Radix UI、sonner 等开源项目

---

如果您觉得这个项目有用，请考虑给仓库点个 Star — 这真的能激励持续开发。
