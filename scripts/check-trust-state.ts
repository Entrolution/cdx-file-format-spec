#!/usr/bin/env npx tsx

/**
 * Enforcing gate for the signature-state production rules (Security Extension
 * §3.8) — the 3.2a-ii trust core.
 *
 * Part 1 — Production-rule vectors: `evaluateSignatureState` reproduces each
 *   hand-derived state across every precedence rule and collision.
 *
 * Part 2 — Real-ES256 grounding: an ephemeral P-256 key signs a REAL JWS signing
 *   input (built by the 3.2a-i envelope helpers) and the signature verifies;
 *   tampering one byte makes it fail. This grounds the abstract `signatureVerifies`
 *   input in an actual ES256 operation — no committed key, no new dependency.
 *   (The chain/trust-store/revocation inputs stay abstract: a spec-repo gate
 *   cannot ship a trust anchor or run OCSP; those are normative verifier
 *   obligations, see §3.9/§7.4.)
 */

import * as crypto from 'crypto';
import { evaluateSignatureState, type SignatureStateInputs } from './lib/signature-state.js';
import { trustStateVectors } from './kat/trust-state-vectors.js';
import { encodeProtectedHeader, jwsSigningInput } from './lib/jws-envelope.js';

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};

// --- Part 1: production-rule vectors --------------------------------------
console.log('Signature-state production-rule vectors:');
for (const vec of trustStateVectors) {
  const got = evaluateSignatureState(vec.inputs);
  if (got !== vec.expected) {
    fail(`${vec.name} — expected ${vec.expected}, got ${got}`);
    continue;
  }
  console.log(`  ✓ ${vec.name} → ${got}`);
}

// Defence-in-depth: every state in the vocabulary must be reachable (no vector
// table that silently stops exercising a state).
const REACHABLE = new Set(trustStateVectors.map((vec) => vec.expected));
for (const state of ['valid', 'invalid', 'expired', 'revoked', 'untrusted', 'unknown']) {
  if (!REACHABLE.has(state as never)) fail(`state "${state}" is never exercised by a vector`);
}

// --- Part 2: real-ES256 grounding -----------------------------------------
console.log('\nReal-ES256 grounding (ephemeral key, no committed material):');
const ground = (): void => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const protectedHeader = encodeProtectedHeader({ alg: 'ES256', b64: false, crit: ['b64'] });
  const scope = { documentId: 'sha256:' + 'a'.repeat(64) };
  const signingInput = Buffer.from(jwsSigningInput(protectedHeader, scope), 'utf8');

  // ES256 = ECDSA P-256 + SHA-256 with the raw P-1363 (R||S) encoding JOSE uses.
  const signature = crypto.sign('sha256', signingInput, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  const verifies = crypto.verify('sha256', signingInput, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);

  const base: SignatureStateInputs = {
    headerConsistent: true,
    signatureVerifies: verifies,
    chainResult: 'anchored',
    revocationStatus: 'good',
    signingTimeWithinValidity: true,
    certCurrentlyExpired: false,
    referenceTimeTrusted: false,
  };
  if (!verifies) {
    fail('a freshly-signed ES256 JWS signing input did not verify');
  } else if (evaluateSignatureState(base) !== 'valid') {
    fail(`a real verifying signature with all-good inputs did not evaluate to valid`);
  } else {
    console.log('  ✓ real ES256 signature verifies → valid');
  }

  // Tamper one byte of the signing input — the same signature must NOT verify,
  // and the state must become invalid.
  const tampered = Buffer.from(signingInput);
  tampered[tampered.length - 1] ^= 0x01;
  const tamperVerifies = crypto.verify('sha256', tampered, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  if (tamperVerifies) {
    fail('a tampered signing input still verified against the original signature');
  } else if (evaluateSignatureState({ ...base, signatureVerifies: false }) !== 'invalid') {
    fail('a non-verifying signature did not evaluate to invalid');
  } else {
    console.log('  ✓ tampered input fails verification → invalid');
  }
};
try {
  ground();
} catch (err) {
  fail(`real-ES256 grounding threw: ${err instanceof Error ? err.message : String(err)}`);
}

if (failures > 0) {
  console.log(`\n${failures} failure(s). Trust-state check failed.`);
  process.exit(1);
}
console.log(`\nAll ${trustStateVectors.length} production-rule vectors verified; real-ES256 grounding passed.`);
