// @ts-nocheck — runs with bun, not tsc
// Bootstrap user corpus from historical OpenCode sessions.
// Run once: bun run scripts/seed-corpus.ts [limit]
// Then /pred-profile maintains it incrementally.
import { $ } from "bun"

const LIMIT = parseInt(process.argv[2] || "30")

// Find the coding-agent-sessions finder from oh-my-openagent
const candidates = [
  `${process.env.HOME}/.cache/opencode/packages/oh-my-openagent@latest`,
  ...(await Array.fromAsync(new Bun.Glob(`${process.env.HOME}/.cache/opencode/packages/oh-my-openagent@*`).scan())),
]

let finder = ""
for (const c of candidates) {
  const p = `${c}/node_modules/oh-my-openagent/dist/skills/coding-agent-sessions/scripts/find-agent-sessions.py`
  if (await Bun.file(p).exists()) { finder = p; break }
}
if (!finder) {
  console.error("Cannot find coding-agent-sessions finder. Install oh-my-openagent first.")
  process.exit(1)
}

// List sessions
const list = await $`python3 ${finder} list --platform opencode --limit ${LIMIT} --from 30d`.quiet()
const sessions = JSON.parse(list.stdout.toString()).results

const corpus: Array<{ content: string }> = []
for (const s of sessions) {
  const detail = await $`python3 ${finder} read ${s.id} --platform opencode`.quiet().catch(() => null)
  if (!detail) continue
  try {
    const data = JSON.parse(detail.stdout.toString())
    for (const r of data.results || []) {
      for (const evt of r.events || []) {
        if (evt.type === "message" && evt.message?.role === "user" && evt.message?.content?.trim()) {
          corpus.push({ content: evt.message.content.trim() })
        }
      }
    }
  } catch {}
}

const output = { updated_at: new Date().toISOString(), count: corpus.length, messages: corpus }
await Bun.write("data/user-corpus.json", JSON.stringify(output, null, 2))
console.log(`Saved ${corpus.length} user messages from ${sessions.length} sessions to data/user-corpus.json`)
