import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Mock Bun global for tests
    globals: true,
    setupFiles: ["./test-setup.ts"],
  },
})
