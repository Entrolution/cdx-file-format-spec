# Security Extension

**Extension ID**: `cdx.security`
**Version**: 0.1
**Status**: Draft

## 1. Overview

The Security Extension provides cryptographic capabilities for CDX documents:

- Digital signatures for document authentication and integrity
- Encryption for confidentiality
- Access control for permission management

## 2. Extension Declaration

To use this extension, declare it in the manifest:

```json
{
  "extensions": [
    {
      "id": "cdx.security",
      "version": "0.1",
      "required": true
    }
  ],
  "security": {
    "signatures": "security/signatures.json",
    "encryption": "security/encryption.json"
  }
}
```

## 3. Digital Signatures

### 3.1 Signature Model

A signature covers an explicit, signed **scope** of what it attests. The scope always binds the document ID (the content hash); a scoped signature additionally binds the **manifest projection** (Section 9.7) and/or precise-layout hashes (Section 9.3). A signature is a detached JWS (Section 3.3) over the canonical bytes of that scope:

```
Signature = JWS(signing key, JCS(scope))      // scope.documentId is always present
```

This means:
- Signatures verify document content integrity
- Multiple signatures can attest to the same content
- Re-packaging doesn't invalidate signatures (only content changes do)

The document ID binds the document's semantic content only. It does **not** bind the rest of the manifest — the lifecycle state, the content and presentation part hashes, the required-extension set, or the lineage — so a content-only signature leaves those unauthenticated. To authenticate them, a signature covers the **manifest projection** (Section 9.7). A signature on a `frozen` or `published` document MUST cover the manifest projection (Section 9.8).

### 3.2 Supported Algorithms

| Algorithm | Identifier | Key Size | Status |
|-----------|------------|----------|--------|
| ECDSA P-256 | `ES256` | 256-bit | Required |
| ECDSA P-384 | `ES384` | 384-bit | Recommended |
| Ed25519 | `EdDSA` | 256-bit | Recommended |
| RSA-PSS | `PS256` | 2048+ bit | Optional |
| ML-DSA-65 | `ML-DSA-65` | PQC | Optional (future) |

Implementations MUST support ES256. Support for other algorithms is RECOMMENDED.

### 3.3 Signature File Structure

Location: `security/signatures.json`

Each signature is a **detached JWS** ([RFC 7515](https://www.rfc-editor.org/rfc/rfc7515), JSON Serialization) with an **unencoded** payload ([RFC 7797](https://www.rfc-editor.org/rfc/rfc7797), `b64:false`). The signed payload is `JCS(scope)`; the readable `scope` object is carried as a sibling member and is reconstructed — not stored — as the detached payload (see section 3.4). The signed protected header binds the algorithm, the signing certificate, and the signing time.

This is a JWS profiled toward **JAdES** ([ETSI TS 119 182-1](https://www.etsi.org/standards)); it does not claim a JAdES baseline conformance level. It omits the JAdES `sigD` descriptor: the detached payload is reconstructed as `JCS(scope)` per this section.

```json
{
  "version": "0.1",
  "documentId": "sha256:3a7bd3e2...",
  "signatures": [
    {
      "id": "sig-1",
      "protected": "eyJhbGciOiJFUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sInNpZ1QiOiIyMDI1Li4uIiwieDVjIjpbIk1JSUIuLi4iXSwieDV0I1MyNTYiOiIuLi4ifQ",
      "signature": "MEUCIQDf9Ky7...",
      "scope": {
        "documentId": "sha256:3a7bd3e2..."
      },
      "signer": { "name": "Jane Doe", "email": "jane@example.com" },
      "timestamp": {}
    }
  ]
}
```

> **Trust model status.** This version specifies the signature **envelope** only — the structure of the signed bytes. It does **not** yet specify a trust model (trust anchor, certificate-chain validation, revocation, or signature verification). A verifier MUST NOT report a signature as `valid` on the basis of this section alone; the trust model is specified in a subsequent version.

### 3.4 Signature Entry Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique signature identifier |
| `protected` | string | Yes | base64url-encoded signed JWS protected header (see below) |
| `signature` | string | Yes | base64url-encoded JWS signature |
| `scope` | object | Yes | The detached payload — what the signature covers (see section 9) |
| `signer` | object | No | Advisory signer display information (see section 3.5) |
| `timestamp` | object | No | Advisory trusted timestamp (see section 3.6) |

**Protected header.** The base64url-decoded `protected` member is a JSON object with these parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `alg` | Yes | Signature algorithm (section 3.2) |
| `b64` | Yes | MUST be `false` — the payload is unencoded (RFC 7797) |
| `crit` | Yes | MUST be exactly `["b64"]` (a registered parameter such as `sigT` MUST NOT appear here) |
| `x5c` | Yes | Signing certificate chain, base64 DER, leaf-first |
| `x5t#S256` | Yes | base64url SHA-256 thumbprint of the signing certificate |
| `sigT` | Yes | Signing time (ISO 8601 UTC), replacing the former unsigned `signedAt` |

The signature is computed over the **signing input** `BASE64URL(UTF8(protected)) + '.' + JCS(scope)`. The protected header is signed as its exact stored bytes — a verifier MUST use the stored `protected` string and MUST NOT re-serialize the decoded header. The detached payload, by contrast, is recomputed: a verifier MUST derive it as `JCS(scope)` from the `scope` member it displays, so the bytes verified are always the bytes shown.

### 3.5 Signer Information

The `signer` object carries **advisory** display information only. The authoritative signer identity is the subject of the validated signing certificate (the `x5c` chain in the protected header). A verifier MUST NOT treat these fields as authenticated and MUST NOT elevate `signer.name`/`email` above the certificate subject.

```json
{
  "signer": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "organization": "Acme Corporation"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Signer's display name (advisory) |
| `email` | string | No | Signer's email (advisory) |
| `organization` | string | No | Signer's organization (advisory) |

### 3.6 Trusted Timestamps

For non-repudiation, signatures can include trusted timestamps:

```json
{
  "timestamp": {
    "authority": "https://timestamp.example.com",
    "time": "2025-01-15T10:00:05Z",
    "token": "MIIEpgYJKoZI...",
    "algorithm": "SHA256"
  }
}
```

### 3.7 Signature Verification

To verify a signature:

1. Extract the document ID from the manifest and recompute it from the content (integrity)
2. If the document state is `frozen` or `published`, require that every signature covers the manifest projection (Section 9.8); reject the document otherwise
3. For each signature:
   a. Decode the `protected` header and check its shape (section 3.4): `alg` supported, `b64` false, `crit` exactly `["b64"]`, and `x5c`/`x5t#S256`/`sigT` present
   b. Reconstruct the detached payload as `JCS(scope)` from the `scope` member, and the signing input as `protected + "." + JCS(scope)`
   c. Verify `scope.documentId` matches the top-level `documentId`, and when `scope.manifest`/`scope.layouts` are present perform the scoped checks (section 9.5)
   d. **Trust evaluation — deferred.** Validating the `x5c` chain to a trust anchor, checking certificate validity and revocation, and verifying the JWS signature against the certified key are specified in a subsequent version. Until then a verifier MUST NOT report a signature as `valid`
4. Report verification results

### 3.8 Signature States

| State | Meaning |
|-------|---------|
| `valid` | Signature verifies, certificate valid |
| `invalid` | Signature does not verify |
| `expired` | Certificate has expired |
| `revoked` | Certificate has been revoked |
| `untrusted` | Certificate chain not trusted |
| `unknown` | Cannot determine validity |

## 4. Encryption

### 4.1 Encryption Model

Documents can be encrypted for confidentiality. The encryption model supports:

- Symmetric encryption with password
- Asymmetric encryption with recipient public keys
- Hybrid encryption (asymmetric key wrapping + symmetric content)

### 4.2 Supported Algorithms

**Content Encryption:**
| Algorithm | Identifier | Status |
|-----------|------------|--------|
| AES-256-GCM | `A256GCM` | Required |
| ChaCha20-Poly1305 | `C20P` | Recommended |

**Key Wrapping:**
| Algorithm | Identifier | Status |
|-----------|------------|--------|
| ECDH-ES+A256KW | `ECDH-ES+A256KW` | Required |
| RSA-OAEP-256 | `RSA-OAEP-256` | Optional |
| PBES2-HS256+A256KW | `PBES2-HS256+A256KW` | Optional (password) |

### 4.3 Encryption Metadata

Location: `security/encryption.json`

```json
{
  "version": "0.1",
  "algorithm": "A256GCM",
  "keyManagement": "ECDH-ES+A256KW",
  "recipients": [
    {
      "id": "recipient-1",
      "name": "Jane Doe",
      "keyId": "did:web:example.com:jane",
      "encryptedKey": "base64...",
      "ephemeralPublicKey": "base64..."
    }
  ],
  "encryptedContent": {
    "iv": "base64...",
    "tag": "base64...",
    "path": "content/document.json.enc"
  }
}
```

### 4.4 Encrypted Files

When encryption is enabled:

- Content files are encrypted in place (`.enc` suffix)
- The manifest remains unencrypted (for metadata access)
- Dublin Core metadata can optionally be encrypted

### 4.5 Decryption Process

1. Parse encryption metadata
2. Identify recipient (by key ID or try each)
3. Unwrap content encryption key using recipient's private key
4. Decrypt content files using CEK
5. Verify authentication tags

## 5. Access Control

### 5.1 Overview

Access control defines what actions different users can perform:

- View content
- Print
- Copy text
- Add annotations
- Edit (if document is unfrozen)

### 5.2 Access Control Structure

```json
{
  "accessControl": {
    "default": {
      "view": true,
      "print": true,
      "copy": false,
      "annotate": true
    },
    "permissions": [
      {
        "principal": "user:jane@example.com",
        "grants": {
          "view": true,
          "print": true,
          "copy": true,
          "annotate": true,
          "edit": true
        }
      }
    ]
  }
}
```

**Enforcement Model:** Access control lists (ACLs) defined in this extension are declarative and advisory. They express the document author's intended access restrictions but do not enforce them cryptographically on their own. For enforceable access control, combine ACLs with the encryption capabilities defined in this extension (see Section 4 — Encryption). When encryption is applied, ACLs serve as metadata for key distribution and access management. Without encryption, ACLs function as guidance for compliant implementations, which SHOULD respect the declared permissions.

### 5.3 Permission Types

| Permission | Description |
|------------|-------------|
| `view` | View document content |
| `print` | Print document |
| `copy` | Copy text to clipboard |
| `annotate` | Add comments/annotations |
| `edit` | Edit content (draft only) |
| `sign` | Add signatures |
| `decrypt` | Decrypt if encrypted |

### 5.4 Principals

Principals identify who permissions apply to:

- `user:email@example.com` - Specific user
- `group:team-name` - Group of users
- `role:reviewer` - Role-based
- `*` - Everyone (public)

## 6. WebAuthn/FIDO2 Integration

### 6.1 Overview

Documents can be signed using hardware security keys via WebAuthn.

> **Status: deferred.** WebAuthn signatures are not available in this version. A WebAuthn assertion signs over `authenticatorData || hash(clientDataJSON)` rather than the JWS signing input of Section 3.3, so it cannot produce a scoped (manifest-covering) signature, and it carries no X.509 identity for the trust model. The `webauthn` member has therefore been removed from the signature schema pending a defined WebAuthn trust-and-binding profile in a subsequent version. The structure below is retained for reference only.

### 6.2 WebAuthn Signature

```json
{
  "algorithm": "ES256",
  "webauthn": {
    "credentialId": "base64...",
    "authenticatorData": "base64...",
    "clientDataJSON": "base64...",
    "signature": "base64..."
  }
}
```

### 6.3 Verification (reference only)

When reintroduced, WebAuthn signatures would be verified using the WebAuthn verification procedure. Binding the WebAuthn challenge to the JWS signing input of Section 3.3 — a WebAuthn assertion signs `authenticatorData || hash(clientDataJSON)`, not that input — is the open issue deferred per Section 6.1.

## 7. Key Management Guidance

### 7.1 Key Generation

- Use cryptographically secure random number generators
- Generate keys of appropriate strength (256-bit for symmetric, P-256 or stronger for ECDSA)
- Protect private keys appropriately

### 7.2 Key Storage

Recommendations:
- Use hardware security modules (HSM) for high-value keys
- Use operating system keystores where available
- Never store private keys in documents

### 7.3 Key Rotation

- Plan for certificate expiration
- Support multiple valid certificates during rotation
- Maintain audit trail of key changes

### 7.4 Revocation

If a signing key is compromised:
1. Revoke the certificate (publish to CRL or OCSP)
2. Re-sign documents with new key if needed
3. Document the revocation in audit trail

## 8. Security Considerations

### 8.1 Algorithm Agility

The format supports algorithm agility to handle:
- Future cryptographic advances
- Algorithm deprecation
- Post-quantum migration

Implementations SHOULD warn about weak algorithms and support migration.

### 8.2 Post-Quantum Readiness

ML-DSA (formerly Dilithium) is included for post-quantum readiness. Hybrid signatures (classical + PQC) are supported.

### 8.3 Timing Attacks

Implementations MUST use constant-time comparison for cryptographic operations.

### 8.4 Side-Channel Attacks

Use well-audited cryptographic libraries that protect against side-channel attacks.

## 9. Scoped Signatures

### 9.1 Overview

Every signature carries a `scope` object — the detached JWS payload — that makes explicit what it covers. The minimal scope binds the document ID (semantic content) only; for use cases that require attesting to more (the manifest state, or the visual appearance of legal documents and notarized contracts), the scope additionally binds the manifest projection (Section 9.7) and/or precise-layout hashes.

### 9.2 Content-Only Signature

A content-only signature has a `scope` that binds just the document ID:

```json
{
  "id": "sig-1",
  "protected": "eyJhbGci...",
  "signature": "MEUCIQDf9Ky7...",
  "scope": { "documentId": "sha256:contenthash..." }
}
```

### 9.3 Scoped Signature (Content + Layout Attestation)

A scoped signature's `scope` additionally binds the manifest projection and/or precise-layout hashes:

```json
{
  "id": "sig-2",
  "protected": "eyJhbGci...",
  "signature": "MEYCIQCa8Bx2...",
  "scope": {
    "documentId": "sha256:contenthash...",
    "layouts": {
      "presentation/layouts/letter.json": "sha256:layouthash..."
    }
  }
}
```

The `scope` object is serialized using JCS ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)) to produce deterministic bytes for signing.

### 9.4 Scope Object Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `documentId` | string | Yes | Content hash (MUST match top-level `documentId`) |
| `manifest` | object | Conditional | The manifest projection (Section 9.7). REQUIRED on a `frozen` or `published` document; otherwise optional. |
| `layouts` | object | No | Map of layout path → layout file hash. Attests visual appearance. |

The `scope` object is **closed**: it is validated with `additionalProperties: false`, and a verifier MUST reject a scope carrying any member not defined here. New scope members may be introduced in future versions of this extension, but because the signature is computed over `JCS(scope)`, a signature's covered set is fixed at signing time — adding a member changes the signed bytes, so it does not retroactively extend a signature made before the member existed.

### 9.5 Verification Algorithm for Scoped Signatures

With `scope` always present, the scoped checks extend section 3.7 step 3:

   a. Verify `scope.documentId` matches the top-level `documentId`
   b. If `scope.manifest` is present, recompute the manifest projection from `manifest.json` (Section 9.7) and verify it equals `scope.manifest`
   c. If `scope.layouts` is present, verify each layout path exists and its file hash matches the declared hash
   d. The JWS signature is over the signing input `BASE64URL(protected) + "." + JCS(scope)` (section 3.4); the signature's trust evaluation is deferred per section 3.7

### 9.6 Use Case

In legal contexts, a notary signs with `scope` including the letter layout, attesting: "I certify this content rendered in this exact layout." Another signer might sign content-only if appearance is not relevant to their attestation.

### 9.7 Manifest Projection

The document ID binds only the document's semantic content. The rest of the manifest — the lifecycle state, the content and presentation part hashes, the required-extension set, and the lineage — is otherwise unauthenticated. The **manifest projection** is the canonical, signable representation of those security-relevant manifest declarations; a signature attests them by including the projection as `scope.manifest`.

The projection is a deterministic transform of `manifest.json`, serialized with JCS ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)) — the same canonicalization the document ID uses — so a signer and a verifier compute identical bytes. It is defined only once the document ID is fixed; a manifest whose `id` is `pending` (a draft) has no projection.

**Bound fields:**

| Field | Source | Notes |
|-------|--------|-------|
| `cdx` | `manifest.cdx` | Specification version (prevents a silent version downgrade) |
| `state` | `manifest.state` | Lifecycle state |
| `content` | `manifest.content` | Projected to `{path, hash}` |
| `presentation` | `manifest.presentation[]` | Each entry projected to `{type, path, hash}`; the default entry additionally carries `default: true`. Binds the presentation *declaration* (which parts, which is default), not visual rendering — visual attestation remains `scope.layouts` (Section 9.3) |
| `extensions` | `manifest.extensions[]` | Each entry projected to `{id, version, required}`; a required extension additionally carries its `config` |
| `lineage` | `manifest.lineage` | Bound verbatim |

**Construction rules** (mirroring the document-ID canonical form, 06 §4.3):

- Absent or empty optional fields (`presentation`, `extensions`, `lineage`) are omitted, never materialized as `null` or `[]`.
- An explicit `null` (e.g. `lineage.parent: null`) is preserved.
- A non-default presentation carries no `default` member; the flag marks only the default entry (`default: false` is never materialized).
- A non-required extension's `config` is omitted; a required extension's `config` is bound, because a required extension's configuration can change how the document is interpreted.
- Arrays of declarations (`presentation`, `extensions`) are sorted by the JCS serialization of each element, so authored order is not significant; the `lineage.ancestors` order (nearest-first) is significant and preserved.
- Keys and values obey the stored-byte invariants of 06 §4.3.2 (NFC, well-formed Unicode, safe integers).

The document ID is **not** part of the projection — it is carried separately by `scope.documentId`, which a verifier already cross-checks against the top-level `documentId`.

### 9.8 Coverage and Negative Coverage

A signature's coverage is exactly:

- The **document ID** (semantic content) — always.
- The **manifest projection** (Section 9.7) — if and only if `scope.manifest` is present.
- The listed **precise layouts** — if and only if `scope.layouts` is present (Section 9.3).

A signature does **not** cover, in this version of the extension:

- Embedded **fonts** and other non-content assets (excluded from the document ID by design).
- The **bytes** of parts the manifest references by path only — metadata, provenance, phantoms, annotations — and of the `security` block. Only `content` and `presentation[]` carry hashes in the manifest and are bound by the projection.
- The **set of signatures** itself: a signature cannot attest that another signature has not been removed, added, or downgraded.
- Administrative fields with no integrity meaning: `created`, `modified`, and `hashAlgorithm` (redundant with the document-ID prefix).
- Auxiliary `content` integrity fields (`compression`, `merkleRoot`, `blockCount`) and the advisory `presentation[]` fields (`contentHash`, `generated`): the bound `content.hash` and `presentation[].hash` are authoritative, so these subordinate fields are not separately attested.
- A **non-required** extension's `config` (only a required extension's `config` is bound, Section 9.7), and **any manifest member not enumerated in Section 9.7**: the manifest's top-level object is not closed, so an unrecognized member is dropped from the projection rather than signed.

Implementations MUST NOT represent a signature as covering anything beyond the above.

**Coverage requirement.** Because a content-only signature leaves the manifest unauthenticated, the manifest projection is mandatory wherever the manifest is final:

- For a document in state `frozen` or `published`, every signature MUST include `scope.manifest`, and a verifier MUST reject the document if any signature omits it.
- For a document in state `draft` or `review`, a signature MAY be content-only; such a signature does not attest the manifest, and an implementation MUST surface that limitation rather than implying manifest coverage.

> **Lifecycle downgrade.** A content-only signature binds neither the lifecycle state nor any other manifest field, so it cannot establish that a document was not `frozen` or `published`. An attacker can take a frozen document, rewrite its manifest (including `state`), and present only a content-only signature over the unchanged content. A verifier MUST NOT represent a document's state — or any manifest field — as authenticated on the strength of a content-only signature, and SHOULD warn when a document is presented this way. The per-signature JWS protected header (Section 3.3) authenticates only that one signature's own algorithm, certificate and time — not the completeness of the signature set, so a stripped or downgraded set is not yet detectable. Binding the signature set against stripping and downgrade is addressed in a later increment.

## 10. Examples

### 10.1 Single Signature

```json
{
  "version": "0.1",
  "documentId": "sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
  "signatures": [
    {
      "id": "sig-1",
      "protected": "eyJhbGciOiJFUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sLi4ufQ",
      "signature": "MEUCIQDf9Ky7BpL5Rj9E8JH3YqKPvXxNmVhKD5bXc4Qz1A2wAiEA7HjKLm8NoPq...",
      "scope": { "documentId": "sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b" },
      "signer": { "name": "Jane Doe", "email": "jane@example.com" }
    }
  ]
}
```

### 10.2 Multiple Signers

```json
{
  "version": "0.1",
  "documentId": "sha256:3a7bd3e2...",
  "signatures": [
    {
      "id": "sig-1",
      "protected": "eyJhbGciOiJFUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sLi4ufQ",
      "signature": "MEUCIQDf...",
      "scope": { "documentId": "sha256:3a7bd3e2..." },
      "signer": { "name": "Author", "email": "author@example.com" }
    },
    {
      "id": "sig-2",
      "protected": "eyJhbGciOiJFUzM4NCIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sLi4ufQ",
      "signature": "MGQCMA...",
      "scope": { "documentId": "sha256:3a7bd3e2..." },
      "signer": { "name": "Approver", "email": "approver@example.com" }
    }
  ]
}
```
