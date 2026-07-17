# opencode-user-predictor

OpenCode plugin that predicts what you'll say next — a reverse-role LLM agent that role-plays as you.

## Quick Start

```bash
# Install
npm install

# Add to your project's opencode.json:
# "plugin": ["opencode-user-predictor"]

# Or for local dev:
# "plugin": ["./src/index.ts"]
```

## Usage

| Command | Effect |
|---------|--------|
| `/pred-on` | Enable predictions |
| `/pred-on message` | Enable + send message to LLM |
| `/pred-off` | Disable predictions |
| `/pred-status` | Show current state |
| `/pred-profile` | Build/update user behavior profile from session history |

After enabling, ghost text appears in the input box after each AI response — press Tab to accept, or keep typing to ignore.

### Building your profile

The predictor ships with a generic developer profile. To personalize it:

```bash
# One-time: seed profile from your historical sessions
bun run scripts/seed-corpus.ts 50

# Then run periodically to accumulate:
/pred-profile
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

## File sizes

| File | Purpose |
|------|---------|
| `src/index.ts` | Plugin: hooks, agent, predict, toggle, profile refresh |
| `src/prompts.ts` | System prompt + buildPredictionMessages |
| `scripts/seed-corpus.ts` | Bootstrap profile from history |

## Current state

| Feature | Status |
|---------|--------|
| Prediction engine | ✅ |
| Slash commands (`/pred-on`, etc.) | ✅ |
| `_predictor` agent with custom system prompt | ✅ |
| User profile (behavioral baseline) | ✅ |
| Hot-reload profile via `/pred-profile` | ✅ |
| Rate limiting (2s interval) | ✅ |
| Toast notifications | ✅ |
| Debug logging (`data/predictor.log`) | ✅ |
| `autoSubmitThreshold` | ⬜ |
| Graceful degrade when no model configured | ⬜ |
| Configurable via opencode.json options | ⬜ |

## Design decisions

1. **Fresh session per prediction**: System prompt from the `_predictor` agent only works reliably on the first `prompt()` call in a new session (confirmed via `opencode-llm-proxy` reference).

2. **Agent-managed system prompt**: The `_predictor` agent is registered via the `config` hook, not hardcoded in `opencode.json`. Its system prompt defines identity (role-play, NEVER rules) and style (few-shot examples).

3. **JSON message format**: `{"role":"self"}` / `{"role":"others"}` — structured, unambiguous, no text markers. Avoids "AI" identity confusion by framing "others" as "external messages."

4. **Profile in conversation, identity in agent**: Behavioral stats (from `/pred-profile`) are prepended to the conversation text. Core identity stays in the agent's system prompt (cached by provider).

5. **Slash commands only**: `/pred-on` etc. via `command.execute.before` hook. No magic strings. Clean separation — commands never reach the LLM.

## Verification

```bash
npx tsc --noEmit          # should be clean
bun run scripts/seed-corpus.ts 5  # should save messages
```

Manual test: `/pred-on`, send a message, AI responds, check input box for ghost text.

## Gotchas

- **Restart OpenCode** after any code change (no hot reload)
- Ghost text appears only after `/pred-on` (starts disabled)
- `data/user-corpus.json` builds up over time — run `/pred-profile` across sessions
- Predictor session must have `agent: "_predictor"` — agent's system prompt doesn't carry over otherwise
