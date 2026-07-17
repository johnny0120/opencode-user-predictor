# AGENTS.md — opencode-user-predictor

## Project

OpenCode plugin. Predicts what the user will type next via reverse-role LLM role-play.

## Commands

```bash
npm install              # install deps
npm run lint             # eslint .
npm run lint:fix         # eslint . --fix
npm run format           # prettier --write .
npm run typecheck        # tsc --noEmit (src/)
npm run typecheck:test   # tsc --noEmit -p tsconfig.test.json (src/ + test/)
npm test                 # vitest run
npm run ci               # lint + typecheck(src) + typecheck(test) + test  (the full gate)
```

## Code quality

ESLint (flat config, `eslint.config.js`) + Prettier (`.prettierrc.json`). A
husky `pre-commit` hook runs `lint-staged` (auto-fixes + formats staged files).
CI (`.github/workflows/ci.yml`) gates PRs on `npm run ci`.

- **Agents**: before declaring a task done, run `npm run ci`. Lint/format
  proactively (`npm run lint:fix && npm run format`) so the pre-commit hook is
  a backstop, not the primary path. CI is the hard gate — green locally ⇒
  green in CI.
- `@typescript-eslint/no-explicit-any` is `error` in clean modules, `warn` in
  the SDK-interop modules (`src/index.ts`, `src/internals.ts`), where each
  surviving `any` carries an inline `eslint-disable-next-line` with a reason.
- The `opencode-start` integration test self-skips when the `opencode` binary
  is absent (e.g. CI on ubuntu), so CI runs without it installed.

## Architecture

```
src/index.ts      — Plugin ENTRY (hooks, _predictor agent, predict(), toggle, refreshProfile, runSeed). ONLY this file is in opencode.json's plugin array.
src/internals.ts  — State + pure helpers (resolveModel, extractTextMessages, _testState). NOT a plugin entry — free to export anything.
src/seed.ts       — seedCorpus(): reads ~/.local/share/opencode/opencode.db via bun:sqlite, pure/testable.
src/prompts.ts    — USER_SIMULATOR_SYSTEM (role-play identity) + buildPredictionMessages().
src/bun.d.ts      — Ambient types for Bun global + bun:sqlite (so tsc under node works without @types/bun).
test/             — Integration tests (outside tsconfig include; type-checked via tsconfig.test.json).
```

- `_predictor` agent registered via `config` hook (not opencode.json)
- Fresh session per prediction (`create → prompt(agent:"_predictor") → delete`)
- Conversation formatted as JSON: `{"role":"self"}` / `{"role":"others"}`
- `/pred-*` commands handled in BOTH `chat.message` (oh-my-openagent intercepts `/` messages and bypasses native dispatch) AND `command.execute.before`. Keep the two handlers in sync — there are 3 wiring points per command: the `config` registration, the `chat.message` regex+branch, the `command.execute.before` branch.

## Key constraints

- Do NOT modify the user's global `~/.config/opencode/opencode.json`
- Project-level `opencode.json` is OK — ships with the plugin, registers `/pred-*` commands
- `client.session.prompt()` always creates `role:"user"` messages — no assistant injection
- Agent system prompt only works on first `prompt()` call in a fresh session
- Plugin has NO hot reload — restart OpenCode after any code change

### ⚠️ Plugin entry modules may ONLY export `server`/`default`

This is the #1 way to brick the plugin. OpenCode's loader iterates
`Object.values(exports)` and treats **every exported function as a plugin**.
A stray `export function` (e.g. a test helper, or `resolveModel` which returns
`null` when no model is set) gets called as a plugin and dereferenced as
`null.config` → bootstrap crash: `null is not an object (evaluating 'N.config')`
→ opencode won't start in this directory.

- `src/index.ts` exports **only** `server` + `default`. Nothing else.
- State, helpers, anything testable → put in `src/internals.ts` / `src/seed.ts`
  (NOT referenced by `opencode.json`, so never loader-scanned; free to export).
- Adding a new exported helper to `src/index.ts`? Don't. Move it to a non-entry
  module. `src/index.test.ts` has a guard test asserting the export shape stays
  `["default","server"]` — if it fails, you broke this rule.

## Runtime: Bun is mandatory

OpenCode's plugin host is the **Bun runtime** — every OpenCode install ships Bun internally
(the opencode binary embeds it). So `Bun.file`/`Bun.write` and `import "bun:sqlite"` are always
available inside a plugin at runtime, regardless of how the user installed OpenCode (the official
installer, Homebrew, the standalone binary, etc.). The user never installs Bun themselves; it is
not an npm/brew dependency of this package. `@types/bun` is deliberately NOT a devDependency —
`src/bun.d.ts` declares just the surface we use, so `tsc` under node type-checks without it.

`bun:sqlite` is only resolvable under Bun. `src/seed.test.ts` guards on import and skips under
node; run it for real with `bun --bun vitest run src/seed.test.ts`.

## Type checking: two tsconfigs

- `tsconfig.json` — `include: ["src"]`. This is what `npm run typecheck` and `tsc --noEmit` use. Source only.
- `tsconfig.test.json` — extends the above, adds `test/` + `test-setup.ts` + `vitest.config.ts`, `types: ["node","vitest/globals"]`. Run via `npm run typecheck:test`. Exists so VSCode doesn't show `Cannot find name 'node:...'` warnings in test files without polluting the src config.
- Both must pass. `npm run ci` runs both.

## Debugging

When the plugin misbehaves or opencode won't start:

- **OpenCode log** (the source of truth for bootstrap/plugin-load failures):
  `~/.local/share/opencode/log/opencode.log`. Grep for `plugin config hook failed`,
  `failed to load plugin`, `Event listener failed`. Each run has a `run=<hex>` id;
  filter on the latest one.
- **Plugin's own log**: `data/predictor.log` (written by `log()` in `src/index.ts`).
  `config hook ran` appearing = the plugin loaded and its config hook fired.
  `seed: …` / `error: …` lines come from `/pred-seed` / the event hook.
- **Reproduce a startup crash in isolation**: copy `src/index.ts` + `prompts.ts` +
  `internals.ts` into a temp dir with a bare `{"plugin":["./index.ts"]}` opencode.json,
  `cd` there, `opencode run hi`. Eliminates other plugins (oh-my-openagent etc.) as a factor.
- The `test/opencode-start.test.ts` smoke test does exactly this — run it locally
  (`npx vitest run test/opencode-start.test.ts`) to catch loader regressions. It skips on CI (no opencode binary).

## Verifying a change

`npm run ci` (lint + typecheck + test) is necessary but NOT sufficient — it does not
exercise the plugin at runtime (the smoke test skips without the opencode binary; unit
tests mock the SDK). For any change to `src/index.ts` hooks, the agent config, or `/pred-*`
command handling, ALSO do the runtime check:

```bash
opencode run "/pred-status"     # plugin loads? (no "Unexpected server error")
opencode run "/pred-seed 3"     # /pred-seed works? check data/user-corpus.json grew + data/predictor.log has "seed:"
tail data/predictor.log         # should show "config hook ran" for each run
```

Then check `~/.local/share/opencode/log/opencode.log` for the latest `run=` has NO
`plugin config hook failed` / `Event listener failed` / `failed to load plugin`.

`data/` is gitignored (runtime artifacts) — safe to mutate during verification, restore
`data/user-corpus.json` from git if you care about its committed state.

## Profile system

- `/pred-profile` → `refreshProfile()` reads `data/user-corpus.json`, categorizes historical messages
- Corpus grows incrementally — each run appends current session, dedup by content
- `/pred-seed [limit]` → `seedCorpus()` (`src/seed.ts`) bootstraps the corpus from past OpenCode
  sessions by reading `~/.local/share/opencode/opencode.db` directly via `bun:sqlite` (read-only).
  No oh-my-openagent / python finder needed — works for any installed user. Runs inside the Bun
  plugin host; no-ops (with a toast) if `bun:sqlite` is unavailable.
  - DB schema: tables `session` / `message` / `part`. Role in `message.data` JSON (`$.role`),
    text in `part.data` JSON (`$.text` where `$.type="text"`). Seed excludes: assistant messages,
    non-text parts, `synthetic` parts (editor-open system-reminder injections), and `/`-command lines.

## Releasing

- Use **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, …). release-please
  (`.github/workflows/release.yml`) generates the changelog and version bump from them.
- On push to `main`, release-please maintains a `chore(main): release X.Y.Z` PR. **Merge that PR**
  to cut a release — it tags `vX.Y.Z` and creates the GitHub Release.
- The `v*` tag push triggers `.github/workflows/publish.yml` → `npm publish --provenance`.
- Do NOT hand-edit `version` in `package.json` or hand-tag. The release PR does both in lockstep.
- `prepublishOnly` runs `npm run ci`, so a manual `npm publish` can't ship untested code either.

### One-time / prerequisite setup (already done — don't redo)

- **release-please needs Actions to create PRs**: repo Settings → Actions → General →
  Workflow permissions → "Allow GitHub Actions to create and approve pull requests" = ON.
  Without it, release-please fails with "not permitted to create pull requests".
- **npm provenance needs repo linkage**: on npmjs.com, the package settings must link the
  GitHub repo, or `npm publish --provenance` fails. `publish.yml` keeps `NPM_TOKEN` for auth
  (provenance signs on top of it); rotating to a granular publish-only token is a TBD follow-up.

## Documentation sync

After ANY code change that affects behavior, API, or configuration, update ALL of:

| Code change                  | Must update                                           |
| ---------------------------- | ----------------------------------------------------- |
| System prompt (`prompts.ts`) | `predictor-profile.json`, `predictor-profile-zh.json` |
| Slash commands               | `README.md`, `README-zh.md`                           |
| Architecture, constraints    | `PROGRESS.md`, `AGENTS.md`                            |
