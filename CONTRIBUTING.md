# Contributing to Bilibili Downloader GUI

Thank you for your interest in contributing to Bilibili Downloader GUI! This
document provides guidelines and instructions for contributing.

## Table of Contents

- [Development Environment Setup](#development-environment-setup)
- [Branch Strategy](#branch-strategy)
- [Commit Message Convention](#commit-message-convention)
- [Code Style Guidelines](#code-style-guidelines)
- [Submitting Issues](#submitting-issues)
- [Submitting Pull Requests](#submitting-pull-requests)

## Development Environment Setup

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **Rust** (stable)
- **Tauri Prerequisites** - Platform-specific dependencies required by Tauri:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Microsoft Visual Studio C++ Build Tools, WebView2
  - See [Tauri Prerequisites](https://tauri.app/start/prerequisites/) for
    details

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/j4rviscmd/bilibili-downloader-gui.git
   cd bilibili-downloader-gui
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the development server:

   ```bash
   npm run tauri dev
   ```

   This launches the Tauri app with hot module replacement (HMR) enabled.

### Useful Commands

| Command               | Description                       |
| --------------------- | --------------------------------- |
| `npm run tauri dev`   | Start development server with HMR |
| `npm run tauri build` | Build distributable binaries      |
| `npm run typecheck`   | Run TypeScript type checking      |
| `npm run lint`        | Run ESLint                        |

## Branch Strategy

This project follows **GitHub Flow**. All changes must go through feature
branches and pull requests.

### Rules

1. **Never commit directly to the `main` branch**
2. Always create a feature branch from `main`
3. Submit a Pull Request for review
4. Merge to `main` only after approval

### Branch Naming Convention

Use descriptive branch names with prefixes:

- `feature/` - New features (e.g., `feature/add-download-queue`)
- `fix/` - Bug fixes (e.g., `fix/cookie-parsing-error`)
- `docs/` - Documentation changes (e.g., `docs/update-readme`)
- `refactor/` - Code refactoring (e.g., `refactor/simplify-api-calls`)

### Workflow

```bash
# 1. Ensure you're on main and up to date
git checkout main
git pull origin main

# 2. Create a feature branch
git checkout -b feature/your-feature-name

# 3. Make your changes and commit
git add .
git commit -m "feat: add your feature"

# 4. Push to remote
git push -u origin feature/your-feature-name

# 5. Open a Pull Request on GitHub
```

## Commit Message Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```text
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Description                                      |
| ---------- | ------------------------------------------------ |
| `feat`     | A new feature                                    |
| `fix`      | A bug fix                                        |
| `docs`     | Documentation changes                            |
| `style`    | Code style changes (formatting, no logic change) |
| `refactor` | Code refactoring (no feature or fix)             |
| `test`     | Adding or updating tests                         |
| `chore`    | Maintenance tasks (deps, configs, etc.)          |
| `ci`       | CI/CD configuration changes                      |

### Examples

```bash
feat(video): add batch download support
fix(cookie): handle Firefox cookie encryption on macOS
docs(readme): update installation instructions
refactor(handlers): simplify error handling logic
```

## Code Style Guidelines

### TypeScript / JavaScript

- **Indentation**: 2 spaces
- **Naming**: camelCase for variables/functions, PascalCase for
  classes/components
- **Formatting**: Prettier (configured in the project)
- **Linting**: ESLint

### Rust

- **Formatting**: `cargo fmt` (default settings)
- **Linting**: `cargo clippy`

### General

- Maximum line length: 80 characters (where practical)
- Add comments for complex logic
- All user-facing text must use i18n (`react-i18next`)

## Submitting Issues

Before creating an issue:

1. Search existing issues to avoid duplicates
2. Use the appropriate issue template if available

When creating an issue, include:

- **Clear title** describing the problem or feature
- **Steps to reproduce** (for bugs)
- **Expected vs actual behavior** (for bugs)
- **Environment details** (OS, app version)
- **Screenshots** if applicable

## Submitting Pull Requests

### Before Submitting

1. Ensure your branch is up to date with `main`
2. Run type checking: `npm run typecheck`
3. Run linting: `npm run lint`
4. Test your changes locally with `npm run tauri dev`

### PR Guidelines

- **One PR per feature/fix** - Keep PRs focused and reviewable
- **Write a clear description** - Explain what and why
- **Reference related issues** - Use `Fixes #123` or `Closes #123`
- **Keep commits clean** - Squash or rebase if needed before merging

### PR Title Format

Follow the same convention as commit messages:

```text
feat(video): add batch download support
fix(cookie): handle Firefox cookie encryption on macOS
```

## Project Architecture

### Directory Structure (Co-location)

We use a **feature-based, co-located** folder strategy.

```txt
src/
  ├── app/                      # Application wiring
  │   ├── providers/            # Global providers (Theme, Listener)
  │   └── store/                # Redux store configuration
  ├── pages/                    # Route-level screens
  │   ├── home/
  │   │   └── index.tsx
  │   ├── init/
  │   │   └── index.tsx
  │   └── error/
  │       └── index.tsx
  ├── features/                 # Feature modules
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
  ├── shared/                   # Shared resources
  │   ├── ui/                   # shadcn/ui components, AppBar, Progress
  │   ├── animate-ui/           # Animated UI components
  │   ├── hooks/                # useIsMobile, etc.
  │   ├── lib/                  # cn(), utilities
  │   ├── progress/             # Progress state management
  │   ├── downloadStatus/       # Download status state
  │   ├── queue/                # Queue state
  │   └── os/                   # OS detection API
  ├── i18n/                     # Internationalization
  │   └── locales/              # Translation files
  ├── styles/                   # Global styles
  └── assets/                   # Static assets
```

### Directory Responsibilities

#### `src/app/`

Application wiring at the root level. This is where the application is assembled:
global providers and store setup.

#### `src/pages/`

Route-level screens. Pages should mainly **compose** features and shared UI.
Keep business logic/state inside `features/`.

#### `src/features/`

Reusable product features (user-facing behavior). Each feature co-locates its
Redux logic, API calls, and UI.

A typical feature folder contains:

- `ui/` — feature-specific UI components
- `model/` — Redux Toolkit slice, selectors
- `hooks/` — feature hooks
- `api/` — feature-specific API functions
- `lib/` — internal utilities for the feature
- `types.ts` — feature-local types
- `index.ts` — feature **public API** (recommended entry point for imports)

#### `src/shared/`

Reusable, non-domain-specific building blocks used across the app.

- `shared/ui/` — App-wide reusable UI primitives (shadcn/ui, custom components)
- `shared/animate-ui/` — Animated UI components
- `shared/lib/` — Generic utilities (e.g., `cn()`)
- `shared/hooks/` — Reusable React hooks

### Import Rules

- `pages` may import from `features` and `shared`.
- `features` must not import from `pages`.
- Avoid importing directly from other `features`. Prefer composition in `pages`.
- Prefer importing from a feature's `index.ts` (public API) instead of deep paths.

### Path Aliases

- `@/app/*`
- `@/pages/*`
- `@/features/*`
- `@/shared/*`

### Backend (Tauri / Rust)

```txt
src-tauri/src/
  main.rs            ← Entry point (kept thin)
  lib.rs             ← App root module / command definitions
  handlers/          ← Implementations of commands
  models/            ← Data structures (requests/responses, etc.)
  utils/             ← Utilities
```

### Tech Stack

- Frontend: React, Vite, TypeScript, Redux Toolkit, shadcn/ui, animate‑ui
- Desktop: Tauri (Rust)

---

Thank you for contributing!
