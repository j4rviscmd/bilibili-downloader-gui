# BILIBILI-DOWNLOADER-GUI

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8DB)
![React + Vite + TS](https://img.shields.io/badge/React%20%2B%20Vite-TypeScript-2ea44f)
![GitHub Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=flat-square)

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

![Star](docs/images/star-github.gif)

## Fonctionnalités

### Téléchargement

- **Téléchargement vidéo haute qualité** - Choisissez n'importe quelle qualité : 4K/1080p/720p
- **Sauvegarde par lot de vidéos multi-parties** - Téléchargez automatiquement toutes les parties de cours, séries, etc.
- **Téléchargements rapides et stables** - Changement automatique de CDN si lent, jusqu'à 5 tentatives
- **Traitement en arrière-plan** - Gestion de file avec progression en temps réel

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
