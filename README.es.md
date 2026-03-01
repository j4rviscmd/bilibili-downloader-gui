<div align="center">

# Bilibili Downloader GUI

![App Image](<public/app-image(searched)_en_light.png>)

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | Español | [Français](README.fr.md)

[![Windows](https://img.shields.io/badge/Windows-Supported-0078D6?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+V2luZG93cyAxMTwvdGl0bGU+PHBhdGggZmlsbD0iIzAwQTRFRiIgZD0iTTAsMEgxMS4zNzdWMTEuMzcySDBaTTEyLjYyMywwSDI0VjExLjM3MkgxMi42MjNaTTAsMTIuNjIzSDExLjM3N1YyNEgwWm0xMi42MjMsMEgyNFYyNEgxMi42MjMiLz48L3N2Zz4=)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-Supported-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=for-the-badge&color=blue&logo=github&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases)<br/>
[![Latest Release](https://img.shields.io/github/v/release/j4rviscmd/bilibili-downloader-gui?style=for-the-badge&color=green&label=Latest&logo=github&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![Last Commit](https://img.shields.io/github/last-commit/j4rviscmd/bilibili-downloader-gui/main?style=for-the-badge&color=1F6FEB&label=Last%20Update&logo=git&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/commits/main)
[![CI](https://img.shields.io/github/actions/workflow/status/j4rviscmd/bilibili-downloader-gui/ci.yml?style=for-the-badge&label=CI&color=brightgreen&logo=githubactions&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-018FF5?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)

## Descargador de videos de Bilibili para Windows y macOS

Sin anuncios, sin seguimiento. 100% gratis.

</div>

> [!WARNING]
> Esta aplicación está destinada a uso personal y educativo. Respeta los términos de servicio y las leyes de derechos de autor.<br/>
> No descargues ni redistribuyas contenido sin permiso de los titulares de derechos.

## Características

### Descarga

- **Descarga de video de alta calidad** - Elige cualquier calidad: 4K/1080p/720p/HDR
- **Guardado por lotes de videos multiparte** - Descarga automáticamente todas las partes de cursos, series, etc.
- **Descargas rápidas y estables** - Cambio automático de CDN
- **Procesamiento en segundo plano** - Gestión de cola con progreso en tiempo real
- **Incrustación de subtítulos** - Selección de subtítulos blandos/duros con soporte multiidioma
- **Audio de alta resolución** - Compatible con Dolby Atmos y Hi-Res Lossless

### Facilidad de uso

- **Interfaz en 6 idiomas** - Inglés / Japonés / Francés / Español / Chino / Coreano
- **Configuración con un clic** - Instalación automática de FFmpeg, sin configuración manual
- **Búsqueda y exportación de historial** - Exporta el historial de descargas a JSON/CSV
- **Soporte de modo oscuro** - Alternancia de tema claro/oscuro
- **Experiencia sin publicidad** - Sin anuncios, sin rastreo, completamente gratis

### Sin inicio de sesión y privacidad primero

- **Detección automática de cookies de Firefox** - Descargas de alta calidad sin inicio de sesión manual
- **Almacenamiento solo local** - Todos los datos se guardan solo en tu PC

## Instalación

Descarga desde el [último lanzamiento](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest).

### macOS

- **Apple Silicon**: `bilibili-downloader-gui_<version>_aarch64.dmg`
- **Intel x64**: `bilibili-downloader-gui_<version>_x64.dmg`

### Windows

- **Instalador** (recomendado): `bilibili-downloader-gui_<version>_x64-setup.exe`
- **MSI** (alternativo): `bilibili-downloader-gui_<version>_x64_en-US.msi`

> [!NOTE]
> Las compilaciones de macOS no están firmadas. En el primer inicio, ejecuta:
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
> ```

## Contribuir

Issues y PRs son bienvenidos.

Las traducciones también son apreciadas — consulta [CONTRIBUTING.md](./CONTRIBUTING.md) para configuración de desarrollo y guías.

## Agradecimientos

- El equipo y la comunidad de Tauri
- OSS como shadcn/ui, Radix UI, sonner

## Licencia

MIT License — consulta [LICENSE](./LICENSE) para más detalles.
