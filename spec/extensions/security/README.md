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

A signature covers an explicit, signed **scope** of what it attests. The scope always binds the document ID (the content hash); a scoped signature additionally binds the **manifest projection** (Section 9.7) and/or precise-layout hashes (Section 9.3):

```
content-only:   Signature = Sign(PrivateKey, DocumentID)
scoped:         Signature = Sign(PrivateKey, JCS(scope))
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

```json
{
  "version": "0.1",
  "documentId": "sha256:3a7bd3e2...",
  "signatures": [
    {
      "id": "sig-1",
      "algorithm": "ES256",
      "signedAt": "2025-01-15T10:00:00Z",
      "signer": {
        "name": "Jane Doe",
        "email": "jane@example.com",
        "certificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
      },
      "value": "MEUCIQDf9Ky7...",
      "certificateChain": [...],
      "timestamp": {...}
    }
  ]
}
```

### 3.4 Signature Entry Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique signature identifier |
| `algorithm` | string | Yes | Signature algorithm |
| `signedAt` | string | Yes | ISO 8601 signing timestamp |
| `signer` | object | Yes | Signer information |
| `value` | string | Yes | Base64-encoded signature |
| `certificateChain` | array | No | Certificate chain for validation |
| `timestamp` | object | No | Trusted timestamp |
| `scope` | object | No | Scoped signature attestation (see section 9) |

### 3.5 Signer Information

```json
{
  "signer": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "organization": "Acme Corporation",
    "certificate": "-----BEGIN CERTIFICATE-----\n...",
    "keyId": "did:web:example.com:jane"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Signer's display name |
| `email` | string | No | Signer's email |
| `organization` | string | No | Signer's organization |
| `certificate` | string | No | X.509 certificate (PEM) |
| `keyId` | string | No | Key identifier (DID, URL, etc.) |

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

1. Extract document ID from manifest
2. Recompute document ID from content (verify integrity)
3. If the document state is `frozen` or `published`, require that every signature covers the manifest projection (Section 9.8); reject the document otherwise
4. For each signature:
   a. Decode the signature value
   b. If `scope` is absent: verify signature over document ID using signer's public key
   c. If `scope` is present: verify using the scoped signature algorithm (see section 9.5), which recomputes and checks the manifest projection when `scope.manifest` is present
   d. If certificate present, validate certificate chain
   e. If timestamp present, verify timestamp token
5. Report verification results

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

### 6.3 Verification

WebAuthn signatures are verified using the WebAuthn verification procedure, with the document ID as the challenge.

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

By default, signatures cover the document ID (semantic content) only. For use cases that require attesting to visual appearance (e.g., legal documents, notarized contracts), signatures can include an optional `scope` object that makes explicit what the signature covers.

### 9.2 Content-Only Signature (Default)

When `scope` is absent, the signature covers semantic content only. This is backward compatible with existing signatures:

```json
{
  "id": "sig-1",
  "algorithm": "ES256",
  "signedAt": "2025-01-15T10:00:00Z",
  "signer": { "name": "Jane Doe", "email": "jane@example.com" },
  "value": "MEUCIQDf9Ky7..."
}
```

Verification: `Verify(PublicKey, value, DocumentID)`

### 9.3 Scoped Signature (Content + Layout Attestation)

When `scope` is present, the signature covers both content identity and additional components specified in the scope:

```json
{
  "id": "sig-2",
  "algorithm": "ES256",
  "signedAt": "2025-01-15T10:00:00Z",
  "signer": { "name": "Bob Smith", "email": "bob@example.com" },
  "scope": {
    "documentId": "sha256:contenthash...",
    "layouts": {
      "presentation/layouts/letter.json": "sha256:layouthash..."
    }
  },
  "value": "MEYCIQCa8Bx2..."
}
```

Verification: `Verify(PublicKey, value, JCS(scope))`

The `scope` object is serialized using JCS ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)) to produce deterministic bytes for signing.

### 9.4 Scope Object Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `documentId` | string | Yes | Content hash (MUST match top-level `documentId`) |
| `manifest` | object | Conditional | The manifest projection (Section 9.7). REQUIRED on a `frozen` or `published` document; otherwise optional. |
| `layouts` | object | No | Map of layout path → layout file hash. Attests visual appearance. |

The `scope` object is **closed**: it is validated with `additionalProperties: false`, and a verifier MUST reject a scope carrying any member not defined here. New scope members may be introduced in future versions of this extension, but because the signature is computed over `JCS(scope)`, a signature's covered set is fixed at signing time — adding a member changes the signed bytes, so it does not retroactively extend a signature made before the member existed.

### 9.5 Verification Algorithm for Scoped Signatures

The verification algorithm (section 3.7) is extended to handle both legacy and scoped modes:

1. If `scope` is absent: `Verify(PublicKey, value, documentId)` — legacy content-only verification
2. If `scope` is present:
   a. Verify `scope.documentId` matches top-level `documentId`
   b. If `scope.manifest` is present, recompute the manifest projection from `manifest.json` (Section 9.7) and verify it equals `scope.manifest`
   c. If `scope.layouts` is present, verify each layout path exists and its file hash matches the declared hash
   d. Serialize `scope` with JCS
   e. `Verify(PublicKey, value, JCS(scope))`

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

> **Lifecycle downgrade.** A content-only signature binds neither the lifecycle state nor any other manifest field, so it cannot establish that a document was not `frozen` or `published`. An attacker can take a frozen document, rewrite its manifest (including `state`), and present only a content-only signature over the unchanged content. A verifier MUST NOT represent a document's state — or any manifest field — as authenticated on the strength of a content-only signature, and SHOULD warn when a document is presented this way. Binding the signature set against stripping and downgrade is addressed in a later increment.

## 10. Examples

### 10.1 Single Signature

```json
{
  "version": "0.1",
  "documentId": "sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
  "signatures": [
    {
      "id": "sig-1",
      "algorithm": "ES256",
      "signedAt": "2025-01-15T10:00:00Z",
      "signer": {
        "name": "Jane Doe",
        "email": "jane@example.com"
      },
      "value": "MEUCIQDf9Ky7BpL5Rj9E8JH3YqKPvXxNmVhKD5bXc4Qz1A2wAiEA7HjKLm8NoPq..."
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
      "algorithm": "ES256",
      "signedAt": "2025-01-15T10:00:00Z",
      "signer": { "name": "Author", "email": "author@example.com" },
      "value": "MEUCIQDf..."
    },
    {
      "id": "sig-2",
      "algorithm": "ES384",
      "signedAt": "2025-01-16T14:30:00Z",
      "signer": { "name": "Approver", "email": "approver@example.com" },
      "value": "MGQCMA..."
    }
  ]
}
```
