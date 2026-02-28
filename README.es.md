# BILIBILI-DOWNLOADER-GUI

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![Windows](https://img.shields.io/badge/Windows-Compatible-0078D6?style=flat-square&logo=windows)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-Compatible-000000?style=flat-square&logo=apple)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
![Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=flat-square&label=Descargas)
[![Latest Release](https://img.shields.io/github/v/release/j4rviscmd/bilibili-downloader-gui?style=flat-square&label=Último)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![CI](https://github.com/j4rviscmd/bilibili-downloader-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/j4rviscmd/bilibili-downloader-gui/actions/workflows/ci.yml)
[![Last Commit](https://img.shields.io/github/last-commit/j4rviscmd/bilibili-downloader-gui/main?style=flat-square&label=Última%20actualización)](https://github.com/j4rviscmd/bilibili-downloader-gui/commits/main)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

<table width="100%">
  <tr>
    <td width="80%">
      <p><strong>Interfaz gráfica de descarga de videos de Bilibili para Windows y macOS.</strong></p>
      <p>Sin configuración. Instala y comienza a descargar videos de inmediato.</p>
    </td>
    <td width="20%">
      <img src="public/icon.png" alt="App Icon" width="128">
    </td>
  </tr>
</table>

![Imagen de la aplicación (búsqueda)](<public/app-image(searched)_en.png>)
![Imagen de la aplicación (fusionando)](<public/app-image(merging)_en.png>)

> [!WARNING]
> Esta aplicación está destinada a uso educativo y personal. Respeta los términos de servicio y las leyes de derechos de autor. No descargues ni redistribuyas contenido sin permiso de los titulares de derechos.

## ⭐ Dale una estrella a este repositorio para mantenerme motivado

Desarrollo esto como hobby. Sin estrellas, cerraré el proyecto 😄

<div align="center">
  <img src="assets/star-github.gif" alt="Star">
</div>

## Características

### Descarga

- **Descarga de video de alta calidad** - Elige cualquier calidad: 4K/1080p/720p/HDR
- **Guardado por lotes de videos multiparte** - Descarga automáticamente todas las partes de cursos, series, etc.
- **Descargas rápidas y estables** - Cambio automático de CDN
- **Procesamiento en segundo plano** - Gestión de cola con progreso en tiempo real
- **Incrustación de subtítulos** - Selección de subtítulos blandos/duros con soporte multiidioma
- **Audio de alta resolución** - Compatible con Dolby Atmos y Hi-Res Lossless

### Facilidad de uso

- **Interfaz en 6 idiomas** - English / 日本語 / Français / Español / 中文 / 한국어
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

Las traducciones también son apreciadas — consulta [CONTRIBUTING.md](./CONTRIBUTING.md) para más detalles.

## Agradecimientos

- El equipo y la comunidad de Tauri
- OSS como shadcn/ui, Radix UI, sonner

## Licencia

MIT License — consulta [LICENSE](./LICENSE) para más detalles.
