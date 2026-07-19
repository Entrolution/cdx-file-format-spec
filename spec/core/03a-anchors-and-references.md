# Anchors and References

**Section**: Core Specification
**Version**: 0.1
**Maturity**: Draft

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

Position fields (`offset`, `start`, `end`) are defined only when `blockId` targets a text-bearing block (section 3). When `blockId` names a named anchor rather than a block, it already denotes a specific position, so `offset`, `start`, and `end` MUST NOT be present; a named-anchor target carrying a position field is invalid. (The schema permits the field combination structurally, so a consumer enforces this as a validation rule.)

### 2.3 ContentAnchor with Stale Detection

Anchors MAY include an optional `contentHash` field to detect when an offset-based anchor may be stale:

<!-- cdx-schema: anchor.schema.json#/$defs/contentAnchor -->
```json
{
  "blockId": "intro",
  "start": 10,
  "end": 25,
  "contentHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

The `contentHash` is the hash of the target block's text content at anchor creation time. If the current text content no longer matches this hash, the anchor offsets may be stale.

## 3. Character Offset Computation

Character offsets address positions within the text content of a **text-bearing block** — a block whose `children` are text nodes (such as `paragraph`, `heading`, `figcaption`, `definitionTerm`, and `codeBlock`). The text content of such a block is computed as follows:

1. Traverse the block's text-node children in document order
2. Concatenate each text node's `value` string
3. The result is the block's text content string

A block-level element carries no inline text of its own: a `break` is a void block (Content Blocks section 4.14), not an inline child, and a container block whose children are other blocks (`list`, `listItem`, `blockquote`, `table`, and the like) has no text content of its own — its text lives in its text-bearing descendants. A character-offset anchor therefore MUST target a text-bearing block; to address text inside a container, anchor the leaf text-bearing block that holds it. This makes a block's text content well-defined for `contentHash` and offset purposes in every state.

A **character** is one Unicode scalar value (code point) — not a UTF-16 code unit and not a grapheme cluster. Offsets are zero-based code-point indices into the text content. Ranges use half-open intervals: `start` is inclusive, `end` is exclusive.

The text content is in Normalization Form C (NFC), as required of all hashed text (see Document Hashing, section 4.3); offsets are measured over that NFC text.

> **Note**: Offsets are defined over the *concatenated* text content, so they are invariant under canonical merging or splitting of adjacent text nodes — the concatenation is unchanged. A frozen anchor therefore stays valid across any text-node normalization applied before hashing.

**Example (ASCII):**

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

The block's text content is `"Hello, world!"` (13 code points). An anchor `{ "blockId": "para-1", "start": 7, "end": 12 }` selects `"world"`.

**Example (non-BMP):**

For text content `"a😀b"`, the emoji U+1F600 is a single Unicode scalar value, so the string is **3 code points**. An anchor `{ "start": 1, "end": 2 }` selects `"😀"`. A UTF-16-based implementation would count the emoji as two units and mis-target the anchor — which is why the unit is fixed to the scalar value.

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

- Anchor IDs share one document-wide identifier namespace with block IDs and with in-content sub-block IDs (academic equation-line ids and subfigure ids)
- Every ID in this namespace MUST be unique across all of block IDs, anchor IDs, equation-line ids, and subfigure ids
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

Reference resolution MUST be **byte-exact and case-sensitive**: a target id resolves to a defined id only when the two strings are byte-for-byte identical. A resolver MUST NOT case-fold, Unicode-fold, or otherwise normalize a target before matching — `#Figure1` and `#figure1` are distinct ids, and a case-insensitive resolver would let one reference silently redirect to a different block than the author (and the document hash) committed to.

### 7.2 State-Dependent Severity

| Condition | DRAFT/REVIEW | FROZEN/PUBLISHED |
|-----------|--------------|------------------|
| Target block/anchor ID does not exist | Warning | Error |
| Offset/range exceeds target block text length | Warning | Error |
| ID collides with another ID in the shared namespace | Error | Error |

- **DRAFT/REVIEW**: Broken anchors produce a **warning** because content is fluid — targets may not yet exist or may have been recently removed.
- **FROZEN/PUBLISHED**: Broken anchors produce an **error** because content is immutable, so a broken anchor indicates corruption or invalid construction.
- An ID that collides with another ID in the shared namespace — block, anchor, equation-line, or subfigure — MUST produce an error in all states, since that namespace requires uniqueness.

These severities are the WARNING and INTEGRITY-ERROR dispositions of State Machine section 5.4.

### 7.3 Range Validation

- `start` MUST be less than `end`
- `start` MUST be non-negative
- `offset` MUST be non-negative
- An `offset`, `start`, or `end` MUST NOT exceed the target block's text content length; a position past the end of the text carries the state-dependent severity of section 7.2 — a warning in DRAFT/REVIEW, an error in FROZEN/PUBLISHED

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
| `academic:theorem-ref` / `academic:equation-ref` / `academic:algorithm-ref` | Academic | References to theorems, equations, algorithms, or other numbered academic elements |

For simple internal links, use the core `link` mark. For documents requiring automatic numbering and label generation (e.g., 'Figure 3', 'Theorem 2.1'), use extension-specific reference marks. When multiple reference types apply, prefer the most semantically specific mechanism: an academic numbered element — a theorem, equation, or algorithm — is referenced with its academic `*-ref` mark, which renders the element's number, while `semantic:ref` is for general scholarly cross-references. When both could resolve the same target, the academic `*-ref` mark is authoritative for academic numbered targets and `semantic:ref` for all others, and a document SHOULD reference a given target through a single mechanism.
