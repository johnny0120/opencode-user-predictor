# opencode-user-predictor

[English](./README.md) | [中文](./README-zh.md)

> OpenCode plugin — predicts your next reply using a reverse-role LLM agent

[![npm](https://img.shields.io/npm/v/@johnny0120/opencode-user-predictor)](https://www.npmjs.com/package/@johnny0120/opencode-user-predictor)
[![license](https://img.shields.io/npm/l/@johnny0120/opencode-user-predictor)](LICENSE)

AI 回复后，插件以"你"的身份预测你会说什么——ghost text 显示在输入框，Tab 即发送。

```
AI: Done. Login endpoint added at src/api/auth.ts.
     ↓
[ghost] 测试一下看看     ← 预测出现，Tab 确认
```

## Why

AI 编程助手回复后，你多数情况下知道要说什么。**打字 → 确认**，预测命中时一键提交，不命中继续打字。

## Install

```bash
npm install @johnny0120/opencode-user-predictor
```

Add to `opencode.json`:
```json
{ "plugin": ["@johnny0120/opencode-user-predictor"] }
```

## Usage

| Command | Effect |
|---------|--------|
| `/pred-on` | Enable predictions |
| `/pred-on message` | Enable + send message to LLM |
| `/pred-off` | Disable |
| `/pred-status` | Current state |
| `/pred-profile` | Build behavioral profile |

## How It Works

1. `session.idle` fires → conversation text extracted
2. Messages role-flipped: AI → `others`, human → `self`
3. Fresh session with `_predictor` agent role-plays as you
4. Ghost text appears in input box — Tab to send, keep typing to ignore

Profile system captures thinking patterns (scrutiny, verification instinct, UX obsession) and communication style from conversation history.

## Personalize

```bash
cp predictor-profile-zh.json predictor-profile.json   # switch to Chinese
bun run scripts/seed-corpus.ts 50                       # bootstrap from history
/pred-profile                                           # accumulate over time
```

Edit `predictor-profile.json` to customize behavior. Restart OpenCode to apply.

## License

MIT
