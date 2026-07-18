#!/usr/bin/env npx tsx

/**
 * Asserts the content-hash format stays centralized.
 *
 * Content-hash fields must $ref the single shared definition
 * anchor.schema.json#/$defs/contentHash rather than declare their own
 * (ad-hoc) hash pattern. This guards against the drift that let hash patterns
 * diverge (unbounded length, weak algorithms) across the schemas. The script
 * also confirms the shared pattern actually rejects malformed digests.
 *
 * Limitation: this scans `pattern` keywords only, so it enforces "no ad-hoc
 * hash pattern" — NOT "no unconstrained hash field". A new hash field added as
 * a bare string (no pattern) is invisible here; the set of fields that must
 * $ref contentHash is maintained manually.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createAjv } from './lib/ajv-utils.js';

const schemasDir = path.join(__dirname, '..', 'schemas');

// The one canonical content-hash pattern (per-algorithm hex length, lowercase).
const CANONICAL =
  '^(sha256:[a-f0-9]{64}|sha384:[a-f0-9]{96}|sha512:[a-f0-9]{128}|sha3-256:[a-f0-9]{64}|sha3-512:[a-f0-9]{128}|blake3:[a-f0-9]{64})$';

// Its sole permitted home.
const SOURCE_FILE = 'anchor.schema.json';
const SOURCE_PATH = '/$defs/contentHash/pattern';

// A pattern is "hash-shaped" if it names a digest algorithm, quantifies a hex
// character class (lowercase, uppercase, or mixed case), or applies a digest-
// length quantifier (`{64}`/`{96}`/`{128}`) — the shape of a content-hash
// pattern. Matching only the two lowercase classes `[a-f0-9]`/`[0-9a-f]` let an
// ad-hoc case-insensitive pattern (`^[a-fA-F0-9]{64}$`) or a `\d`-plus-letters
// class (`^[\da-f]{64}$`) evade the offender check, so the detector now flags any
// char class carrying an `a-f`/`A-F` hex-letter range and, independently, any
// digest-length quantifier. Non-hash patterns (orcid `[0-9]{4}`, principal
// `user:`, version `\d+\.\d+`, ids `[A-Za-z0-9._-]` — an `A-Z` range, not `A-F`)
// contain none of these signals, so this does not false-positive.
function isHashPattern(p: string): boolean {
  return (
    /sha256|sha384|sha512|sha3-256|sha3-512|blake3/.test(p) || // names a digest algorithm
    /\[[^\]]*(?:a-f|A-F)[^\]]*\]/.test(p) ||                    // a hex-letter range (any case) in a char class
    /\{(?:64|96|128)\}/.test(p)                                 // a digest-length quantifier
  );
}

interface Found { file: string; jsonPath: string; pattern: string; }

function collectPatterns(node: unknown, file: string, jsonPath: string, out: Found[]): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectPatterns(v, file, `${jsonPath}/${i}`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'pattern' && typeof v === 'string') {
        out.push({ file, jsonPath: `${jsonPath}/pattern`, pattern: v });
      }
      collectPatterns(v, file, `${jsonPath}/${k}`, out);
    }
  }
}

console.log('Checking content-hash centralization...\n');

const schemaFiles = fs.readdirSync(schemasDir).filter(f => f.endsWith('.schema.json'));
const allPatterns: Found[] = [];
for (const f of schemaFiles) {
  collectPatterns(JSON.parse(fs.readFileSync(path.join(schemasDir, f), 'utf8')), f, '', allPatterns);
}
const hashPatterns = allPatterns.filter(p => isHashPattern(p.pattern));

console.log(`Scanned ${schemaFiles.length} schemas; ${allPatterns.length} pattern(s), ${hashPatterns.length} hash-shaped.`);

let ok = true;

// (1) The only hash-shaped pattern allowed is the canonical source in anchor.
const offenders = hashPatterns.filter(
  p => !(p.file === SOURCE_FILE && p.jsonPath === SOURCE_PATH && p.pattern === CANONICAL)
);
if (offenders.length > 0) {
  ok = false;
  console.error(`\n✗ ${offenders.length} ad-hoc hash pattern(s) — every hash field must $ref ${SOURCE_FILE}#/$defs/contentHash:`);
  for (const o of offenders) console.error(`    ${o.file}${o.jsonPath} = ${o.pattern}`);
}

// (2) The shared source must exist and still be the canonical pattern.
const source = hashPatterns.find(p => p.file === SOURCE_FILE && p.jsonPath === SOURCE_PATH);
if (!source) {
  ok = false;
  console.error(`\n✗ shared source ${SOURCE_FILE}#/$defs/contentHash/pattern is missing.`);
} else if (source.pattern !== CANONICAL) {
  ok = false;
  console.error(`\n✗ ${SOURCE_FILE}#/$defs/contentHash pattern was changed from the canonical form.`);
}

// (3) The shared pattern must accept valid digests and reject malformed ones.
const validate = createAjv().compile({ type: 'string', pattern: CANONICAL });
const accept = [`sha256:${'a'.repeat(64)}`, `sha384:${'b'.repeat(96)}`, `sha512:${'f'.repeat(128)}`, `blake3:${'0'.repeat(64)}`];
const reject = [
  'sha256:a',                    // too short
  `sha256:${'a'.repeat(63)}`,    // off-by-one short
  `sha256:${'a'.repeat(65)}`,    // off-by-one long
  `sha256:${'A'.repeat(64)}`,    // uppercase hex
  `SHA256:${'a'.repeat(64)}`,    // uppercase algorithm
  `md5:${'a'.repeat(32)}`,       // unrecognized algorithm
  `blake3:${'a'.repeat(128)}`,   // wrong length for algorithm
];
for (const v of accept) if (!validate(v)) { ok = false; console.error(`✗ canonical pattern should ACCEPT ${v}`); }
for (const v of reject) if (validate(v)) { ok = false; console.error(`✗ canonical pattern should REJECT ${v}`); }

console.log('');
if (!ok) {
  console.error('Content-hash centralization check failed.');
  process.exit(1);
}
console.log(`✓ No ad-hoc hash patterns; the shared ${SOURCE_FILE}#/$defs/contentHash definition rejects malformed digests.`);
