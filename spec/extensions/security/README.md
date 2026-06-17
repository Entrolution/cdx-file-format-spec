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

Signatures bind to the document ID (content hash), not the raw file bytes:

```
Signature = Sign(PrivateKey, DocumentID)
```

This means:
- Signatures verify document content integrity
- Multiple signatures can attest to the same content
- Re-packaging doesn't invalidate signatures (only content changes do)

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
3. For each signature:
   a. Decode the signature value
   b. If `scope` is absent: verify signature over document ID using signer's public key
   c. If `scope` is present: verify using scoped signature algorithm (see section 9.5)
   d. If certificate present, validate certificate chain
   e. If timestamp present, verify timestamp token
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
| `layouts` | object | No | Map of layout path → layout file hash. Attests visual appearance. |

The `scope` object is extensible — future fields can be added (e.g., `metadata`, `assets`) without breaking existing signatures.

### 9.5 Verification Algorithm for Scoped Signatures

The verification algorithm (section 3.7) is extended to handle both legacy and scoped modes:

1. If `scope` is absent: `Verify(PublicKey, value, documentId)` — legacy content-only verification
2. If `scope` is present:
   a. Verify `scope.documentId` matches top-level `documentId`
   b. If `scope.layouts` is present, verify each layout path exists and its file hash matches the declared hash
   c. Serialize `scope` with JCS
   d. `Verify(PublicKey, value, JCS(scope))`

### 9.6 Use Case

In legal contexts, a notary signs with `scope` including the letter layout, attesting: "I certify this content rendered in this exact layout." Another signer might sign content-only if appearance is not relevant to their attestation.

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
