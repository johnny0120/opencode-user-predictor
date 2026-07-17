/**
 * opencode-user-predictor
 *
 * A reverse-role plugin for OpenCode. After each AI response, the plugin
 * role-plays as the human user and generates a natural response — shown as
 * ghost text the user can accept or ignore.
 *
 * Architecture:
 *   1. `event` hook → `session.idle` (model finished, user can type)
 *   2. `client.session.messages()` → read conversation, extract text
 *   3. `buildPredictionMessages()` → JSON messages with role "self"/"others"
 *   4. Fresh session created per prediction → prompt() with system + flipped text
 *   5. `client.tui.appendPrompt()` → show prediction as ghost text
 *
 * Session lifecycle:
 *   Fresh session per prediction (create → prompt → delete). This is the
 *   proven pattern from opencode-llm-proxy — the system prompt only works
 *   reliably on the first prompt() call in a new session.
 *
 * Caching: system prompt is STATIC, set once → provider caches it.
 * The predictor session persists — cache survives across prediction rounds.
 *
 * Recursion guard: locks onto mainSessionID, skips idle events from the
 * predictor session, and uses a `predicting` boolean gate.
 */
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import {
  USER_SIMULATOR_SYSTEM,
  buildPredictionMessages,
} from "./prompts"

// Use Bun's built-in fs — available in OpenCode plugin runtime
declare const Bun: {
  write(path: string, data: string): Promise<number>
  file(path: string): { text(): Promise<string> }
}

// ---- State ----

interface PredictorState {
  modelId?: string
  smallModelId?: string
  useSmallModel: boolean
  enabled: boolean
  lastPredictionAt: number
  minPredictionInterval: number
  mainSessionID: string | null
  predicting: boolean
  profileStats: string
}

const state: PredictorState = {
  useSmallModel: false,
  enabled: false,
  lastPredictionAt: 0,
  minPredictionInterval: 2000,
  mainSessionID: null,
  predicting: false,
  profileStats: "",
}

export { state as _state }

// ---- Plugin ----

async function loadProfile(cfg: any): Promise<string> {
  try {
    const custom = await Bun.file("predictor-profile.json").text()
    return JSON.parse(custom).prompt || USER_SIMULATOR_SYSTEM
  } catch {
    return USER_SIMULATOR_SYSTEM
  }
}

type PluginInput = Parameters<Plugin>[0]

const predictor: Plugin = async ({ client, $ }) => {
  return {
    config: async (cfg) => {
      state.modelId = cfg.model
      state.smallModelId = cfg.small_model

      // Allow user to override the system prompt via predictor-profile.json
      const agentPrompt = await loadProfile(cfg)
      const agents = (cfg as any).agent ?? {}
      agents._predictor = {
        prompt: agentPrompt,
        mode: "subagent",
      }
      ;(cfg as any).agent = agents
    },

    "chat.message": async (_input, _output) => {
      // No-op — control is handled via /predictor slash command.
    },

    "command.execute.before": (input, output) => {
      const cmd = input.command
      const rest = (input.arguments ?? "").trim()

      if (cmd === "pred-on") {
        state.enabled = true
        client.tui.showToast({ body: { message: "Predictor enabled", variant: "success" } }).catch(() => {})
        output.parts = [{ type: "text", text: rest || "Predictor enabled" } as any]
      } else if (cmd === "pred-off") {
        state.enabled = false
        client.tui.showToast({ body: { message: "Predictor disabled", variant: "info" } }).catch(() => {})
        output.parts = [{ type: "text", text: rest || "Predictor disabled" } as any]
      } else if (cmd === "pred-status") {
        output.parts = [{ type: "text", text: `Predictor is ${state.enabled ? "on" : "off"}` } as any]
      } else if (cmd === "pred-profile") {
        refreshProfile(client, input.sessionID).catch(() => {})
        output.parts = [{ type: "text", text: "Profile refresh started" } as any]
        client.tui.showToast({ body: { message: "User profile refreshed", variant: "success" } }).catch(() => {})
      }
      return Promise.resolve()
    },

    event: async ({ event }) => {
      if (!state.enabled || state.predicting) return
      if (event.type !== "session.idle") return

      const props = event.properties as Record<string, unknown> | undefined
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      if (!state.mainSessionID) {
        state.mainSessionID = sessionID
      }
      if (sessionID !== state.mainSessionID) return

      const modelSpec = resolveModel()
      if (!modelSpec) return

      try {
        state.predicting = true

        client.tui.showToast({
          body: { message: "Predicting...", variant: "info", duration: 3000 },
        }).catch(() => {})

        const response = await client.session.messages({
          path: { id: sessionID },
        })
        const raw = response.data ?? []
        if (!Array.isArray(raw) || raw.length < 2) return

        const textMessages = extractTextMessages(raw)
        if (textMessages.length < 2) return

        const now = Date.now()
        if (now - state.lastPredictionAt < state.minPredictionInterval) return
        state.lastPredictionAt = now

        const prediction = await predict(client, modelSpec, textMessages)
        if (!prediction) return

        await client.tui.appendPrompt({ body: { text: prediction } })
        log("ghost text appended")
      } catch (err) {
        log(`error: ${err}`)
      } finally {
        state.predicting = false
      }
    },

    dispose: async () => {
      state.mainSessionID = null
    },

    tool: {
      toggle_predictor: tool({
        description:
          "Enable or disable the user response predictor plugin. " +
          "Call when the user asks to turn predictions on/off or check status.",
        args: {
          action: tool.schema.enum(["on", "off", "status"]),
        },
        execute: async (args) => {
          const action = args.action as string
          if (action === "on") {
            state.enabled = true
          } else if (action === "off") {
            state.enabled = false
          }
          const status = state.enabled ? "enabled" : "disabled"
          return { output: `Predictor ${status}.` }
        },
      }),
    },
  }
}

export { predictor as server }
export default predictor

// ---- Model Resolution ----

export function resolveModel(): { providerID: string; modelID: string } | null {
  const id = state.useSmallModel
    ? (state.smallModelId ?? state.modelId)
    : state.modelId
  if (!id) return null

  const [providerID, ...rest] = id.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return null

  return { providerID, modelID }
}

// ---- Prediction ----

/**
 * Create a fresh session, inject the role-flipped conversation, and
 * get a prediction. Fresh session per prediction — this is the proven
 * pattern from opencode-llm-proxy. The system prompt only works reliably
 * on the first prompt() call in a new session.
 */
async function predict(
  client: PluginInput["client"],
  model: { providerID: string; modelID: string },
  history: Array<{ role: string; content: string }>,
): Promise<string | null> {
  const flipped = buildPredictionMessages(history)
  if (flipped.length === 0) return null

  const messages = state.profileStats
    ? [state.profileStats, ...flipped]
    : flipped
  const prompt = messages.join("\n\n")

  // Create fresh session
  const created = await client.session.create({
    body: { title: "predictor" },
  })
  const sid = created.data?.id
  if (!sid) return null

  try {
    const result = await client.session.prompt({
      path: { id: sid },
      body: {
        model: { providerID: model.providerID, modelID: model.modelID },
        agent: "_predictor",
        parts: [{ type: "text", text: prompt }],
      },
    })

    if (!result.data) return null

    const text = (result.data.parts ?? [])
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("")
      .trim()

    log(`LLM CALL:\n---AGENT---\n_predictor\n---SYSTEM---\n${USER_SIMULATOR_SYSTEM}\n---INPUT---\n${prompt}\n---OUTPUT---\n${text}\n---END---`)
    return text || null
  } catch (err) {
    log(`predict error: ${err}`)
    return null
  } finally {
    await client.session.delete({ path: { id: sid } }).catch(() => {})
  }
}

// ---- Helpers ----

let _logQueue: Promise<void> = Promise.resolve()

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  _logQueue = _logQueue
    .then(() => Bun.file("data/predictor.log").text().catch(() => ""))
    .then(prev => Bun.write("data/predictor.log", prev + line).then(() => {}))
    .catch(() => {})
}

export function extractTextMessages(
  raw: unknown[],
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = []

  for (const msg of raw) {
    const m = msg as any
    const role = m.role ?? m.info?.role
    if (!role || role === "tool" || role === "system") continue

    let content = ""
    if (Array.isArray(m.parts)) {
      for (const part of m.parts) {
        if (
          part.text &&
          part.type !== "tool_call" &&
          part.type !== "tool_result" &&
          part.type !== "reasoning" &&
          part.type !== "thinking"
        ) {
          content += part.text
        }
      }
    } else if (typeof m.content === "string") {
      content = m.content
    }

    if (content.trim()) {
      result.push({ role, content: content.trim() })
    }
  }

  return result
}

// ---- Profile Refresh ----

interface ProfileCategory {
  challenge: string[]
  correction: string[]
  detail: string[]
  instruction: string[]
}

async function refreshProfile(
  client: PluginInput["client"],
  sessionID: string,
): Promise<void> {
  const response = await client.session.messages({ path: { id: sessionID } })
  const raw = response.data ?? []
  if (!Array.isArray(raw)) return

  // Read historical user corpus if available
  try {
    const corpusStr = await Bun.file("data/user-corpus.json").text()
    const corpus = JSON.parse(corpusStr)
    for (const m of (corpus.messages ?? [])) {
      if (m.content) {
        raw.push({ role: "user", parts: [{ type: "text", text: m.content }] } as any)
      }
    }
  } catch {}

  const categories: ProfileCategory = {
    challenge: [],
    correction: [],
    detail: [],
    instruction: [],
  }

  // Categorize from historical corpus (built incrementally) —
  // current session messages are already in conversation context
  try {
    const corpusStr = await Bun.file("data/user-corpus.json").text()
    const corpus = JSON.parse(corpusStr)
    for (const m of (corpus.messages ?? [])) {
      categorize(m.content ?? "")
    }
  } catch {}

  // Append current session's user messages to corpus for future use
  try {
    const existing = await Bun.file("data/user-corpus.json").text().catch(() => "{}")
    const corpus = JSON.parse(existing)
    const msgs = (corpus.messages ?? []) as Array<unknown>
    for (const msg of raw) {
      const m = msg as any
      if (m.role !== "user" && m.info?.role !== "user") continue
      let content = ""
      if (Array.isArray(m.parts)) {
        content = m.parts.filter((p: any) => p.type === "text" && p.text).map((p: any) => p.text).join("")
      } else if (typeof m.content === "string") {
        content = m.content
      }
      if (content.trim()) {
        const txt = content.trim()
        if (!msgs.some((e: any) => e.content === txt)) {
          msgs.push({ content: txt })
        }
      }
    }
    corpus.messages = msgs
    corpus.updated_at = new Date().toISOString()
    corpus.count = msgs.length
    await Bun.write("data/user-corpus.json", JSON.stringify(corpus, null, 2))
  } catch {}

  function categorize(text: string) {
    text = text.trim()
    if (!text) return
    const lower = text.toLowerCase()
    if (/^为什么|^不对|^不应该|^你确定|^确认一下|^这个逻辑|^怎么|理解错|不合理|矛盾/.test(text)) {
      categories.challenge.push(text)
    } else if (/应该是|改成|不对|换|不要|需要改|重新|修[复改]/.test(text)) {
      categories.correction.push(text)
    } else if (/验证|检查|确认|规范|遵循|标准|细节|边缘|边界|case|测试/.test(lower)) {
      categories.detail.push(text)
    } else {
      categories.instruction.push(text)
    }
  }

  // Write to data/user-profile-raw.json
    const output = JSON.stringify(
    {
      updated_at: new Date().toISOString(),
      session_id: sessionID,
      summary: {
        total: Object.values(categories).reduce((a, b) => a + b.length, 0),
        challenge: categories.challenge.length,
        correction: categories.correction.length,
        detail: categories.detail.length,
        instruction: categories.instruction.length,
      },
      categories,
    },
    null,
    2,
  )

  await Bun.write("data/user-profile-raw.json", output)

  const summary = `Profile: ${categories.challenge.length}C/${categories.correction.length}CR/${categories.detail.length}D/${categories.instruction.length}I`
  const recent = categories.challenge.length > 0
    ? ` Recent: ${categories.challenge.slice(-3).map(c => c.slice(0, 40)).join(" | ")}`
    : ""
  state.profileStats = summary + recent
}
