# State Machine

**Section**: Core Specification
**Version**: 0.1

## 1. Overview

CDX documents have explicit lifecycle states that govern their mutability and signature requirements. This state machine addresses a fundamental limitation of PDF and other formats: the lack of clear semantics around document finalization.

## 2. Design Goals

### 2.1 Clear Freeze Semantics

When a document is signed, it should be clear:

- What content is covered by the signature
- Whether the document can still be modified
- What modifications (if any) are permitted

### 2.2 State as Contract

The document state is a contract between author and reader:

| State | Author's Intent | Reader's Expectation |
|-------|-----------------|---------------------|
| draft | "Work in progress" | "Content may change" |
| review | "Ready for feedback" | "Seeking input" |
| frozen | "This is final" | "Content is fixed" |
| published | "This is authoritative" | "Official version" |

## 3. Document States

### 3.1 State Definitions

```
┌─────────────────────────────────────────────────────────────────┐
│                       STATE MACHINE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────┐    review     ┌─────────┐    sign    ┌─────────┐ │
│   │  DRAFT  │ ───────────▶  │ REVIEW  │ ────────▶  │ FROZEN  │ │
│   └─────────┘               └─────────┘            └─────────┘ │
│        │                         │                      │       │
│        │                         │                      │       │
│        │         fork            │        fork          │       │
│        ◀─────────────────────────┴──────────────────────┘       │
│                                                                 │
│                                        publish                  │
│                              ┌─────────┐    │    ┌───────────┐  │
│                              │ FROZEN  │ ───┴──▶ │ PUBLISHED │  │
│                              └─────────┘         └───────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 DRAFT

The initial state for new documents.

**Characteristics:**
- Fully editable
- No signature required
- Document ID may be "pending"
- Content hash may be outdated

**Permitted Operations:**
- Edit content
- Add/remove assets
- Modify presentation
- Modify metadata
- Add/edit/remove phantom clusters
- Transition to REVIEW

### 3.3 REVIEW

Documents ready for feedback and approval.

**Characteristics:**
- Content editable (with tracking)
- Document ID computed
- Comments/annotations encouraged
- Signature optional

**Permitted Operations:**
- Edit content (changes tracked)
- Add comments/annotations
- Add/edit/remove phantom clusters
- Transition to FROZEN (with signature)
- Transition back to DRAFT (if unsigned)
- Fork to new DRAFT

### 3.4 FROZEN

Documents that have been signed and locked.

**Characteristics:**
- Content immutable
- At least one valid signature required
- Document ID is final
- Hash verified on load

**Permitted Operations:**
- Add annotation layer (separate from content)
- Add additional signatures
- Add/edit/remove phantom clusters (outside hashing boundary)
- Transition to PUBLISHED
- Fork to new DRAFT

**Prohibited Operations:**
- Edit content
- Modify presentation layer
- Change metadata (except security metadata)

### 3.5 PUBLISHED

Documents officially released for distribution.

**Characteristics:**
- All FROZEN characteristics
- Indicates official/authoritative status
- May have distribution metadata

**Permitted Operations:**
- Same as FROZEN (including phantom cluster operations)
- Fork to new DRAFT

## 4. State Transitions

### 4.1 Transition Rules

| From | To | Trigger | Requirements |
|------|-----|---------|--------------|
| DRAFT | REVIEW | `submitForReview()` | None |
| REVIEW | DRAFT | `revertToDraft()` | No signatures; `id` reset to `pending` |
| REVIEW | FROZEN | `sign()` | Valid signature |
| FROZEN | PUBLISHED | `publish()` | None |
| Any | DRAFT (new) | `fork()` | Creates new document |

> **Note**: `revertToDraft()` MUST reset `id` to `pending`. A reverted draft is fully editable, so any previously computed ID is stale and MUST be recomputed on the next `draft → review` transition (see Document Hashing, section 7.2) — this prevents a stale ID from surviving edits into a signed, frozen document.

### 4.2 Submit for Review

```json
{
  "state": "draft",
  "id": "pending"
}
```

Becomes:

```json
{
  "state": "review",
  "id": "sha256:computed..."
}
```

Actions:
1. Compute document ID (hash canonical content)
2. Update state to "review"
3. Update modified timestamp

### 4.3 Sign (Review → Frozen)

```json
{
  "state": "review",
  "id": "sha256:abc123...",
  "security": null
}
```

Becomes:

```json
{
  "state": "frozen",
  "id": "sha256:abc123...",
  "security": {
    "signatures": "security/signatures.json"
  }
}
```

Actions:
1. Verify document ID matches current content
2. Create signature over document ID
3. Store signature in security layer
4. Update state to "frozen"

### 4.4 Fork

Forking creates a new document derived from the current one:

```json
// Original (frozen)
{
  "state": "frozen",
  "id": "sha256:original..."
}
```

Produces new document:

```json
{
  "state": "draft",
  "id": "pending",
  "lineage": {
    "parent": "sha256:original...",
    "version": 2,
    "note": "Forked for revisions"
  }
}
```

The fork operation:
1. Copies content, assets, and metadata
2. Removes security layer
3. Sets state to "draft"
4. Records lineage to parent

## 5. State Enforcement

### 5.1 Reader Enforcement

Implementations MUST enforce state semantics when reading:

| State | Enforcement |
|-------|-------------|
| draft | Allow editing UI |
| review | Allow editing, show tracking |
| frozen | Read-only content, verify signatures |
| published | Read-only content, verify signatures |

### 5.2 Writer Enforcement

Implementations MUST enforce when saving:

| State | Enforcement |
|-------|-------------|
| draft | Allow content changes |
| review | Track content changes |
| frozen | Reject content changes |
| published | Reject content changes |

### 5.3 Validation on Load

When loading a frozen/published document:

1. Verify document state is "frozen" or "published"
2. Verify at least one signature exists
3. Verify at least one signature is valid
4. Recompute the document ID from the canonical content and verify it matches `manifest.id` (this is distinct from the raw file hash in `content.hash`)
5. If any verification fails, warn user

## 6. Signatures and State

### 6.1 Signature Binding

Signatures bind to the document ID, which is computed from content:

```
Signature = Sign(PrivateKey, DocumentID)
```

This means:
- Any content change invalidates all signatures
- Signature verification proves content unchanged
- Multiple parties can sign the same content

### 6.2 Signature Requirements by State

| State | Signature Requirement |
|-------|----------------------|
| draft | None |
| review | Optional |
| frozen | At least one valid signature |
| published | At least one valid signature |

### 6.3 Additional Signatures

Frozen documents can accumulate signatures without changing content:

```json
{
  "signatures": [
    {
      "id": "sig-1",
      "protected": "eyJhbGci...",
      "signature": "MEUCIQ...",
      "scope": { "documentId": "sha256:abc123..." }
    },
    {
      "id": "sig-2",
      "protected": "eyJhbGci...",
      "signature": "MGQCMA...",
      "scope": { "documentId": "sha256:abc123..." }
    }
  ]
}
```

All signatures reference the same document ID. See the Security Extension §3.3 for the signature envelope.

## 7. Annotation Layer

### 7.1 Annotations vs. Content

Frozen documents distinguish between:

| Type | Mutability | Part of Hash |
|------|------------|--------------|
| Content | Immutable | Yes |
| Annotations | Mutable | No |

### 7.2 Permitted Annotations

On frozen documents:

- Comments on specific content blocks
- Highlights
- Sticky notes
- Reactions/approvals

### 7.3 Annotation Storage

Annotations are stored separately:

```
security/
├── signatures.json    # Document signatures
└── annotations.json   # User annotations
```

Annotations do NOT affect the document ID or signatures.

### 7.4 Annotation Structure

```json
{
  "annotations": [
    {
      "id": "annot-1",
      "type": "comment",
      "anchor": { "blockId": "block-456" },
      "author": "Jane Doe",
      "created": "2025-01-15T10:00:00Z",
      "content": "This section needs a citation."
    }
  ]
}
```

The `anchor` field uses a ContentAnchor object from the Anchors and References specification. For range-specific annotations, include `start` and `end`:

```json
{
  "anchor": { "blockId": "block-456", "start": 10, "end": 25 }
}
```

### 7.5 Annotation Layer Relationships

There are three annotation storage locations, each serving a different purpose:

| Layer | Location | Purpose | Extension Required |
|-------|----------|---------|--------------------|
| Core annotations | `security/annotations.json` | Minimal annotation support for frozen/published documents. Lightweight format for implementations that don't support extensions. | No (core) |
| Collaboration | `collaboration/comments.json` | Full-featured comments, suggestions, change tracking, presence. Supersedes core annotations when active. | `cdx.collaboration` |
| Phantoms | `phantoms/clusters.json` | Spatially-organized off-page annotation clusters. Orthogonal to inline annotations. | `cdx.phantoms` |

When the collaboration extension is active, implementations SHOULD use `collaboration/comments.json` rather than `security/annotations.json` for new annotations. Core annotations exist as a fallback for minimal implementations.

Phantoms are a separate concept from inline annotations — they provide spatially-organized, off-page content that is anchored to document content but rendered outside the page plane.

## 8. State Persistence

### 8.1 In Manifest

The state is stored in the manifest:

```json
{
  "cdx": "0.1",
  "state": "frozen",
  "id": "sha256:..."
}
```

### 8.2 State History

Optionally, state transitions can be logged:

```json
{
  "stateHistory": [
    { "state": "draft", "at": "2025-01-10T08:00:00Z" },
    { "state": "review", "at": "2025-01-12T14:00:00Z" },
    { "state": "frozen", "at": "2025-01-15T10:00:00Z", "signature": "sig-1" }
  ]
}
```

## 9. Edge Cases

### 9.1 Invalid Signature on Frozen Document

If a frozen document's signature is invalid:

1. Warn user: "Document integrity cannot be verified"
2. Offer options: View anyway, Reject, Report
3. Do NOT allow editing (state is still frozen)
4. Log the verification failure

### 9.2 Missing Signature on Frozen Document

If a frozen document has no signatures:

1. Treat as integrity violation
2. Same handling as invalid signature
3. This indicates tampering (state changed without signature)

### 9.3 Conflicting Forks

When multiple forks exist from the same parent:

- Each fork is a separate document
- Lineage shows common parent
- No automatic merge (out of scope)

### 9.4 Re-signing After Expiration

If signatures expire (based on certificate validity):

1. Document remains frozen
2. Signature marked as expired
3. New signature can be added if content unchanged
4. Original signature retained for audit trail

## 10. Implementation Notes

### 10.1 State Transition Logging

Implementations SHOULD log state transitions for audit:

```json
{
  "transition": "review->frozen",
  "at": "2025-01-15T10:00:00Z",
  "actor": "alice@example.com",
  "signature": "sig-1"
}
```

### 10.2 UI Indicators

Implementations SHOULD clearly indicate document state:

| State | Suggested Indicator |
|-------|---------------------|
| draft | Yellow/amber badge, "Draft" label |
| review | Blue badge, "In Review" label |
| frozen | Green badge + lock icon, "Signed" label |
| published | Green badge + globe icon, "Published" label |

### 10.3 Preventing Accidental State Changes

For frozen documents:

- Disable edit controls
- Show "View Only" mode
- Require explicit "Fork" action to enable editing

## 11. Examples

### 11.1 Draft Document Manifest

```json
{
  "cdx": "0.1",
  "id": "pending",
  "state": "draft",
  "created": "2025-01-10T08:00:00Z",
  "modified": "2025-01-14T16:30:00Z",
  "content": {
    "path": "content/document.json",
    "hash": "sha256:..."
  },
  "metadata": {
    "dublinCore": "metadata/dublin-core.json"
  }
}
```

### 11.2 Frozen Document Manifest

```json
{
  "cdx": "0.1",
  "id": "sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
  "state": "frozen",
  "created": "2025-01-10T08:00:00Z",
  "modified": "2025-01-15T10:00:00Z",
  "content": {
    "path": "content/document.json",
    "hash": "sha256:abc123..."
  },
  "security": {
    "signatures": "security/signatures.json"
  },
  "extensions": [
    { "id": "cdx.security", "version": "0.1", "required": true }
  ],
  "metadata": {
    "dublinCore": "metadata/dublin-core.json"
  },
  "lineage": {
    "parent": null,
    "version": 1
  }
}
```

### 11.3 Forked Document

```json
{
  "cdx": "0.1",
  "id": "pending",
  "state": "draft",
  "created": "2025-01-16T09:00:00Z",
  "modified": "2025-01-16T09:00:00Z",
  "content": {
    "path": "content/document.json",
    "hash": "sha256:def456..."
  },
  "metadata": {
    "dublinCore": "metadata/dublin-core.json"
  },
  "lineage": {
    "parent": "sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
    "version": 2,
    "branch": "main",
    "note": "Forked for Q2 updates"
  }
}
```
