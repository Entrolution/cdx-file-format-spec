#!/usr/bin/env npx tsx

/**
 * Generate the committed Level-1 fixture corpus from its source of truth
 * (scripts/lib/fixture-corpus.ts). For each case it writes
 * conformance/fixtures/<layer>/<name>/case.json (the descriptor) and case.cdx
 * (the byte-stable archive == buildZip(recipe)). The case's `layer` is its <kind>
 * directory: `container` (B1a, the archive layer) or `document` (B1b, the part
 * layer). This is the "generate" half of the kat -> vectors pattern;
 * scripts/check-fixtures.ts is the "verify" half and asserts the committed
 * artifacts still match this source.
 *
 * Run after editing the corpus:  npm run build:fixtures
 */

import * as fs from 'fs';
import * as path from 'path';
import { FIXTURE_CORPUS, caseJson, type AuthoredCase } from './lib/fixture-corpus.js';
import { buildZip } from './lib/zip-writer.js';

const fixturesRoot = path.join(__dirname, '..', 'conformance', 'fixtures');
fs.mkdirSync(fixturesRoot, { recursive: true });

// Group cases by their <kind> directory (== layer).
const byKind = new Map<string, AuthoredCase[]>();
for (const c of FIXTURE_CORPUS) {
  const list = byKind.get(c.layer) ?? [];
  list.push(c);
  byKind.set(c.layer, list);
}

// Consider every kind directory currently on disk too, so a kind whose cases were
// all removed from the corpus gets its stale directories pruned (not silently left).
const onDisk = fs
  .readdirSync(fixturesRoot)
  .filter((e) => fs.statSync(path.join(fixturesRoot, e)).isDirectory());
const kinds = new Set<string>([...byKind.keys(), ...onDisk]);

let total = 0;
for (const kind of [...kinds].sort()) {
  const root = path.join(fixturesRoot, kind);
  const cases = byKind.get(kind) ?? [];
  const names = new Set(cases.map((c) => c.name));

  // Prune stale case directories no longer in the corpus for this kind.
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root)) {
      const p = path.join(root, entry);
      if (fs.statSync(p).isDirectory() && !names.has(entry)) {
        fs.rmSync(p, { recursive: true, force: true });
        console.log(`  pruned stale fixture ${kind}/${entry}`);
      }
    }
  }
  if (cases.length === 0) {
    // The kind has no cases left; remove the now-empty kind directory rather than
    // leaving an orphan husk (its stale case dirs were pruned above).
    if (fs.existsSync(root) && fs.readdirSync(root).length === 0) fs.rmdirSync(root);
    continue;
  }

  fs.mkdirSync(root, { recursive: true });
  for (const c of cases) {
    const dir = path.join(root, c.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'case.json'), caseJson(c));
    fs.writeFileSync(path.join(dir, 'case.cdx'), buildZip(c.recipe));
    total++;
  }
}

const summary = [...byKind.keys()]
  .sort()
  .map((k) => `${byKind.get(k)!.length} ${k}`)
  .join(', ');
console.log(`wrote ${total} fixtures (${summary}) to ${path.relative(process.cwd(), fixturesRoot)}/`);
