import { describe, it, expect } from "vitest"
import { buildPredictionMessages } from "./prompts"

describe("buildPredictionMessages", () => {
  it("returns empty array for empty input", () => {
    expect(buildPredictionMessages([])).toEqual([])
  })

  it("role-flips user→self and assistant→others", () => {
    const history = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "帮我看下这个 bug" },
    ]
    const result = buildPredictionMessages(history)
    expect(result).toHaveLength(3)
    expect(JSON.parse(result[0]!)).toEqual({ role: "self", content: "hello" })
    expect(JSON.parse(result[1]!)).toEqual({ role: "others", content: "hi there" })
    expect(JSON.parse(result[2]!)).toEqual({ role: "self", content: "帮我看下这个 bug" })
  })

  it("skips messages with empty content", () => {
    const history = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "  " },
      { role: "user", content: "world" },
    ]
    const result = buildPredictionMessages(history)
    expect(result).toHaveLength(2)
    expect(JSON.parse(result[0]!)).toEqual({ role: "self", content: "hello" })
    expect(JSON.parse(result[1]!)).toEqual({ role: "self", content: "world" })
  })

  it("skips unknown roles (system, tool)", () => {
    const history = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "actual message" },
      { role: "tool", content: "tool output" },
    ]
    const result = buildPredictionMessages(history)
    expect(result).toHaveLength(1)
    expect(JSON.parse(result[0]!)).toEqual({ role: "self", content: "actual message" })
  })

  it("trims content whitespace", () => {
    const history = [
      { role: "user", content: "  hello world  " },
    ]
    const result = buildPredictionMessages(history)
    expect(JSON.parse(result[0]!)).toEqual({ role: "self", content: "hello world" })
  })

  it("handles content with special JSON characters", () => {
    const history = [
      { role: "user", content: '{"key": "value"}' },
      { role: "assistant", content: "line1\nline2" },
    ]
    const result = buildPredictionMessages(history)
    expect(result).toHaveLength(2)
    expect(JSON.parse(result[0]!)).toEqual({ role: "self", content: '{"key": "value"}' })
    expect(JSON.parse(result[1]!)).toEqual({ role: "others", content: "line1\nline2" })
  })

  it("handles only-assistant history", () => {
    const history = [
      { role: "assistant", content: "solo message" },
    ]
    const result = buildPredictionMessages(history)
    expect(result).toHaveLength(1)
    expect(JSON.parse(result[0]!)).toEqual({ role: "others", content: "solo message" })
  })

  it("handles only-user history", () => {
    const history = [
      { role: "user", content: "solo user" },
    ]
    const result = buildPredictionMessages(history)
    expect(result).toHaveLength(1)
    expect(JSON.parse(result[0]!)).toEqual({ role: "self", content: "solo user" })
  })
})
