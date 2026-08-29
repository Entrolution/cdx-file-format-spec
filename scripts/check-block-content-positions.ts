#!/usr/bin/env npx tsx

/**
 * Gate: the transcribed block-content position sets match what the published schemas declare.
 *
 * WHY THIS EXISTS. §4.3.1 item 4 and §4.3.2 item 2 are scoped to block content
 * (`BLOCK_CONTENT_KEYS`), and BOTH implementations transcribe that set rather than deriving
 * it — the reference because it is a specification's canonicalizer and stays a pure function
 * of its inputs, the Python oracle because deriving from the same schema as the reference
 * would make the two share any error in it. Transcription is the right call twice over and it
 * has one failure mode: a new block type carrying a rich text array updates the schema and
 * leaves both sets quietly narrow, so the rules stop reaching content they govern. Nothing
 * else in the suite would notice — the corpus can only catch a position some fixture exercises.
 *
 * The gate closes that by re-deriving from the schemas and demanding exact equality with each
 * transcription independently. It compares against the SCHEMA rather than the two sets against
 * each other: two transcriptions that agree with one another and disagree with the schema is
 * the case worth failing, and a pairwise check passes it.
 *
 * Run: `npm run check:block-content-positions`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BLOCK_CONTENT_KEYS, parseStrictJson } from './lib/canonicalize.js';

// Resolved from this file rather than from the cwd, so the gate reads the same schemas
// whichever directory `npm run` is invoked from.
const repoRoot = path.resolve(__dirname, '..');
const schemasDir = path.join(repoRoot, 'schemas');
const ORACLE = path.join(repoRoot, 'conformance', 'oracles', 'document_oracle.py');

/** Every `$ref` reachable from an `items` schema, through allOf/anyOf/oneOf. */
function refsOf(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) refsOf(n, out);
  } else if (node !== null && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.$ref === 'string') out.push(o.$ref);
    for (const k of ['allOf', 'anyOf', 'oneOf'] as const) refsOf(o[k], out);
  }
  return out;
}

const isContentRef = (r: string): boolean => r.endsWith('/block') || r.endsWith('/textNode');

/**
 * Derive the property names whose declared array items are block or text content.
 * A property qualifies through a direct `type: array`, or through a `oneOf` arm that is one
 * (a `figure` `caption` is `oneOf [string, array]`, and the array arm is the rich form the
 * run rule governs) — so a narrowing of either shape is visible here.
 */
function deriveKeys(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of fs.readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json')).sort()) {
    const schema = parseStrictJson(fs.readFileSync(path.join(schemasDir, file), 'utf8')) as Record<string, unknown>;
    const defs = (schema.$defs ?? {}) as Record<string, unknown>;
    for (const [defName, def] of [['<root>', schema] as const, ...Object.entries(defs)]) {
      if (def === null || typeof def !== 'object') continue;
      const branches = ((def as Record<string, unknown>).allOf as unknown[]) ?? [def];
      const props: Record<string, unknown> = {};
      for (const b of branches) {
        if (b !== null && typeof b === 'object') Object.assign(props, (b as Record<string, unknown>).properties ?? {});
      }
      for (const [key, raw] of Object.entries(props)) {
        if (raw === null || typeof raw !== 'object') continue;
        const v = raw as Record<string, unknown>;
        const arms: unknown[] = [];
        if (v.type === 'array') arms.push(v.items);
        for (const arm of (v.oneOf as unknown[]) ?? []) {
          if (arm !== null && typeof arm === 'object' && (arm as Record<string, unknown>).type === 'array') {
            arms.push((arm as Record<string, unknown>).items);
          }
        }
        if (arms.some((a) => a !== undefined && refsOf(a).some(isContentRef))) {
          if (!found.has(key)) found.set(key, new Set());
          found.get(key)!.add(`${file.replace('.schema.json', '')}:${defName}`);
        }
      }
    }
  }
  return found;
}

/** The oracle's transcription, read from its source — it is a separate implementation. */
function oracleKeys(): Set<string> {
  const src = fs.readFileSync(ORACLE, 'utf8');
  const m = /^BLOCK_CONTENT_KEYS = \{([^}]*)\}/m.exec(src);
  if (m === null) throw new Error('document_oracle.py: BLOCK_CONTENT_KEYS not found — did it move or get renamed?');
  return new Set([...m[1].matchAll(/"([^"]+)"/g)].map((g) => g[1]));
}

const sorted = (s: Iterable<string>): string[] => [...s].sort();

function compare(label: string, actual: Set<string>, expected: Set<string>): string[] {
  const missing = sorted(expected).filter((k) => !actual.has(k));
  const extra = sorted(actual).filter((k) => !expected.has(k));
  const problems: string[] = [];
  if (missing.length > 0) problems.push(`${label}: MISSING ${missing.join(', ')} — the schema declares these as block content, so both rules are silently out of scope there`);
  if (extra.length > 0) problems.push(`${label}: EXTRA ${extra.join(', ')} — no schema declares these as block content, so both rules reach material they do not govern`);
  return problems;
}

const derived = deriveKeys();
const derivedKeys = new Set(derived.keys());

// FLOOR. A derivation that silently yields nothing would make every comparison trivially
// pass, which is the shape of gate this repository has been bitten by twice.
if (derivedKeys.size < 4 || !derivedKeys.has('children') || !derivedKeys.has('blocks')) {
  console.error(`✗ derivation floor: expected at least 4 keys including \`children\` and \`blocks\`, got [${sorted(derivedKeys).join(', ')}]`);
  console.error('  The schemas did not yield a usable set — this is a broken derivation, not a passing check.');
  process.exit(1);
}

const problems = [
  ...compare('scripts/lib/canonicalize.ts BLOCK_CONTENT_KEYS', BLOCK_CONTENT_KEYS as Set<string>, derivedKeys),
  ...compare('conformance/oracles/document_oracle.py BLOCK_CONTENT_KEYS', oracleKeys(), derivedKeys),
];

if (problems.length > 0) {
  console.error('✗ block-content position sets disagree with the published schemas:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nDerived from the schemas:');
  for (const key of sorted(derivedKeys)) console.error(`  ${key.padEnd(10)} <- ${sorted(derived.get(key)!).join(', ')}`);
  process.exit(1);
}

console.log(`✓ block-content positions: ${derivedKeys.size} keys, both implementations agree with the schemas`);
for (const key of sorted(derivedKeys)) console.log(`    ${key.padEnd(10)} <- ${sorted(derived.get(key)!).join(', ')}`);
