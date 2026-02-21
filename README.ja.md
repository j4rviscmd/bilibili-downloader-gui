# BILIBILI-DOWNLOADER-GUI

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8DB)
![React + Vite + TS](https://img.shields.io/badge/React%20%2B%20Vite-TypeScript-2ea44f)
![GitHub Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=flat-square)

<table width="100%">
  <tr>
    <td width="80%">
      <p><strong>Windows / macOS対応のBilibili動画ダウンローダーGUIアプリ</strong></p>
      <p>設定不要。インストールするだけですぐ使える動画ダウンローダー</p>
    </td>
    <td width="20%">
      <img src="public/icon.png" alt="App Icon" width="128">
    </td>
  </tr>
</table>

![アプリ画像（検索）](<public/app-image(searched)_en.png>)
![アプリ画像（マージ中）](<public/app-image(merging)_en.png>)

> [!WARNING]
> このアプリは教育目的および個人利用を目的としています。利用規約と著作権法を遵守してください。権利者の許可なくコンテンツをダウンロードまたは再配布しないでください。

## ⭐ このリポジトリにスターをお願いします

趣味で開発してます。スターなければ閉鎖します 😄

![Star](assets/star-github.gif)

## 機能

### ダウンロード

- **高品質動画のダウンロード** - 4K/1080p/720pなど任意の品質を選択可能
- **マルチパート動画の一括保存** - 講義・番組など複数パート構成も自動で全話ダウンロード
- **高速・安定ダウンロード** - 低速時に自動でCDNを切り替え、最大5回までリトライ
- **バックグラウンド処理** - キュー管理で複数動画を順次ダウンロード、進捗はリアルタイム表示

### 使いやすさ

- **6言語対応UI** - English / 日本語 / Français / Español / 中文 / 한국어
- **ワンクリックセットアップ** - FFmpegは自動インストール、面倒な設定不要
- **履歴検索・エクスポート** - ダウンロード履歴をJSON/CSVで出力、検索も可能
- **ダークモード対応** - ライト/ダークテーマ切り替え

### ログイン不要・プライバシー重視

- **Firefox Cookie自動検出** - 手動ログイン作業なしで高画質ダウンロード可能
- **ローカル完結** - すべてのデータはお使いのPCにのみ保存

## インストール

[最新リリース](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)からダウンロードしてください。

### macOS

- **Apple Silicon**: `bilibili-downloader-gui_<version>_aarch64.dmg`
- **Intel x64**: `bilibili-downloader-gui_<version>_x64.dmg`

### Windows

- **インストーラー**（推奨）: `bilibili-downloader-gui_<version>_x64-setup.exe`
- **MSI**（代替）: `bilibili-downloader-gui_<version>_x64_en-US.msi`

> [!NOTE]
> macOSビルドは署名されていません。初回起動時は以下を実行してください:
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
> ```

## コントリビュート

IssueとPRを歓迎します。

翻訳の貢献も大歓迎です — 詳細は[CONTRIBUTING.md](./CONTRIBUTING.md)をご覧ください。

## 謝辞

- Tauriチームとコミュニティ
- shadcn/ui、Radix UI、sonnerなどのOSS

## ライセンス

MIT License — 詳細は[LICENSE](./LICENSE)を参照してください。
