/**
 * Seed the user corpus from past OpenCode sessions — directly from the local
 * SQLite store, with no dependency on oh-my-openagent or a python finder.
 *
 * OpenCode stores all session/message history in a SQLite DB at
 * `~/.local/share/opencode/opencode.db` (tables: session, message, part).
 * Role lives in `message.data` (JSON `$.role`); the typed text lives in
 * `part.data` (JSON `$.text` where `$.type = "text"`). We read it read-only;
 * Bun's sqlite driver handles WAL sidecars transparently.
 *
 * This module is pure: it takes the DB path + options and writes to an
 * explicit corpus path, so it's unit-testable with a temp DB. The plugin
 * entry wires it to `/pred-seed`.
 */

// `bun:sqlite` is only available under the Bun runtime (the OpenCode plugin
// host). Under node/vitest the import throws; callers/tests guard on that.
import type { Database as DatabaseType } from "bun:sqlite"

export interface SeedOptions {
  /** Path to opencode.db. Default: ~/.local/share/opencode/opencode.db */
  dbPath?: string
  /** Filter sessions by project directory; null = all sessions. Default: null */
  directory?: string | null
  /** Cap sessions scanned (most recent first). Default: 50 */
  limit?: number
  /** Where to read/merge the corpus. Default: data/user-corpus.json */
  corpusPath?: string
}

export interface SeedResult {
  sessions: number
  messages: number
  newMessages: number // after dedup against existing corpus
}

interface CorpusFile {
  updated_at?: string
  count?: number
  messages: Array<{ content: string }>
}

function defaultDbPath(): string {
  const home = process.env.HOME ?? ""
  const xdg = process.env.XDG_DATA_HOME ?? `${home}/.local/share`
  return `${xdg}/opencode/opencode.db`
}

/**
 * Open opencode.db read-only and pull genuine user-typed text from past
 * sessions, then merge (dedup by content) into the corpus file.
 *
 * Excludes: assistant messages, non-text parts, `synthetic` parts (editor-open
 * system-reminder injections), and command lines (text starting with "/").
 */
export async function seedCorpus(
  opts: SeedOptions = {},
  deps: { Database: typeof DatabaseType; fs?: typeof import("node:fs") } | null = null,
): Promise<SeedResult> {
  if (!deps?.Database) {
    throw new Error(
      "bun:sqlite is not available in this runtime — /pred-seed runs inside the OpenCode (Bun) plugin host.",
    )
  }
  const { Database } = deps
  const dbPath = opts.dbPath ?? defaultDbPath()
  const directory = opts.directory ?? null
  const limit = opts.limit ?? 50
  const corpusPath = opts.corpusPath ?? "data/user-corpus.json"

  const db = new Database(dbPath, { readonly: true }) as DatabaseType
  try {
    const sessions = listSessions(db, directory, limit)
    const messages: string[] = []
    for (const sid of sessions) {
      for (const text of userTextForSession(db, sid)) {
        messages.push(text)
      }
    }

    return mergeIntoCorpus(corpusPath, messages, deps.fs, sessions.length)
  } finally {
    db.close()
  }
}

function listSessions(db: DatabaseType, directory: string | null, limit: number): string[] {
  if (directory) {
    const rows = db
      .query("SELECT id FROM session WHERE directory = ? ORDER BY time_created DESC LIMIT ?")
      .all(directory, limit) as Array<{ id: string }>
    return rows.map((r) => r.id)
  }
  const rows = db
    .query("SELECT id FROM session ORDER BY time_created DESC LIMIT ?")
    .all(limit) as Array<{ id: string }>
  return rows.map((r) => r.id)
}

function userTextForSession(db: DatabaseType, sessionId: string): string[] {
  const rows = db
    .query(
      `SELECT json_extract(p.data, '$.text') AS text
       FROM message m
       JOIN part p ON p.message_id = m.id
       WHERE m.session_id = ?
         AND json_extract(m.data, '$.role') = 'user'
         AND json_extract(p.data, '$.type') = 'text'
         AND json_extract(p.data, '$.text') IS NOT NULL
         AND (json_extract(p.data, '$.synthetic') IS NULL
              OR json_extract(p.data, '$.synthetic') = 0)
       ORDER BY p.time_created ASC`,
    )
    .all(sessionId) as Array<{ text: string | null }>
  const out: string[] = []
  for (const r of rows) {
    const text = (r.text ?? "").trim()
    if (!text) continue
    if (text.startsWith("/")) continue // command lines aren't natural prose
    out.push(text)
  }
  return out
}

async function mergeIntoCorpus(
  corpusPath: string,
  newMessages: string[],
  fs: typeof import("node:fs") | undefined,
  sessionsCount: number,
): Promise<SeedResult> {
  // Prefer node:fs when injected (tests); fall back to Bun.file/write at runtime.
  const existing = await readCorpus(corpusPath, fs)
  const seen = new Set(existing.messages.map((m) => m.content))
  let added = 0
  for (const text of newMessages) {
    if (!seen.has(text)) {
      seen.add(text)
      existing.messages.push({ content: text })
      added++
    }
  }
  existing.updated_at = new Date().toISOString()
  existing.count = existing.messages.length
  await writeCorpus(corpusPath, existing, fs)
  return { sessions: sessionsCount, messages: newMessages.length, newMessages: added }
}

async function readCorpus(
  path: string,
  fs: typeof import("node:fs") | undefined,
): Promise<CorpusFile> {
  if (fs) {
    try {
      return JSON.parse(fs.readFileSync(path, "utf8")) as CorpusFile
    } catch {
      return { messages: [] }
    }
  }
  try {
    return JSON.parse(await Bun.file(path).text()) as CorpusFile
  } catch {
    return { messages: [] }
  }
}

async function writeCorpus(
  path: string,
  data: CorpusFile,
  fs: typeof import("node:fs") | undefined,
): Promise<void> {
  const text = JSON.stringify(data, null, 2)
  if (fs) {
    fs.writeFileSync(path, text)
    return
  }
  await Bun.write(path, text)
}

/** Test/inspection helper: is bun:sqlite importable in this runtime? */
export async function isSeedAvailable(): Promise<boolean> {
  try {
    await import("bun:sqlite")
    return true
  } catch {
    return false
  }
}
