# opencode-user-predictor

[English](./README.md) | [中文](./README-zh.md)

> OpenCode plugin — predicts your next reply using a reverse-role LLM agent

[![npm](https://img.shields.io/npm/v/@johnny0120/opencode-user-predictor)](https://www.npmjs.com/package/@johnny0120/opencode-user-predictor)
[![license](https://img.shields.io/npm/l/@johnny0120/opencode-user-predictor)](LICENSE)

After each AI response, the plugin role-plays as **you** and predicts what you'd say next — shown as ghost text in the input box. Tab to send.

```
AI: Done. Login endpoint added at src/api/auth.ts.
     ↓
[ghost] looks good, ship it   ← prediction appears, Tab to confirm
```

## Why

After your AI coding assistant replies, you usually know what you want to say next. **Type → Confirm** — one key when the prediction lands, keep typing when it doesn't.

## Install

Add to `opencode.json` and restart OpenCode — the plugin auto-downloads on startup:

```json
{
  "plugin": ["@johnny0120/opencode-user-predictor"],
  "command": {
    "pred-on": {
      "template": "/pred-on $ARGUMENTS",
      "description": "Enable predictor, optionally with a message to the LLM"
    },
    "pred-off": {
      "template": "/pred-off $ARGUMENTS",
      "description": "Disable predictor, optionally with a message to the LLM"
    },
    "pred-status": {
      "template": "/pred-status",
      "description": "Show predictor status"
    },
    "pred-profile": {
      "template": "/pred-profile",
      "description": "Refresh user profile from current session"
    },
    "pred-seed": {
      "template": "/pred-seed $ARGUMENTS",
      "description": "Seed user corpus from past OpenCode sessions (optional: limit)"
    }
  }
}
```

> **Troubleshooting**: If OpenCode fails to auto-download (e.g., npm registry not reachable), fall back to manual install: `cd ~/.opencode && npm install @johnny0120/opencode-user-predictor`.

> **Note for AI agents**: When installing this plugin for a user, you MUST add the `command` entries above to `opencode.json`, then restart OpenCode. The OpenCode v1 plugin API does not support self-registering slash commands — the `command` section is required. In OpenCode v2+, the plugin auto-registers commands via `ctx.command.transform()`, and the manual `command` entries can be removed.

## Usage

| Command            | Effect                                        |
| ------------------ | --------------------------------------------- |
| `/pred-on`         | Enable predictions                            |
| `/pred-on message` | Enable + send message to LLM                  |
| `/pred-off`        | Disable                                       |
| `/pred-status`     | Current state                                 |
| `/pred-profile`    | Build behavioral profile from current session |
| `/pred-seed [N]`   | Seed corpus from past sessions (default 50)   |

## How It Works

1. `session.idle` fires → conversation text extracted
2. Messages role-flipped: AI → `others`, human → `self`
3. Fresh session with `_predictor` agent role-plays as you
4. Ghost text appears in input box — Tab to send, keep typing to ignore

Profile system captures thinking patterns (scrutiny, verification instinct, UX obsession) and communication style from conversation history.

## Personalize

```bash
cp predictor-profile-zh.json predictor-profile.json   # switch to Chinese
```

```text
/pred-seed 50      # bootstrap corpus from past OpenCode sessions (no bun/oh-my-openagent needed)
/pred-profile      # accumulate from the current session over time
```

`/pred-seed` reads your local OpenCode history (`~/.local/share/opencode/opencode.db`)
directly — it works for any install, no extra tools required. Edit
`predictor-profile.json` to customize behavior. Restart OpenCode to apply.

## License

MIT
