# opencode-user-predictor

OpenCode plugin that predicts what you'll say next — a reverse-role LLM agent that role-plays as you.

> This file is the running project journal. `AGENTS.md` is the operational
> handbook (commands, constraints, debugging, releasing) — read that first when
> picking up work; this file records _what_ happened and _why_.

## Quick Start

```bash
npm install              # install deps
npm run ci               # lint + typecheck(src) + typecheck(test) + test  (the full gate)
```

Load the plugin in a project's `opencode.json`:

```json
{ "plugin": ["@johnny0120/opencode-user-predictor"] }
```

Or for local dev: `"plugin": ["./src/index.ts"]`.

## Usage

| Command            | Effect                                                  |
| ------------------ | ------------------------------------------------------- |
| `/pred-on`         | Enable predictions                                      |
| `/pred-on message` | Enable + send message to LLM                            |
| `/pred-off`        | Disable predictions                                     |
| `/pred-status`     | Show current state                                      |
| `/pred-profile`    | Build/update user behavior profile from current session |
| `/pred-seed [N]`   | Seed corpus from past sessions (default 50)             |

After enabling, ghost text appears in the input box after each AI response — press Tab to accept, or keep typing to ignore.

### Building your profile

The predictor ships with a generic developer profile. To personalize it:

```text
/pred-seed 50      # one-time: seed corpus from past OpenCode sessions (no bun/oh-my-openagent needed)
/pred-profile      # then run periodically to accumulate from the current session
```

The profile captures your thinking patterns (scrutiny, verification instinct, detail orientation) and communication style (brevity, language mixing, action verbs). It persists across sessions in `data/user-corpus.json`.

## Architecture

```
session.idle → extractTextMessages() → buildPredictionMessages()
    → fresh _predictor session → prompt() → tui.appendPrompt()
```

- `_predictor` agent registered via `config` hook, with custom system prompt
- Fresh session per prediction (`create → prompt → delete`)
- Role-flipped conversation as JSON: `{"role":"self"}` (user) / `{"role":"others"}` (AI)
- Priority on `small_model`, falls back to primary
- `/pred-*` commands wired in 3 places each (config hook + `chat.message` + `command.execute.before`)

## Modules

| File               | Purpose                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `src/index.ts`     | Plugin ENTRY — hooks, `_predictor` agent, predict(), toggle, profile, seed |
| `src/internals.ts` | State + pure helpers (resolveModel, extractTextMessages). Not an entry.    |
| `src/seed.ts`      | `seedCorpus()` — reads opencode.db via `bun:sqlite`, pure/testable         |
| `src/prompts.ts`   | System prompt + buildPredictionMessages                                    |
| `src/bun.d.ts`     | Ambient Bun + `bun:sqlite` types (tsc under node, no `@types/bun`)         |
| `test/`            | Integration tests (opencode-start smoke test; skips without the binary)    |

## Current state

| Feature                                        | Status |
| ---------------------------------------------- | ------ |
| Prediction engine                              | ✅     |
| Slash commands (`/pred-on`, etc.)              | ✅     |
| `/pred-seed` (self-contained corpus bootstrap) | ✅     |
| `_predictor` agent with custom system prompt   | ✅     |
| User profile (behavioral baseline)             | ✅     |
| Hot-reload profile via `/pred-profile`         | ✅     |
| Rate limiting (2s interval)                    | ✅     |
| Toast notifications                            | ✅     |
| Debug logging (`data/predictor.log`)           | ✅     |
| ESLint + Prettier + husky + CI gate            | ✅     |
| release-please + npm provenance publishing     | ✅     |
| `autoSubmitThreshold`                          | ⬜     |
| Graceful degrade when no model configured      | ⬜     |
| Configurable via opencode.json options         | ⬜     |
| Cross-session user-style memory (see Roadmap)  | ⬜     |

## Roadmap

### Cross-session user-style memory

Today the predictor infers the user's voice **only from the current session's**
`{"role":"self"}` messages — so style adaptation resets every new session and
only stabilizes once enough turns accumulate. `/pred-profile` already collects
user messages across sessions into `data/user-corpus.json` (and `/pred-seed`
bootstraps it from history), but that corpus is only used for coarse category
counts (`profileStats`), not for style.

**Goal:** let the system prompt reflect the user's _actual_ cross-session
style — typical length, whether they ask follow-ups, language mix, signature
phrasings — so predictions feel right from turn one, not turn ten.

**Approach (TBD):**

1. Distill style signals from `data/user-corpus.json` (e.g. median message
   length, follow-up-question rate, language ratio, frequent action verbs,
   a few representative real messages as in-context exemplars).
2. Inject the distilled style profile into the `_predictor` system prompt
   (or as a preamble to the prediction input) — alongside the soul/persona,
   not replacing it. The persona stays generic ("a sharp senior engineer");
   the style profile is the per-user layer on top.
3. Refresh the distillation periodically (on `/pred-profile`, or when the
   corpus grows past a threshold) — not per prediction (cost).

**Why not now:** needs a stable persona-first prompt (landed in this work)
to layer style on top of, plus a decision on how aggressively to
few-shot real user messages (privacy/overfitting tradeoff). Tracked here as
the next meaningful quality leap after the persona + pollution-filter fix.

## Design decisions

1. **Fresh session per prediction**: System prompt from the `_predictor` agent only works reliably on the first `prompt()` call in a new session (confirmed via `opencode-llm-proxy` reference).

2. **Agent-managed system prompt**: The `_predictor` agent is registered via the `config` hook, not hardcoded in `opencode.json`. Its system prompt defines identity (role-play, NEVER rules) and style (few-shot examples).

3. **JSON message format**: `{"role":"self"}` / `{"role":"others"}` — structured, unambiguous, no text markers. Avoids "AI" identity confusion by framing "others" as "external messages."

4. **Profile in conversation, identity in agent**: Behavioral stats (from `/pred-profile`) are prepended to the conversation text. Core identity stays in the agent's system prompt (cached by provider).

5. **Slash commands only**: `/pred-on` etc. via `command.execute.before` hook. No magic strings. Clean separation — commands never reach the LLM.

6. **Self-contained `/pred-seed`**: reads OpenCode's own SQLite store directly, replacing a manual script that depended on `oh-my-openagent` + python. Works for any installed user.

## Verification

```bash
npm run ci                              # lint + typecheck + test (the full gate)
bun --bun vitest run src/seed.test.ts   # /pred-seed unit tests (need bun:sqlite)
opencode run "/pred-status"             # runtime: plugin loads? (no "Unexpected server error")
opencode run "/pred-seed 5"             # runtime: corpus grows + data/predictor.log has "seed:"
```

`npm run ci` alone is NOT sufficient for hook changes — the smoke test skips without the `opencode` binary and unit tests mock the SDK. See AGENTS.md "Verifying a change".

Manual test: `/pred-on`, send a message, AI responds, check input box for ghost text.

## `/pred-seed` (added 2026-07-17)

Replaced the manual `scripts/seed-corpus.ts` (which depended on `oh-my-openagent` + a python
finder) with a self-contained, plugin-native `/pred-seed [limit]` command. It reads OpenCode's
own session store (`~/.local/share/opencode/opencode.db`, SQLite — tables `session`/`message`/
`part`; role in `message.data`, text in `part.data`) directly via `bun:sqlite`, read-only, and
merges genuine user messages into `data/user-corpus.json` (dedup by content). Excludes assistant
messages, non-text parts, `synthetic` injections, and `/`-command lines. Works for any installed
user — no bun/oh-my-openagent on their side. `scripts/seed-corpus.ts` deleted; `"scripts"` removed
from `package.json` `files`.

## CI/CD baseline (added 2026-07-17, revised 2026-07-18)

- `ci.yml`: runs `npm run ci` on **all branch pushes + PRs** (`permissions: contents: read`).
- `release.yml`: **release-please** maintains a release PR on `main`; merging it bumps `package.json`
  version, updates the changelog, tags `vX.Y.Z`, opens a GitHub Release. A second job in the same
  workflow (`if: release_created`) then checks out the tag, runs `npm run ci`, and
  `npm publish --provenance` (`id-token: write` for OIDC signing). Requires Conventional Commits.
- Publish is **in** `release.yml` (not a separate tag-triggered workflow) because release-please's
  bot-created tag push doesn't reliably fire a `push: tags` workflow — that race left 0.2.0 tagged
  but unpublished until the tag was re-pushed manually. (Resolved 2026-07-18.)
- `NPM_TOKEN` still used for auth (rotate to granular token TBD).
- `prepublishOnly` = `npm run ci` — local backstop so manual `npm publish` can't ship untested code.
- **Bun note**: the OpenCode plugin host is Bun (embedded in every opencode install), so `Bun.*`
  and `bun:sqlite` are always available at runtime regardless of install method. `@types/bun` is
  NOT a devDep — `src/bun.d.ts` declares the minimal surface so `tsc` (node) type-checks without it.

## Code quality baseline (added 2026-07-17)

ESLint (flat config, `eslint.config.js`) + Prettier (`.prettierrc.json`) +
husky pre-commit (`lint-staged`) + CI (`.github/workflows/ci.yml`).

- `npm run ci` = `lint && typecheck && typecheck:test && test` — the single
  gate for humans and agents.
- ESLint uses `typescript-eslint` `recommended` + `no-unused-vars` +
  `no-explicit-any` (error in clean modules, warn in SDK-interop modules with
  inline disable-reasons, off in tests/scripts).
- Prettier: `semi:false, singleQuote:false, trailingComma:"all", printWidth:100`
  (matches pre-existing style).
- `prepare: husky` installs the hook on `npm install`; `lint-staged` runs
  `eslint --fix` + `prettier --write` on staged files.
- CI runs `npm run ci` on Node 20 ubuntu; `test/opencode-start.test.ts`
  self-skips without the `opencode` binary.

## Gotchas

- **Restart OpenCode** after any code change (no hot reload)
- Ghost text appears only after `/pred-on` (starts disabled)
- `data/user-corpus.json` builds up over time — run `/pred-profile` across sessions
- Predictor session must have `agent: "_predictor"` — agent's system prompt doesn't carry over otherwise
- **Plugin entry module may only export `server`/`default`** — see "Loader-safe exports" below

## Loader-safe exports (fixed 2026-07-17)

**Symptom:** `opencode run` in this directory failed with `Unexpected server error`; log showed `plugin config hook failed  error="null is not an object (evaluating 'N.config')"` followed by `Event listener failed ... 'M.event'`.

**Root cause:** OpenCode's plugin loader iterates `Object.values(moduleExports)` and treats _every_ exported function as a plugin. `src/index.ts` exported `_testState`, `resolveModel`, `extractTextMessages` alongside `server`/`default`. `resolveModel()` returns `null` when no model is configured, so the loader ran `null.config?.(...)` and crashed — the `null` then poisoned the event-listener array (`M.event`). (Previous commit `1582a98` swapped `state`→`_testState()` to dodge "Plugin export is not a function", which merely traded one crash for this one.)

**Fix:** Moved state + helpers to `src/internals.ts` (not referenced by `opencode.json`, so never loader-scanned). `src/index.ts` now imports them and exports only `server` + `default`.

**Tests added:**

- `src/index.test.ts` — guards the entry module's export shape (`["default","server"]` only) and that invoking the plugin returns a real hooks object.
- `src/internals.test.ts` — moved the `resolveModel` / `extractTextMessages` / `_testState` unit tests here.
- `test/opencode-start.test.ts` — integration test: scaffolds a temp project loading only this plugin, runs `opencode run hi`, asserts the log has NO `plugin config hook failed` / `failed to load plugin` / `Event listener failed` and that `data/predictor.log` contains `config hook ran`.

**Rule going forward:** any module listed in `opencode.json`'s `plugin` array exports _only_ `server` and/or `default`. Put everything else in a non-entry module.
