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
import { jwkThumbprint, multibaseKeyToJwk } from './lib/keyid-resolution.js';
import {
  headerVectors,
  signingInputVectors,
  thumbprintVectors,
  multibaseVectors,
} from './kat/jws-envelope-vectors.js';

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};
const sha256Of = (s: string): string => 'sha256:' + crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Legacy bespoke fields removed by the JWS migration — their presence is a
 * regression. (`webauthn` is NOT here: it is a valid signature shape again as of
 * the WebAuthn credential path — section 6 — and is checked by `check:webauthn`.)
 */
const REMOVED_SIGNATURE_FIELDS = ['value', 'algorithm', 'signedAt', 'certificateChain'];

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
    // WebAuthn signatures are a different (non-JWS) shape with no protected header;
    // they are validated by check:webauthn. Skip them in this JWS-envelope gate.
    if (s?.webauthn !== undefined) {
      continue;
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

// --- Part 4: credential-path shape (X.509 XOR keyId) -----------------------
// validateProtectedHeader must accept exactly one credential path and reject
// both/neither/cross-contaminated headers. These are behavioural assertions (not
// byte KATs): the XOR branch is the one piece of logic this increment changes.
console.log('\nCredential-path shape (x5c XOR kid):');
const baseHeader = { alg: 'ES256', b64: false, crit: ['b64'], sigT: '2025-01-15T10:00:00Z' };
const JKT = 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k'; // a real RFC 7638 SHA-256 thumbprint (43 chars)
const shapeCases: { name: string; header: Record<string, unknown>; accept: boolean }[] = [
  { name: 'X.509 path (x5c + x5t#S256)', header: { ...baseHeader, x5c: ['MIIBplaceholderDER=='], 'x5t#S256': 'AAAA' }, accept: true },
  { name: 'keyId path (did:key)', header: { ...baseHeader, alg: 'EdDSA', kid: 'did:key:z6MkPlaceholderForShapeCheck' }, accept: true },
  { name: 'keyId path (did:jwk)', header: { ...baseHeader, kid: 'did:jwk:eyJrdHkiOiJFQyJ9PlaceholderForShapeCheck' }, accept: true },
  { name: 'keyId path with DID-URL fragment', header: { ...baseHeader, alg: 'EdDSA', kid: 'did:key:z6MkPlaceholder#z6MkPlaceholder' }, accept: true },
  { name: 'did:web + jkt', header: { ...baseHeader, kid: 'did:web:example.com:alice', jkt: JKT }, accept: true },
  { name: 'did:web with port + path + fragment + jkt', header: { ...baseHeader, kid: 'did:web:example.com%3A3000:dids:alice#key-1', jkt: JKT }, accept: true },
  { name: 'both x5c and kid (mutual exclusion)', header: { ...baseHeader, x5c: ['MIIBplaceholderDER=='], 'x5t#S256': 'AAAA', kid: 'did:key:z6MkPlaceholder' }, accept: false },
  { name: 'kid + stray x5t#S256 (cross-contamination)', header: { ...baseHeader, kid: 'did:key:z6MkPlaceholder', 'x5t#S256': 'AAAA' }, accept: false },
  { name: 'neither credential path', header: { ...baseHeader }, accept: false },
  { name: 'did:web without jkt (required)', header: { ...baseHeader, kid: 'did:web:example.com:alice' }, accept: false },
  { name: 'did:key with jkt (forbidden on self-certifying)', header: { ...baseHeader, alg: 'EdDSA', kid: 'did:key:z6MkPlaceholder', jkt: JKT }, accept: false },
  { name: 'X.509 with jkt (forbidden)', header: { ...baseHeader, x5c: ['MIIBplaceholderDER=='], 'x5t#S256': 'AAAA', jkt: JKT }, accept: false },
  { name: 'did:web malformed jkt (too short)', header: { ...baseHeader, kid: 'did:web:example.com:alice', jkt: 'AAAA' }, accept: false },
  { name: 'did:web IP-literal host (SSRF)', header: { ...baseHeader, kid: 'did:web:127.0.0.1:alice', jkt: JKT }, accept: false },
  { name: 'did:web localhost host (SSRF)', header: { ...baseHeader, kid: 'did:web:localhost', jkt: JKT }, accept: false },
  { name: 'did:web decimal-IP host (SSRF)', header: { ...baseHeader, kid: 'did:web:2130706433', jkt: JKT }, accept: false },
  { name: 'did:web hex-dotted IP host (SSRF)', header: { ...baseHeader, kid: 'did:web:0x7f.0.0.1', jkt: JKT }, accept: false },
  { name: 'did:web octal IP host (SSRF)', header: { ...baseHeader, kid: 'did:web:0177.0.0.1', jkt: JKT }, accept: false },
  { name: 'did:web short-form IP host (SSRF)', header: { ...baseHeader, kid: 'did:web:127.1', jkt: JKT }, accept: false },
  { name: 'did:web path traversal (%2e%2e)', header: { ...baseHeader, kid: 'did:web:example.com:%2e%2e:secrets', jkt: JKT }, accept: false },
  { name: 'unknown DID method', header: { ...baseHeader, kid: 'did:example:1234' }, accept: false },
  { name: 'empty kid', header: { ...baseHeader, kid: '' }, accept: false },
  { name: 'non-DID kid', header: { ...baseHeader, kid: 'just-a-string' }, accept: false },
  { name: 'x5c without x5t#S256', header: { ...baseHeader, x5c: ['MIIBplaceholderDER=='] }, accept: false },
];
for (const c of shapeCases) {
  let threw = false;
  try {
    validateProtectedHeader(c.header);
  } catch {
    threw = true;
  }
  if (c.accept === !threw) {
    console.log(`  ✓ ${c.name} → ${c.accept ? 'accepted' : 'rejected'}`);
  } else {
    fail(`${c.name} — expected ${c.accept ? 'accepted' : 'rejected'} but got ${threw ? 'rejected' : 'accepted'}`);
  }
}

// --- Part 5: did:web key resolution (RFC 7638 thumbprint + multibase→JWK) ----
// Pins the canonicalisation a verifier MUST get bit-exact for the did:web `jkt`
// binding (§3.11). Vectors are independently produced: Ed25519 is anchored to RFC
// 8037 Appendix A.3; P-256 to a deterministic key — exercising the actual point
// decompression and required-member ordering where representation bugs hide.
console.log('\nkeyId key-resolution (RFC 7638 jkt + publicKeyMultibase→JWK):');
for (const v of thumbprintVectors) {
  let got: string;
  try {
    got = jwkThumbprint(v.jwk);
  } catch (err) {
    fail(`thumbprint ${v.name} — threw: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (got !== v.expectedJkt) {
    fail(`thumbprint ${v.name} — jkt mismatch (expected ${v.expectedJkt}, got ${got})`);
    continue;
  }
  console.log(`  ✓ thumbprint ${v.name}`);
}
for (const v of multibaseVectors) {
  try {
    const jwk = multibaseKeyToJwk(v.multibase);
    if (JSON.stringify(jwk) !== JSON.stringify(v.expectedJwk)) {
      fail(`multibase ${v.name} — JWK mismatch (expected ${JSON.stringify(v.expectedJwk)}, got ${JSON.stringify(jwk)})`);
      continue;
    }
    if (jwkThumbprint(jwk) !== v.expectedJkt) {
      fail(`multibase ${v.name} — convert→thumbprint mismatch`);
      continue;
    }
  } catch (err) {
    fail(`multibase ${v.name} — threw: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  console.log(`  ✓ multibase ${v.name}`);
}

if (failures > 0) {
  console.log(`\n${failures} failure(s). JWS-envelope check failed.`);
  process.exit(1);
}
console.log(`\nAll envelope vectors verified; ${checked} example signature envelope(s) checked.`);
