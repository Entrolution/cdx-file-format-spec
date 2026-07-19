# Manifest

**Section**: Core Specification
**Version**: 0.1
**Maturity**: Draft

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
| `profile` | string | Advisory profile declaration (Profiles) |
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

Implementations MUST reject documents with a major version they do not support. A higher **minor** version within a supported major version MUST NOT be rejected: an implementation SHOULD process the fields it recognizes and ignore unrecognized additions (a warning disposition — State Machine section 5.4).

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
| `construction` | string | No | Merkle tree construction identifier — `cdx-bmt-1` (see Provenance spec section 4.4) |

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
| `contentHash` | string | No | Document content hash when this presentation was generated |
| `generated` | string | No | ISO 8601 timestamp when this presentation was generated |

Standard presentation types:
- `"paginated"` - Fixed page layout for print
- `"continuous"` - Vertical scroll for screen
- `"responsive"` - Reflowable layout

At most one entry MAY set `default: true`; setting it on more than one presentation is invalid. To choose a presentation, a reader uses the entry marked `default: true` when present and of a type it supports, and otherwise the first entry, in array order, whose type it supports. A document MAY declare presentations of several types; presentation is outside the document-hash boundary (Document Hashing section 4.1a), so the choice never affects the document ID.

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
| `config` | object | No | Extension-specific configuration paths or inline settings |

If `required` is `true`, implementations that do not support the extension MUST refuse to process the document. If `required` is `false`, an implementation that does not support the extension MUST still process the document, ignoring that extension's data and degrading gracefully (State Machine section 5.4).

### 4.11 `metadata` (Required)

References to metadata files.

```json
{
  "metadata": {
    "dublinCore": "metadata/dublin-core.json",
    "custom": {
      "legal": "metadata/legal.json"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `dublinCore` | string | Yes | Path to Dublin Core metadata |
| `jsonld` | string | No | Path to a document-level JSON-LD metadata file (Semantic Extension); out-of-hash advisory data, referenced by path only |
| `custom` | object | No | Map of custom metadata references (name → path) |

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

Version history and document relationships. The manifest's `lineage` is the **authoritative, signable** ancestor chain: on a frozen or published document the manifest projection binds it (Security Extension section 9.7), so the chain it declares is tamper-evident. It carries the immediate `parent`, the nearest-first `ancestors` chain, `depth`, `branch`, merge parents (`mergedFrom`), `version`, and a `note`. The provenance record (`provenance/record.json`) restates the same chain with additional auditing detail (derivation history and timestamps) but is path-only and **unsigned** — never the authoritative copy. See the Provenance and Lineage specification for the verification model.

```json
{
  "lineage": {
    "parent": "sha256:previousdochash...",
    "ancestors": ["sha256:previousdochash...", "sha256:rootdochash..."],
    "version": 3,
    "depth": 3,
    "branch": "main",
    "note": "Updated section 3 per review feedback"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `parent` | string | No | Document ID of parent version (`null` for a root) |
| `ancestors` | array | No | Nearest-first ancestor chain; `ancestors[0]` equals `parent`. Placing it here binds the signed chain (Provenance and Lineage section 3.3) |
| `version` | integer | No | Sequential version number (advisory) |
| `depth` | integer | No | Generation number: 1 for the root, +1 per generation (advisory; recomputed on verification) |
| `branch` | string | No | Branch identifier for parallel versions |
| `mergedFrom` | array | No | Additional merge-parent document IDs (Provenance and Lineage section 3.4) |
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

Path to the provenance record file, which carries the document's derivation history and timestamps. Its lineage restates the authoritative chain in `manifest.lineage` (section 4.13) with additional auditing detail; because the provenance record is path-only and unsigned, it is never the authoritative copy.

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

### 4.18 `profile` (Optional)

An advisory declaration of the profile a document targets, as a bare identifier.

```json
{
  "profile": "simple"
}
```

A profile is non-normative guidance on which features suit a use case (see the Profiles specification); it defines no conformance class (Introduction section 1.3). The `profile` field is therefore advisory only:

- It never affects document validity. A document that declares a profile but uses features outside that profile's guidance is still a fully valid CDX document.
- A consumer MUST process a document that declares a profile as a standard CDX document — honoring every feature it actually contains regardless of the declared value — and SHOULD ignore an unrecognized profile value.
- A producer MAY declare a profile to signal intent; doing so imposes no obligation to restrict the document to that profile's recommended features.

The declaration carries no version component and is not bound by the document ID or the signed manifest projection.

## 5. Validation

### 5.1 Required Field Validation

Implementations MUST verify:

1. All required fields are present
2. Field types match specification
3. `cdx` version is supported
4. Referenced files exist in archive
5. File hashes match when present

The disposition when any of these checks fails is defined by State Machine section 5.4.

### 5.2 Hash Verification

For frozen and published documents, implementations MUST verify that referenced file hashes match actual contents; a mismatch is an INTEGRITY-ERROR (State Machine section 5.4).

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
    "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "compression": "zstd"
  },
  "presentation": [
    {
      "type": "paginated",
      "path": "presentation/paginated.json",
      "hash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "default": true
    }
  ],
  "assets": {
    "images": {
      "count": 3,
      "totalSize": 524288,
      "index": "assets/images/index.json",
      "hash": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
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
    "parent": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "version": 2,
    "note": "Final version after legal review"
  }
}
```
