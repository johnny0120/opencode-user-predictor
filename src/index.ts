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
import { USER_SIMULATOR_SYSTEM, buildPredictionMessages } from "./prompts"
import { state, resolveModel, extractTextMessages } from "./internals"
import { seedCorpus } from "./seed"

// NOTE: This module is the plugin entry referenced by `opencode.json`'s
// `plugin` array. OpenCode's loader iterates `Object.values(exports)` and
// treats EVERY exported function as a plugin. Only `server`/`default` may be
// exported here — helpers/state live in `./internals` (see that file for why).

// Bun runtime types (Bun global + bun:sqlite) are declared in ./bun.d.ts —
// ambient, so tsc under node can type-check without @types/bun.

async function loadProfile(): Promise<string> {
  try {
    const custom = await Bun.file("predictor-profile.json").text()
    return JSON.parse(custom).prompt || USER_SIMULATOR_SYSTEM
  } catch {
    return USER_SIMULATOR_SYSTEM
  }
}

type PluginInput = Parameters<Plugin>[0]

const predictor: Plugin = async ({ client }) => {
  return {
    config: async (cfg) => {
      state.modelId = cfg.model
      state.smallModelId = cfg.small_model

      log("config hook ran")

      // Allow user to override the system prompt via predictor-profile.json
      const agentPrompt = await loadProfile()
      // OpenCode's Config type is a deep proxy; agent/command are loosely typed
      // here because the SDK's Config/AgentConfig shapes don't expose arbitrary
      // mutation cleanly. Cast through unknown for the interop.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK Config/AgentConfig mutation
      const cfgAny = cfg as unknown as Record<string, any>
      const agents = cfgAny.agent ?? {}
      agents._predictor = {
        prompt: agentPrompt,
        mode: "subagent",
      }
      cfgAny.agent = agents

      // Auto-register predictor slash commands — users get /pred-on,
      // /pred-off, /pred-status, /pred-profile without editing opencode.json.
      // IMPORTANT: Must mutate individual properties on the existing object;
      // replacing cfg.command with a new object bypasses the config proxy.
      if (!cfg.command) {
        cfgAny.command = {}
      }
      const cmd = cfg.command!
      cmd["pred-on"] = {
        template: "/pred-on $ARGUMENTS",
        description: "Enable predictor, optionally with a message to the LLM",
      }
      cmd["pred-off"] = {
        template: "/pred-off $ARGUMENTS",
        description: "Disable predictor, optionally with a message to the LLM",
      }
      cmd["pred-status"] = {
        template: "/pred-status",
        description: "Show predictor status",
      }
      cmd["pred-profile"] = {
        template: "/pred-profile",
        description: "Refresh user profile from current session",
      }
      cmd["pred-seed"] = {
        template: "/pred-seed $ARGUMENTS",
        description: "Seed user corpus from past OpenCode sessions (optional: limit)",
      }
    },

    "chat.message": async (_input, output) => {
      // Detect /pred- commands in message text — needed because
      // oh-my-openagent intercepts all / messages and bypasses
      // OpenCode's native command processing (command.execute.before).
      const text = output.parts
        ?.filter((p) => p.type === "text" && "text" in p && p.text)
        .map((p) => ("text" in p ? p.text : ""))
        .join("")
        .trim()
      if (!text) return
      const match = text.match(/^\/(pred-on|pred-off|pred-status|pred-profile|pred-seed)\b(.*)?/)
      if (!match) return

      const cmd = match[1]!
      const rest = (match[2] || "").trim()
      const toast = (message: string, variant: "success" | "info") =>
        client.tui.showToast({ body: { message, variant } }).catch(() => {})

      if (cmd === "pred-on") {
        state.enabled = true
        toast("Predictor enabled", "success")
        output.parts = [textPart(rest || "Predictor enabled")]
      } else if (cmd === "pred-off") {
        state.enabled = false
        toast("Predictor disabled", "info")
        output.parts = [textPart(rest || "Predictor disabled")]
      } else if (cmd === "pred-status") {
        output.parts = [textPart(`Predictor is ${state.enabled ? "on" : "off"}`)]
      } else if (cmd === "pred-profile") {
        refreshProfile(client, _input.sessionID).catch(() => {})
        output.parts = [textPart("Profile refresh started")]
        toast("User profile refreshed", "success")
      } else if (cmd === "pred-seed") {
        runSeed(client, rest)
        output.parts = [textPart("Seed started…")]
      }
    },

    "command.execute.before": (input, output) => {
      const cmd = input.command
      const rest = (input.arguments ?? "").trim()
      const toast = (message: string, variant: "success" | "info") =>
        client.tui.showToast({ body: { message, variant } }).catch(() => {})

      if (cmd === "pred-on") {
        state.enabled = true
        toast("Predictor enabled", "success")
        output.parts = [textPart(rest || "Predictor enabled")]
      } else if (cmd === "pred-off") {
        state.enabled = false
        toast("Predictor disabled", "info")
        output.parts = [textPart(rest || "Predictor disabled")]
      } else if (cmd === "pred-status") {
        output.parts = [textPart(`Predictor is ${state.enabled ? "on" : "off"}`)]
      } else if (cmd === "pred-profile") {
        refreshProfile(client, input.sessionID).catch(() => {})
        output.parts = [textPart("Profile refresh started")]
        toast("User profile refreshed", "success")
      } else if (cmd === "pred-seed") {
        runSeed(client, rest)
        output.parts = [textPart("Seed started…")]
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

        client.tui
          .showToast({
            body: { message: "Predicting...", variant: "info", duration: 3000 },
          })
          .catch(() => {})

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
        log(`error: ${String(err)}`)
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

  const messages = state.profileStats ? [state.profileStats, ...flipped] : flipped
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
      .filter((p) => p.type === "text")
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim()

    log(
      `LLM CALL:\n---AGENT---\n_predictor\n---SYSTEM---\n${USER_SIMULATOR_SYSTEM}\n---INPUT---\n${prompt}\n---OUTPUT---\n${text}\n---END---`,
    )
    return text || null
  } catch (err) {
    log(`predict error: ${String(err)}`)
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
    .then(() =>
      Bun.file("data/predictor.log")
        .text()
        .catch(() => ""),
    )
    .then((prev) => Bun.write("data/predictor.log", prev + line).then(() => {}))
    .catch(() => {})
}

/**
 * Build a text Part for hook outputs. OpenCode's `Part` type is a broad union
 * where every member carries id/sessionID/messageID — but the runtime accepts a
 * bare `{type:"text", text}` and fills the rest. The hook's `output.parts` is
 * typed `Part[]`, so we cast the bare object to `Part` (runtime-compatible).
 */
function textPart(text: string): import("@opencode-ai/sdk").Part {
  return { type: "text", text } as unknown as import("@opencode-ai/sdk").Part
}

// ---- Seed (bootstrap corpus from past sessions) ----

/**
 * Run `/pred-seed`: pull genuine user messages from past OpenCode sessions
 * (read directly from ~/.local/share/opencode/opencode.db via bun:sqlite) and
 * merge them into data/user-corpus.json. Fire-and-forget; toasts progress.
 */
function runSeed(client: PluginInput["client"], rest: string): void {
  const limit = parseInt(rest, 10)
  const opts = Number.isFinite(limit) && limit > 0 ? { limit } : {}
  const toast = (message: string, variant: "success" | "info") =>
    client.tui.showToast({ body: { message, variant } }).catch(() => {})

  toast("Seeding corpus from past sessions…", "info")
  void (async () => {
    try {
      // bun:sqlite is only available in the Bun plugin host. Import lazily so
      // the module loads under node/vitest too (where /pred-seed just no-ops).
      const { Database } = await import("bun:sqlite")
      const result = await seedCorpus(opts, { Database })
      log(`seed: ${result.sessions} sessions, ${result.messages} msgs, ${result.newMessages} new`)
      toast(`Seeded ${result.newMessages} new messages from ${result.sessions} sessions`, "success")
    } catch (err) {
      log(`seed error: ${String(err)}`)
      toast(`Seed failed: ${String(err)}`, "info")
    }
  })()
}

// ---- Profile Refresh ----

interface ProfileCategory {
  challenge: string[]
  correction: string[]
  detail: string[]
  instruction: string[]
}

async function refreshProfile(client: PluginInput["client"], sessionID: string): Promise<void> {
  const response = await client.session.messages({ path: { id: sessionID } })
  const raw: Array<{
    role?: string
    info?: { role?: string }
    parts?: Array<{ type?: string; text?: string }>
    content?: string
  }> = (response.data ?? []) as unknown as Array<Record<string, unknown>>
  if (!Array.isArray(raw)) return

  // Read historical user corpus if available
  try {
    const corpusStr = await Bun.file("data/user-corpus.json").text()
    const corpus = JSON.parse(corpusStr)
    for (const m of corpus.messages ?? []) {
      if (m.content) {
        raw.push({ role: "user", parts: [{ type: "text", text: m.content }] })
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
    for (const m of corpus.messages ?? []) {
      categorize(m.content ?? "")
    }
  } catch {}

  // Append current session's user messages to corpus for future use
  try {
    const existing = await Bun.file("data/user-corpus.json")
      .text()
      .catch(() => "{}")
    const corpus = JSON.parse(existing)
    const msgs = (corpus.messages ?? []) as Array<{ content?: string }>
    for (const msg of raw) {
      const m = msg
      if (m.role !== "user" && m.info?.role !== "user") continue
      let content = ""
      if (Array.isArray(m.parts)) {
        content = m.parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text ?? "")
          .join("")
      } else if (typeof m.content === "string") {
        content = m.content
      }
      if (content.trim()) {
        const txt = content.trim()
        if (!msgs.some((e) => e.content === txt)) {
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
  const recent =
    categories.challenge.length > 0
      ? ` Recent: ${categories.challenge
          .slice(-3)
          .map((c) => c.slice(0, 40))
          .join(" | ")}`
      : ""
  state.profileStats = summary + recent
}

export { predictor as server }
export default predictor
