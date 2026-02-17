# BILIBILI-DOWNLOADER-GUI

[English](README.md) | [日本語](README.ja.md) | [简体中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8DB)
![React + Vite + TS](https://img.shields.io/badge/React%20%2B%20Vite-TypeScript-2ea44f)
![GitHub Downloads](https://img.shields.io/github/downloads/j4rviscmd/bilibili-downloader-gui/total?style=flat-square)

<table width="100%">
  <tr>
    <td width="80%">
      <p><strong>Interfaz gráfica de descarga de videos de Bilibili para Windows y macOS.</strong></p>
      <p>El frontend está construido con React + Vite; la aplicación de escritorio está impulsada por Tauri (Rust).</p>
    </td>
    <td width="20%">
      <img src="public/icon.png" alt="App Icon" width="128">
    </td>
  </tr>
</table>

> Aviso: Esta aplicación está destinada a uso educativo y personal. Respeta los términos de servicio y las leyes de derechos de autor. No descargues ni redistribuyas contenido sin permiso de los titulares de derechos.

![Imagen de la aplicación](public/app-image_en.png)

## ⭐ Dale una estrella a este repositorio para mantenerme motivado

Desarrollo esto en mi tiempo libre. ¡Cada estrella muestra que mi trabajo es valorado y me mantiene adelante!

![Star](docs/images/star-github.gif)

## 🎯 Características

- Obtener información de videos de Bilibili y asistir en la descarga
- Aplicación de escritorio ligera y rápida construida con Tauri
- Alternancia de tema claro/oscuro (basado en shadcn/ui)
- Indicador de progreso y notificaciones toast
- Interfaz multiidioma (English / 日本語 / Français / Español / 中文 / 한국어)

## 💻 Instalación

Descarga desde el [último lanzamiento](https://github.com/j4rviscmd/bilibili-downloader-gui/releases/latest).

### macOS

- **Apple Silicon**: `bilibili-downloader-gui_<version>_aarch64.dmg`
- **Intel x64**: `bilibili-downloader-gui_<version>_x64.dmg`

### Windows

- **Instalador** (recomendado): `bilibili-downloader-gui_<version>_x64-setup.exe`
- **MSI** (alternativo): `bilibili-downloader-gui_<version>_x64_en-US.msi`

> **Nota**: Las compilaciones de macOS no están firmadas. En el primer inicio, haz clic derecho en la aplicación → Abrir → Abrir, o ejecuta:
>
> ```bash
> xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
> ```

## 🍎 macOS: Primer inicio de compilaciones no firmadas

Si ejecutas una compilación que no está notariada/firmada con un certificado de Apple Developer (por ejemplo, artefactos de CI), es posible que macOS Gatekeeper bloquee la aplicación. Puedes:

- Hacer clic derecho en la aplicación → Abrir → Abrir, o
- Eliminar los atributos de cuarentena/extendidos:

```bash
# Reemplaza la ruta con el nombre/ubicación real de tu aplicación instalada
xattr -dr com.apple.quarantine "/Applications/bilibili-downloader-gui.app"
# o borra todos los atributos extendidos
xattr -c "/Applications/bilibili-downloader-gui.app"
```

Si instalaste la aplicación fuera de /Applications, ajusta la ruta en consecuencia.

---

## 👨‍💻 Para desarrolladores

Las siguientes secciones están destinadas a desarrolladores que quieren compilar, modificar o contribuir a este proyecto.

## 📦 Requisitos

- Node.js 18+ (LTS recomendado)
- Rust (stable)
- Toolchain requerido por las compilaciones de Tauri (por ejemplo, Xcode Command Line Tools en macOS)

Ver: [Documentación oficial de Tauri](https://tauri.app/)

## 💻 Sistemas operativos compatibles

- Windows 10/11
- macOS 12+ (Intel y Apple Silicon)

## 🚀 Inicio rápido (Desarrollo)

1. Instalar dependencias
   - `npm i`
2. Iniciar el servidor de desarrollo de Tauri
   - `npm run tauri dev`

## 🔨 Compilación (Binarios distribuibles)

- `npm run tauri build`
  - Los artefactos generalmente se generan en `src-tauri/target/release/` (varía según el SO).

## Estructura de directorios (Co-location)

Usamos una estrategia de carpetas **basada en funcionalidades y co-ubicadas**.

```txt
src/
  ├── app/                      # Configuración de la aplicación
  │   ├── providers/            # Proveedores globales (Theme, Listener)
  │   └── store/                # Configuración de Redux store
  ├── pages/                    # Pantallas a nivel de ruta
  │   ├── home/
  │   │   └── index.tsx
  │   ├── init/
  │   │   └── index.tsx
  │   └── error/
  │       └── index.tsx
  ├── features/                 # Módulos de funcionalidad
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
  ├── shared/                   # Recursos compartidos
  │   ├── ui/                   # Componentes shadcn/ui, AppBar, Progress
  │   ├── animate-ui/           # Componentes de UI animados
  │   ├── hooks/                # useIsMobile, etc.
  │   ├── lib/                  # cn(), utilidades
  │   ├── progress/             # Gestión del estado de progreso
  │   ├── downloadStatus/       # Estado de descarga
  │   ├── queue/                # Estado de cola
  │   └── os/                   # API de detección de SO
  ├── i18n/                     # Internacionalización
  │   └── locales/              # Archivos de traducción
  ├── styles/                   # Estilos globales
  └── assets/                   # Activos estáticos
```

### Responsabilidades de los directorios

#### `src/app/`

Configuración de la aplicación a nivel raíz. Aquí es donde se ensambla la aplicación: proveedores globales y configuración del store.

#### `src/pages/`

Pantallas a nivel de ruta. Las páginas deben principalmente **componer** funcionalidades y UI compartida. Mantén la lógica de negocio/estado dentro de `features/`.

#### `src/features/`

Funcionalidades de producto reutilizables (comportamiento orientado al usuario). Cada funcionalidad co-ubica su lógica Redux, llamadas API y UI.

Una carpeta de funcionalidad típica contiene:

- `ui/` — Componentes de UI específicos de la funcionalidad
- `model/` — Redux Toolkit slice, selectors
- `hooks/` — Hooks de la funcionalidad
- `api/` — Funciones API específicas de la funcionalidad
- `lib/` — Utilidades internas de la funcionalidad
- `types.ts` — Tipos locales de la funcionalidad
- `index.ts` — **Public API** de la funcionalidad (punto de entrada recomendado para importaciones)

#### `src/shared/`

Bloques de construcción reutilizables no específicos de dominio utilizados en toda la aplicación.

- `shared/ui/` — Primitivas de UI reutilizables en toda la aplicación (shadcn/ui, componentes personalizados)
- `shared/animate-ui/` — Componentes de UI animados
- `shared/lib/` — Utilidades genéricas (por ejemplo, `cn()`)
- `shared/hooks/` — React hooks reutilizables

### Reglas de importación

- `pages` puede importar desde `features` y `shared`.
- `features` no debe importar desde `pages`.
- Evita importar directamente desde otros `features`. Prefiere la composición en `pages`.
- Prefiere importar desde el `index.ts` de una funcionalidad (Public API) en lugar de rutas profundas.

### Alias de ruta

- `@/app/*`
- `@/pages/*`
- `@/features/*`
- `@/shared/*`

### Backend (Tauri / Rust)

```txt
src-tauri/src/
  main.rs            ← Punto de entrada (mantenido simple)
  lib.rs             ← Módulo raíz de la app / definiciones de comandos
  handlers/          ← Implementaciones de comandos
  models/            ← Estructuras de datos (solicitudes/respuestas, etc.)
  utils/             ← Utilidades
```

## ⚙️ Scripts

- Desarrollo: `npm run tauri dev`
- Compilación: `npm run tauri build`

## 🛠️ Stack tecnológico

- Frontend: React, Vite, TypeScript, Redux Toolkit, shadcn/ui, animate‑ui
- Desktop: Tauri (Rust)

## ❌ Códigos de error

Códigos de error devueltos (mapeados a i18n en el frontend):

- `ERR::COOKIE_MISSING` Cookie faltante o inválida
- `ERR::QUALITY_NOT_FOUND` ID de calidad solicitado no disponible
- `ERR::DISK_FULL` Espacio libre en disco insuficiente
- `ERR::FILE_EXISTS` Conflicto de archivo no resoluble automáticamente
- `ERR::NETWORK::<detail>` Fallo de red después de reintentos
- `ERR::MERGE_FAILED` Proceso de fusión ffmpeg fallido

## 🔮 Futuro

- [ ] Seleccionar destino de descarga
- [ ] Permitir sobrescribir archivos existentes
- [ ] Cola de múltiples elementos para descarga
- [ ] Retención del historial de descargas
- [ ] Lanzamiento de instancia única de la app (evitar múltiples lanzamientos concurrentes)

## 🌍 Localización (i18n)

Idiomas actualmente soportados:

- English (en)
- 日本語 (ja)
- Français (fr)
- Español (es)
- 中文 (zh)
- 한국어 (ko)

Se agradecen contribuciones para idiomas adicionales. Si encuentras una frase antinatural o incómoda, por favor abre un Pull Request.

## 🤝 Contribuir

Se agradecen Issues y PRs. Para cambios grandes, por favor inicia una discusión en un Issue primero. Las correcciones pequeñas (documentación, erratas, ajustes menores de UI) son apreciadas.

## 📜 Licencia

MIT License — ver [LICENSE](./LICENSE) para más detalles.

## 🙏 Agradecimientos

- El equipo y la comunidad de Tauri
- OSS como shadcn/ui, Radix UI, sonner

---

Si encuentras este proyecto útil, por favor considera darle una estrella al repositorio — realmente ayuda a motivar el desarrollo continuo.
