/**
 * Asserts a D1 database really has the schema a migration claims to have applied.
 *
 * This exists because `wrangler d1 migrations apply` has a history of exiting 0
 * in GitHub Actions while having applied nothing, and of exiting 1 with no
 * useful log while having applied everything. The exit code is not trustworthy
 * on its own, so CI asks the database what it contains and fails loudly on a
 * mismatch, naming the tables that are missing.
 *
 * Usage: tsx scripts/verify-schema.ts <local|staging|production>
 */
import { execFileSync } from 'node:child_process';

const EXPECTED_TABLES = [
  'badge_award',
  'device',
  'leaderboard_snapshot',
  'score_histogram',
  'season',
  'session',
  'shared_deck',
  'suggestion',
  'transfer_claim_attempt',
  'transfer_code',
  'usage',
] as const;

const EXPECTED_INDEXES = [
  'idx_badge_device',
  'idx_session_alltime',
  'idx_session_device',
  'idx_session_leaderboard',
  'idx_shared_deck_device',
  'idx_snapshot_device',
  'idx_suggestion_device',
  'idx_suggestion_status',
  'idx_transfer_device',
  'idx_transfer_expires',
] as const;

/**
 * Columns a later migration added with `ALTER TABLE`, grouped by table.
 *
 * Checked as well as the table list because an `ADD COLUMN` that did not apply
 * looks exactly like one that did: the table is present either way, and the
 * mismatch only surfaces when a handler binds a column that is not there. These
 * are the columns with no `CREATE TABLE` of their own to vouch for them.
 */
const EXPECTED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  device: ['best_score', 'season_id_days', 'season_days'],
  score_histogram: ['built_at'],
};

type Target = 'local' | 'staging' | 'production';

function parseTarget(value: string | undefined): Target {
  if (value === 'local' || value === 'staging' || value === 'production') return value;
  throw new Error(`Expected one of local|staging|production, got ${String(value)}`);
}

/**
 * `--json` is the only output mode worth parsing; the table renderer wraps and
 * truncates. Wrangler prints its banner to stdout too, so the JSON is found
 * rather than assumed to start at byte zero.
 */
function query(target: Target, sql: string): string[] {
  // `DB` is the binding, not a database name: it resolves correctly in every
  // env without this script needing to know what each database is called.
  const args = ['wrangler', 'd1', 'execute', 'DB', '--config', 'worker/wrangler.toml'];
  if (target === 'local') args.push('--local');
  else args.push('--remote', '--env', target);
  args.push('--command', sql, '--json');

  const raw = execFileSync('npx', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

  const start = raw.indexOf('[');
  if (start === -1) throw new Error(`No JSON in wrangler output:\n${raw}`);

  const parsed: unknown = JSON.parse(raw.slice(start));
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array from wrangler');

  const names: string[] = [];
  for (const block of parsed) {
    const results: unknown = (block as { results?: unknown }).results;
    if (!Array.isArray(results)) continue;
    for (const row of results) {
      const name: unknown = (row as { name?: unknown }).name;
      if (typeof name === 'string') names.push(name);
    }
  }
  return names;
}

function assertAllPresent(kind: string, expected: readonly string[], actual: string[]): string[] {
  const found = new Set(actual);
  const missing = expected.filter((name) => !found.has(name));
  if (missing.length > 0) {
    console.error(`\n  MISSING ${kind}: ${missing.join(', ')}`);
    console.error(`  present: ${actual.sort().join(', ') || '(none)'}`);
  } else {
    console.log(`  ${expected.length} ${kind} present`);
  }
  return missing;
}

const target = parseTarget(process.argv[2]);
console.log(`Verifying schema on ${target}...`);

const tables = query(target, "SELECT name FROM sqlite_master WHERE type='table'");
const indexes = query(target, "SELECT name FROM sqlite_master WHERE type='index'");

const missing = [
  ...assertAllPresent('tables', EXPECTED_TABLES, tables),
  ...assertAllPresent('indexes', EXPECTED_INDEXES, indexes),
  // `PRAGMA table_info` returns one row per column, each carrying `name`, which
  // is the same shape `query` already reads.
  ...Object.entries(EXPECTED_COLUMNS).flatMap(([table, columns]) =>
    assertAllPresent(`${table} columns`, columns, query(target, `PRAGMA table_info(${table})`)),
  ),
];

if (missing.length > 0) {
  console.error(`\nSchema verification FAILED on ${target}: ${missing.length} object(s) missing.`);
  console.error('The migration did not apply what it claimed to. Do not trust its exit code.\n');
  process.exit(1);
}

console.log(`Schema verified on ${target}.`);
