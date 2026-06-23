# Manifest

**Section**: Core Specification
**Version**: 0.1

## 1. Overview

The manifest (`manifest.json`) is the root metadata structure of a CDX document. It describes the document's identity, version, state, structure, and processing requirements.

## 2. Location and Format

The manifest MUST be:

- Located at `/manifest.json` in the archive root
- The first file in the ZIP archive
- Valid JSON conforming to [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)
- Encoded as UTF-8 without BOM

## 3. Structure

### 3.1 Root Object

```json
{
  "cdx": "0.1",
  "id": "sha256:a1b2c3d4e5f6...",
  "state": "draft",
  "created": "2025-01-15T10:30:00Z",
  "modified": "2025-01-15T14:22:00Z",
  "content": {
    "path": "content/document.json",
    "hash": "sha256:..."
  },
  "presentation": [...],
  "assets": {...},
  "security": {...},
  "metadata": {...},
  "extensions": [...],
  "lineage": {...}
}
```

### 3.2 Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `cdx` | string | Specification version (e.g., "0.1") |
| `id` | string | Content-addressable document identifier |
| `state` | string | Document state (see State Machine spec) |
| `created` | string | ISO 8601 creation timestamp |
| `modified` | string | ISO 8601 last modification timestamp |
| `content` | object | Content layer reference |
| `metadata` | object | Metadata references |

### 3.3 Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `presentation` | array | Presentation layer references |
| `assets` | object | Asset manifest |
| `security` | object | Security layer reference |
| `extensions` | array | Active extension declarations |
| `lineage` | object | Version history and parent reference |
| `phantoms` | object | Phantom layer reference (Phantom Extension) |
| `hashAlgorithm` | string | Hash algorithm for the document ID (default `sha256`) |
| `provenance` | string | Path to the provenance record file |
| `signaturePolicy` | object | Required-signer policy (Security Extension) |
| `academic` | object | Academic Extension configuration |
| `semantic` | object | Semantic Extension configuration |
| `legal` | object | Legal Extension configuration |
| `collaboration` | object | Collaboration Extension configuration |

## 4. Field Definitions

### 4.1 `cdx` (Required)

The specification version this document conforms to.

```json
{
  "cdx": "0.1"
}
```

Format: `MAJOR.MINOR` (PATCH omitted for documents)

Implementations MUST reject documents with a major version they do not support.

### 4.2 `id` (Required)

The content-addressable identifier for this document version.

```json
{
  "id": "sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b"
}
```

Format: `algorithm:hexdigest`

See Document Hashing specification for computation rules.

For documents in `draft` state, the `id` MAY be a placeholder that is computed when the document is finalized:

```json
{
  "id": "pending"
}
```

### 4.3 `state` (Required)

The current lifecycle state of the document.

```json
{
  "state": "draft"
}
```

Valid values: `"draft"`, `"review"`, `"frozen"`, `"published"`

See State Machine specification for state definitions and transitions.

### 4.4 `created` (Required)

ISO 8601 timestamp when the document was first created.

```json
{
  "created": "2025-01-15T10:30:00Z"
}
```

This value MUST NOT change across document versions. Use lineage to trace original creation time.

### 4.5 `modified` (Required)

ISO 8601 timestamp when the document was last modified.

```json
{
  "modified": "2025-01-15T14:22:00Z"
}
```

This value MUST be updated on any content or metadata change.

### 4.6 `content` (Required)

Reference to the content layer.

```json
{
  "content": {
    "path": "content/document.json",
    "hash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "compression": "zstd"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Relative path within archive |
| `hash` | string | Yes | Hash of file contents |
| `compression` | string | No | Compression used ("deflate", "zstd", "none") |
| `merkleRoot` | string | No | Merkle tree root hash of content blocks (see Provenance spec section 4.4) |
| `blockCount` | integer | No | Number of content blocks in the document |

### 4.7 `presentation` (Optional)

Array of presentation layer references.

```json
{
  "presentation": [
    {
      "type": "paginated",
      "path": "presentation/paginated.json",
      "hash": "sha256:...",
      "default": true
    },
    {
      "type": "continuous",
      "path": "presentation/continuous.json",
      "hash": "sha256:..."
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Presentation type identifier |
| `path` | string | Yes | Relative path within archive |
| `hash` | string | Yes | Hash of file contents |
| `default` | boolean | No | Whether this is the default presentation |

Standard presentation types:
- `"paginated"` - Fixed page layout for print
- `"continuous"` - Vertical scroll for screen
- `"responsive"` - Reflowable layout

### 4.8 `assets` (Optional)

Asset manifest describing embedded resources.

```json
{
  "assets": {
    "images": {
      "count": 5,
      "totalSize": 1048576,
      "index": "assets/images/index.json"
    },
    "fonts": {
      "count": 2,
      "totalSize": 65536,
      "index": "assets/fonts/index.json"
    },
    "embeds": {
      "count": 1,
      "totalSize": 2048,
      "index": "assets/embeds/index.json"
    }
  }
}
```

See Asset Embedding specification for index file format.

### 4.9 `security` (Optional)

Security layer reference. Presence indicates the Security Extension is active.

```json
{
  "security": {
    "signatures": "security/signatures.json",
    "encryption": null
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `signatures` | string | Path to signatures file, or null |
| `encryption` | string | Path to encryption metadata, or null |

### 4.10 `extensions` (Optional)

Array of active extensions beyond the core specification.

```json
{
  "extensions": [
    {
      "id": "cdx.security",
      "version": "0.1",
      "required": true
    },
    {
      "id": "cdx.collaboration",
      "version": "0.1",
      "required": false
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Extension identifier |
| `version` | string | Yes | Extension version |
| `required` | boolean | Yes | Whether extension is required for correct rendering |

If `required` is `true`, implementations that do not support the extension MUST refuse to process the document.

### 4.11 `metadata` (Required)

References to metadata files.

```json
{
  "metadata": {
    "dublinCore": "metadata/dublin-core.json",
    "custom": "metadata/custom.json"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `dublinCore` | string | Yes | Path to Dublin Core metadata |
| `custom` | string | No | Path to custom metadata |

### 4.12 `phantoms` (Optional)

Reference to the phantom annotation layer. Presence indicates the Phantom Extension is active.

```json
{
  "phantoms": {
    "clusters": "phantoms/clusters.json"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clusters` | string | Yes | Path to phantom clusters file |

Phantom data is explicitly outside the content hash boundary. No `hash` field is included — adding or editing phantoms never changes the document ID.

### 4.13 `lineage` (Optional)

Version history and document relationships. The manifest lineage provides a summary of the document's version context. The full provenance record (`provenance/record.json`) extends this with the complete ancestor chain, depth, merge history, and timestamps. See the Provenance and Lineage specification for the extended model.

```json
{
  "lineage": {
    "parent": "sha256:previousdochash...",
    "version": 3,
    "branch": "main",
    "note": "Updated section 3 per review feedback"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `parent` | string | No | Document ID of parent version |
| `version` | integer | No | Sequential version number |
| `branch` | string | No | Branch identifier for parallel versions |
| `note` | string | No | Description of changes from parent |

### 4.14 `hashAlgorithm` (Optional)

The hash algorithm used to compute the document `id`. Defaults to `sha256` when omitted.

```json
{
  "hashAlgorithm": "sha256"
}
```

When present, this value MUST match the algorithm prefix of the `id`. See the Document Hashing specification for the supported algorithms and computation rules.

### 4.15 `provenance` (Optional)

Path to the provenance record file, which carries the document's extended lineage chain, derivation history, and timestamps beyond the summary in `lineage`.

```json
{
  "provenance": "provenance/record.json"
}
```

The canonical location is `provenance/record.json`. See the Provenance and Lineage specification.

### 4.16 `signaturePolicy` (Optional)

The document's signature policy. Its `requiredSigners` set binds the signature set against stripping and downgrade: the policy rides in the signed manifest projection, so every manifest-covering signature attests it. While any such signature survives, the set is tamper-evident — a stripped required signer is detected (survivors still declare it required), and editing the set breaks each survivor's manifest coverage.

```json
{
  "signaturePolicy": {
    "requiredSigners": [ ... ]
  }
}
```

See the Security Extension specification.

### 4.17 Extension Configuration (`academic`, `semantic`, `legal`, `collaboration`) (Optional)

Top-level configuration objects for the correspondingly named extensions. Each is an open object whose shape is defined by the extension that owns it — for example, file-path pointers or rendering options — and appears at the manifest root only when that extension is active.

```json
{
  "academic": { ... },
  "semantic": { ... },
  "legal": { ... },
  "collaboration": { ... }
}
```

See the relevant extension specification for each object's shape.

## 5. Validation

### 5.1 Required Field Validation

Implementations MUST verify:

1. All required fields are present
2. Field types match specification
3. `cdx` version is supported
4. Referenced files exist in archive
5. File hashes match when present

### 5.2 Hash Verification

For frozen documents, implementations SHOULD verify that referenced file hashes match actual contents. Hash mismatches in frozen documents MUST be reported as errors.

### 5.3 State Consistency

The manifest state MUST be consistent with other indicators:

| State | Security Signatures | Lineage.parent |
|-------|---------------------|----------------|
| draft | Optional | Optional |
| review | Optional | Optional |
| frozen | Required | Required if forked |
| published | Required | Required if forked |

> **Note**: `Lineage.parent` is required for frozen/published documents that were derived from another document (forked). Root documents — those created from scratch, not forked from a parent — have no parent and omit this field.

## 6. Processing Model

### 6.1 Reading

1. Extract `manifest.json` from archive
2. Parse as JSON
3. Validate `cdx` version
4. Check required fields
5. Load referenced files as needed

### 6.2 Writing

1. Construct manifest object
2. Compute content hash
3. Compute document ID (if not draft)
4. Set timestamps
5. Serialize to JSON
6. Write as first file in archive

### 6.3 Updating

When modifying a document:

1. Update `modified` timestamp
2. Recalculate content hash
3. Update `id` if not draft
4. If version-controlled, set `lineage.parent` to previous `id`

## 7. Examples

### 7.1 Minimal Draft Document

```json
{
  "cdx": "0.1",
  "id": "pending",
  "state": "draft",
  "created": "2025-01-15T10:30:00Z",
  "modified": "2025-01-15T10:30:00Z",
  "content": {
    "path": "content/document.json",
    "hash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  },
  "metadata": {
    "dublinCore": "metadata/dublin-core.json"
  }
}
```

### 7.2 Signed Frozen Document

```json
{
  "cdx": "0.1",
  "id": "sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
  "state": "frozen",
  "created": "2025-01-10T08:00:00Z",
  "modified": "2025-01-15T14:22:00Z",
  "content": {
    "path": "content/document.json",
    "hash": "sha256:abc123...",
    "compression": "zstd"
  },
  "presentation": [
    {
      "type": "paginated",
      "path": "presentation/paginated.json",
      "hash": "sha256:def456...",
      "default": true
    }
  ],
  "assets": {
    "images": {
      "count": 3,
      "totalSize": 524288,
      "index": "assets/images/index.json"
    }
  },
  "security": {
    "signatures": "security/signatures.json",
    "encryption": null
  },
  "extensions": [
    {
      "id": "cdx.security",
      "version": "0.1",
      "required": true
    }
  ],
  "metadata": {
    "dublinCore": "metadata/dublin-core.json"
  },
  "lineage": {
    "parent": "sha256:previousversion...",
    "version": 2,
    "note": "Final version after legal review"
  }
}
```
