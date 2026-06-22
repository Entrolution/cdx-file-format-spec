#!/usr/bin/env npx tsx

/**
 * Enforcing gate for provenance-record timestamp bindings (core 09 §6) — the
 * hash-binding contract that makes a timestamp attest THIS document.
 *
 * Part 1 — Binding vectors: `checkTimestampBinding` reproduces each hand-derived
 *   per-type outcome — rfc3161/blockchain keyed on `hash`, aggregated on
 *   `proof.documentHash` with the Merkle path recomputed to `merkleRoot`. The
 *   vectors include the fail-open guard (an aggregated entry whose top-level
 *   `hash` equals the documentId while its Merkle leaf does not — a gate keying
 *   only on `hash` would wrongly pass it) and Merkle position sensitivity.
 *
 * Part 2 — Corpus grounding: every provenance record shipped in the corpus binds
 *   `record.documentId == manifest.id`, and every `timestamps[]` entry binds to
 *   that documentId (aggregated entries additionally reproduce their merkleRoot).
 *
 * Validating an RFC 3161 token's TSA chain, a blockchain transaction's inclusion
 * and confirmation/finality, or an on-chain aggregate anchor is a verifier
 * obligation a spec-repo gate cannot run (core 09 §6.7); the hash bindings and
 * the Merkle recomputation are what is pinned here, exactly as the trust-state
 * machine pins the signature-state production rules.
 */

import * as fs from 'fs';
import * as path from 'path';
import { checkTimestampBinding } from './lib/provenance-timestamp.js';
import { timestampVectors } from './kat/provenance-timestamp-vectors.js';

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};

// --- Part 1: binding vectors -----------------------------------------------
console.log('Provenance-timestamp binding vectors:');
for (const vec of timestampVectors) {
  const got = checkTimestampBinding(vec.timestamp, vec.documentId);
  const e = vec.expected;
  const problems: string[] = [];
  if (got.boundToDocument !== e.boundToDocument) problems.push(`boundToDocument ${got.boundToDocument} != ${e.boundToDocument}`);
  if (e.merkleVerified !== undefined && got.merkleVerified !== e.merkleVerified) problems.push(`merkleVerified ${got.merkleVerified} != ${e.merkleVerified}`);
  if (e.leaf !== undefined && got.leaf !== e.leaf) problems.push(`leaf ${got.leaf} != ${e.leaf}`);
  const empty = got.problems.length === 0;
  if (empty !== e.problemsEmpty) problems.push(`problemsEmpty ${empty} != ${e.problemsEmpty} (problems: ${JSON.stringify(got.problems)})`);
  if (problems.length > 0) {
    fail(`${vec.name} — ${problems.join('; ')}`);
  } else {
    const merkle = got.merkleVerified !== undefined ? `, merkle=${got.merkleVerified}` : '';
    console.log(`  ✓ ${vec.name} → bound=${got.boundToDocument}${merkle}`);
  }
}

// Defence-in-depth: both a bound and an unbound outcome must be exercised, and
// both a verified and a failed Merkle recomputation.
const boundSeen = new Set(timestampVectors.map((v) => v.expected.boundToDocument));
if (!boundSeen.has(true) || !boundSeen.has(false)) fail('vectors must exercise both a bound and an unbound outcome');
const merkleSeen = new Set(timestampVectors.filter((v) => v.expected.merkleVerified !== undefined).map((v) => v.expected.merkleVerified));
if (!merkleSeen.has(true) || !merkleSeen.has(false)) fail('vectors must exercise both a verified and a failed Merkle recomputation');

// --- Part 2: corpus grounding ----------------------------------------------
console.log('\nCorpus provenance-timestamp grounding:');
const examplesDir = path.join(__dirname, '..', 'examples');
let checked = 0;
for (const name of fs.readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const dir = path.join(examplesDir, name);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  let manifest: any;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { continue; }

  const provRel = typeof manifest.provenance === 'string' ? manifest.provenance : undefined;
  if (!provRel) continue;
  const recPath = path.join(dir, provRel);
  if (!fs.existsSync(recPath)) continue;
  let rec: any;
  try { rec = JSON.parse(fs.readFileSync(recPath, 'utf8')); } catch (err) {
    fail(`${name} — provenance parse error: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  const timestamps: any[] = Array.isArray(rec.timestamps) ? rec.timestamps : [];
  if (timestamps.length === 0) { console.log(`  – ${name} (provenance record, no timestamps)`); continue; }

  // The record's own binding: documentId == manifest.id. On a frozen/published
  // document manifest.id is authenticated by a manifest-covering signature
  // (scope.documentId == manifest.id), so this transitively authenticates the
  // timestamped hash; on a draft it is only a consistency check (09 §6.2).
  if (typeof manifest.id === 'string' && manifest.id !== 'pending' && rec.documentId !== manifest.id) {
    fail(`${name} — provenance documentId (${rec.documentId}) does not equal manifest.id (${manifest.id})`);
    continue;
  }

  let ok = true;
  for (let i = 0; i < timestamps.length; i++) {
    const r = checkTimestampBinding(timestamps[i], rec.documentId);
    if (!r.boundToDocument || r.problems.length > 0) {
      fail(`${name} timestamp[${i}] (${r.type ?? 'unknown'}) — ${r.problems.join('; ')}`);
      ok = false;
    } else if (r.type === 'aggregated' && r.merkleVerified !== true) {
      fail(`${name} timestamp[${i}] aggregated — Merkle proof did not reproduce merkleRoot`);
      ok = false;
    }
  }
  if (ok) {
    console.log(`  ✓ ${name} (${manifest.state}; ${timestamps.length} timestamp(s) bound to documentId)`);
    checked++;
  }
}
if (checked === 0) fail('no corpus provenance timestamps found to ground against');

if (failures > 0) {
  console.log(`\n${failures} failure(s). Provenance-timestamp check failed.`);
  process.exit(1);
}
console.log(`\nAll ${timestampVectors.length} binding vectors verified; corpus grounding passed (${checked} record(s)).`);
