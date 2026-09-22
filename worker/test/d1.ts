/**
 * A D1 double backed by real SQLite, for tests.
 *
 * It runs every file in `migrations/` — the actual files CI applies, in the same
 * filename order — against an in-memory database via `node:sqlite`. So a test
 * exercises real SQL against the real schema: a typo in a column name, a missing
 * index, or a constraint the handler violates all fail here rather than in
 * production. A new migration is picked up by virtue of existing, so there is no
 * list here to forget to update.
 *
 * It also counts statements and rows, because several phase 3 requirements are
 * budgets ("exactly 2 rows written per session", "a top-50 read costs ≤ 50
 * rows") and a budget that is not asserted is a budget that drifts.
 *
 * What it does NOT measure: rows *scanned*. SQLite does not expose its internal
 * read counter through `node:sqlite`, so `rowsRead` here is rows *returned*.
 * Whether a query is index-bounded is a separate question, answered by
 * `explain()` below and by the `EXPLAIN QUERY PLAN` output recorded in
 * `worker/README.md`.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `.href` rather than the URL object: this file is compiled with both
// `@cloudflare/workers-types` and `@types/node` in scope, whose `URL` types are
// not assignable to one another, and the string overload sidesteps the clash.
const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url).href);

/** Filename order, which is the order `wrangler d1 migrations apply` uses. */
function migrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(MIGRATIONS_DIR + name, 'utf8'));
}

export interface QueryRecord {
  sql: string;
  rowsRead: number;
  rowsWritten: number;
}

type Row = Record<string, unknown>;

/** What D1 accepts as a bound parameter, and what node:sqlite accepts. */
type Bindable = string | number | null;

function bindable(value: unknown): Bindable {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  // D1 stores booleans as integers; being explicit here stops a `true` from
  // silently becoming the string 'true' in a column a query later compares.
  if (typeof value === 'boolean') return value ? 1 : 0;
  throw new TypeError(`Cannot bind ${typeof value} to a D1 statement`);
}

function isWrite(sql: string): boolean {
  return /^\s*(insert|update|delete|replace)/i.test(sql);
}

export class TestD1 {
  readonly queries: QueryRecord[] = [];
  private readonly db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(':memory:');
    // The real thing, not a hand-maintained copy. If a migration breaks the
    // schema, every handler test fails and says so.
    for (const sql of migrations()) this.db.exec(sql);
  }

  /** Total rows the Worker has read through this binding. */
  get rowsRead(): number {
    return this.queries.reduce((sum, q) => sum + q.rowsRead, 0);
  }

  /** Total rows the Worker has written through this binding. */
  get rowsWritten(): number {
    return this.queries.reduce((sum, q) => sum + q.rowsWritten, 0);
  }

  /** Forget the log, so a test can measure one call rather than a whole setup. */
  resetCounters(): void {
    this.queries.length = 0;
  }

  /** The query plan for a statement, for asserting a query is really indexed. */
  explain(sql: string, ...params: Bindable[]): string[] {
    const rows = this.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Row[];
    return rows.map((row) => String(row.detail));
  }

  /** Direct access for fixtures and assertions; not counted against the budget. */
  seed(sql: string, ...params: Bindable[]): void {
    this.db.prepare(sql).run(...params);
  }

  /** Read helper for assertions; not counted against the budget. */
  read<T = Row>(sql: string, ...params: Bindable[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this, this.db.prepare(sql), sql);
  }

  /** D1 runs a batch in one transaction; so does this. */
  async batch<T = Row>(statements: TestD1Statement[]): Promise<D1ResultLike<T>[]> {
    this.db.exec('BEGIN');
    try {
      const results: D1ResultLike<T>[] = [];
      for (const statement of statements) results.push(await statement.run<T>());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  record(sql: string, rowsRead: number, rowsWritten: number): void {
    this.queries.push({ sql, rowsRead, rowsWritten });
  }
}

export interface D1ResultLike<T> {
  results: T[];
  success: true;
  meta: { rows_read: number; rows_written: number; changes: number; duration: number };
}

export class TestD1Statement {
  private params: Bindable[] = [];

  constructor(
    private readonly owner: TestD1,
    private readonly statement: StatementSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.params = values.map(bindable);
    return this;
  }

  // These return promises without awaiting anything: `node:sqlite` is
  // synchronous, but D1's API is not, and the double has to present the async
  // shape the handlers are written against.
  first<T = Row>(): Promise<T | null>;
  first<V>(column: string): Promise<V | null>;
  first<T>(column?: string): Promise<T | null> {
    const rows = this.statement.all(...this.params) as Row[];
    this.owner.record(this.sql, rows.length, 0);
    const row = rows[0];
    if (row === undefined) return Promise.resolve(null);
    if (column === undefined) return Promise.resolve(row as T);
    return Promise.resolve((row[column] ?? null) as T);
  }

  all<T = Row>(): Promise<D1ResultLike<T>> {
    const rows = this.statement.all(...this.params) as T[];
    this.owner.record(this.sql, rows.length, 0);
    return Promise.resolve({
      results: rows,
      success: true,
      meta: { rows_read: rows.length, rows_written: 0, changes: 0, duration: 0 },
    });
  }

  run<T = Row>(): Promise<D1ResultLike<T>> {
    // A statement carrying RETURNING produces rows, and `node:sqlite` only
    // surfaces those through `all`. Everything else goes through `run`, whose
    // `changes` is the accurate write count — which is the number the budget
    // assertions depend on, so it is worth the branch.
    if (/returning/i.test(this.sql)) {
      const returned = this.statement.all(...this.params) as T[];
      this.owner.record(this.sql, 0, returned.length);
      return Promise.resolve({
        results: returned,
        success: true,
        meta: {
          rows_read: 0,
          rows_written: returned.length,
          changes: returned.length,
          duration: 0,
        },
      });
    }

    const result = this.statement.run(...this.params);
    const changes = Number(result.changes);
    const written = isWrite(this.sql) ? changes : 0;
    this.owner.record(this.sql, 0, written);
    return Promise.resolve({
      results: [],
      success: true,
      meta: { rows_read: 0, rows_written: written, changes, duration: 0 },
    });
  }
}
