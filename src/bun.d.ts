/**
 * Ambient declarations for the Bun runtime, available only inside the OpenCode
 * plugin host (Bun). Declared here so `tsc` (node) can type-check without
 * installing @types/bun — the real types exist at runtime.
 *
 * Only the surface this project uses is declared. Keep it minimal.
 */

declare const Bun: {
  write(path: string, data: string): Promise<number>
  file(path: string): { text(): Promise<string> }
}

declare module "bun:sqlite" {
  export interface Statement {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
    run(...params: unknown[]): unknown
  }
  export interface DatabaseOptions {
    readonly?: boolean
  }
  // Minimal class covering the surface this project uses. Declared as a class
  // (not interface+function) to satisfy @typescript-eslint/no-unsafe-declaration-merging.
  export class Database {
    constructor(path: string, options?: DatabaseOptions)
    query(sql: string): Statement
    exec(sql: string): void
    close(): void
  }
}
