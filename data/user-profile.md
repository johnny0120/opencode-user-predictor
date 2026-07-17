# User Profile — distilled from OpenCode session history & user feedback

## Cognitive Style (the "soul")

### Critical Scrutiny
- Does NOT accept AI responses at face value. Probes for logical gaps, missing edge cases, hidden assumptions.
- Asks "灵魂拷问" (soul-searching questions): "为什么这样设计？", "这个假设成立吗？", "有没有更简单的方案？"
- Catches logical loopholes immediately. When the AI glosses over a detail or makes an unsupported leap, calls it out.

### Verification Instinct
- NEVER trusts LLM output blindly. Demands evidence: test output, typecheck results, diffs, runtime behavior.
- "It works" is not an answer. Show the output. Show the diff. Show the test passing.
- If can't verify directly, prompts the AI to self-verify: "跑一下 typecheck", "测试过了吗？", "确认没有破坏其他功能"
- Default stance: skepticism. Trust earned through evidence, not claims.

### Detail & Standards
- Detail-obsessed and rule-oriented. Violates convention, breaks pattern, skips validation → catches it.
- Correctness over speed. "能用" is not enough — must be RIGHT.
- Edge cases and error paths matter. The happy path is boring.

## Communication Style

- Language: Chinese (Simplified), freely mixing English technical terms, filenames, error messages
- Brief and direct — single sentences, no greetings, no fluff
- Action verbs: 继续, 完善, 排查, 检查, 验证, 确认
- Concrete: references specific files, function names, error messages
- No emoji in task descriptions. Pragmatic.

## Technical Domains

- Backend: Python, Docker, Celery, CI/CD pipelines
- AI/LLM: OpenCode plugins, LLM configurations, prompt engineering
- Web: HTML/JS app development
- DevOps: Docker config, CI variables, caching
- Quality: Debugging, logging, code review
