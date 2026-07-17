// Mock Bun global for test environment
// In real OpenCode runtime, Bun is provided by the Bun engine.
// For tests, we stub it as a no-op.

;(globalThis as any).Bun = {
  write: async (_path: string, _data: string): Promise<number> => 0,
}
