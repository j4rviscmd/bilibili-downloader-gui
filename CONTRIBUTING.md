# Contributing to Bilibili Downloader GUI

Thank you for your interest in contributing to Bilibili Downloader GUI!
This document covers workflow conventions, project architecture, and
code rules.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Code Style](#code-style)
- [Testing](#testing)

## Getting Started

Requires **Node.js 20+**, **Rust (stable)**, and the platform-specific
[Tauri prerequisites](https://tauri.app/start/prerequisites/) (Xcode CLT
on macOS, MSVC Build Tools + WebView2 on Windows).

```bash
npm install && npm run tauri dev
```

See `package.json` scripts for all available commands.

## Development Workflow

This project follows **GitHub Flow**. All changes go through feature
branches and pull requests — never commit directly to `main`.

### Branch Naming

Use descriptive branch names with prefixes:

- `feature/` — new features (e.g., `feature/add-download-queue`)
- `fix/` — bug fixes (e.g., `fix/cookie-parsing-error`)
- `docs/` — documentation changes (e.g., `docs/update-readme`)
- `refactor/` — code refactoring (e.g., `refactor/simplify-api-calls`)

### Commit Message Convention

This project uses
[Conventional Commits](https://www.conventionalcommits.org/).

```text
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

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

Examples:

```bash
feat(video): add batch download support
fix(cookie): handle Firefox cookie encryption on macOS
docs(readme): update installation instructions
```

### Submitting Pull Requests

Before submitting:

1. Ensure your branch is up to date with `main`
2. Run type checking: `npm run typecheck`
3. Run linting: `npm run lint`
4. Run tests: `npm test` (and `cargo test` in `src-tauri/` for Rust
   changes)
5. Test your changes locally with `npm run tauri dev`

PR guidelines:

- **One PR per feature/fix** — keep PRs focused and reviewable
- **Write a clear description** — explain what and why
- **Reference related issues** — use `Fixes #123` or `Closes #123`
- **Keep commits clean** — squash or rebase if needed before merging
- **Write in English** — PR titles/descriptions, commit messages, and
  code comments
- **CI must be green before review** — PRs are reviewed only after all
  required checks (the `ci-status` aggregate) pass
- **CodeQL scans every PR** (JavaScript/TypeScript, Actions, Rust) —
  informational, not required; triage any alerts it raises in the
  Security tab

## Project Structure

### Frontend (co-location)

The frontend uses a **feature-based, co-located** folder strategy:

```txt
src/
  ├── app/          # Application wiring (providers, store)
  ├── pages/        # Route-level screens (one folder per route)
  ├── features/     # Feature modules (video, settings, history, ...)
  ├── shared/       # Cross-feature building blocks (ui, layout, hooks, ...)
  ├── components/   # shadcn/ui components (install target)
  ├── lib/          # shadcn utilities like cn() (install target)
  ├── hooks/        # shadcn hooks (install target)
  ├── i18n/         # react-i18next setup + locales/
  ├── styles/       # Global styles (Tailwind CSS)
  └── assets/       # Static assets
```

> `src/components`, `src/lib`, and `src/hooks` are the install targets
> configured in `components.json`. Install shadcn/ui components with
> `npx shadcn@latest add <component>` instead of creating files by hand.

Each feature in `src/features/` co-locates everything it needs:

```txt
features/video/
  ├── ui/          # Feature-specific UI components
  ├── model/       # Redux Toolkit slice, selectors
  ├── hooks/       # Feature hooks
  ├── api/         # Feature-specific API functions
  ├── lib/         # Internal utilities for the feature
  ├── types.ts     # Feature-local types
  └── index.ts     # Public API (recommended import entry point)
```

### Import Rules

- `pages` may import from `features` and `shared`
- `features` must not import from `pages`
- Avoid importing directly from other `features`. Prefer composition in
  `pages`
- Prefer importing from a feature's `index.ts` (public API) instead of
  deep paths

### Backend (Tauri / Rust)

```txt
src-tauri/src/
  ├── main.rs       # Entry point (kept thin)
  ├── lib.rs        # App root module / command definitions
  ├── handlers/     # Implementations of Tauri commands
  ├── models/       # Data structures (requests/responses, etc.)
  ├── utils/        # Utilities (downloads, ffmpeg, cdn_selector, ...)
  ├── store/        # Persistent stores
  └── ...           # menu.rs, window.rs, emits.rs, constants.rs
```

- The Rust command name must match the string passed to `invoke()` on
  the TypeScript side (snake_case)
- New commands must be registered in the `invoke_handler`
  (`generate_handler!`) in `src-tauri/src/lib.rs`
- Dev-only features are gated behind `#[cfg(debug_assertions)]`

## Code Style

One rule beyond what CI enforces:

- All user-facing text must use i18n (`react-i18next`)

## Testing

```bash
npm test && cd src-tauri && cargo test
```

Two policies to know:

- Every new or changed testable logic ships with unit tests
- Tests never hit live Bilibili APIs — network code is tested against
  a local [wiremock](https://crates.io/crates/wiremock) server

---

Thank you for contributing!
