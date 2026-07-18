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

const DOC_ID = 'sha256:e7ad94ba3634250646b41d62bc40cfc0c6aba0de995c2193fd2ebae77eed35c7';
const DOC_CONTENT = 'sha256:f28bbc78915107cc2973f10da7c5c0943414a03b274cdf6193f7b34d433ef026';

/** Clearly-fake, non-verifying cert material for envelope-shape vectors. */
const X5C_PLACEHOLDER = 'MIIBixUNVERIFIEDplaceholderDERcertificateBASE64FORILLUSTRATIONxw==';
const X5T_PLACEHOLDER = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Clearly-fake, non-resolving self-certifying keyId (did:key) for envelope-shape vectors. */
const KID_PLACEHOLDER = 'did:key:z6MkUNVERIFIEDplaceholderEd25519keyForIllustration';

/** A did:web keyId + a real RFC 7638 thumbprint (the RFC 8037 Ed25519 key) for did:web shape vectors. */
const KID_WEB = 'did:web:example.com:alice';
const JKT_SAMPLE = 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k';

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
  {
    name: 'kid-did-web-jkt',
    description: 'A did:web keyId header: an out-of-band-resolved key bound by a jkt thumbprint, with a colon-delimited path (§3.11).',
    header: { alg: 'EdDSA', b64: false, crit: ['b64'], kid: KID_WEB, jkt: JKT_SAMPLE, sigT: '2025-01-15T10:00:00Z' },
    expectedProtected: 'eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImprdCI6ImtQcktfcW14VldhWVZBOXd3QkY2SXVvM3ZWeno3VHhIQ1R3WEJ5Z3JTNGsiLCJraWQiOiJkaWQ6d2ViOmV4YW1wbGUuY29tOmFsaWNlIiwic2lnVCI6IjIwMjUtMDEtMTVUMTA6MDA6MDBaIn0',
  },
];

export const signingInputVectors: SigningInputVector[] = [
  {
    name: 'min-content-only',
    description: 'Minimal header + a content-only scope (documentId alone).',
    header: { alg: 'ES256', b64: false, crit: ['b64'] },
    scope: { documentId: DOC_ID },
    expectedSha256: 'sha256:6df5f4e1a284c4c61734869c76f325a9b1141d76267de3e3856cd29b75ce6608',
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
    expectedSha256: 'sha256:982c1edf31749950f8b91a0fc16a757376c9f517f32e0870b2b669c1e565dfe9',
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
    expectedSha256: 'sha256:49cbf20981ac75ee6e5be5e7e891b75b27b8dcbef26a0592f3f71c1ff42bce3c',
  },
  {
    name: 'kid-did-web-content-only',
    description: 'A did:web header (kid + jkt) + content-only scope — confirms the signing-input construction is unchanged for the out-of-band keyId path.',
    header: { alg: 'EdDSA', b64: false, crit: ['b64'], kid: KID_WEB, jkt: JKT_SAMPLE, sigT: '2025-01-15T10:00:00Z' },
    scope: { documentId: DOC_ID },
    expectedSha256: 'sha256:278bff47816fa8651c08c8da465485819e7b22d9bcd5b99e00b2ef14a7c7bbc1',
  },
];

// ---------------------------------------------------------------------------
// did:web key-resolution vectors (§3.11): RFC 7638/8037 JWK thumbprint (the `jkt`
// value) and publicKeyMultibase → JWK conversion. Independently produced (Python
// hashlib/base64 + the `cryptography` lib for the P-256 point); the Ed25519 vector
// is anchored to RFC 8037 Appendix A.3, the P-256 vector to a deterministic key
// (private scalar d=2).
// ---------------------------------------------------------------------------

export interface ThumbprintVector {
  name: string;
  description: string;
  jwk: Record<string, string>;
  /** base64url RFC 7638 SHA-256 thumbprint (the `jkt`). */
  expectedJkt: string;
}

export const thumbprintVectors: ThumbprintVector[] = [
  {
    name: 'ed25519-rfc8037',
    description: 'RFC 8037 Appendix A.3 Ed25519 JWK thumbprint (authoritative published value).',
    jwk: { kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' },
    expectedJkt: 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k',
  },
  {
    name: 'p256-deterministic',
    description: 'P-256 JWK thumbprint (deterministic key, private scalar d=2).',
    jwk: { kty: 'EC', crv: 'P-256', x: 'fPJ7GI0DT36KUjgDBLUaw8CJaeJ38hs1pgtI_EdmmXg', y: 'B3dVENuO0EApPZrGn3Qw27p9reY86YIpngS3nSJ4c9E' },
    expectedJkt: 'AhqHzaYXA5MzmDCrsseUsVBGKyfhDhvekx0THjH_xIE',
  },
];

export interface MultibaseVector {
  name: string;
  description: string;
  /** A DID-document publicKeyMultibase value (base58btc, 'z' prefix). */
  multibase: string;
  expectedJwk: Record<string, string>;
  /** The thumbprint of the converted key — confirms convert→thumbprint round-trips. */
  expectedJkt: string;
}

export const multibaseVectors: MultibaseVector[] = [
  {
    name: 'ed25519-multikey',
    description: 'Ed25519 publicKeyMultibase (the RFC 8037 key) → JWK; thumbprint matches the JWK vector.',
    multibase: 'z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw',
    expectedJwk: { kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' },
    expectedJkt: 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k',
  },
  {
    name: 'p256-multikey',
    description: 'P-256 compressed publicKeyMultibase → JWK (point decompressed); thumbprint matches the JWK vector.',
    multibase: 'zDnaer52RTwabaBeMkKYYwZmEFqPabLW78cRK62iovMUQhFif',
    expectedJwk: { kty: 'EC', crv: 'P-256', x: 'fPJ7GI0DT36KUjgDBLUaw8CJaeJ38hs1pgtI_EdmmXg', y: 'B3dVENuO0EApPZrGn3Qw27p9reY86YIpngS3nSJ4c9E' },
    expectedJkt: 'AhqHzaYXA5MzmDCrsseUsVBGKyfhDhvekx0THjH_xIE',
  },
];
