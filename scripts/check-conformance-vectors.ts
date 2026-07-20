#!/usr/bin/env npx tsx

/**
 * Enforcing gate for the published conformance vectors
 * (`conformance/vectors/*.json`) — the artifacts third-party implementations
 * consume.
 *
 * Part 1 — Byte round-trip: every file must already be in the canonical
 *   on-disk form (parse, re-emit with the repository's fixed formatting,
 *   compare bytes). Hand edits are expected — the JSON is the source of truth —
 *   so this pins a single normalized form rather than leaving formatting to
 *   drift per editor. The load-bearing ordering these vectors assert on lives
 *   INSIDE raw-JSON string values (a manifest's key order, a canonical-JCS
 *   byte sequence); those strings are compared byte-for-byte as string
 *   contents, so an astral/PUA character re-escaped or a key reordered within
 *   one of them is caught. (A reordering of the JSON *envelope's own* keys, by
 *   contrast, round-trips to itself and is not caught — but no vector asserts
 *   on envelope key order, only on the string values, so that is not a gap.)
 *
 * Part 2 — Schema: every file validates against vectors.schema.json, which
 *   also forbids a `local` member anywhere (that is this-implementation-only
 *   data, stripped at the export boundary — its presence means the boundary
 *   leaked).
 *
 * Part 3 — Envelope coverage: every file declares an oracle, a clause and a
 *   unique kind matching its filename, and every vector name is unique within
 *   its file so a consumer can reference results stably.
 *
 * Part 4 — Digest self-consistency: where a vector carries both expected bytes
 *   and an expected digest, the digest is recomputed here. This is a
 *   consistency check on the published data, NOT an oracle: the values were
 *   derived out-of-band (see each file's `oracle`), and this only proves the
 *   two halves of a vector still agree after any edit.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { allVectorKinds, loadVectorFile } from './lib/conformance-vectors.js';

const VECTORS_DIR = path.join(__dirname, '..', 'conformance', 'vectors');

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};

const kinds = allVectorKinds();
if (kinds.length === 0) fail('no conformance vector files found');

// --- Part 1: byte round-trip ------------------------------------------------
console.log('Vector file byte round-trip:');
for (const kind of kinds) {
  const file = path.join(VECTORS_DIR, `${kind}.json`);
  const onDisk = fs.readFileSync(file, 'utf8');
  const reEmitted = JSON.stringify(JSON.parse(onDisk), null, 2) + '\n';
  if (onDisk !== reEmitted) {
    fail(`${kind}.json is not in canonical on-disk form (re-emit differs; run a formatter or check for stray whitespace/ordering)`);
  } else {
    console.log(`  ✓ ${kind}.json`);
  }
}

// --- Part 2 + 3: schema and envelope ---------------------------------------
console.log('\nVector file envelopes:');
let total = 0;
for (const kind of kinds) {
  let file;
  try {
    file = loadVectorFile<{ name: string }>(kind); // throws on schema failure
  } catch (err) {
    fail(`${kind} — ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  const problems: string[] = [];
  if (file.kind !== kind) problems.push(`declares kind "${file.kind}" but is named ${kind}.json`);
  const names = file.vectors.map((v) => v.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) problems.push(`duplicate vector name(s): ${[...new Set(dupes)].join(', ')}`);
  if (problems.length > 0) {
    fail(`${kind} — ${problems.join('; ')}`);
  } else {
    total += file.vectors.length;
    console.log(`  ✓ ${kind} (${file.vectors.length} vectors, ${file.clause})`);
  }
}

// --- Part 4: digest self-consistency ---------------------------------------
console.log('\nDigest self-consistency:');
{
  const before = failures;
  let checked = 0;
  // Node's digest names carry the hyphen for the SHA-3 family ('sha3-256'), so
  // the algorithm prefix is used verbatim — stripping the hyphen would turn
  // 'sha3-256' into the invalid name 'sha3256'.
  const digest = (alg: string, s: string): string =>
    `${alg}:${crypto.createHash(alg).update(s, 'utf8').digest('hex')}`;

  for (const kind of kinds) {
    for (const v of loadVectorFile<Record<string, string>>(kind).vectors) {
      if (v.expectedCanonicalJcs !== undefined && v.expectedId !== undefined) {
        const alg = v.algorithm ?? 'sha256';
        if (digest(alg, v.expectedCanonicalJcs) !== v.expectedId) {
          fail(`${kind}/${v.name} — expectedId does not match the digest of expectedCanonicalJcs`);
        }
        checked++;
      }
      if (v.expectedJcs !== undefined && v.expectedSha256 !== undefined) {
        if (digest('sha256', v.expectedJcs) !== v.expectedSha256) {
          fail(`${kind}/${v.name} — expectedSha256 does not match the digest of expectedJcs`);
        }
        checked++;
      }
    }
  }
  if (checked === 0) fail('no vector carried both expected bytes and an expected digest');
  if (failures === before) console.log(`  ✓ ${checked} byte/digest pair(s) self-consistent`);
}

if (failures > 0) {
  console.log(`\n${failures} failure(s). Conformance-vector check failed.`);
  process.exit(1);
}
console.log(`\nAll ${kinds.length} vector file(s) verified; ${total} published vectors.`);
