import { describe, it, expect } from "vitest"
import * as pluginModule from "./index"

describe("plugin module export shape (opencode loader safety)", () => {
  // OpenCode's loader iterates Object.values(exports) and treats every
  // exported function as a plugin. The entry module must only export
  // server/default — any extra export gets mis-loaded as a plugin.
  it("only exports server and default — no stray exports", () => {
    expect(Object.keys(pluginModule).sort()).toEqual(["default", "server"])
  })

  it("server and default are the same function", () => {
    expect(typeof pluginModule.server).toBe("function")
    expect(pluginModule.default).toBe(pluginModule.server)
  })

  // Regression for "null is not an object (evaluating 'N.config')": the
  // plugin factory must return a real hooks object (not null), so the loader's
  // `hooks.config?.()` dereference never crashes.
  it("invoking the plugin returns a real hooks object with config/event", async () => {
    const hooks = await pluginModule.server({} as any, {} as any)
    expect(hooks).toBeTruthy()
    expect(typeof hooks).toBe("object")
    expect(typeof (hooks as any).config).toBe("function")
    expect(typeof (hooks as any).event).toBe("function")
  })
})
