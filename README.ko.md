# BILIBILI-DOWNLOADER-GUI

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8DB)
![React + Vite + TS](https://img.shields.io/badge/React%20%2B%20Vite-TypeScript-2ea44f)
![GitHub Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=flat-square)

<table width="100%">
  <tr>
    <td width="80%">
      <p><strong>Windows 및 macOS용 Bilibili 동영상 다운로더 GUI 애플리케이션</strong></p>
      <p>설정 불필요. 설치 후 바로 동영상을 다운로드하세요.</p>
    </td>
    <td width="20%">
      <img src="public/icon.png" alt="App Icon" width="128">
    </td>
  </tr>
</table>

![앱 이미지(검색)](<public/app-image(searched)_en.png>)
![앱 이미지(병합 중)](<public/app-image(merging)_en.png>)

> [!WARNING]
> 이 앱은 교육 및 개인 사용 목적으로 제공됩니다. 이용 약관과 저작권법을 준수해 주세요. 저작권자의 허가 없이 콘텐츠를 다운로드하거나 재배포하지 마세요.

## ⭐ 이 저장소에 Star를 눌러주세요

취미로 개발하고 있습니다. Star가 없으면 폐쇄하겠습니다 😄

![Star](docs/images/star-github.gif)

## 기능

### 다운로드

- **고화질 동영상 다운로드** - 4K/1080p/720p 등 원하는 화질 선택 가능
- **멀티파트 동영상 일괄 저장** - 강좌, 드라마 등 여러 파트로 구성된 동영상 자동 전체 다운로드
- **고속 안정 다운로드** - 저속 시 자동 CDN 전환, 최대 5회 재시도
- **백그라운드 처리** - 대기열 관리, 실시간 진행률 표시

### 사용 편의성

- **6개국어 UI** - English / 日本語 / Français / Español / 中文 / 한국어
- **원클릭 설정** - FFmpeg 자동 설치, 수동 설정 불필요
- **기록 검색 및 내보내기** - 다운로드 기록을 JSON/CSV로 내보내기
- **다크 모드 지원** - 라이트/다크 테마 전환

### 로그인 불필요 & 개인정보 보호 우선

- **Firefox 쿠키 자동 감지** - 수동 로그인 없이 고화질 다운로드 가능
- **로컬 저장** - 모든 데이터는 사용자 PC에만 저장

## 설치

[최신 릴리스](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)에서 다운로드하세요.

### macOS

- **Apple Silicon**: `bilibili-downloader-gui_<version>_aarch64.dmg`
- **Intel x64**: `bilibili-downloader-gui_<version>_x64.dmg`

### Windows

- **설치 프로그램** (권장): `bilibili-downloader-gui_<version>_x64-setup.exe`
- **MSI** (대안): `bilibili-downloader-gui_<version>_x64_en-US.msi`

> [!NOTE]
> macOS 빌드는 서명되지 않았습니다. 첫 실행 시 다음을 실행하세요:
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
> ```

## 기여

Issue와 PR을 환영합니다.

번역 기여도 환영합니다 — 자세한 내용은 [CONTRIBUTING.md](./CONTRIBUTING.md)를 참조하세요.

## 감사의 말

- Tauri 팀과 커뮤니티
- shadcn/ui, Radix UI, sonner 등 오픈소스 프로젝트

## 라이선스

MIT License — 자세한 내용은 [LICENSE](./LICENSE)를 참조하세요.
