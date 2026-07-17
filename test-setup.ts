// Mock the Bun global for the node/vitest test environment.
// In the real OpenCode runtime Bun is provided by the Bun engine; under node
// it's absent, so stub it as a no-op so modules that reference Bun.file/Bun.write
// at load time don't throw. (Tests that need the real Bun runtime — e.g.
// src/seed.test.ts using bun:sqlite — run under `bun --bun vitest`, where Bun
// already exists and this stub is skipped.)
if (typeof Bun === "undefined") {
  ;(globalThis as any).Bun = {
    write: async (_path: string, _data: string): Promise<number> => 0,
    file: () => ({ text: async () => "" }),
  }
}
