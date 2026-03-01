<div align="center">

# Bilibili Downloader GUI

![App Image](<public/app-image(searched)_en.png>)

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![Windows](https://img.shields.io/badge/Windows-Supported-0078D6?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+V2luZG93cyAxMTwvdGl0bGU+PHBhdGggZmlsbD0iIzAwQTRFRiIgZD0iTTAsMEgxMS4zNzdWMTEuMzcySDBaTTEyLjYyMywwSDI0VjExLjM3MkgxMi62MjNaTTAsMTIuNjIzSDExLjM3N1YyNEgwWm0xMi62MjMsMEgyNFYyNEgxMi62MjMiLz48L3N2Zz4=)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-Supported-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=for-the-badge&color=blue&logo=github&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases)<br/>
[![Latest Release](https://img.shields.io/github/v/release/j4rviscmd/bilibili-downloader-gui?style=for-the-badge&color=green&label=Latest&logo=github&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![Last Commit](https://img.shields.io/github/last-commit/j4rviscmd/bilibili-downloader-gui/main?style=for-the-badge&color=blue&label=Last%20Update&logo=git&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/commits/main)
[![CI](https://img.shields.io/github/actions/workflow/status/j4rviscmd/bilibili-downloader-gui/ci.yml?style=for-the-badge&label=CI&color=brightgreen&logo=githubactions&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)

**Interface graphique de téléchargement de vidéos Bilibili pour Windows et macOS**

Pas de publicités, pas de suivi. 100 % gratuit.

</div>

> [!WARNING]
> Cette application est destinée à un usage personnel et éducatif. Respectez les conditions d'utilisation et les lois sur le droit d'auteur.<br/>
> Ne téléchargez ni ne redistribuez de contenu sans l'autorisation des détenteurs de droits.

## Fonctionnalités

### Téléchargement

- **Téléchargement vidéo haute qualité** - Choisissez n'importe quelle qualité : 4K/1080p/720p/HDR
- **Sauvegarde par lot de vidéos multi-parties** - Téléchargez automatiquement toutes les parties de cours, séries, etc.
- **Téléchargements rapides et stables** - Changement automatique de CDN
- **Traitement en arrière-plan** - Gestion de file avec progression en temps réel
- **Incorporation de sous-titres** - Sélection de sous-titres souples/durs avec support multilingue
- **Audio haute résolution** - Prise en charge Dolby Atmos et Hi-Res Lossless

### Facilité d'utilisation

- **Interface en 6 langues** - Anglais / Japonais / Français / Espagnol / Chinois / Coréen
- **Configuration en un clic** - Installation automatique de FFmpeg, sans configuration manuelle
- **Recherche et exportation de l'historique** - Exportez l'historique de téléchargement en JSON/CSV
- **Support du mode sombre** - Basculement thème clair/sombre
- **Expérience sans publicité** - Sans publicité, sans suivi, totalement gratuit

### Sans connexion et confidentialité d'abord

- **Détection automatique des cookies Firefox** - Téléchargements haute qualité sans connexion manuelle
- **Stockage local uniquement** - Toutes les données sont stockées uniquement sur votre PC

## Installation

Téléchargez depuis la [dernière version](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest).

### macOS

- **Apple Silicon** : `bilibili-downloader-gui_<version>_aarch64.dmg`
- **Intel x64** : `bilibili-downloader-gui_<version>_x64.dmg`

### Windows

- **Installateur** (recommandé) : `bilibili-downloader-gui_<version>_x64-setup.exe`
- **MSI** (alternative) : `bilibili-downloader-gui_<version>_x64_en-US.msi`

> [!NOTE]
> Les builds macOS ne sont pas signés. Au premier lancement, exécutez :
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
> ```

## Contribuer

Les Issues et PR sont les bienvenus.

Les traductions sont également appréciées — consultez [CONTRIBUTING.md](./CONTRIBUTING.md) pour la configuration de développement et les guides.

## Remerciements

- L'équipe et la communauté Tauri
- OSS comme shadcn/ui, Radix UI, sonner

## Licence

MIT License — voir [LICENSE](./LICENSE) pour plus de détails.
