#!/usr/bin/env npx tsx

/**
 * Enforcing gate for the detached-JWS signature envelope (Security Extension
 * §3.3) — the 3.2a-i envelope migration.
 *
 * Part 1 — Header encoding: the reference encoder reproduces each hand-specified
 *   base64url protected header.
 * Part 2 — Signing input: the construction `BASE64URL(protected) || '.' ||
 *   JCS(scope)` reproduces each independently-computed SHA-256.
 * Part 3 — Example corpus: every signature is a well-formed JWS envelope
 *   (protected + signature + scope; header passes the shape profile; signing
 *   input reconstructs) and carries NONE of the removed bespoke fields
 *   (value/algorithm/signedAt/certificateChain/webauthn) — the migration guard.
 *
 * This gate asserts ENVELOPE structure only. It does NOT verify signatures or
 * anchor trust (the trust core is a later increment); a verifier MUST NOT report
 * `valid` on the strength of anything checked here.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  encodeProtectedHeader,
  decodeProtectedHeader,
  validateProtectedHeader,
  jwsSigningInput,
  base64urlDecode,
} from './lib/jws-envelope.js';
import { headerVectors, signingInputVectors } from './kat/jws-envelope-vectors.js';

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};
const sha256Of = (s: string): string => 'sha256:' + crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** Bespoke fields removed by the JWS migration — their presence is a regression. */
const REMOVED_SIGNATURE_FIELDS = ['value', 'algorithm', 'signedAt', 'certificateChain', 'webauthn'];

// --- Part 1: header encoding ----------------------------------------------
console.log('Protected-header encoding vectors:');
for (const v of headerVectors) {
  let got: string;
  try {
    got = encodeProtectedHeader(v.header);
  } catch (err) {
    fail(`${v.name} — threw: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (got !== v.expectedProtected) {
    fail(`${v.name} — protected mismatch`);
    console.log(`      expected ${v.expectedProtected}`);
    console.log(`      actual   ${got}`);
    continue;
  }
  console.log(`  ✓ ${v.name}`);
}

// --- Part 2: signing input -------------------------------------------------
console.log('\nSigning-input vectors:');
for (const v of signingInputVectors) {
  let si: string;
  try {
    si = jwsSigningInput(encodeProtectedHeader(v.header), v.scope);
  } catch (err) {
    fail(`${v.name} — threw: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (sha256Of(si) !== v.expectedSha256) {
    fail(`${v.name} — signing-input sha256 mismatch (expected ${v.expectedSha256}, got ${sha256Of(si)})`);
    continue;
  }
  console.log(`  ✓ ${v.name}`);
}

// --- Part 3: example corpus ------------------------------------------------
console.log('\nExample corpus signature envelopes:');
const examplesDir = path.join(__dirname, '..', 'examples');
let checked = 0;
for (const name of fs.readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const dir = path.join(examplesDir, name);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;

  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    fail(`${name} — manifest parse error: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  const sigRel = manifest.security?.signatures;
  if (typeof sigRel !== 'string' || !fs.existsSync(path.join(dir, sigRel))) continue;

  let sigFile: any;
  try {
    sigFile = JSON.parse(fs.readFileSync(path.join(dir, sigRel), 'utf8'));
  } catch (err) {
    fail(`${name} — signatures.json parse error: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  for (const s of Array.isArray(sigFile.signatures) ? sigFile.signatures : []) {
    const id = s?.id ?? '(unnamed)';
    for (const removed of REMOVED_SIGNATURE_FIELDS) {
      if (s != null && s[removed] !== undefined) {
        fail(`${name} signature "${id}" — carries removed bespoke field "${removed}" (must migrate to the JWS envelope)`);
      }
    }
    // The signing certificate lives in the protected-header x5c; an unsigned copy
    // on the advisory signer block is a removed identity field (the schema's
    // shared `person` base leaves `signer` open, so this is enforced here).
    for (const removed of ['certificate', 'keyId']) {
      if (s?.signer != null && s.signer[removed] !== undefined) {
        fail(`${name} signature "${id}" — signer carries removed field "${removed}" (identity comes from the protected-header x5c subject)`);
      }
    }
    if (typeof s?.protected !== 'string' || typeof s?.signature !== 'string') {
      fail(`${name} signature "${id}" — missing JWS "protected"/"signature" members`);
      continue;
    }
    if (s.scope == null) {
      fail(`${name} signature "${id}" — missing detached "scope" payload member`);
      continue;
    }
    try {
      base64urlDecode(s.signature); // structural base64url check (not verification)
      const header = decodeProtectedHeader(s.protected);
      validateProtectedHeader(header);
      jwsSigningInput(s.protected, s.scope); // reconstructs without error
    } catch (err) {
      fail(`${name} signature "${id}" — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    console.log(`  ✓ ${name} signature "${id}"`);
    checked++;
  }
}

if (failures > 0) {
  console.log(`\n${failures} failure(s). JWS-envelope check failed.`);
  process.exit(1);
}
console.log(`\nAll envelope vectors verified; ${checked} example signature envelope(s) checked.`);
