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
      <p>フロントエンドはReact + Vite、デスクトップアプリはTauri（Rust）で構築されています。</p>
    </td>
    <td width="20%">
      <img src="public/icon.png" alt="App Icon" width="128">
    </td>
  </tr>
</table>

> 注意: このアプリは教育目的および個人利用を目的としています。利用規約と著作権法を遵守してください。権利者の許可なくコンテンツをダウンロードまたは再配布しないでください。

![アプリ画像（検索）](<public/app-image(searched)_en.png>)
![アプリ画像（マージ中）](<public/app-image(merging)_en.png>)

## ⭐ このリポジトリにスターをお願いします

余暇に開発しています。スターをいただけるたびに、この開発が続けられるモチベーションになります！

![Star](docs/images/star-github.gif)

## 🎯 機能

- Bilibili動画情報の取得とダウンロード支援
- Tauriで構築された軽量・高速なデスクトップアプリ
- ライト/ダークテーマ切り替え（shadcn/uiベース）
- 進捗表示とトースト通知
- 多言語UI対応（English / 日本語 / Français / Español / 中文 / 한국어）

## 💻 インストール

[最新リリース](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)からダウンロードしてください。

### macOS

- **Apple Silicon**: `bilibili-downloader-gui_<version>_aarch64.dmg`
- **Intel x64**: `bilibili-downloader-gui_<version>_x64.dmg`

### Windows

- **インストーラー**（推奨）: `bilibili-downloader-gui_<version>_x64-setup.exe`
- **MSI**（代替）: `bilibili-downloader-gui_<version>_x64_en-US.msi`

> **注意**: macOSビルドは署名されていません。初回起動時は、アプリを右クリック → 開く → 開く を選択するか、以下を実行してください:
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
> ```

## 🍎 macOS: 署名されていないビルドの初回起動

Apple Developer証明書で署名/公証されていないビルド（例: CIアーティファクト）を使用する場合、macOS Gatekeeperがアプリをブロックする可能性があります。以下のいずれかの方法で対処できます:

- アプリを右クリック → 開く → 開く を選択
- 検疫属性/拡張属性を削除:

```bash
# パスは実際のインストール済みアプリ名/場所に置き換えてください
xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
# または、すべての拡張属性をクリア
xattr -c "/Applications/bilibili-downloader-gui.app"
```

/Applications以外にインストールした場合は、パスを適宜調整してください。

---

## 👨‍💻 開発者向け

以下のセクションは、このプロジェクトをビルド、変更、または貢献したい開発者向けです。

## 📦 必要条件

- Node.js 18以上（LTS推奨）
- Rust（stable）
- Tauriビルドに必要なツールチェーン（例: macOSではXcode Command Line Tools）

詳細: [Tauri公式ドキュメント](https://tauri.app/)

## 💻 対応OS

- Windows 10/11
- macOS 12以上（Intel および Apple Silicon）

## 🚀 クイックスタート（開発）

1. 依存関係をインストール
   - `npm i`
2. Tauri開発サーバーを起動
   - `npm run tauri dev`

## 🔨 ビルド（配布用バイナリ）

- `npm run tauri build`
  - 成果物は通常 `src-tauri/target/release/` に生成されます（OSにより異なります）。

## ディレクトリ構造（Co-location）

**フィーチャーベース・コロケーション**のフォルダ戦略を採用しています。

```txt
src/
  ├── app/                      # アプリケーション設定
  │   ├── providers/            # グローバルProvider (Theme, Listener)
  │   └── store/                # Redux store設定
  ├── pages/                    # ルートレベル画面
  │   ├── home/
  │   │   └── index.tsx
  │   ├── init/
  │   │   └── index.tsx
  │   └── error/
  │       └── index.tsx
  ├── features/                 # 機能モジュール
  │   ├── video/
  │   │   ├── ui/               # VideoForm1, VideoForm2, DownloadButton等
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
  ├── shared/                   # 共通リソース
  │   ├── ui/                   # shadcn/uiコンポーネント, AppBar, Progress
  │   ├── animate-ui/           # アニメーションUIコンポーネント
  │   ├── hooks/                # useIsMobile等
  │   ├── lib/                  # cn(), ユーティリティ
  │   ├── progress/             # 進捗状態管理
  │   ├── downloadStatus/       # ダウンロード状態管理
  │   ├── queue/                # キュー状態
  │   └── os/                   # OS検出API
  ├── i18n/                     # 国際化
  │   └── locales/              # 翻訳ファイル
  ├── styles/                   # グローバルスタイル
  └── assets/                   # 静的アセット
```

### ディレクトリの役割

#### `src/app/`

ルートレベルのアプリケーション設定。グローバルプロバイダーとストアのセットアップを行います。

#### `src/pages/`

ルートレベルの画面。ページは主にフィーチャーと共有UIを**構成**します。ビジネスロジック/状態は `features/` 内に保持してください。

#### `src/features/`

再利用可能なプロダクトフィーチャー（ユーザー向け機能）。各フィーチャーはReduxロジック、APIコール、UIをコロケーションします。

典型的なフィーチャーフォルダには以下が含まれます:

- `ui/` — フィーチャー固有のUIコンポーネント
- `model/` — Redux Toolkit slice、selectors
- `hooks/` — フィーチャーフック
- `api/` — フィーチャー固有のAPI関数
- `lib/` — フィーチャー内部のユーティリティ
- `types.ts` — フィーチャーローカル型
- `index.ts` — フィーチャー**Public API**（インポートの推奨エントリーポイント）

#### `src/shared/`

アプリ全体で使用される再利用可能なドメイン非依存のビルディングブロック。

- `shared/ui/` — アプリ全体で再利用可能なUIプリミティブ（shadcn/ui、カスタムコンポーネント）
- `shared/animate-ui/` — アニメーションUIコンポーネント
- `shared/lib/` — 汎用ユーティリティ（例: `cn()`）
- `shared/hooks/` — 再利用可能なReactフック

### インポートルール

- `pages` → `features`、`shared` からインポート可能
- `features` → `pages` からインポート禁止
- 他の `features` から直接インポートは避ける。`pages` で構成することを推奨
- フィーチャーの `index.ts`（Public API）からインポートすることを推奨（深いパスは避ける）

### パスエイリアス

- `@/app/*`
- `@/pages/*`
- `@/features/*`
- `@/shared/*`

### バックエンド（Tauri / Rust）

```txt
src-tauri/src/
  main.rs            ← エントリーポイント（シンプルに保つ）
  lib.rs             ← アプリのルートモジュール / コマンド定義
  handlers/          ← コマンドの実装
  models/            ← データ構造（リクエスト/レスポンス等）
  utils/             ← ユーティリティ
```

## ⚙️ スクリプト

- 開発: `npm run tauri dev`
- ビルド: `npm run tauri build`

## 🛠️ 技術スタック

- フロントエンド: React, Vite, TypeScript, Redux Toolkit, shadcn/ui, animate‑ui
- デスクトップ: Tauri (Rust)

## ❌ エラーコード

返されるエラーコード（フロントエンドでi18nにマッピング）:

- `ERR::COOKIE_MISSING` Cookieが見つからない、または無効
- `ERR::QUALITY_NOT_FOUND` リクエストされた品質IDが利用できない
- `ERR::DISK_FULL` ディスクの空き容量不足
- `ERR::FILE_EXISTS` ファイル競合が自動解決できない
- `ERR::NETWORK::<detail>` リトライ後もネットワークエラー
- `ERR::MERGE_FAILED` ffmpegマージプロセスが失敗

## 🔮 今後の予定

- [ ] ダウンロード先の選択
- [ ] 既存ファイルの上書き許可
- [ ] 複数アイテムのキューダウンロード
- [ ] ダウンロード履歴の保持
- [ ] シングルインスタンス起動（複数同時起動の防止）

## 🌍 ローカライゼーション（i18n）

現在サポートされている言語:

- English (en)
- 日本語 (ja)
- Français (fr)
- Español (es)
- 中文 (zh)
- 한국어 (ko)

追加言語の貢献を歓迎します。不自然な表現を見つけた場合は、Pull Requestを開いてください。

## 🤝 コントリビュート

IssueとPRを歓迎します。大きな変更がある場合は、まずIssueで議論を開始してください。小さな修正（ドキュメント、誤字、軽微なUI調整）も感謝します。

## 📜 ライセンス

MIT License — 詳細は[LICENSE](./LICENSE)を参照してください。

## 🙏 謝辞

- Tauriチームとコミュニティ
- shadcn/ui、Radix UI、sonnerなどのOSS

---

このプロジェクトが役に立ったら、リポジトリにスターを付けていただけると、継続的な開発のモチベーションになります。
