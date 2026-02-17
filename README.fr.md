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
      <p>Le frontend est construit avec React + Vite ; l'application de bureau est propulsée par Tauri (Rust).</p>
    </td>
    <td width="20%">
      <img src="public/icon.png" alt="App Icon" width="128">
    </td>
  </tr>
</table>

> Remarque : Cette application est destinée à un usage éducatif et personnel. Respectez les conditions d'utilisation et les lois sur le droit d'auteur. Ne téléchargez ni ne redistribuez de contenu sans l'autorisation des détenteurs de droits.

![Image de l'application](public/app-image_fr.png)

## ⭐ Mettez une étoile à ce dépôt pour me motiver

Je développe ceci sur mon temps libre. Chaque étoile montre que mon travail est apprécié et me encourage à continuer !

![Star](docs/images/star-github.gif)

## 🎯 Fonctionnalités

- Récupérer les informations des vidéos Bilibili et assister au téléchargement
- Application de bureau légère et rapide construite avec Tauri
- Basculement thème clair/sombre (basé sur shadcn/ui)
- Indicateur de progression et notifications toast
- Interface multilingue (English / 日本語 / Français / Español / 中文 / 한국어)

## 💻 Installation

Téléchargez depuis la [dernière version](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest).

### macOS

- **Apple Silicon** : `bilibili-downloader-gui_<version>_aarch64.dmg`
- **Intel x64** : `bilibili-downloader-gui_<version>_x64.dmg`

### Windows

- **Installateur** (recommandé) : `bilibili-downloader-gui_<version>_x64-setup.exe`
- **MSI** (alternative) : `bilibili-downloader-gui_<version>_x64_en-US.msi`

> **Note** : Les builds macOS ne sont pas signés. Au premier lancement, faites un clic droit sur l'application → Ouvrir → Ouvrir, ou exécutez :
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
> ```

## 🍎 macOS : Premier lancement des builds non signés

Si vous exécutez un build qui n'est pas notarisé/signé avec un certificat Apple Developer (par ex., artefacts CI), macOS Gatekeeper peut bloquer l'application. Vous pouvez :

- Faire un clic droit sur l'application → Ouvrir → Ouvrir, ou
- Supprimer les attributs de quarantaine/étendus :

```bash
# Remplacez le chemin par le nom/emplacement réel de votre application installée
xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
# ou effacez tous les attributs étendus
xattr -c "/Applications/bilibili-downloader-gui.app"
```

Si vous avez installé l'application en dehors de /Applications, ajustez le chemin en conséquence.

---

## 👨‍💻 Pour les développeurs

Les sections suivantes sont destinées aux développeurs qui souhaitent compiler, modifier ou contribuer à ce projet.

## 📦 Prérequis

- Node.js 18+ (LTS recommandé)
- Rust (stable)
- Toolchain requis par les builds Tauri (par ex., Xcode Command Line Tools sur macOS)

Voir : [Documentation officielle de Tauri](https://tauri.app/)

## 💻 Systèmes d'exploitation pris en charge

- Windows 10/11
- macOS 12+ (Intel et Apple Silicon)

## 🚀 Démarrage rapide (Développement)

1. Installer les dépendances
   - `npm i`
2. Démarrer le serveur de développement Tauri
   - `npm run tauri dev`

## 🔨 Compilation (Binaires distribuables)

- `npm run tauri build`
  - Les artefacts sont généralement générés dans `src-tauri/target/release/` (varie selon le système d'exploitation).

## Structure des répertoires (Co-location)

Nous utilisons une stratégie de dossier **basée sur les fonctionnalités et co-localisée**.

```txt
src/
  ├── app/                      # Configuration de l'application
  │   ├── providers/            # Fournisseurs globaux (Theme, Listener)
  │   └── store/                # Configuration du store Redux
  ├── pages/                    # Écrans au niveau des routes
  │   ├── home/
  │   │   └── index.tsx
  │   ├── init/
  │   │   └── index.tsx
  │   └── error/
  │       └── index.tsx
  ├── features/                 # Modules de fonctionnalités
  │   ├── video/
  │   │   ├── ui/               # VideoForm1, VideoForm2, DownloadButton, etc.
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
  ├── shared/                   # Ressources partagées
  │   ├── ui/                   # Composants shadcn/ui, AppBar, Progress
  │   ├── animate-ui/           # Composants UI animés
  │   ├── hooks/                # useIsMobile, etc.
  │   ├── lib/                  # cn(), utilitaires
  │   ├── progress/             # Gestion de l'état de progression
  │   ├── downloadStatus/       # État de téléchargement
  │   ├── queue/                # État de la file d'attente
  │   └── os/                   # API de détection du système d'exploitation
  ├── i18n/                     # Internationalisation
  │   └── locales/              # Fichiers de traduction
  ├── styles/                   # Styles globaux
  └── assets/                   # Ressources statiques
```

### Responsabilités des répertoires

#### `src/app/`

Configuration de l'application au niveau racine. C'est là que l'application est assemblée : fournisseurs globaux et configuration du store.

#### `src/pages/`

Écrans au niveau des routes. Les pages doivent principalement **composer** des fonctionnalités et de l'UI partagée. Gardez la logique métier/état à l'intérieur de `features/`.

#### `src/features/`

Fonctionnalités produit réutilisables (comportement orienté utilisateur). Chaque fonctionnalité co-localise sa logique Redux, ses appels API et son UI.

Un dossier de fonctionnalité typique contient :

- `ui/` — Composants UI spécifiques à la fonctionnalité
- `model/` — Redux Toolkit slice, selectors
- `hooks/` — Hooks de la fonctionnalité
- `api/` — Fonctions API spécifiques à la fonctionnalité
- `lib/` — Utilitaires internes de la fonctionnalité
- `types.ts` — Types locaux de la fonctionnalité
- `index.ts` — **Public API** de la fonctionnalité (point d'entrée recommandé pour les imports)

#### `src/shared/`

Blocs de construction réutilisables non spécifiques au domaine utilisés dans toute l'application.

- `shared/ui/` — Primitives UI réutilisables dans toute l'application (shadcn/ui, composants personnalisés)
- `shared/animate-ui/` — Composants UI animés
- `shared/lib/` — Utilitaires génériques (par ex., `cn()`)
- `shared/hooks/` — React hooks réutilisables

### Règles d'importation

- `pages` peut importer depuis `features` et `shared`.
- `features` ne doit pas importer depuis `pages`.
- Évitez d'importer directement depuis d'autres `features`. Préférez la composition dans `pages`.
- Préférez importer depuis le `index.ts` d'une fonctionnalité (Public API) plutôt que des chemins profonds.

### Alias de chemin

- `@/app/*`
- `@/pages/*`
- `@/features/*`
- `@/shared/*`

### Backend (Tauri / Rust)

```txt
src-tauri/src/
  main.rs            ← Point d'entrée (gardé simple)
  lib.rs             ← Module racine de l'application / définitions des commandes
  handlers/          ← Implémentations des commandes
  models/            ← Structures de données (requêtes/réponses, etc.)
  utils/             ← Utilitaires
```

## ⚙️ Scripts

- Développement : `npm run tauri dev`
- Compilation : `npm run tauri build`

## 🛠️ Stack technique

- Frontend : React, Vite, TypeScript, Redux Toolkit, shadcn/ui, animate‑ui
- Desktop : Tauri (Rust)

## ❌ Codes d'erreur

Codes d'erreur retournés (mappés à i18n dans le frontend) :

- `ERR::COOKIE_MISSING` Cookie manquant ou invalide
- `ERR::QUALITY_NOT_FOUND` ID de qualité demandé non disponible
- `ERR::DISK_FULL` Espace disque libre insuffisant
- `ERR::FILE_EXISTS` Conflit de fichier non résolvable automatiquement
- `ERR::NETWORK::<detail>` Échec réseau après tentatives
- `ERR::MERGE_FAILED` Échec du processus de fusion ffmpeg

## 🔮 Futur

- [ ] Sélectionner la destination de téléchargement
- [ ] Autoriser l'écrasement des fichiers existants
- [ ] Mise en file d'attente de plusieurs éléments pour téléchargement
- [ ] Rétention de l'historique de téléchargement
- [ ] Lancement en instance unique (empêcher les lancements simultanés multiples)

## 🌍 Localisation (i18n)

Langues actuellement prises en charge :

- English (en)
- 日本語 (ja)
- Français (fr)
- Español (es)
- 中文 (zh)
- 한국어 (ko)

Les contributions pour des langues supplémentaires sont les bienvenues. Si vous trouvez une expression non naturelle ou maladroite, veuillez ouvrir une Pull Request.

## 🤝 Contribuer

Les Issues et PR sont les bienvenues. Pour les gros changements, veuillez d'abord lancer une discussion dans un Issue. Les petites corrections (documentation, coquilles, ajustements mineurs de l'UI) sont appréciées.

## 📜 Licence

MIT License — voir [LICENSE](./LICENSE) pour plus de détails.

## 🙏 Remerciements

- L'équipe et la communauté Tauri
- Les OSS comme shadcn/ui, Radix UI, sonner

---

Si vous trouvez ce projet utile, veuillez envisager de mettre une étoile au dépôt — cela aide vraiment à motiver le développement continu.
