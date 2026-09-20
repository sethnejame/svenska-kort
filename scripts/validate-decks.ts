import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { entriesFileSchema } from '../src/data/schema';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entriesPath = resolve(root, 'src/data/entries.json');

const failures: string[] = [];

function report(): never {
  for (const line of failures.slice(0, 10)) console.error(`  ✗ ${line}`);
  if (failures.length > 10) console.error(`  … and ${failures.length - 10} more`);
  console.error(`\n${failures.length} problem(s) in src/data/entries.json`);
  process.exit(1);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(entriesPath, 'utf8'));
} catch (error) {
  failures.push(`entries.json is not valid JSON: ${(error as Error).message}`);
  report();
}

const parsed = entriesFileSchema.safeParse(raw);
if (!parsed.success) {
  const entries = Array.isArray(raw) ? raw : [];
  for (const issue of parsed.error.issues) {
    const index = issue.path[0];
    const entry = typeof index === 'number' ? (entries[index] as { id?: unknown }) : undefined;
    const id = typeof entry?.id === 'string' ? entry.id : `index ${String(index)}`;
    const field = issue.path.slice(1).join('.') || '(root)';
    failures.push(`${id} · ${field}: ${issue.message}`);
  }
  report();
}

const entries = parsed.data;

const seen = new Set<string>();
for (const entry of entries) {
  if (seen.has(entry.id)) failures.push(`${entry.id}: duplicate id`);
  seen.add(entry.id);
}

if (failures.length > 0) report();

console.log(`✓ ${entries.length} entries valid`);
