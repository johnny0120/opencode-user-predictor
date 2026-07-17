/**
 * Integration test: prove the plugin loads without crashing OpenCode.
 *
 * This test is outside `src/` (not in tsconfig `include`), so it isn't part
 * of `tsc --noEmit`. It uses node built-ins directly. Vitest picks it up via
 * its default test glob.
 *
 * What it checks (the original bug): OpenCode's plugin loader iterates
 * `Object.values(moduleExports)` and treats every exported function as a
 * plugin. Stray exports from the entry module caused `resolveModel()` (which
 * returns null) to be called as a plugin, then dereferenced as `null.config`
 * → "plugin config hook failed" → OpenCode failed to start.
 *
 * Strategy: scaffold a throwaway project dir that loads ONLY this plugin,
 * run `opencode run hi` there, and assert the OpenCode log shows our config
 * hook ran and shows NONE of the plugin-load failure markers.
 */
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..")
const OPENCODE_BIN = process.env.OPENCODE_BIN || "opencode"

const LOG_PATH = join(
  process.env.XDG_DATA_HOME || join(process.env.HOME || "~", ".local", "share"),
  "opencode",
  "log",
  "opencode.log",
)

function fileSize(p: string): number {
  try {
    return statSync(p).size
  } catch {
    return 0
  }
}

function readTail(p: string, fromByte: number): string {
  try {
    const fd = readFileSync(p)
    return fd.subarray(fromByte).toString("utf8")
  } catch {
    return ""
  }
}

/** Is the opencode binary actually available on PATH (or OPENCODE_BIN)? */
function opencodeAvailable(): boolean {
  const bin = OPENCODE_BIN
  // If it's an absolute/relative path, just check it exists; otherwise look it
  // up on PATH via `which`. `which` is a shell builtin, so use `command -v`.
  const r = spawnSync("sh", ["-c", `command -v ${JSON.stringify(bin)}`], { encoding: "utf8" })
  return r.status === 0 && r.stdout.trim().length > 0
}

// Skip entirely when the opencode binary isn't installed (e.g. CI on ubuntu).
// This is an end-to-end smoke test, not a unit test — it only meaningfully
// runs where opencode is present (developer machines).
const describeOrSkip = opencodeAvailable() ? describe : describe.skip

describeOrSkip("opencode can start with this plugin loaded", { timeout: 60_000 }, () => {
  it("plugin loads without 'config hook failed' / 'failed to load plugin' and runs its config hook", () => {
    const dir = join(tmpdir(), `opencode-pred-it-${process.pid}-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    mkdirSync(join(dir, "src"), { recursive: true })
    mkdirSync(join(dir, "data"), { recursive: true })

    // Scaffold a project that loads ONLY this plugin (entry at ./src/index.ts
    // so the relative "./prompts" / "./internals" imports resolve unchanged).
    copyFileSync(join(REPO_ROOT, "src", "index.ts"), join(dir, "src", "index.ts"))
    copyFileSync(join(REPO_ROOT, "src", "prompts.ts"), join(dir, "src", "prompts.ts"))
    copyFileSync(join(REPO_ROOT, "src", "internals.ts"), join(dir, "src", "internals.ts"))
    if (existsSync(join(REPO_ROOT, "predictor-profile.json"))) {
      copyFileSync(join(REPO_ROOT, "predictor-profile.json"), join(dir, "predictor-profile.json"))
    }
    writeFileSync(
      join(dir, "opencode.json"),
      JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          plugin: ["./src/index.ts"],
        },
        null,
        2,
      ),
    )

    const logBefore = fileSize(LOG_PATH)

    try {
      const res = spawnSync(OPENCODE_BIN, ["run", "hi"], {
        cwd: dir,
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env },
      })

      // Whether the LLM call itself succeeded is irrelevant — the plugin
      // load/CONFIG phase happens during bootstrap, before any model call.
      // We only care that bootstrap didn't crash on the plugin.

      const logTail = readTail(LOG_PATH, logBefore)

      // Sanity: this bootstrap actually ran in our temp dir. macOS resolves
      // /tmp → /private/tmp, so realpath() before matching.
      const realDir = realpathSync(dir)
      const sawBootstrap =
        logTail.includes(`bootstrapping directory=${dir}`) ||
        logTail.includes(`bootstrapping directory=${realDir}`)
      expect(sawBootstrap, `expected bootstrap for ${dir} or ${realDir}`).toBe(true)

      // The regression: these markers must NOT appear for this run.
      expect(logTail).not.toContain("plugin config hook failed")
      expect(logTail).not.toContain("failed to load plugin")
      expect(logTail).not.toContain("Event listener failed")

      // Positive: our plugin's config hook actually executed (it writes
      // "config hook ran" to data/predictor.log).
      const predictorLogPath = join(dir, "data", "predictor.log")
      expect(existsSync(predictorLogPath)).toBe(true)
      const predictorLog = readFileSync(predictorLogPath, "utf8")
      expect(predictorLog).toContain("config hook ran")

      // res.status / stderr surfaced only for debugging on failure.
      if (res.error) {
        // spawn-level failure (e.g. timeout) — still fail loudly with context
        throw new Error(
          `opencode spawn failed: ${res.error.message}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
        )
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
