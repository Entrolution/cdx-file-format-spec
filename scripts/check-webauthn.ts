#!/usr/bin/env npx tsx

/**
 * Enforcing gate for the WebAuthn credential path (Security Extension §6) — the
 * 3.2c increment.
 *
 * A WebAuthn assertion cannot sign `JCS(scope)`; CDX binds the document by setting
 * `clientDataJSON.challenge = BASE64URL(SHA-256(JCS(scope)))`. This gate checks the
 * binding and the cryptographic signature; it does NOT anchor trust (the key must
 * still be pinned — §6) or evaluate origin/rpId/flag policy (verifier obligations).
 *
 * Part 1 — challenge KAT: `webauthnChallenge(scope)` reproduces an independent oracle.
 * Part 2 — real-ES256 grounding: an ephemeral key signs `authData || SHA-256(clientDataJSON)`;
 *          verification succeeds for a minimal AND a NON-MINIMAL clientDataJSON (proving the
 *          verifier hashes the STORED bytes and PARSES the challenge, never re-serializes);
 *          tampering fails; a 0-counter vector (the counter is not interpreted).
 * Part 3 — binding shape: a well-formed binding is accepted; wrong challenge/type/alg rejected.
 * Part 4 — example corpus: every WebAuthn signature's challenge binds its scope and its
 *          signature verifies under its `publicKey`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  webauthnChallenge,
  parseClientData,
  parseAuthData,
  webauthnSigningInput,
  verifyWebauthnSignature,
  webauthnKeyMatchesAlg,
  WEBAUTHN_ALGS,
} from './lib/webauthn.js';

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};

const DOC_ID = 'sha256:66db6e3c227d306b57068a4fa5e779e3a4b2ab74c9cb6320ecd57ddf280c2b86';
const DOC_CONTENT = 'sha256:dac719a7afeb6b8bfb05fa673154f3a840ba8554348a2c085859889abe240bb7';
const MANIFEST_SCOPE = {
  documentId: DOC_ID,
  manifest: {
    cdx: '0.1',
    state: 'frozen',
    content: { path: 'content/document.json', hash: DOC_CONTENT },
    extensions: [{ id: 'cdx.security', version: '0.1', required: true }],
    lineage: { parent: null, version: 1 },
  },
};

/**
 * Validate a WebAuthn assertion's binding to a scope (shape only — not the
 * cryptographic signature). Throws on any failure: unsupported algorithm,
 * malformed clientDataJSON, `type != "webauthn.get"`, a challenge that does not
 * equal `BASE64URL(SHA-256(JCS(scope)))`, or a too-short authenticatorData.
 */
function validateBinding(webauthn: any, scope: unknown): void {
  if (!WEBAUTHN_ALGS.has(webauthn?.algorithm)) {
    throw new Error(`unsupported WebAuthn algorithm ${JSON.stringify(webauthn?.algorithm)}`);
  }
  if (webauthn.publicKey !== undefined && !webauthnKeyMatchesAlg(webauthn.publicKey, webauthn.algorithm)) {
    throw new Error(`algorithm ${webauthn.algorithm} does not agree with the publicKey type/curve`);
  }
  const clientDataJSON = Buffer.from(String(webauthn.clientDataJSON), 'base64url');
  const cd = parseClientData(clientDataJSON);
  if (cd.type !== 'webauthn.get') {
    throw new Error(`clientDataJSON.type must be "webauthn.get", got ${JSON.stringify(cd.type)}`);
  }
  const expected = webauthnChallenge(scope);
  if (cd.challenge !== expected) {
    throw new Error(`challenge does not bind scope (expected ${expected}, got ${cd.challenge})`);
  }
  const ad = parseAuthData(Buffer.from(String(webauthn.authenticatorData), 'base64url'));
  if (!ad.flags.up) {
    throw new Error('User-Present (UP) flag must be set on a webauthn.get assertion (§6.3)');
  }
}

// --- Part 1: challenge-binding KAT (independent Python oracle) --------------
console.log('Challenge-binding vectors (challenge == BASE64URL(SHA-256(JCS(scope)))):');
const challengeVectors = [
  { name: 'content-only', scope: { documentId: DOC_ID }, expected: 'i2Plab3MAr3jrjqWaewYwKpwhAJ-oPgI1SGkN_C0NMk' },
  { name: 'manifest-covering', scope: MANIFEST_SCOPE, expected: 'LJlJtQGIAHP0DeUl526SVY_XpgFHlZjZBRya1rAVmzA' },
];
for (const v of challengeVectors) {
  const got = webauthnChallenge(v.scope);
  if (got === v.expected) console.log(`  ✓ ${v.name}`);
  else fail(`${v.name} — challenge mismatch (expected ${v.expected}, got ${got})`);
}

// --- Part 2: real-ES256 grounding ------------------------------------------
console.log('\nReal-ES256 assertion grounding (ephemeral key, no committed material):');
{
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as crypto.JsonWebKey;
  const chal = webauthnChallenge({ documentId: DOC_ID });
  const rpIdHash = crypto.createHash('sha256').update('cdx.dev').digest();
  const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), Buffer.from([0, 0, 0, 0])]); // UP|UV, counter 0
  const cdMin = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: chal, origin: 'https://cdx.dev' }), 'utf8');
  const cdNon = Buffer.from(`{ "type": "webauthn.get",  "challenge": "${chal}", "origin": "https://cdx.dev", "x": 1 }`, 'utf8');
  for (const [label, cd] of [['minimal', cdMin], ['non-minimal', cdNon]] as const) {
    const sig = crypto.sign('sha256', webauthnSigningInput(authData, cd), { key: privateKey, dsaEncoding: 'der' });
    if (verifyWebauthnSignature(jwk, authData, cd, sig, 'ES256') && parseClientData(cd).challenge === chal) {
      console.log(`  ✓ ${label} clientDataJSON verifies + challenge parses from stored bytes`);
    } else {
      fail(`${label} clientDataJSON — verify/parse failed`);
    }
  }
  const sig = crypto.sign('sha256', webauthnSigningInput(authData, cdMin), { key: privateKey, dsaEncoding: 'der' });
  const badAuth = Buffer.from(authData);
  badAuth[32] ^= 0x04; // flip the UV bit
  if (!verifyWebauthnSignature(jwk, badAuth, cdMin, sig, 'ES256')) console.log('  ✓ tampered authenticatorData fails verification');
  else fail('tampered authenticatorData still verifies');
  const a = parseAuthData(authData);
  if (a.signCount === 0 && a.flags.up && a.flags.uv) console.log('  ✓ authData parses (UP+UV set, signCount 0 — counter not interpreted)');
  else fail('authData parse');
  // Algorithm must agree with the key: ES256 under an Ed25519 key (and EdDSA under
  // a P-256 key) cannot verify — a total, non-throwing `false`, never a raw error.
  const ed = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }) as crypto.JsonWebKey;
  if (verifyWebauthnSignature(ed, authData, cdMin, sig, 'ES256') === false && verifyWebauthnSignature(jwk, authData, cdMin, sig, 'EdDSA') === false) {
    console.log('  ✓ algorithm/key disagreement returns false (no cross-type verify, no throw)');
  } else {
    fail('algorithm/key disagreement not rejected');
  }
}

// --- Part 3: binding shape (accept good, reject malformed) ------------------
console.log('\nBinding shape (challenge == SHA-256(JCS(scope)); type == webauthn.get):');
const goodChallenge = webauthnChallenge(MANIFEST_SCOPE);
const b64urlJson = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
const authDataB64 = Buffer.concat([crypto.createHash('sha256').update('cdx.dev').digest(), Buffer.from([0x05, 0, 0, 0, 0])]).toString('base64url');
const authDataNoUP = Buffer.concat([crypto.createHash('sha256').update('cdx.dev').digest(), Buffer.from([0x00, 0, 0, 0, 0])]).toString('base64url'); // UP not set
const bindingCases: { name: string; webauthn: any; accept: boolean }[] = [
  { name: 'well-formed binding', webauthn: { algorithm: 'ES256', authenticatorData: authDataB64, clientDataJSON: b64urlJson({ type: 'webauthn.get', challenge: goodChallenge, origin: 'https://cdx.dev' }) }, accept: true },
  { name: 'wrong challenge (does not bind scope)', webauthn: { algorithm: 'ES256', authenticatorData: authDataB64, clientDataJSON: b64urlJson({ type: 'webauthn.get', challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', origin: 'https://cdx.dev' }) }, accept: false },
  { name: 'wrong type (webauthn.create)', webauthn: { algorithm: 'ES256', authenticatorData: authDataB64, clientDataJSON: b64urlJson({ type: 'webauthn.create', challenge: goodChallenge, origin: 'https://cdx.dev' }) }, accept: false },
  { name: 'unsupported algorithm (RS256)', webauthn: { algorithm: 'RS256', authenticatorData: authDataB64, clientDataJSON: b64urlJson({ type: 'webauthn.get', challenge: goodChallenge, origin: 'https://cdx.dev' }) }, accept: false },
  { name: 'UP flag not set', webauthn: { algorithm: 'ES256', authenticatorData: authDataNoUP, clientDataJSON: b64urlJson({ type: 'webauthn.get', challenge: goodChallenge, origin: 'https://cdx.dev' }) }, accept: false },
  { name: 'algorithm disagrees with publicKey (ES256 + OKP key)', webauthn: { algorithm: 'ES256', authenticatorData: authDataB64, clientDataJSON: b64urlJson({ type: 'webauthn.get', challenge: goodChallenge, origin: 'https://cdx.dev' }), publicKey: { kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' } }, accept: false },
];
for (const c of bindingCases) {
  let threw = false;
  try {
    validateBinding(c.webauthn, MANIFEST_SCOPE);
  } catch {
    threw = true;
  }
  if (c.accept === !threw) console.log(`  ✓ ${c.name} → ${c.accept ? 'accepted' : 'rejected'}`);
  else fail(`${c.name} — expected ${c.accept ? 'accepted' : 'rejected'} but got ${threw ? 'rejected' : 'accepted'}`);
}

// --- Part 4: example corpus ------------------------------------------------
console.log('\nExample corpus WebAuthn signatures:');
const examplesDir = path.join(__dirname, '..', 'examples');
let checked = 0;
for (const name of fs.readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const dir = path.join(examplesDir, name);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    continue;
  }
  const sigRel = manifest.security?.signatures;
  if (typeof sigRel !== 'string' || !fs.existsSync(path.join(dir, sigRel))) continue;
  let sigFile: any;
  try {
    sigFile = JSON.parse(fs.readFileSync(path.join(dir, sigRel), 'utf8'));
  } catch {
    continue;
  }
  for (const s of Array.isArray(sigFile.signatures) ? sigFile.signatures : []) {
    if (s?.webauthn === undefined) continue;
    const id = s?.id ?? '(unnamed)';
    try {
      validateBinding(s.webauthn, s.scope);
      const ok = verifyWebauthnSignature(
        s.webauthn.publicKey,
        Buffer.from(String(s.webauthn.authenticatorData), 'base64url'),
        Buffer.from(String(s.webauthn.clientDataJSON), 'base64url'),
        Buffer.from(String(s.webauthn.signature), 'base64url'),
        s.webauthn.algorithm,
      );
      if (!ok) {
        fail(`${name} signature "${id}" — WebAuthn signature does not verify under publicKey`);
        continue;
      }
      console.log(`  ✓ ${name} signature "${id}" (challenge binds scope; signature verifies)`);
      checked++;
    } catch (err) {
      fail(`${name} signature "${id}" — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

if (failures > 0) {
  console.log(`\n${failures} failure(s). WebAuthn check failed.`);
  process.exit(1);
}
console.log(`\nAll WebAuthn vectors verified; ${checked} example WebAuthn signature(s) checked.`);
