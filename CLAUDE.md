# CLAUDE.md

Essential rules for Claude Code when working in this repository. For
architecture, code style, and branch/commit conventions, see
CONTRIBUTING.md.

## Commands

| Command               | Purpose                      |
| --------------------- | ---------------------------- |
| `npm run tauri dev`   | Launch Tauri app (HMR)       |
| `npm run dev`         | Frontend only (Vite)         |
| `npm run build`       | Type-check + build           |
| `npm run typecheck`   | TypeScript type check        |
| `npm run lint`        | ESLint                       |
| `npm run test`        | Run Vitest                   |
| `npm run tauri build` | Build distributable binaries |
| `cargo build` / `fmt` | Rust (run in `src-tauri/`)   |

## Required Rules

### shadcn/ui

**IMPORTANT**: Never create component files by hand. Always install via:

```bash
npx shadcn@latest add <component>
```

### i18n (Internationalization)

- All user-facing text must go through `react-i18next`
- Translation key naming: `{feature}.{description}` (e.g.,
  `video.video_not_found`)
- **IMPORTANT**: When adding or changing a key in any language file,
  apply the same change to **all 6 languages
  (`en`/`ja`/`zh`/`ko`/`es`/`fr`)**. Adding to only some languages causes
  runtime errors. Verify:

  ```bash
  for f in src/i18n/locales/*.json; do echo "$f: $(grep -c '":' "$f")"; done
  ```

- Map backend `ERR::*` error codes to translation keys (e.g.,
  `ERR::VIDEO_NOT_FOUND` → `video.video_not_found`)

### Tauri Commands (Frontend ↔ Backend)

- The Rust command name must match the string passed to `invoke()` on
  the TS side (snake_case)
- New commands must be registered in the `invoke_handler`
  (`generate_handler!`) in `src-tauri/src/lib.rs`
- Gate dev-only features behind `#[cfg(debug_assertions)]`

### Tauri API Mock (tests)

```typescript
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
```

## Pre-verification Checklist

- Use `@hypothesi/tauri-mcp-server` to retrieve logs and HTML elements
- Before user verification, check the following:
  - `npm run lint` has no errors
  - `cargo build` compiles successfully
- Verification is performed by a human, as a rule
- For `animate-ui` components, use the `shadcn` MCP
- For Rust compile errors → run `cargo build` in `src-tauri/` for details

## References (read on demand)

- **CONTRIBUTING.md** — architecture, directory structure, import rules,
  code style, branch/commit conventions
- **README.md** — project overview, feature list
- **references/bilibili-API-collect/** — bilibili API reference
