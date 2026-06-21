/**
 * Known-answer test vectors for the detached-JWS signature envelope
 * (Security Extension §3.3).
 *
 * `headerVectors` pin the reference protected-header encoding (header object →
 * base64url). `signingInputVectors` pin the full signing-input construction —
 * `BASE64URL(protected) || '.' || JCS(scope)` (RFC 7797 detached, b64:false) —
 * against an independent SHA-256 oracle (Python base64/json/hashlib, not this
 * repo's code), so a construction or encoding bug is caught, not snapshotted.
 *
 * These vectors exercise the ENVELOPE only: no certificate is parsed, no DID is
 * resolved, and no signature is verified — the `x5c`/`x5t#S256`/`kid` values are
 * clearly-fake placeholders, and trust semantics are out of scope here (the trust
 * core and keyId resolution are separate increments). The vectors cover both
 * credential paths: X.509 (`x5c`+`x5t#S256`) and keyId (`kid`, §3.11).
 */

const DOC_ID = 'sha256:66db6e3c227d306b57068a4fa5e779e3a4b2ab74c9cb6320ecd57ddf280c2b86';
const DOC_CONTENT = 'sha256:dac719a7afeb6b8bfb05fa673154f3a840ba8554348a2c085859889abe240bb7';

/** Clearly-fake, non-verifying cert material for envelope-shape vectors. */
const X5C_PLACEHOLDER = 'MIIBixUNVERIFIEDplaceholderDERcertificateBASE64FORILLUSTRATIONxw==';
const X5T_PLACEHOLDER = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Clearly-fake, non-resolving self-certifying keyId (did:key) for envelope-shape vectors. */
const KID_PLACEHOLDER = 'did:key:z6MkUNVERIFIEDplaceholderEd25519keyForIllustration';

export interface HeaderVector {
  name: string;
  description: string;
  header: Record<string, unknown>;
  /** base64url of the RFC 8785 (JCS) serialization of `header`. */
  expectedProtected: string;
}

export interface SigningInputVector {
  name: string;
  description: string;
  /** The protected header is derived from this object via the reference encoder. */
  header: Record<string, unknown>;
  /** The readable scope sibling whose JCS is the detached payload. */
  scope: unknown;
  /** sha256 of the UTF-8 signing input (computed out-of-band). */
  expectedSha256: string;
}

export const headerVectors: HeaderVector[] = [
  {
    name: 'minimal-es256',
    description: 'The smallest valid header: alg + the mandatory b64:false / crit:["b64"].',
    header: { alg: 'ES256', b64: false, crit: ['b64'] },
    expectedProtected: 'eyJhbGciOiJFUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il19',
  },
  {
    name: 'minimal-eddsa',
    description: 'A different algorithm in the same minimal header shape.',
    header: { alg: 'EdDSA', b64: false, crit: ['b64'] },
    expectedProtected: 'eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il19',
  },
  {
    name: 'kid-did-key-eddsa',
    description: 'A keyId-path header: a self-certifying did:key DID plus sigT, in place of x5c/x5t#S256 (§3.11).',
    header: { alg: 'EdDSA', b64: false, crit: ['b64'], kid: KID_PLACEHOLDER, sigT: '2025-01-15T10:00:00Z' },
    expectedProtected: 'eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6ImRpZDprZXk6ejZNa1VOVkVSSUZJRURwbGFjZWhvbGRlckVkMjU1MTlrZXlGb3JJbGx1c3RyYXRpb24iLCJzaWdUIjoiMjAyNS0wMS0xNVQxMDowMDowMFoifQ',
  },
];

export const signingInputVectors: SigningInputVector[] = [
  {
    name: 'min-content-only',
    description: 'Minimal header + a content-only scope (documentId alone).',
    header: { alg: 'ES256', b64: false, crit: ['b64'] },
    scope: { documentId: DOC_ID },
    expectedSha256: 'sha256:5f8b3603411b3b56488d878ed8ffe8423669346a60ae325e5704c8696bbc2ffb',
  },
  {
    name: 'full-manifest-covering',
    description: 'A full JAdES-inspired header (x5c/x5t#S256/sigT) + a manifest-covering scope — the signed-document case.',
    header: {
      alg: 'ES256',
      b64: false,
      crit: ['b64'],
      sigT: '2025-01-15T10:00:00Z',
      x5c: [X5C_PLACEHOLDER],
      'x5t#S256': X5T_PLACEHOLDER,
    },
    scope: {
      documentId: DOC_ID,
      manifest: {
        cdx: '0.1',
        state: 'frozen',
        content: { path: 'content/document.json', hash: DOC_CONTENT },
        extensions: [{ id: 'cdx.security', version: '0.1', required: true }],
        lineage: { parent: null, version: 1 },
      },
    },
    expectedSha256: 'sha256:714cfbb574c69a2d5f965c6d0d6ab5699d67f7d13becff3a1de82dae331d2688',
  },
  {
    name: 'eddsa-sha384-content-only',
    description: 'EdDSA + a sha384 document id, confirming alg-agility and a longer hash flow through the construction unchanged.',
    header: { alg: 'EdDSA', b64: false, crit: ['b64'] },
    scope: { documentId: `sha384:${'a'.repeat(96)}` },
    expectedSha256: 'sha256:144dee61769761a1914a1a793781ac2736064bf89b598c0a34f88e271effb31f',
  },
  {
    name: 'kid-did-key-content-only',
    description: 'A keyId-path (did:key) header + a content-only scope — confirms the signing-input construction is identical across credential paths (only the header contents differ).',
    header: { alg: 'EdDSA', b64: false, crit: ['b64'], kid: KID_PLACEHOLDER, sigT: '2025-01-15T10:00:00Z' },
    scope: { documentId: DOC_ID },
    expectedSha256: 'sha256:295f97c39bc6789dee47e1ac520fa069793176c09fccc4f1d70f6ff583fd8946',
  },
];
