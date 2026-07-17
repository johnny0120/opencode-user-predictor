import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { seedCorpus } from "./seed"

// bun:sqlite is only available under the Bun runtime. These tests create a
// real temp SQLite DB, so they skip entirely under node/vitest.
let Database: typeof import("bun:sqlite").Database | null = null
try {
  Database = (await import("bun:sqlite")).Database
} catch {
  Database = null
}

const describeOrSkip = Database ? describe : describe.skip

describeOrSkip("seedCorpus", () => {
  let dir: string
  let dbPath: string
  let corpusPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pred-seed-"))
    dbPath = join(dir, "opencode.db")
    corpusPath = join(dir, "user-corpus.json")
    const db = new Database!(dbPath)
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, time_created INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT NOT NULL);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
                         time_created INTEGER, data TEXT NOT NULL);
    `)
    // Session A: two genuine user messages + an assistant reply + a /cmd line
    insertMsg(db, "ses_A", "m_a1", "user", "fix the login bug", false)
    insertMsg(db, "ses_A", "m_a2", "assistant", "done", false)
    insertMsg(db, "ses_A", "m_a3", "user", "run typecheck", false)
    insertMsg(db, "ses_A", "m_a4", "user", "/pred-status", false) // command line — excluded
    // Session B: a synthetic editor-open injection — excluded
    insertMsg(db, "ses_B", "m_b1", "user", "<system-reminder>editor opened</system-reminder>", true)
    insertMsg(db, "ses_B", "m_b2", "user", "why does this throw on null", false)
    db.close()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("extracts only genuine user text, excluding assistant/synthetic/command lines", async () => {
    const result = await seedCorpus(
      { dbPath, corpusPath, directory: null, limit: 10 },
      { Database: Database! },
    )
    expect(result.sessions).toBe(2)
    // 4 user text parts total, minus the /pred-status command line = 3 genuine;
    // but ses_A has 3 user msgs (a1, a3, a4) and ses_B has 2 (b1 synthetic, b2).
    // Genuine = a1 "fix the login bug", a3 "run typecheck", b2 "why does this throw on null" = 3.
    expect(result.messages).toBe(3)
    expect(result.newMessages).toBe(3)

    const corpus = JSON.parse(readFileSync(corpusPath, "utf8"))
    const contents = corpus.messages.map((m: { content: string }) => m.content)
    expect(contents).toContain("fix the login bug")
    expect(contents).toContain("run typecheck")
    expect(contents).toContain("why does this throw on null")
    expect(contents).not.toContain("/pred-status")
    expect(contents).not.toContain("<system-reminder>editor opened</system-reminder>")
    expect(contents).not.toContain("done") // assistant
  })

  it("dedups against an existing corpus", async () => {
    // Pre-seed the corpus with one already-known message.
    writeFileSync(corpusPath, JSON.stringify({ messages: [{ content: "fix the login bug" }] }))
    const result = await seedCorpus(
      { dbPath, corpusPath, directory: null, limit: 10 },
      { Database: Database! },
    )
    expect(result.messages).toBe(3)
    expect(result.newMessages).toBe(2) // "fix the login bug" already present

    const corpus = JSON.parse(readFileSync(corpusPath, "utf8"))
    expect(corpus.messages).toHaveLength(3)
    expect(corpus.count).toBe(3)
    expect(corpus.updated_at).toBeTruthy()
  })

  it("respects the limit (sessions scanned, most recent first)", async () => {
    const result = await seedCorpus(
      { dbPath, corpusPath, directory: null, limit: 1 },
      { Database: Database! },
    )
    expect(result.sessions).toBe(1)
    // ses_B is newer (higher time_created) → only its 1 genuine message
    expect(result.messages).toBe(1)
  })

  it("filters by directory when provided", async () => {
    const result = await seedCorpus(
      { dbPath, corpusPath, directory: "/projects/alpha", limit: 10 },
      { Database: Database! },
    )
    expect(result.sessions).toBe(1)
    expect(result.messages).toBe(2) // a1 + a3 (a4 is a /cmd, excluded)
  })

  it("creates the corpus file when none exists", async () => {
    expect(existsSync(corpusPath)).toBe(false)
    await seedCorpus({ dbPath, corpusPath, directory: null, limit: 10 }, { Database: Database! })
    expect(existsSync(corpusPath)).toBe(true)
  })
})

function insertMsg(
  db: import("bun:sqlite").Database,
  sessionId: string,
  msgId: string,
  role: string,
  text: string,
  synthetic: boolean,
) {
  const t = (sessionId === "ses_B" ? 2000 : 1000) + parseInt(msgId.slice(-1), 36)
  // Insert session row only once per session (idempotent — multiple messages
  // share a session).
  db.query("INSERT OR IGNORE INTO session (id, directory, time_created) VALUES (?, ?, ?)").run(
    sessionId,
    sessionId === "ses_A" ? "/projects/alpha" : "/projects/beta",
    t,
  )
  db.query("INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)").run(
    msgId,
    sessionId,
    JSON.stringify({ role }),
  )
  db.query(
    "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
  ).run(
    `p_${msgId}`,
    msgId,
    sessionId,
    t,
    JSON.stringify({ type: "text", text, synthetic: synthetic || undefined }),
  )
}
