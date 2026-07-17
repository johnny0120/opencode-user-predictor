import { afterEach, describe, expect, it } from "vitest"
import { extractTextMessages, resolveModel, _testState } from "./internals"

const _state = _testState()

describe("resolveModel", () => {
  afterEach(() => {
    _state.modelId = undefined
    _state.smallModelId = undefined
    _state.useSmallModel = true
  })

  it("returns null when no model configured", () => {
    _state.modelId = undefined
    _state.smallModelId = undefined
    expect(resolveModel()).toBeNull()
  })

  it("returns modelId when useSmallModel=false and modelId is set", () => {
    _state.modelId = "anthropic/claude-sonnet-4-20250514"
    _state.smallModelId = "openai/gpt-4o-mini"
    _state.useSmallModel = false
    expect(resolveModel()).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
    })
  })

  it("returns smallModelId when useSmallModel=true", () => {
    _state.modelId = "anthropic/claude-sonnet-4-20250514"
    _state.smallModelId = "openai/gpt-4o-mini"
    _state.useSmallModel = true
    expect(resolveModel()).toEqual({
      providerID: "openai",
      modelID: "gpt-4o-mini",
    })
  })

  it("falls back to modelId when smallModelId not set but useSmallModel=true", () => {
    _state.modelId = "anthropic/claude-sonnet-4-20250514"
    _state.smallModelId = undefined
    _state.useSmallModel = true
    expect(resolveModel()).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
    })
  })

  it("returns null for invalid format without slash", () => {
    _state.modelId = "invalid-format"
    _state.useSmallModel = false
    expect(resolveModel()).toBeNull()
  })

  it("handles model IDs with multiple slashes", () => {
    _state.modelId = "azure/gpt-4/deployment-name"
    _state.useSmallModel = false
    expect(resolveModel()).toEqual({
      providerID: "azure",
      modelID: "gpt-4/deployment-name",
    })
  })

  it("returns null when modelId has only provider with trailing slash", () => {
    _state.modelId = "provider/"
    _state.useSmallModel = false
    // split gives ["provider", ""], modelID is "" which is falsy
    expect(resolveModel()).toBeNull()
  })
})

describe("extractTextMessages", () => {
  it("returns empty array for empty input", () => {
    expect(extractTextMessages([])).toEqual([])
  })

  it("extracts role and content from messages with parts array", () => {
    const raw = [
      {
        role: "user",
        parts: [
          { type: "text", text: "hello there" },
          { type: "text", text: " how are you?" },
        ],
      },
    ]
    const result = extractTextMessages(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: "user", content: "hello there how are you?" })
  })

  it("filters out tool_call, tool_result, reasoning, thinking parts", () => {
    const raw = [
      {
        role: "assistant",
        parts: [
          { type: "text", text: "Here's the fix:" },
          { type: "tool_call", text: "call data" },
          { type: "text", text: " and this is the result" },
          { type: "tool_result", text: "result data" },
          { type: "reasoning", text: "I think..." },
          { type: "thinking", text: "hmm..." },
        ],
      },
    ]
    const result = extractTextMessages(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.content).toBe("Here's the fix: and this is the result")
  })

  it("extracts from m.content string fallback", () => {
    const raw = [
      {
        role: "user",
        content: "plain content string",
      },
    ]
    const result = extractTextMessages(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: "user", content: "plain content string" })
  })

  it("skips system and tool roles", () => {
    const raw = [
      { role: "system", parts: [{ type: "text", text: "system prompt" }] },
      { role: "user", parts: [{ type: "text", text: "user message" }] },
      { role: "tool", parts: [{ type: "text", text: "tool output" }] },
      { role: "assistant", parts: [{ type: "text", text: "assistant reply" }] },
    ]
    const result = extractTextMessages(raw)
    expect(result).toHaveLength(2)
    expect(result[0]!.role).toBe("user")
    expect(result[1]!.role).toBe("assistant")
  })

  it("falls back to m.info.role when m.role is missing", () => {
    const raw = [
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "message via info.role" }],
      },
    ]
    const result = extractTextMessages(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: "user", content: "message via info.role" })
  })

  it("prefers m.role over m.info.role", () => {
    const raw = [
      {
        role: "assistant",
        info: { role: "user" },
        parts: [{ type: "text", text: "from assistant" }],
      },
    ]
    const result = extractTextMessages(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.role).toBe("assistant")
  })

  it("skips messages with empty content after extraction", () => {
    const raw = [
      {
        role: "user",
        parts: [{ type: "text", text: "   " }],
      },
      {
        role: "assistant",
        content: "",
      },
      {
        role: "user",
        parts: [{ type: "text", text: "real content" }],
      },
    ]
    const result = extractTextMessages(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.content).toBe("real content")
  })

  it("handles missing parts and content", () => {
    const raw = [{ role: "user" }, { role: "assistant", content: "has content" }]
    const result = extractTextMessages(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.content).toBe("has content")
  })

  it("handles parts where text is empty string", () => {
    const raw = [
      {
        role: "user",
        parts: [
          { type: "text", text: "" },
          { type: "text", text: "actual" },
          { type: "text", text: "" },
        ],
      },
    ]
    const result = extractTextMessages(raw)
    expect(result).toHaveLength(1)
    expect(result[0]!.content).toBe("actual")
  })
})
