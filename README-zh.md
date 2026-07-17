# opencode-user-predictor

[English](./README.md) | [中文](./README-zh.md)

> AI 预测你的下一句话——OpenCode 反向角色扮演插件

[![npm](https://img.shields.io/npm/v/@johnny0120/opencode-user-predictor)](https://www.npmjs.com/package/@johnny0120/opencode-user-predictor)
[![license](https://img.shields.io/npm/l/@johnny0120/opencode-user-predictor)](LICENSE)

AI 回复后，插件以"你"的身份预测你会说什么——ghost text 显示在输入框，Tab 即发送。

```
AI: Done. Login endpoint added at src/api/auth.ts.
     ↓
[ghost] 测试一下看看     ← 预测出现，Tab 确认
```

## 为什么需要

AI 编程助手回复后，你多数情况下知道要说什么。**打字 → 确认**，预测命中时一键提交，不命中继续打字。

## 安装

```bash
npm install @johnny0120/opencode-user-predictor
```

在 `opencode.json` 中配置：
```json
{ "plugin": ["@johnny0120/opencode-user-predictor"] }
```

## 使用

| 命令 | 效果 |
|---------|--------|
| `/pred-on` | 开启预测 |
| `/pred-on 消息` | 开启 + 发送消息给 LLM |
| `/pred-off` | 关闭预测 |
| `/pred-status` | 查看状态 |
| `/pred-profile` | 构建用户行为画像 |

## 工作原理

1. `session.idle` 触发 → 提取对话文本
2. 角色翻转：AI → `others`，用户 → `self`
3. 创建新 session，使用 `_predictor` agent 扮演你
4. ghost text 出现在输入框——Tab 发送，继续打字忽略

画像系统从对话历史中提取思维模式（审视能力、验证本能、UX 洁癖）和沟通风格，注入预测。

## 个性化

```bash
cp predictor-profile-zh.json predictor-profile.json   # 切换中文模式
bun run scripts/seed-corpus.ts 50                       # 从历史灌数据（一次性）
/pred-profile                                           # 逐步累积
```

编辑 `predictor-profile.json` 自定义行为。重启 OpenCode 生效。

## License

MIT
