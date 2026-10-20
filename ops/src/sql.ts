/**
 * The one DB seam (D29): every module talks to the DB through this shape and
 * nothing else. Two backends implement it — better-sqlite3 on the Node side
 * (`sqlite-file.ts`) and the Durable Object's `ctx.storage.sql` on the Workers
 * side (`sql-do.ts`) — so the tests run against an injectable seam and the
 * Workers port changes the backend, not the modules.
 *
 * The shape is better-sqlite3's, deliberately: positional params, `.get` /
 * `.all` / `.run`, a `transaction(fn)` wrapper, and an `exec` for the
 * multi-statement migration strings. The Durable Object adapter maps that
 * shape onto SqlStorage (`exec` cursors, `transactionSync`), which is why the
 * migrations "mostly carry" (the ENG-740 amendment's words).
 */
export interface SqlRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

export interface SqlStatement {
  /** The first row, or undefined. */
  get(...params: unknown[]): unknown;
  /** Every row, possibly empty. */
  all(...params: unknown[]): unknown[];
  /** One write; `changes` and `lastInsertRowid` as better-sqlite3 reports them. */
  run(...params: unknown[]): SqlRunResult;
}

export interface SqlHandle {
  /** Release resources owned by the adapter; runtime-owned DO storage omits this. */
  close?(): void;
  prepare(sql: string): SqlStatement;
  /** One or more statements, no params — the migrations' shape. */
  exec(sql: string): void;
  /** Runs `fn` atomically: all of it commits, or none of it did. */
  transaction<T>(fn: () => T): T;
}
