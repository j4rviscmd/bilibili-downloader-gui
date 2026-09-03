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
  runtime errors. Enforced automatically by
  `src/i18n/locales.test.ts` (full key-set parity vs `en.json`, reports
  exact missing/extra keys per language) — run `npm test` to verify.

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

### Tooltips for Ambiguous / Disabled Controls

**Proactively add tooltips where the user may be confused (disabled
buttons, state-dependent restrictions, non-obvious behavior). Explain
_why_, not just _what_.**

- Use `@/shared/animate-ui/radix/tooltip` (`Tooltip` / `TooltipTrigger` /
  `TooltipContent`). `TooltipProvider` may be omitted when an ancestor
  already provides it (e.g. `DownloadStatusDialog`)
- **Disabled buttons**: native `title` won't fire because
  `pointer-events: none` blocks hover. Wrap with
  `<TooltipTrigger asChild><span><Button disabled>…</Button></span></TooltipTrigger>`
  so the wrapper receives the hover
- Tooltip text must be **i18n**-ized across all 6 languages; key naming
  follows `{feature}.{description}`
- Render `TooltipContent` only when the reason applies (conditional), not
  always-on

### Unit Tests

**Every new or changed testable logic ships with unit tests** — keep the
suite growing with the codebase. The only exemption is thin
AppHandle-coupled glue (command wrappers, plugin registration); extract
the real logic into pure functions or test seams and test those:

- Rust: `with_path`-style constructors or `*_in_dir` functions let the
  logic run against `tempfile::tempdir()` without an `AppHandle`
  (see `HistoryStore::with_path`, `cleanup_temp_files_in_dir`)
- Frontend: use the global `mockInvoke` + `renderHookWithStore` /
  `renderWithProviders` conventions (`src/test/test-utils.tsx`); do not
  add per-file `vi.mock('@tauri-apps/api/core')`
- Run `npm test` and `cargo test` before handing over for verification

### Code Comments

**Write all code comments in English.** This includes inline `//`
comments, JSDoc/docstring descriptions, and WHY/CAUTION/CONSTRAINT tags.
Existing Japanese comments may remain, but never add new Japanese
comments.

## CI & E2E Workflows

- **CI** (`.github/workflows/ci.yml`) runs on Ubuntu and is aggregated
  into the **required** `ci-status` status check. The report-only
  `coverage` job (nightly cargo-llvm-cov) is NOT part of ci-status.
- **E2E Tests** (`.github/workflows/e2e.yml`) runs separately on macOS
  and is **NOT a required** status check.
- When monitoring CI (e.g. during `worktree-finish`), do **not** wait
  for the E2E workflow to finish — `ci-status` passing is sufficient to
  treat CI as green. Treat E2E as informational (screenshots are still
  useful for visual review).

## Pre-verification Checklist

- Use `@hypothesi/tauri-mcp-server` to retrieve logs and HTML elements
- When asked to check app logs (e.g. after user verification), grep
  `~/Library/Application Support/com.bilibili-downloader-gui.app/logs/app.log`
  — both backend `[BE]` and frontend `[FE]` logs land there (plugin-log
  Folder target captures webview logs too). Dev (`npm run tauri dev`)
  and release builds share this path (same bundle identifier). The
  tauri-mcp `console` capture may lag or belong to a stale app instance
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
