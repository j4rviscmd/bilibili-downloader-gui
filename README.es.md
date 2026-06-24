<div align="center">

# Bilibili Downloader GUI

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./public/app-image(searched)_en.png">
  <img src="./public/app-image(searched)_en_light.png" alt="App Image">
</picture>

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | Español | [Français](README.fr.md)

[![Windows](https://img.shields.io/badge/Windows-Supported-0078D6?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+V2luZG93cyAxMTwvdGl0bGU+PHBhdGggZmlsbD0iIzAwQTRFRiIgZD0iTTAsMEgxMS4zNzdWMTEuMzcySDBaTTEyLjYyMywwSDI0VjExLjM3MkgxMi42MjNaTTAsMTIuNjIzSDExLjM3N1YyNEgwWm0xMi42MjMsMEgyNFYyNEgxMi42MjMiLz48L3N2Zz4=)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_Windows_x64-setup.exe)
[![macOS](https://img.shields.io/badge/macOS-Supported-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_macOS_arm64.dmg)
[![Linux](https://img.shields.io/badge/Linux-Supported-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_Linux_x64.deb)
[![Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=for-the-badge&color=blue&logo=github&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases)<br/>
[![Latest Release](https://img.shields.io/github/v/release/j4rviscmd/bilibili-downloader-gui?style=for-the-badge&color=green&label=Latest&logo=github&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest)
[![Last Commit](https://img.shields.io/github/last-commit/j4rviscmd/bilibili-downloader-gui/main?style=for-the-badge&color=1F6FEB&label=Last%20Update&logo=git&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/commits/main)
[![CI](https://img.shields.io/github/actions/workflow/status/j4rviscmd/bilibili-downloader-gui/ci.yml?style=for-the-badge&label=CI&color=brightgreen&logo=githubactions&logoColor=white)](https://github.com/j4rviscmd/bilibili-downloader-gui/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-018FF5?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)

## Descargador de videos de Bilibili para Windows, macOS y Linux

Sin anuncios, sin seguimiento. 100% gratis.

</div>

## Características

### Descarga

- **Descarga de video de alta calidad** - Elige cualquier calidad: 4K/1080p/720p/HDR
- **Soporte de Bangumi (anime y series)** - Descarga episodios de anime y series además de videos regulares
- **Guardado por lotes de videos multiparte** - Descarga automáticamente todas las partes de cursos, series, etc.
- **Descargas rápidas y estables** - Cambio automático de CDN con reintento automático ante errores de red
- **Procesamiento en segundo plano** - Gestión de cola con progreso en tiempo real
- **Incrustación de subtítulos** - Selección de subtítulos blandos/duros con soporte multiidioma y subtítulos con IA
- **Audio de alta resolución** - Compatible con Dolby Atmos y Hi-Res Lossless

### Herramientas locales de MP4

- **Recortar** - Corta archivos MP4 locales por tiempo de inicio/fin (copia sin pérdida o recodificación)
- **Concatenar** - Fusiona varios archivos MP4 en uno (recodificación automática si los códecs no coinciden)
- **Extracción de audio** - Extrae audio de MP4 local a MP3/M4A con presets de bitrate

### Integración con Bilibili

- **Favoritos** - Explora y descarga videos de tus carpetas de favoritos de Bilibili
- **Historial de visualización** - Descarga videos directamente de tu historial de visualización de Bilibili
- **Expansión automática de URL corta** - Los enlaces cortos de b23.tv se expanden automáticamente a la URL completa del video

### Facilidad de uso

- **Interfaz en 6 idiomas** - Inglés / Japonés / Francés / Español / Chino / Coreano
- **Configuración con un clic** - Instalación automática de FFmpeg con validación de funcionamiento, sin configuración manual
- **Actualización automática** - Actualizador integrado con verificación de versiones firmadas y notas de versión
- **Búsqueda y exportación de historial** - Exporta el historial de descargas a JSON/CSV
- **Soporte de modo oscuro** - Alternancia de tema claro/oscuro

### Métodos de autenticación

- **Detección automática de cookies de Firefox** - Detecta las cookies de Firefox para descargas de alta calidad sin inicio de sesión manual
- **Inicio de sesión con código QR** - Escanea el código QR en la aplicación para iniciar sesión
  - Alterna entre Cookie e inicio de sesión QR en cualquier momento

### Privacidad y seguridad

- **Gestión segura de credenciales** - Las credenciales de inicio de sesión con código QR se cifran con AES-256-GCM y se almacenan localmente. La derivación de claves con Argon2id garantiza protección específica por máquina.
- **Almacenamiento solo local** - Los videos descargados se almacenan solo en tu PC
- **Sin seguimiento** - Solo se comunica con las APIs de Bilibili y GitHub (para actualizaciones); sin telemetría

## Instalación

| Plataforma                | Descarga                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **macOS (Apple Silicon)** | [bilibili-downloader-gui_macOS_arm64.dmg](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_macOS_arm64.dmg)                     |
| **macOS (Intel)**         | [bilibili-downloader-gui_macOS_x64.dmg](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_macOS_x64.dmg)                         |
| **Windows**               | [bilibili-downloader-gui_Windows_x64-setup.exe](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_Windows_x64-setup.exe)         |
| **Linux (deb)**           | [bilibili-downloader-gui_Linux_x64.deb](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_Linux_x64.deb)                         |
| **Linux (AppImage)**      | [bilibili-downloader-gui_Linux_x64.AppImage.tar.gz](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest/download/bilibili-downloader-gui_Linux_x64.AppImage.tar.gz) |

> [!NOTE]
> Las compilaciones de macOS usan firma de código ad-hoc (sin notarización de Apple). En el primer inicio, ve a **Configuración del Sistema > Privacidad y Seguridad** y haz clic en **Abrir de todos modos**. Alternativamente, ejecuta:
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

> [!WARNING]
> Esta aplicación está destinada a uso personal y educativo. Respeta los términos de servicio y las leyes de derechos de autor.<br/>
> No descargues ni redistribuyas contenido sin permiso de los titulares de derechos.<br/>
> Los autores no son responsables de ningún problema que pueda surgir del uso de este software.

MIT License — consulta [LICENSE](./LICENSE) para más detalles.
