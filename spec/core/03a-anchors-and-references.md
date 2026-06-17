# Anchors and References

**Section**: Core Specification
**Version**: 0.1

## 1. Overview

Anchors provide a unified system for addressing positions within document content. They enable extensions and core features to reference specific blocks, text ranges, and named points consistently across the specification.

Anchors are used by:

- Internal links (link marks with `#` prefix in `href`)
- Collaboration extension (comments, suggestions, change tracking, presence)
- Phantom extension (off-page annotation clusters)
- Presentation extension (cross-references)
- Semantic extension (internal references)

## 2. Content Anchor Representations

The same addressing concept has two representations, chosen based on context.

### 2.1 Content Anchor URI (String Form)

Content Anchor URIs are used in marks and inline references where a compact string is appropriate.

**Syntax:**

```
#blockId              → whole block
#blockId/offset       → point within block (zero-based character offset)
#blockId/start-end    → range within block (half-open interval)
```

**Examples:**

```
#intro                → the entire "intro" block
#intro/15             → character offset 15 within "intro"
#intro/10-25          → characters 10 through 24 within "intro" (half-open)
#def-key-concept      → a named anchor mark (see section 4)
```

**Formal grammar:**

```
content-anchor-uri = "#" anchor-id [ "/" offset-or-range ]
anchor-id          = 1*( ALPHA / DIGIT / "-" / "_" / "." )
offset-or-range    = offset / range
offset             = 1*DIGIT
range              = 1*DIGIT "-" 1*DIGIT
```

The `#` prefix distinguishes internal Content Anchor URIs from external URLs.

### 2.2 ContentAnchor Object (Structured Form)

ContentAnchor objects are used in JSON data files (collaboration, phantoms, annotations) where structured data is appropriate.

**Block-level anchor:**

```json
{ "blockId": "intro" }
```

**Point anchor (character offset):**

```json
{ "blockId": "intro", "offset": 15 }
```

**Range anchor (half-open interval):**

```json
{ "blockId": "intro", "start": 10, "end": 25 }
```

**ContentAnchor fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `blockId` | string | Yes | Target block ID or named anchor ID |
| `offset` | integer | No | Zero-based character offset (point anchor) |
| `start` | integer | No | Range start (inclusive, zero-based) |
| `end` | integer | No | Range end (exclusive, zero-based) |

A ContentAnchor MUST have either no position fields (block-level), `offset` only (point), or both `start` and `end` (range). An anchor with `offset` alongside `start`/`end` is invalid.

### 2.3 ContentAnchor with Stale Detection

Anchors MAY include an optional `contentHash` field to detect when an offset-based anchor may be stale:

```json
{
  "blockId": "intro",
  "start": 10,
  "end": 25,
  "contentHash": "sha256:abc123..."
}
```

The `contentHash` is the hash of the target block's text content at anchor creation time. If the current text content no longer matches this hash, the anchor offsets may be stale.

## 3. Character Offset Computation

Character offsets address positions within a block's text content. The text content of a block is computed as follows:

1. Traverse all child nodes of the block in depth-first document order
2. For each text node, concatenate its `value` string
3. For each non-text inline child (e.g., `break`), contribute U+000A (line feed)
4. The result is the block's text content string

Offsets are zero-based. Ranges use half-open intervals: `start` is inclusive, `end` is exclusive.

**Example:**

Given a paragraph block:

```json
{
  "type": "paragraph",
  "id": "para-1",
  "children": [
    { "type": "text", "value": "Hello, " },
    { "type": "text", "value": "world", "marks": ["bold"] },
    { "type": "text", "value": "!" }
  ]
}
```

The block's text content is `"Hello, world!"` (13 characters). An anchor `{ "blockId": "para-1", "start": 7, "end": 12 }` selects `"world"`.

## 4. Named Anchor Marks

Authors can place explicit, stable anchor points within text using the `anchor` mark:

```json
{
  "type": "text",
  "value": "key concept",
  "marks": [
    { "type": "anchor", "id": "def-key-concept" }
  ]
}
```

**Anchor mark fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"anchor"` |
| `id` | string | Yes | Unique anchor identifier |

**Rules:**

- Anchor IDs share the document-wide ID namespace with block IDs
- Anchor IDs MUST be unique across both block IDs and other anchor IDs
- Anchor IDs MUST use URL-safe characters
- Named anchors can be referenced by Content Anchor URIs (e.g., `#def-key-concept`) and ContentAnchor objects (e.g., `{ "blockId": "def-key-concept" }`)

Named anchors are the preferred mechanism for positions that must survive arbitrary edits, since they move with their containing text naturally (see section 6).

## 5. Link Mark for Internal References

The existing link mark (see Content Blocks, section 4.1.2) accepts Content Anchor URIs for internal links via the `href` field:

```json
{
  "type": "text",
  "value": "See the introduction",
  "marks": [
    {
      "type": "link",
      "href": "#intro",
      "title": "Introduction"
    }
  ]
}
```

The `#` prefix distinguishes internal Content Anchor URIs from external URLs. No new field is needed — `href` values beginning with `#` are internal references.

**Additional examples:**

```json
{ "type": "link", "href": "#fig-architecture", "title": "Figure 1" }
{ "type": "link", "href": "#intro/10-25" }
```

## 6. Stability and Maintenance

### 6.1 Problem Statement

Character offsets become stale when content is edited. Inserting text before offset 42 silently shifts all downstream anchors. This section addresses how implementations should handle anchor stability across document states.

### 6.2 Immutable Documents (FROZEN/PUBLISHED)

In FROZEN and PUBLISHED states, content cannot change. Character offsets are permanently valid, and no stability concern exists.

### 6.3 Mutable Documents (DRAFT/REVIEW)

Implementations that support offset-based anchors in DRAFT or REVIEW documents SHOULD maintain an offset adjustment index when content is edited, updating anchors that reference modified blocks. The adjustment follows the same model as text editor cursor maintenance:

- **Insert** at position `p` with length `n`: Shift all offsets `≥ p` by `+n`
- **Delete** range `[p, p+n)`: Clamp offsets within the range to `p`, shift offsets `≥ p+n` by `-n`
- **Replace** range `[p, p+n)` with length `m`: Equivalent to delete `[p, p+n)` then insert at `p` with length `m`

### 6.4 Named Anchor Marks as the Stable Alternative

For positions that must survive arbitrary edits, authors SHOULD use named anchor marks (section 4) instead of offset-based anchors. Named anchors are marks on text nodes and move with their containing text naturally — they are not external offset references that require adjustment.

### 6.5 Stale Anchor Detection

Anchors MAY include an optional `contentHash` field (see section 2.3) containing the hash of the target block's text content at anchor creation time. Implementations can compare this hash against the current block text content to detect when offsets may be stale.

## 7. Validation Rules

### 7.1 Target Resolution

Implementations SHOULD validate that anchor targets (block IDs, named anchor IDs) resolve to existing content at parse time.

### 7.2 State-Dependent Severity

| Condition | DRAFT/REVIEW | FROZEN/PUBLISHED |
|-----------|--------------|------------------|
| Target block/anchor ID does not exist | Warning | Error |
| Offset/range exceeds target block text length | Warning | Error |
| Named anchor ID collides with block ID | Error | Error |

- **DRAFT/REVIEW**: Broken anchors produce a **warning** because content is fluid — targets may not yet exist or may have been recently removed.
- **FROZEN/PUBLISHED**: Broken anchors produce an **error** because content is immutable, so a broken anchor indicates corruption or invalid construction.
- Named anchor IDs that collide with block IDs MUST produce an error in all states, since the shared namespace requires uniqueness.

### 7.3 Range Validation

- `start` MUST be less than `end`
- `start` MUST be non-negative
- `offset` MUST be non-negative
- For valid ranges, `end` SHOULD NOT exceed the target block's text content length

## 8. Terminology Glossary

This section defines anchor-related terminology used throughout the specification:

| Term | Usage Context | Definition |
|------|---------------|------------|
| Content Anchor URI | Formal name | URI string referencing a content location (e.g., `#blockId/10-25`) |
| ContentAnchor | Schema object type | JSON object representing an anchor with `blockId`, `offset`, `start`, `end` fields |
| anchor | Shorthand | Informal reference to either Content Anchor URI or ContentAnchor object |
| anchor mark | Mark type | A named anchor point within text (`{ "type": "anchor", "id": "..." }`) |
| Content Anchor URI syntax | Pattern description | The `#id[/offset[-end]]` format |

### 8.1 Content Terminology

| Term | Description |
|------|-------------|
| `blocks` | Top-level array of block objects (used in root document and phantom content) |
| `children` | Nested content within a block (paragraphs, list items, etc.) |
| `content` | Plain text shorthand in specific contexts (e.g., footnote simple form) |

The distinction is intentional: `blocks` represents a document-level content array, while `children` represents nested block content.

## 9. Shared Types

### 9.1 Person Object

The Person object is a base type used across multiple extensions to represent a person (author, signer, creator). It is defined in `anchor.schema.json` for reuse across extensions.

**Base Person fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name |
| `email` | string | No | Email address (format: email) |
| `identifier` | string | No | Persistent identifier (ORCID, DID, URL, institutional ID) |

**Base example:**

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "identifier": "https://orcid.org/0000-0002-1825-0097"
}
```

For scholarly documents, the `identifier` field SHOULD use ORCID format (e.g., `https://orcid.org/0000-0002-1825-0097`).

Extensions extend the base Person type with additional fields via schema composition (`allOf`):

| Extension | Object Name | Additional Fields | Description |
|-----------|-------------|------------------|-------------|
| Collaboration | `author` | `userId`, `avatar`, `color` | Real-time collaboration identity |
| Security | `signer` | `organization`, `certificate`, `keyId` | Cryptographic identity |
| Phantoms | `author` | (none) | Basic author attribution |

All Person objects MUST include at minimum the `name` field. Extensions SHOULD include the base fields alongside their extension-specific fields. The naming distinction between "author" and "signer" is intentional to reflect the semantic difference in their contexts.

Extensions MAY add domain-specific identity fields to the Person object. The core `identifier` field remains available for persistent scholarly or decentralized identifiers. Extension-specific identity fields are additive — they do not replace `identifier`. For example, the collaboration extension adds `userId` for session-level identity, and the security extension adds `keyId` for cryptographic key association. A Person object MAY include both `identifier` and extension-specific fields simultaneously.

## 10. Relationship to Extensions

The anchor system is defined in the core specification but is primarily consumed by extensions:

| Extension | Anchor Usage |
|-----------|-------------|
| Collaboration (`cdx.collaboration`) | Comments, suggestions, change tracking, cursor/selection positions use ContentAnchor objects |
| Phantoms (`cdx.phantoms`) | Phantom clusters anchor to content via ContentAnchor objects |
| Presentation (`cdx.presentation`) | Cross-reference `target` fields use Content Anchor URI syntax |
| Semantic (`cdx.semantic`) | Internal `semantic:ref` `target` fields use Content Anchor URI syntax |

See the respective extension specifications for details.

## 11. Cross-Reference Mechanism Selection

Multiple mechanisms exist for cross-referencing within CDX documents. Use the following guidance:

| Mechanism | Extension | Use When |
|-----------|-----------|----------|
| `link` mark (with `#anchor` href) | Core | General-purpose internal links; hyperlink-style references |
| `semantic:ref` | Semantic | Scholarly cross-references (e.g., 'see Section 3', 'as shown in Figure 2') with automatic label generation |
| `presentation:reference` | Presentation | Layout-aware references that need presentation-specific formatting or page numbers |
| `academic:theoremRef` / `academic:equationRef` | Academic | References to theorems, equations, or other numbered academic elements |

For simple internal links, use the core `link` mark. For documents requiring automatic numbering and label generation (e.g., 'Figure 3', 'Theorem 2.1'), use extension-specific reference marks. When multiple reference types apply, prefer the most semantically specific mechanism.
