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
import { BLOCK_CONTENT_KEYS, CONTENT_BARRIER_KEY, parseStrictJson } from './lib/canonicalize.js';

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
 *
 * Recursive, and resolves local `$ref`s, because a position can be declared three ways: on the
 * property directly, behind a `$ref` to an array-typed `$def`, or on an inline nested object
 * inside an array's `items`. Under-derivation is the one failure this gate cannot report on
 * itself — a key it never saw is a key both transcriptions agree about.
 */
function deriveKeys(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();

  for (const file of fs.readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json')).sort()) {
    const schema = parseStrictJson(fs.readFileSync(path.join(schemasDir, file), 'utf8')) as Record<string, unknown>;
    const defs = (schema.$defs ?? {}) as Record<string, unknown>;
    const short = file.replace('.schema.json', '');

    /** Follow a local `#/$defs/x` chain; a cross-file ref is returned as-is for `refsOf`. */
    const resolve = (node: unknown, seen = new Set<string>()): unknown => {
      let cur = node;
      while (cur !== null && typeof cur === 'object' && typeof (cur as Record<string, unknown>).$ref === 'string') {
        const ref = (cur as Record<string, unknown>).$ref as string;
        if (!ref.startsWith('#/$defs/') || seen.has(ref)) return cur;
        seen.add(ref);
        const target = defs[ref.slice('#/$defs/'.length)];
        if (target === undefined) return cur;
        cur = target;
      }
      return cur;
    };

    /** Every schema that `node` effectively is, unwrapping composition keywords. */
    const arms = (node: unknown, seen = new Set<string>()): Record<string, unknown>[] => {
      const r = resolve(node, seen);
      if (r === null || typeof r !== 'object' || Array.isArray(r)) return [];
      const o = r as Record<string, unknown>;
      const out = [o];
      for (const k of ['allOf', 'anyOf', 'oneOf'] as const) {
        for (const b of (o[k] as unknown[]) ?? []) out.push(...arms(b, new Set(seen)));
      }
      return out;
    };

    const isContentArray = (node: unknown): boolean =>
      arms(node).some((a) => a.type === 'array' && a.items !== undefined && refsOf(a.items).some(isContentRef));

    // Walk every subschema, recording each `properties` entry that is a content array. The
    // seen-set is on OBJECT IDENTITY, so a recursive schema terminates without collapsing
    // two structurally identical branches into one.
    const visited = new Set<unknown>();
    const walk = (node: unknown, where: string): void => {
      if (node === null || typeof node !== 'object' || visited.has(node)) return;
      visited.add(node);
      if (Array.isArray(node)) {
        for (const n of node) walk(n, where);
        return;
      }
      const o = node as Record<string, unknown>;
      for (const a of arms(o)) {
        const props = (a.properties ?? {}) as Record<string, unknown>;
        for (const [key, raw] of Object.entries(props)) {
          if (!isContentArray(raw)) continue;
          if (!found.has(key)) found.set(key, new Set());
          found.get(key)!.add(where);
        }
      }
      for (const k of ['properties', 'items', 'allOf', 'anyOf', 'oneOf', 'additionalProperties', 'prefixItems'] as const) {
        const child = o[k];
        if (k === 'properties' && child !== null && typeof child === 'object') {
          for (const v of Object.values(child as Record<string, unknown>)) walk(v, where);
        } else {
          walk(child, where);
        }
      }
    };

    walk(schema, `${short}:<root>`);
    for (const [defName, def] of Object.entries(defs)) walk(def, `${short}:${defName}`);
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

/** The oracle's barrier constant, read from its source for the same reason as its key set. */
function oracleBarrier(): string {
  const m = /^CONTENT_BARRIER_KEY = "([^"]+)"/m.exec(fs.readFileSync(ORACLE, 'utf8'));
  if (m === null) throw new Error('document_oracle.py: CONTENT_BARRIER_KEY not found — did it move or get renamed?');
  return m[1];
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

// The barrier is the other half of the position model and was compared against nothing: the
// two implementations could name different keys, or name one the schemas do not declare, and
// every check above would still pass. It is pinned against `blockBase` rather than a literal,
// so the assertion tracks the schema that makes it true — Content Blocks §3.1 closes
// `attributes` to authored values, which is the whole reason it is a barrier.
const barrierInSchema = (() => {
  const content = parseStrictJson(fs.readFileSync(path.join(schemasDir, 'content.schema.json'), 'utf8')) as Record<string, unknown>;
  const base = ((content.$defs as Record<string, unknown>).blockBase ?? {}) as Record<string, unknown>;
  return Object.keys((base.properties ?? {}) as Record<string, unknown>).includes(CONTENT_BARRIER_KEY);
})();
if (!barrierInSchema) {
  problems.push(`CONTENT_BARRIER_KEY \`${CONTENT_BARRIER_KEY}\` is not a declared property of content.schema.json $defs/blockBase — the barrier names a field no block carries`);
}
if (oracleBarrier() !== CONTENT_BARRIER_KEY) {
  problems.push(`CONTENT_BARRIER_KEY differs: reference \`${CONTENT_BARRIER_KEY}\`, oracle \`${oracleBarrier()}\` — the two implementations barrier different fields`);
}

if (problems.length > 0) {
  console.error('✗ block-content position sets disagree with the published schemas:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nDerived from the schemas:');
  for (const key of sorted(derivedKeys)) console.error(`  ${key.padEnd(10)} <- ${sorted(derived.get(key)!).join(', ')}`);
  process.exit(1);
}

console.log(`✓ block-content positions: ${derivedKeys.size} keys, both implementations agree with the schemas`);
for (const key of sorted(derivedKeys)) console.log(`    ${key.padEnd(10)} <- ${sorted(derived.get(key)!).join(', ')}`);
