# BILIBILI-DOWNLOADER-GUI

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![Windows](https://img.shields.io/badge/Windows-Pris%20en%20charge-0078D6?style=flat-square&logo=windows)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-Pris%20en%20charge-000000?style=flat-square&logo=apple)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
![Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=flat-square&label=Téléchargements)
[![Latest Release](https://img.shields.io/github/v/release/j4rviscmd/bilibili-downloader-gui?style=flat-square&label=Dernier)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![CI](https://github.com/j4rviscmd/bilibili-downloader-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/j4rviscmd/bilibili-downloader-gui/actions/workflows/ci.yml)
[![Last Commit](https://img.shields.io/github/last-commit/j4rviscmd/bilibili-downloader-gui/main?style=flat-square&label=Dernière%20mise%20à%20jour)](https://github.com/j4rviscmd/bilibili-downloader-gui/commits/main)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

<table width="100%">
  <tr>
    <td width="80%">
      <p><strong>Interface graphique de téléchargement de vidéos Bilibili pour Windows et macOS.</strong></p>
      <p>Aucune configuration requise. Installez et commencez à télécharger des vidéos immédiatement.</p>
    </td>
    <td width="20%">
      <img src="public/icon.png" alt="App Icon" width="128">
    </td>
  </tr>
</table>

![Image de l'application (recherche)](<public/app-image(searched)_en.png>)
![Image de l'application (fusion)](<public/app-image(merging)_en.png>)

> [!WARNING]
> Cette application est destinée à un usage éducatif et personnel. Respectez les conditions d'utilisation et les lois sur le droit d'auteur. Ne téléchargez ni ne redistribuez de contenu sans l'autorisation des détenteurs de droits.

## ⭐ Mettez une étoile à ce dépôt pour me motiver

Je développe cela en tant que loisir. Sans étoiles, je fermerai le projet 😄

<div align="center">
  <img src="assets/star-github.gif" alt="Star">
</div>

## Fonctionnalités

### Téléchargement

- **Téléchargement vidéo haute qualité** - Choisissez n'importe quelle qualité : 4K/1080p/720p/HDR
- **Sauvegarde par lot de vidéos multi-parties** - Téléchargez automatiquement toutes les parties de cours, séries, etc.
- **Téléchargements rapides et stables** - Changement automatique de CDN
- **Traitement en arrière-plan** - Gestion de file avec progression en temps réel
- **Incorporation de sous-titres** - Sélection de sous-titres souples/durs avec support multilingue
- **Audio haute résolution** - Prise en charge Dolby Atmos et Hi-Res Lossless

### Facilité d'utilisation

- **Interface en 6 langues** - English / 日本語 / Français / Español / 中文 / 한국어
- **Configuration en un clic** - Installation automatique de FFmpeg, sans configuration manuelle
- **Recherche et exportation de l'historique** - Exportez l'historique de téléchargement en JSON/CSV
- **Support du mode sombre** - Basculement thème clair/sombre

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

Les traductions sont également appréciées — consultez [CONTRIBUTING.md](./CONTRIBUTING.md) pour plus de détails.

## Remerciements

- L'équipe et la communauté Tauri
- OSS comme shadcn/ui, Radix UI, sonner

## Licence

MIT License — voir [LICENSE](./LICENSE) pour plus de détails.
