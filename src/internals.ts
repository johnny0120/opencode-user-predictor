/**
 * Internals for opencode-user-predictor.
 *
 * This module is NOT referenced by `opencode.json`'s `plugin` array, so it is
 * never loaded by the OpenCode plugin loader. That means it is free to export
 * whatever it wants (state, helpers) without those exports being mis-loaded as
 * plugins. The plugin entry module (`src/index.ts`) imports from here but only
 * re-exports `server`/`default`, which is the loader-safe shape.
 *
 * OpenCode's loader iterates `Object.values(moduleExports)` and treats every
 * exported function as a plugin. Exporting helper functions from the entry
 * module caused `resolveModel()` (returns `null` when no model is configured)
 * to be called as a plugin and then dereferenced as `null.config` →
 * "plugin config hook failed". Keep entry modules clean.
 */

// ---- State ----

export interface PredictorState {
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

export const state: PredictorState = {
  useSmallModel: false,
  enabled: false,
  lastPredictionAt: 0,
  minPredictionInterval: 2000,
  mainSessionID: null,
  predicting: false,
  profileStats: "",
}

/** Test-only: returns mutable state ref. NOT a Plugin hook. */
export function _testState(): PredictorState {
  return state
}

// ---- Model Resolution ----

export function resolveModel(): { providerID: string; modelID: string } | null {
  const id = state.useSmallModel ? (state.smallModelId ?? state.modelId) : state.modelId
  if (!id) return null

  const [providerID, ...rest] = id.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return null

  return { providerID, modelID }
}

// ---- Message Extraction ----

/**
 * Is this an assistant message that is just the predictor plugin's own
 * command response (toggle/status/profile/seed acks)? These are not real
 * conversational replies — feeding them to the predictor pollutes its view
 * of "what the coding assistant said" and skews predictions toward
 * status-reporting instead of natural next messages.
 */
function isPluginAck(content: string): boolean {
  const c = content.trim()
  if (!c) return false
  // Exact/template acks the plugin emits via command.execute.before / chat.message.
  const ackPatterns = [
    /^Predictor (enabled|disabled)\b/i,
    /^Predictor is (on|off)\b/i,
    /^Profile refresh started\b/i,
    /^User profile refreshed\b/i,
    /^Seed started\b/i,
    /^Seeded \d+ new messages\b/i,
  ]
  if (ackPatterns.some((re) => re.test(c))) return true
  // oh-my-openagent wraps /pred-* in a status-check style reply.
  if (/predictor.*currently.*(disabled|enabled)/i.test(c) && /turn it on/i.test(c)) return true
  return false
}

export function extractTextMessages(raw: unknown[]): Array<{ role: string; content: string }> {
  if (!Array.isArray(raw)) return []
  const result: Array<{ role: string; content: string }> = []

  for (const msg of raw) {
    const m = msg as {
      role?: string
      info?: { role?: string }
      parts?: Array<{ type?: string; text?: string }>
      content?: string
    }
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

    const text = content.trim()
    if (!text) continue

    // Drop /pred-* command invocations — they are plugin directives, not
    // natural things the user would say to the assistant. (Same rule the
    // /pred-seed corpus seeder applies.)
    if (role === "user" && /^\/pred-(on|off|status|profile|seed)\b/i.test(text)) continue
    // Drop the plugin's own command acks from the assistant side.
    if (role === "assistant" && isPluginAck(text)) continue

    result.push({ role, content: text })
  }

  return result
}
