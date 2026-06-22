# Collaboration Extension

**Extension ID**: `cdx.collaboration`
**Version**: 0.2
**Status**: Draft

## 1. Overview

The Collaboration Extension enables multi-user editing and feedback:

- CRDT-based real-time collaboration
- Comments and annotations
- Change tracking and history
- Presence awareness

## 2. Extension Declaration

```json
{
  "extensions": [
    {
      "id": "cdx.collaboration",
      "version": "0.2",
      "required": false
    }
  ]
}
```

> **Migration note (0.1 → 0.2)**: Version 0.2 replaces the `blockRef` + `range` addressing pattern with the unified `anchor` field using ContentAnchor objects from the core Anchors and References specification. Implementations SHOULD migrate existing `blockRef`/`range` pairs to the equivalent `anchor` object: `{ "blockId": "<blockRef>", "start": <range.start>, "end": <range.end> }`. Block-level references (no range) become `{ "blockId": "<blockRef>" }`.

## 3. CRDT Integration

### 3.1 Purpose

Conflict-free Replicated Data Types (CRDTs) enable:

- Real-time collaborative editing
- Offline editing with automatic merge
- No central coordination required

### 3.2 Integration Model

The CDX format doesn't mandate a specific CRDT implementation. Instead, it defines:

- How CRDT state maps to content blocks
- Synchronization protocol hooks
- Conflict resolution semantics

### 3.3 Block-Level CRDTs

Each content block can carry CRDT metadata:

```json
{
  "type": "paragraph",
  "id": "block-123",
  "crdt": {
    "clock": { "site1": 5, "site2": 3 },
    "origin": "site1",
    "seq": 42
  },
  "children": [...]
}
```

**Hashing:** CRDT metadata (`crdt` fields on content blocks) MUST be stripped before computing the document content hash (see Core Specification, Section 6 — Document Hashing). CRDT metadata represents transient synchronization state, not document content. Implementations MUST materialize CRDT operations to plain content before hashing.

### 3.4 Text CRDTs

For rich text editing within blocks, integrate with text CRDTs:

```json
{
  "type": "paragraph",
  "id": "block-123",
  "children": [
    {
      "type": "text",
      "value": "Hello, world",
      "crdt": {
        "positions": [
          { "id": "s1:1", "char": "H" },
          { "id": "s1:2", "char": "e" },
          ...
        ]
      }
    }
  ]
}
```

### 3.5 Supported CRDT Libraries

Compatible with:

- **Yjs** - Popular JavaScript CRDT library
- **Automerge** - JSON-based CRDT
- **Diamond Types** - High-performance text CRDT

### 3.6 CRDT Format Declaration

Documents using CRDT-based collaboration MUST declare the CRDT format in their collaboration metadata. This enables implementations to correctly interpret CRDT state and determines compatibility for synchronization.

```json
{
  "crdtFormat": "yjs",
  "crdtVersion": "13.6"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `crdtFormat` | string | Yes | CRDT implementation identifier |
| `crdtVersion` | string | No | Version of the CRDT library used |

**Recognized `crdtFormat` values:**

| Value | Description |
|-------|-------------|
| `yjs` | [Yjs](https://yjs.dev/) CRDT library |
| `automerge` | [Automerge](https://automerge.org/) JSON CRDT |
| `diamond-types` | [Diamond Types](https://github.com/josephg/diamond-types) text CRDT |

Implementations MAY define additional `crdtFormat` values for other CRDT libraries. Unrecognized values SHOULD be treated as opaque—implementations that do not support the format can still read static content but cannot participate in CRDT synchronization.

### 3.7 Synchronization Metadata

Documents can include sync metadata for tracking collaboration state:

```json
{
  "collaboration": {
    "crdtFormat": "yjs",
    "crdtVersion": "13.6",
    "syncVersion": 1234,
    "lastSync": "2025-01-15T10:00:00Z",
    "peers": [
      { "id": "peer1", "lastSeen": "2025-01-15T09:55:00Z" }
    ]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `syncVersion` | integer | No | Logical clock or sequence number for sync state |
| `lastSync` | string | No | ISO 8601 timestamp of last synchronization |
| `peers` | array | No | Known collaboration peers |

### 3.8 Document Materialization

When exchanging documents between implementations using different CRDT formats, or when exporting for tools that do not support CRDTs, documents MUST be materialized to static content.

**Materialization process:**

1. **Resolve CRDT state** — Flatten all CRDT operations to produce final content values
2. **Preserve content** — All text, blocks, and structure MUST be preserved exactly
3. **Preserve collaboration data** — Comments, suggestions, change history, and revision history MUST be preserved
4. **Strip or reset CRDT metadata** — The `crdt` field on blocks MAY be removed; alternatively, importing implementations MAY initialize fresh CRDT state from the static content
5. **Update provenance** — The document's provenance chain SHOULD record the materialization event

**Interoperability rules:**

- When a document with `crdtFormat: "yjs"` is opened by a tool using Automerge, the tool SHOULD materialize the content and MAY initialize new Automerge CRDT state
- The original `crdtFormat` SHOULD be replaced with the new format
- Real-time synchronization between different CRDT formats is NOT supported—implementations MUST materialize before cross-format exchange

**Example materialization provenance entry:**

```json
{
  "action": "materialized",
  "timestamp": "2025-01-15T12:00:00Z",
  "agent": "cdx-tool/2.0",
  "details": {
    "fromCrdtFormat": "yjs",
    "toCrdtFormat": "automerge",
    "reason": "cross-tool-exchange"
  }
}
```

## 4. Comments and Annotations

### 4.1 Comment Types

| Type | Description |
|------|-------------|
| `comment` | General comment on a block |
| `highlight` | Highlighted text with optional note |
| `suggestion` | Proposed text change |
| `reaction` | Emoji reaction |

### 4.2 Comment Structure

Location: `collaboration/comments.json`

```json
{
  "version": "0.2",
  "crdtFormat": "yjs",
  "comments": [
    {
      "id": "comment-1",
      "type": "comment",
      "anchor": { "blockId": "block-456", "start": 10, "end": 25 },
      "author": {
        "name": "Jane Doe",
        "email": "jane@example.com"
      },
      "created": "2025-01-15T10:00:00Z",
      "modified": "2025-01-15T10:05:00Z",
      "content": "This section needs a citation.",
      "resolved": false,
      "replies": [...]
    }
  ]
}
```

### 4.3 Comment Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique comment identifier |
| `type` | string | Yes | Comment type |
| `anchor` | ContentAnchor | Yes | Anchor to content (see Anchors and References spec) |
| `author` | object | Yes | Comment author |
| `created` | string | Yes | Creation timestamp |
| `modified` | string | No | Last modification timestamp |
| `content` | string | Yes | Comment text |
| `resolved` | boolean | No | Whether comment is resolved |
| `replies` | array | No | Reply comments |

### 4.3a Reply Object

The `replies` array contains reply objects. Replies are flat — they do not nest (a reply cannot contain further replies). Replies do not have their own anchors; they inherit the anchor context of the parent comment.

```json
{
  "id": "c1-r1",
  "author": { "name": "Author", "email": "author@example.com" },
  "created": "2025-01-15T10:30:00Z",
  "content": "Good point, I'll expand this section."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique reply identifier |
| `author` | object | Yes | Reply author (see Author Object below) |
| `created` | string | Yes | ISO 8601 creation timestamp |
| `content` | string | Yes | Reply text content |

### 4.3b Author Object

The `author` field uses a consistent structure throughout the collaboration extension:

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "userId": "user-12345",
  "avatar": "https://example.com/avatars/jane.png",
  "color": "#ff6b6b"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name |
| `email` | string | No | Email address |
| `userId` | string | No | User identifier in an external system |
| `avatar` | string | No | URL to avatar image |
| `color` | string | No | Color for real-time cursor/highlight display (CSS color value, e.g., `"#ff6b6b"` or `"blue"`) |

The `color` field enables consistent visual identification across real-time collaboration sessions. When a user's cursor or selection is shown, implementations SHOULD use this color. If not specified, implementations SHOULD assign a consistent color based on `userId` or `email`.

### 4.4 Content Anchors

The `anchor` field uses a ContentAnchor object from the core Anchors and References specification. Block-level, point, and range anchors are supported:

```json
{ "blockId": "block-456" }
{ "blockId": "block-456", "start": 10, "end": 25 }
{ "blockId": "block-456", "offset": 15 }
```

Character offsets follow the computation rules defined in the Anchors and References specification.

### 4.5 Suggestions

```json
{
  "id": "suggestion-1",
  "type": "suggestion",
  "anchor": { "blockId": "block-789", "start": 0, "end": 5 },
  "author": { "name": "Editor" },
  "created": "2025-01-15T11:00:00Z",
  "originalText": "Hello",
  "suggestedText": "Greetings",
  "status": "pending"
}
```

Suggestion statuses: `pending`, `accepted`, `rejected`

> **Collaboration metadata is advisory and unauthenticated.** A comment's, suggestion's, or change's `author`, `content`, and `status`/resolution sit in no signature scope and are not bound by the manifest projection, so they are forgeable. A verifier MUST NOT treat a `status: accepted`, an approving comment, or a named `author` as an authenticated decision or identity — it is not a signature. To authenticate an editorial decision (an approval, a sign-off), place it in signed content or bind the approver through a required-signer policy (security extension, Identity Authority and Signature Set Integrity).

### 4.6 Reactions

```json
{
  "id": "reaction-1",
  "type": "reaction",
  "anchor": { "blockId": "block-123" },
  "author": { "name": "Reader" },
  "created": "2025-01-15T12:00:00Z",
  "emoji": "thumbsup"
}
```

Standard emoji identifiers using Unicode CLDR short names (without colons). Examples: `thumbsup`, `heart`, `thinking`, `rocket`. See the [Unicode CLDR annotations](https://cldr.unicode.org/translation/characters-emoji-symbols/short-names-and-keywords) for the canonical list.

### 4.7 Highlights

```json
{
  "id": "highlight-1",
  "type": "highlight",
  "anchor": { "blockId": "block-456", "start": 20, "end": 45 },
  "author": { "name": "Reviewer" },
  "created": "2025-01-15T14:00:00Z",
  "color": "#ffeb3b",
  "note": "Important passage to revisit"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `color` | string | No | Highlight color (CSS color value, defaults to yellow) |
| `note` | string | No | Optional note attached to the highlight |

## 5. Change Tracking

### 5.1 Overview

Track changes between document versions:

- Insertions
- Deletions
- Modifications
- Moves

### 5.2 Change Record

Location: `collaboration/changes.json`

```json
{
  "version": "0.2",
  "baseVersion": "sha256:abc123...",
  "changes": [
    {
      "id": "change-1",
      "type": "insert",
      "anchor": { "blockId": "block-new" },
      "position": { "after": "block-456" },
      "author": { "name": "Jane Doe" },
      "timestamp": "2025-01-15T10:00:00Z"
    },
    {
      "id": "change-2",
      "type": "modify",
      "anchor": { "blockId": "block-789" },
      "before": { "type": "text", "value": "old text" },
      "after": { "type": "text", "value": "new text" },
      "author": { "name": "Jane Doe" },
      "timestamp": "2025-01-15T10:01:00Z"
    }
  ]
}
```

### 5.3 Change Record Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique change identifier |
| `type` | string | Yes | Change type (see Change Types below) |
| `anchor` | ContentAnchor | Yes | Anchor to the affected content (see Anchors and References spec) |
| `position` | object | No | Position for insert/move operations (e.g., `{ "after": "block-id" }`) |
| `before` | object | No | Content state before the change (for `modify` and `delete` types) |
| `after` | object | No | Content state after the change (for `modify` and `insert` types) |
| `author` | object | Yes | Change author (see Author Object in section 4.3a) |
| `timestamp` | string | Yes | ISO 8601 change timestamp |
| `status` | string | No | Change status: `"pending"`, `"accepted"`, or `"rejected"` (default: `"pending"`) |

### 5.4 Change Types

| Type | Description |
|------|-------------|
| `insert` | New block inserted |
| `delete` | Block deleted |
| `modify` | Block content changed |
| `move` | Block moved to new position |
| `format` | Formatting changed |

### 5.5 Accepting/Rejecting Changes

Changes can be:
- `pending` - Not yet reviewed
- `accepted` - Incorporated into content
- `rejected` - Reverted

## 6. Presence Awareness

### 6.1 Overview

For real-time collaboration, track user presence:

- Who is viewing
- Who is editing
- Cursor positions
- Selection ranges

### 6.2 Presence Data

This is typically ephemeral (not stored in document), but can be synchronized:

```json
{
  "presence": [
    {
      "userId": "jane@example.com",
      "name": "Jane Doe",
      "color": "#ff6b6b",
      "cursor": { "blockId": "block-123", "offset": 42 },
      "selection": { "blockId": "block-123", "start": 40, "end": 50 },
      "lastActive": "2025-01-15T10:00:00Z"
    }
  ]
}
```

## 7. Revision History

### 7.1 Overview

Track document evolution over time:

```json
{
  "revisions": [
    {
      "version": 1,
      "documentId": "sha256:v1hash...",
      "created": "2025-01-10T08:00:00Z",
      "author": { "name": "Jane Doe" },
      "note": "Initial draft"
    },
    {
      "version": 2,
      "documentId": "sha256:v2hash...",
      "created": "2025-01-12T14:00:00Z",
      "author": { "name": "John Smith" },
      "note": "Added executive summary"
    }
  ]
}
```

### 7.2 Diff Generation

To show differences between versions:

1. Load both versions
2. Compare block trees
3. Generate change list
4. Display inline or side-by-side

## 8. Collaboration Patterns

> **Note**: This section is *informative*, not normative. Real-time synchronization protocols are implementation-defined. Implementations SHOULD use established CRDT sync protocols (e.g., [yjs-websocket](https://github.com/yjs/y-websocket), [y-webrtc](https://github.com/yjs/y-webrtc), [automerge-repo](https://github.com/automerge/automerge-repo)) rather than defining custom wire protocols.

### 8.1 Transport Options

For real-time collaboration, common transport mechanisms include:

- **WebSocket connections** — Persistent bidirectional communication
- **WebRTC data channels** — Peer-to-peer with NAT traversal
- **Server-sent events** — Server-push for read-heavy scenarios

The choice of transport is orthogonal to the CRDT format. Implementations SHOULD leverage the sync infrastructure provided by their chosen CRDT library.

### 8.2 Common Message Patterns

The following message types represent common patterns in CRDT sync protocols. These are illustrative—actual wire formats depend on the CRDT library used.

| Pattern | Direction | Description |
|---------|-----------|-------------|
| `sync-request` | Client → Server | Request current state or missing updates |
| `sync-response` | Server → Client | State snapshot or update batch |
| `update` | Bidirectional | Incremental CRDT operation(s) |
| `presence` | Bidirectional | User presence update |
| `awareness` | Bidirectional | Cursor position, selection, user info |

### 8.3 Conflict Resolution

CRDT-based collaboration handles conflicts automatically:

1. **CRDT operations** — Merge deterministically without coordination
2. **Non-CRDT metadata** — Last-write-wins or implementation-defined merge
3. **Unresolvable conflicts** — User notification (rare with CRDTs)

## 9. Examples

### 9.1 Document with Comments

```json
{
  "version": "0.2",
  "comments": [
    {
      "id": "c1",
      "type": "comment",
      "anchor": { "blockId": "intro-para" },
      "author": { "name": "Reviewer", "email": "reviewer@example.com" },
      "created": "2025-01-15T10:00:00Z",
      "content": "Consider adding more context here.",
      "resolved": false,
      "replies": [
        {
          "id": "c1-r1",
          "author": { "name": "Author" },
          "created": "2025-01-15T10:30:00Z",
          "content": "Good point, I'll expand this section."
        }
      ]
    }
  ]
}
```

### 9.2 Tracked Changes

```json
{
  "version": "0.2",
  "baseVersion": "sha256:original...",
  "changes": [
    {
      "id": "ch1",
      "type": "delete",
      "anchor": { "blockId": "old-section" },
      "author": { "name": "Editor" },
      "timestamp": "2025-01-15T11:00:00Z",
      "status": "pending"
    },
    {
      "id": "ch2",
      "type": "insert",
      "anchor": { "blockId": "new-section" },
      "position": { "after": "intro" },
      "author": { "name": "Editor" },
      "timestamp": "2025-01-15T11:05:00Z",
      "status": "accepted"
    }
  ]
}
```
