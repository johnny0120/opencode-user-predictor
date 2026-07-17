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
src/index.ts     — Plugin entry: hooks, _predictor agent, predict(), toggle, refreshProfile
src/prompts.ts   — USER_SIMULATOR_SYSTEM (role-play identity) + buildPredictionMessages()
```

- `_predictor` agent registered via `config` hook (not opencode.json)
- Fresh session per prediction (`create → prompt(agent:"_predictor") → delete`)
- Conversation formatted as JSON: `{"role":"self"}` / `{"role":"others"}`
- `/pred-on` etc. handled via `command.execute.before` hook

## Key constraints

- Do NOT modify the user's global `~/.config/opencode/opencode.json`
- Project-level `opencode.json` is OK — ships with the plugin, registers `/pred-*` commands
- `client.session.prompt()` always creates `role:"user"` messages — no assistant injection
- Agent system prompt only works on first `prompt()` call in a fresh session
- Plugin has NO hot reload — restart OpenCode after any code change
- **Plugin entry module may only export `server`/`default`.** OpenCode's loader iterates `Object.values(exports)` and treats every exported function as a plugin — a stray `export function` gets called as a plugin and, if it returns `null`, crashes bootstrap with `null is not an object (evaluating 'N.config')`. State/helpers live in `src/internals.ts` (not referenced by `opencode.json`, so never loader-scanned); `src/index.ts` imports them and exports only `server` + `default`.

## Profile system

- `/pred-profile` → `refreshProfile()` reads `data/user-corpus.json`, categorizes historical messages
- Corpus grows incrementally — each run appends current session, dedup by content
- `/pred-seed [limit]` → `seedCorpus()` (`src/seed.ts`) bootstraps the corpus from past OpenCode
  sessions by reading `~/.local/share/opencode/opencode.db` directly via `bun:sqlite` (read-only).
  No oh-my-openagent / python finder needed — works for any installed user. Runs inside the Bun
  plugin host; no-ops (with a toast) if `bun:sqlite` is unavailable.

## Runtime: Bun is mandatory

OpenCode's plugin host is the **Bun runtime** — every OpenCode install ships Bun internally
(the opencode binary embeds it). So `Bun.file`/`Bun.write` and `import "bun:sqlite"` are always
available inside a plugin at runtime, regardless of how the user installed OpenCode (the official
installer, Homebrew, the standalone binary, etc.). The user never installs Bun themselves; it is
not an npm/brew dependency of this package. `@types/bun` is deliberately NOT a devDependency —
`src/bun.d.ts` declares just the surface we use, so `tsc` under node type-checks without it.

## Releasing

- Use **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, …). release-please
  (`.github/workflows/release.yml`) generates the changelog and version bump from them.
- On push to `main`, release-please maintains a `chore(main): release X.Y.Z` PR. **Merge that PR**
  to cut a release — it tags `vX.Y.Z` and creates the GitHub Release.
- The `v*` tag push triggers `.github/workflows/publish.yml` → `npm publish --provenance`.
- Do NOT hand-edit `version` in `package.json` or hand-tag. The release PR does both in lockstep.
- `prepublishOnly` runs `npm run ci`, so a manual `npm publish` can't ship untested code either.

## Documentation sync

After ANY code change that affects behavior, API, or configuration, update ALL of:

| Code change                  | Must update                                           |
| ---------------------------- | ----------------------------------------------------- |
| System prompt (`prompts.ts`) | `predictor-profile.json`, `predictor-profile-zh.json` |
| Slash commands               | `README.md`, `README-zh.md`                           |
| Architecture, constraints    | `PROGRESS.md`, `AGENTS.md`                            |
