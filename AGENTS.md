# AGENTS.md — opencode-user-predictor

## Project

OpenCode plugin. Predicts what the user will type next via reverse-role LLM role-play.

## Commands

```bash
npm install           # install deps
npx tsc --noEmit      # typecheck
npx vitest run        # run tests
```

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

## Profile system

- `/pred-profile` → `refreshProfile()` reads `data/user-corpus.json`, categorizes historical messages
- Corpus grows incrementally — each run appends current session, dedup by content
- `scripts/seed-corpus.ts` → one-time bootstrap from history (`bun run scripts/seed-corpus.ts 50`)

## Documentation sync

After ANY code change that affects behavior, API, or configuration, update ALL of:

| Code change | Must update |
|-------------|-------------|
| System prompt (`prompts.ts`) | `predictor-profile.json`, `predictor-profile-zh.json` |
| Slash commands | `README.md`, `README-zh.md` |
| Architecture, constraints | `PROGRESS.md`, `AGENTS.md` |
