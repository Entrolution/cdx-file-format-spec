#!/usr/bin/env npx tsx

/**
 * Generate the committed Level-1 container fixture corpus from its source of
 * truth (scripts/lib/fixture-corpus.ts). For each case it writes
 * conformance/fixtures/container/<name>/case.json (the descriptor) and case.cdx
 * (the byte-stable archive == buildZip(recipe)). This is the "generate" half of
 * the kat -> vectors pattern; scripts/check-fixtures.ts is the "verify" half and
 * asserts the committed artifacts still match this source.
 *
 * Run after editing the corpus:  npm run build:fixtures
 */

import * as fs from 'fs';
import * as path from 'path';
import { FIXTURE_CORPUS, caseJson } from './lib/fixture-corpus.js';
import { buildZip } from './lib/zip-writer.js';

const KIND = 'container';
const root = path.join(__dirname, '..', 'conformance', 'fixtures', KIND);

fs.mkdirSync(root, { recursive: true });

// Prune stale case directories no longer in the corpus.
const corpusNames = new Set(FIXTURE_CORPUS.map((c) => c.name));
for (const entry of fs.readdirSync(root)) {
  const p = path.join(root, entry);
  if (fs.statSync(p).isDirectory() && !corpusNames.has(entry)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`  pruned stale fixture ${entry}`);
  }
}

for (const c of FIXTURE_CORPUS) {
  const dir = path.join(root, c.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'case.json'), caseJson(c));
  fs.writeFileSync(path.join(dir, 'case.cdx'), buildZip(c.recipe));
}

console.log(`wrote ${FIXTURE_CORPUS.length} container fixtures to ${path.relative(process.cwd(), root)}/`);
