# Document Hashing

**Section**: Core Specification
**Version**: 0.1

## 1. Overview

CDX documents use content-addressable hashing as a core identity mechanism. The document's hash serves as its canonical identifier, enabling:

- Integrity verification
- Version identification
- Lineage tracking
- Distributed storage
- Deduplication

## 2. Design Principles

### 2.1 Content-Addressable Identity

The hash of a document's content IS its identity. This means:

- Identical content produces identical IDs
- Any content change produces a different ID
- IDs are deterministic (reproducible)
- No central authority needed for ID assignment

### 2.2 Algorithm Agility

The specification supports multiple hash algorithms to accommodate:

- Different security requirements
- Future algorithm advances
- Post-quantum preparedness

## 3. Hash Format

### 3.1 String Representation

Hashes are represented as: `algorithm:hexdigest`

```
sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b
```

Components:
- `algorithm` - Hash algorithm identifier (lowercase)
- `:` - Separator
- `hexdigest` - Lowercase hexadecimal hash value

### 3.2 Supported Algorithms

| Algorithm | Identifier | Output Size | Status |
|-----------|------------|-------------|--------|
| SHA-256 | `sha256` | 256 bits | Required (default) |
| SHA-384 | `sha384` | 384 bits | Optional |
| SHA-512 | `sha512` | 512 bits | Optional |
| SHA-3-256 | `sha3-256` | 256 bits | Optional |
| SHA-3-512 | `sha3-512` | 512 bits | Optional |
| BLAKE3 | `blake3` | 256 bits | Optional |

**Default**: SHA-256 (`sha256`)

Implementations MUST support SHA-256. Support for other algorithms is OPTIONAL.

### 3.3 Algorithm Selection

Documents MAY specify their hash algorithm in the manifest:

```json
{
  "cdx": "0.1",
  "hashAlgorithm": "sha256",
  "id": "sha256:..."
}
```

If `hashAlgorithm` is omitted, SHA-256 is assumed.

## 4. Document ID Computation

### 4.1 What Is Hashed

The document ID is computed from a **canonical representation** of the document's semantic content and essential metadata:

```
Document ID = Hash(CanonicalContent)
```

The canonical content includes:
1. Content blocks (semantic content)
2. Essential metadata (Dublin Core)
3. Asset hashes (not asset content)

The canonical content EXCLUDES:
- Presentation layers (visual rendering, not part of content identity)
- Precise layouts (rendering fidelity, not part of content identity)
- Timestamps (administrative, change on every edit)
- Security data (signatures reference the hash, not part of it)
- Collaboration data (comments, change tracking)
- Phantom data (off-page annotations)
- Form data (`forms/data.json` — filled values are mutable even on frozen documents)

> **Metadata inclusion**: The Dublin Core terms included in the hash are `title`, `creator`, `subject`, `description`, and `language`. Administrative terms (`date`, `publisher`, `identifier`, `rights`) are excluded. See Metadata specification, section 6 for details.

> **Note**: The document ID represents the document's semantic identity — what it says, not how it looks. Multiple visual presentations (letter, A4, responsive) of the same content produce the same document ID. For appearance attestation, see Scoped Signatures in the Security Extension.

### 4.1a Hash Boundary Summary

The following table summarizes what is included in and excluded from the document content hash:

| Layer | Inside Hash | Notes |
|-------|-------------|-------|
| Content blocks | Yes | Core document identity — all text, structure, and semantic markup |
| Dublin Core metadata | Partial | Only `title`, `creator`, `subject`, `description`, `language` |
| Asset hashes | Yes | Asset identity via hash mapping (not asset bytes) |
| Asset content | No | Actual asset bytes are hashed separately; only references included |
| Presentation | No | Visual rendering instructions — not part of semantic identity |
| Precise layouts | No | Coordinate-level positioning — rendering fidelity |
| Collaboration | No | Comments, suggestions, change tracking |
| Phantoms | No | Off-page annotations and margin notes |
| Forms data | No | Fillable field values (mutable even on frozen documents) |
| Security | No | Signatures reference the hash — not part of it |
| Timestamps | No | Administrative metadata (`created`, `modified`) |
| Provenance | No | Lineage tracking and derivation history |
| CRDT metadata | No | Transient synchronization state from collaboration extension |

This boundary ensures that the document's identity represents its **semantic content** — what the document says — rather than how it appears or administrative metadata about it.

> **Note:** CRDT metadata added by the collaboration extension (`crdt` fields on content blocks) is excluded from the content hash. CRDT data represents transient synchronization state and MUST be stripped before computing the document hash.

### 4.2 Canonical Content Structure

```json
{
  "version": "0.1",
  "content": { /* content blocks */ },
  "metadata": { /* dublin core subset */ },
  "assetHashes": { /* asset ID -> hash mapping */ }
}
```

### 4.3 Canonicalization Rules

To ensure deterministic hashing:

1. **JSON Canonicalization**: Use [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JCS) for JSON serialization:
   - Sort object keys lexicographically
   - No whitespace between tokens
   - Numbers without unnecessary precision
   - Strings with minimal escaping

2. **Unicode Normalization**: All text content in NFC form

> **Note**: Because JCS sorts all object keys, the order in which fields are written when authoring a document has no effect on its hash — content may be authored in any field order. The worked example below shows authored input being reordered into canonical JCS form.

### 4.4 Computation Steps

```
1. Extract content blocks from document
2. Extract essential metadata
3. Collect asset hashes (ID -> hash mapping)
4. Build canonical structure
5. Serialize using JCS
6. Hash the serialized bytes
7. Format as "algorithm:hexdigest"
```

### 4.5 Example

Given content:

```json
{
  "version": "0.1",
  "blocks": [
    {
      "type": "heading",
      "level": 1,
      "children": [{ "type": "text", "value": "Hello" }]
    }
  ]
}
```

And metadata:

```json
{
  "title": "Test Document",
  "creator": "Jane Doe"
}
```

Canonical form (JCS serialized, shown formatted for readability):

```json
{"assetHashes":{},"content":{"blocks":[{"children":[{"type":"text","value":"Hello"}],"level":1,"type":"heading"}],"version":"0.1"},"metadata":{"creator":"Jane Doe","title":"Test Document"},"version":"0.1"}
```

Hash: `sha256:...` (computed from the JCS-serialized bytes)

## 5. File-Level Hashes

### 5.1 Individual File Hashes

Files within the archive have their own hashes:

```json
{
  "content": {
    "path": "content/document.json",
    "hash": "sha256:abc123..."
  }
}
```

These are computed from the raw file bytes (after decompression).

### 5.2 Asset Hashes

Assets include hashes in their index:

```json
{
  "id": "figure1",
  "path": "figure1.avif",
  "hash": "sha256:def456..."
}
```

Asset hashes feed into the document ID computation via the `assetHashes` mapping.

## 6. Hash Verification

### 6.1 Verification Levels

| Level | Scope | When |
|-------|-------|------|
| File | Individual file integrity | On file access |
| Asset | Asset integrity | On asset load |
| Document | Full document integrity | On document open, sign, verify |

### 6.2 Verification Process

**File-level verification:**
1. Decompress file from archive
2. Compute hash of decompressed bytes
3. Compare with hash in manifest
4. Reject on mismatch

**Document-level verification:**
1. Verify all file hashes
2. Recompute document ID from canonical content
3. Compare with ID in manifest
4. Reject on mismatch

### 6.3 Hash Mismatch Handling

| Document State | Hash Mismatch Action |
|----------------|---------------------|
| draft | Warning (content may have been edited externally) |
| review | Warning |
| frozen | Error (document integrity compromised) |
| published | Error (document integrity compromised) |

For frozen/published documents, hash mismatches indicate tampering or corruption.

## 7. Draft Documents

### 7.1 Pending ID

Draft documents that haven't been finalized MAY use a pending placeholder:

```json
{
  "id": "pending",
  "state": "draft"
}
```

This indicates the document is in active editing and the ID hasn't been computed yet.

### 7.2 ID Computation Triggers

The document ID SHOULD be computed when:

- Document state transitions from `draft` to `review`
- Document is signed
- Document is exported for distribution
- Explicitly requested by user/application

## 8. Lineage and History

### 8.1 Parent References

When a document is derived from another, the lineage records the parent:

```json
{
  "lineage": {
    "parent": "sha256:originaldochash...",
    "version": 2
  }
}
```

The parent hash refers to the document ID of the previous version.

### 8.2 History Chain

Documents form a chain through parent references:

```
doc-v1 (sha256:aaa...)
    │
    └── doc-v2 (sha256:bbb..., parent=sha256:aaa...)
            │
            └── doc-v3 (sha256:ccc..., parent=sha256:bbb...)
```

### 8.3 Branching

Multiple documents can share the same parent (branching):

```
doc-v1 (sha256:aaa...)
    ├── doc-v2a (sha256:bbb..., parent=sha256:aaa...)
    └── doc-v2b (sha256:ccc..., parent=sha256:aaa...)
```

The `lineage.branch` field can distinguish branches:

```json
{
  "lineage": {
    "parent": "sha256:aaa...",
    "branch": "legal-review"
  }
}
```

## 9. Security Considerations

### 9.1 Collision Resistance

SHA-256 provides strong collision resistance. The probability of accidental collision is negligible (2^-128).

### 9.2 Pre-image Resistance

Given a hash, it's computationally infeasible to find content that produces it.

### 9.3 Second Pre-image Resistance

Given content and its hash, it's computationally infeasible to find different content with the same hash.

### 9.4 Algorithm Weakness

If an algorithm is found to be weak:

1. Implementations SHOULD support re-hashing with stronger algorithm
2. Signatures can bind to new hash
3. Old IDs can be listed as aliases

### 9.5 Post-Quantum Considerations

Current hash algorithms are believed to be quantum-resistant (Grover's algorithm provides only quadratic speedup). SHA-256 provides ~128 bits of security against quantum attacks, which is considered adequate.

## 10. Implementation Notes

### 10.1 Performance

Hash computation is fast (typically <1ms for small documents). For large documents with many assets:

- Compute asset hashes incrementally as assets are added
- Cache computed hashes
- Use streaming hash computation for large files

### 10.2 Caching

Implementations SHOULD cache:

- File hashes (invalidate when file modified)
- Document ID (invalidate when content changes)
- Asset hashes (invalidate when asset added/modified)

### 10.3 Streaming

For large files, use streaming hash computation:

```
hasher = new SHA256()
while chunk = file.read(CHUNK_SIZE):
    hasher.update(chunk)
hash = hasher.finalize()
```

## 11. Examples

### 11.1 Minimal Document Hash

Content:

```json
{"blocks":[{"children":[{"type":"text","value":"Hello"}],"type":"paragraph"}],"version":"0.1"}
```

Canonical form (no metadata, no assets):

```json
{"assetHashes":{},"content":{"blocks":[{"children":[{"type":"text","value":"Hello"}],"type":"paragraph"}],"version":"0.1"},"metadata":{},"version":"0.1"}
```

### 11.2 Document with Assets

```json
{
  "assetHashes": {
    "figure1": "sha256:abc123...",
    "logo": "sha256:def456..."
  },
  "content": { /* ... */ },
  "metadata": {
    "creator": "Finance Team",
    "title": "Annual Report"
  },
  "version": "0.1"
}
```

### 11.3 Verification Code (Pseudocode)

```javascript
function verifyDocument(archive) {
  // 1. Load manifest
  const manifest = parseJSON(archive.read("manifest.json"))

  // 2. Verify file hashes
  for (const fileRef of getAllFileRefs(manifest)) {
    const fileBytes = archive.read(fileRef.path)
    const computedHash = sha256(fileBytes)
    if (computedHash !== fileRef.hash) {
      throw new Error(`File hash mismatch: ${fileRef.path}`)
    }
  }

  // 3. Verify document ID
  const content = parseJSON(archive.read(manifest.content.path))
  const metadata = parseJSON(archive.read(manifest.metadata.dublinCore))
  const assetHashes = collectAssetHashes(archive, manifest)

  const canonical = {
    version: "0.1",
    content: content,
    metadata: metadata,
    assetHashes: assetHashes
  }

  const canonicalBytes = JCS.serialize(canonical)
  const computedId = "sha256:" + sha256hex(canonicalBytes)

  if (manifest.id !== "pending" && computedId !== manifest.id) {
    throw new Error(`Document ID mismatch`)
  }

  return true
}
```
