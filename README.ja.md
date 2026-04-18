<div align="center">

# Bilibili Downloader GUI

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="<public/app-image(searched)_en.png>">
  <img src="<public/app-image(searched)_en_light.png>" alt="App Image">
</picture>

[English](README.md) | 日本語 | [简体中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![Windows](https://img.shields.io/badge/Windows-Supported-0078D6?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+V2luZG93cyAxMTwvdGl0bGU+PHBhdGggZmlsbD0iIzAwQTRFRiIgZD0iTTAsMEgxMS4zNzdWMTEuMzcySDBaTTEyLjYyMywwSDI0VjExLjM3MkgxMi42MjNaTTAsMTIuNjIzSDExLjM3N1YyNEgwWm0xMi42MjMsMEgyNFYyNEgxMi42MjMiLz48L3N2Zz4=)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_Windows_x64-setup.exe)
[![macOS](https://img.shields.io/badge/macOS-Supported-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_macOS_arm64.dmg)
[![Linux](https://img.shields.io/badge/Linux-Supported-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_Linux_x64.deb)
[![Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=for-the-badge&color=blue&logo=github&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases)<br/>
[![Latest Release](https://img.shields.io/github/v/release/j4rviscmd/bilibili-downloader-gui?style=for-the-badge&color=green&label=Latest&logo=github&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![Last Commit](https://img.shields.io/github/last-commit/j4rviscmd/bilibili-downloader-gui/main?style=for-the-badge&color=1F6FEB&label=Last%20Update&logo=git&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/commits/main)
[![CI](https://img.shields.io/github/actions/workflow/status/j4rviscmd/bilibili-downloader-gui/ci.yml?style=for-the-badge&label=CI&color=brightgreen&logo=githubactions&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-018FF5?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)

## Windows/macOS/Linux対応のBilibili動画ダウンローダー

広告なし、追跡なし。100%無料。

</div>

## 機能

### ダウンロード

- **高品質動画ダウンロード** - 4K/1080p/720p/HDRから任意の画質を選択可能
- **マルチパート動画一括保存** - 講座、シリーズなどすべてのパートを自動ダウンロード
- **高速・安定ダウンロード** - CDN自動切り替え
- **バックグラウンド処理** - リアルタイム進捗表示付きキュー管理
- **字幕埋め込み** - ソフト/ハード字幕選択、多言語対応
- **ハイレゾ音声** - Dolby Atmosおよびハイレゾロスレス音質サポート

### 使いやすさ

- **6言語UI** - 英語 / 日本語 / フランス語 / スペイン語 / 中国語 / 韓国語
- **ワンクリックセットアップ** - FFmpeg自動インストール、手動設定不要
- **履歴検索・エクスポート** - ダウンロード履歴をJSON/CSVにエクスポート
- **ダークモード対応** - ライト/ダークテーマ切り替え
- **広告なし体験** - 広告なし、追跡なし、完全無料

### 認証方法

- **Firefox Cookie自動検出** - FirefoxブラウザのCookieを自動検出し、手動ログインなしで高品質ダウンロード
- **QRコードログイン** - アプリ内でQRコードをスキャンして簡単ログイン
  - Firefox Cookieが検知できなかった場合のみ利用可能

> [!TIP]
> OSセキュアストレージアクセスにパスワードを求められた場合、入力後に`常に許可`を選択してください。これにより、次回以降のQRコードログインがスムーズになります。
> ![Secure storage sample](public/session-keychain-dialog_ja.png)

### プライバシーとセキュリティ

- **安全な認証情報管理** - QRコードログインの認証情報はOSのセキュアストレージ（macOS: Keychain、Windows: Credential Manager）で管理。アプリ上では認証情報を保持しません
- **他アプリの情報にはアクセスしません** - セキュアストレージ内の他アプリケーションに関する情報には一切アクセスしませんのでご安心ください
- **ローカルのみ保存** - ダウンロードした動画はPC内にのみ保存

## インストール

| プラットフォーム          | ダウンロード                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **macOS (Apple Silicon)** | [bilibili-downloader-gui_macOS_arm64.dmg](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_macOS_arm64.dmg)                     |
| **macOS (Intel)**         | [bilibili-downloader-gui_macOS_x64.dmg](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_macOS_x64.dmg)                         |
| **Windows**               | [bilibili-downloader-gui_Windows_x64-setup.exe](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_Windows_x64-setup.exe)         |
| **Linux (deb)**           | [bilibili-downloader-gui_Linux_x64.deb](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_Linux_x64.deb)                         |
| **Linux (AppImage)**      | [bilibili-downloader-gui_Linux_x64.AppImage.tar.gz](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_Linux_x64.AppImage.tar.gz) |

> [!NOTE]
> macOSビルドは署名されていません。初回起動時に以下を実行してください：
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
> ```

## コントリビューション

IssueやPRは歓迎します。

翻訳も大歓迎です — 開発環境セットアップとガイドラインについては[CONTRIBUTING.md](./CONTRIBUTING.md)を参照してください。

## 謝辞

- Tauriチームとコミュニティ
- shadcn/ui、Radix UI、sonnerなどのOSS

## ライセンス

> [!WARNING]
> このアプリは個人利用および教育目的を目的としています。利用規約と著作権法を遵守してください。<br/>
> 権利者の許可なくコンテンツをダウンロードまたは再配布しないでください。<br/>
> 本ソフトウェアの使用により生じたいかなる問題についても、作者は責任を負いません。

MIT License — 詳細は[LICENSE](./LICENSE)を参照してください。
