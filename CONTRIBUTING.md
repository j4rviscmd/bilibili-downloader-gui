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

| Command | Description |
| ------- | ----------- |
| `npm run tauri dev` | Start development server with HMR |
| `npm run tauri build` | Build distributable binaries |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Run ESLint |

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

| Type | Description |
| ---- | ----------- |
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting, no logic change) |
| `refactor` | Code refactoring (no feature or fix) |
| `test` | Adding or updating tests |
| `chore` | Maintenance tasks (deps, configs, etc.) |
| `ci` | CI/CD configuration changes |

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

---

Thank you for contributing!
