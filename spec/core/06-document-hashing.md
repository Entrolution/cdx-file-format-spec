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

The hash of a document's **canonical** content IS its identity. The document ID is computed over a canonical *transform* of the stored content (section 4) — normalized, with content-referenced asset paths resolved to content hashes and author-chosen block and anchor identifiers relabeled to canonical names — so it is distinct from the file-level `content.hash` (section 5.1), which pins the exact stored bytes. This means:

- Identical canonical content produces identical IDs
- Any change to canonical content produces a different ID
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

The algorithm used to verify a document ID or hash is determined by the value's own `algorithm:` prefix (for example, `sha512:` selects SHA-512); a verifier MUST use that algorithm and never a hardcoded default. The manifest's `hashAlgorithm`, when present, MUST equal the `id` prefix; when omitted it defaults to `sha256` for the declared field, but verification still follows the `id` prefix rather than this default.

## 4. Document ID Computation

### 4.1 What Is Hashed

The document ID is computed from a **canonical representation** of the document's semantic content and essential metadata:

```
Document ID = Hash(CanonicalContent)
```

The canonical content includes:
1. Content blocks (semantic content), with each content-referenced asset path replaced by that asset's content hash — binding a referenced asset's bytes to identity, but not its filename (see section 4.3)
2. Essential metadata (the Dublin Core projection)

The canonical content EXCLUDES:
- Presentation layers (visual rendering, not part of content identity)
- Precise layouts (rendering fidelity, not part of content identity)
- Timestamps (administrative, change on every edit)
- Security data (signatures reference the hash, not part of it)
- Collaboration data (comments, change tracking)
- Phantom data (off-page annotations)
- Form data (`forms/data.json` — filled values are mutable even on frozen documents)
- Derived fields carried inside content blocks: `measurement.display` (a human-readable rendering of the value) and `codeBlock.tokens` (regenerable syntax highlighting), which have no canonical form. Because they are excluded, no signature attests them, so a renderer MUST derive what it presents from the hashed source — the measurement `value`/`unit`, the code-block `children` — and MUST NOT present the stored `display`/`tokens` as authoritative (Content Blocks section 4.7, Content Blocks section 4.16; Renderer Safety section 6)
- Fonts and other packaged assets not referenced from content (referenced only by the presentation layer); only content-referenced assets are bound to identity

> **Metadata inclusion**: The Dublin Core terms included in the hash are `title`, `creator`, `subject`, `description`, and `language`. Administrative terms (`date`, `publisher`, `identifier`, `rights`) and the structured `creators` array are excluded. See Metadata specification, section 6 for details.

> **Note**: The document ID represents the document's semantic identity — what it says, not how it looks. Multiple visual presentations (letter, A4, responsive) of the same content produce the same document ID. For appearance attestation, see Scoped Signatures in the Security Extension.

> **Out-of-hash assets are still attested.** Excluding fonts and non-content-referenced assets from the document ID keeps identity semantic, but it does not leave them unauthenticated. Each declared asset category's index file is hash-pinned by the manifest (`assets.<category>.hash`, Asset Embedding section 3.1), and a scoped signature that covers the manifest projection binds those index hashes (Security Extension section 9.7). Because the index enumerates every asset's and image variant's own hash, a swapped font or variant is tamper-evident on a `frozen` or `published` document — where a manifest-covering signature is mandatory — even though it never changes the document ID.

### 4.1a Hash Boundary Summary

The following table summarizes what is included in and excluded from the document content hash:

| Layer | Inside Hash | Notes |
|-------|-------------|-------|
| Content blocks | Yes | Core document identity — all text, structure, and semantic markup |
| Dublin Core metadata | Partial | Only the projection: `title`, `creator`, `subject`, `description`, `language` (structured `creators` excluded) |
| Content-referenced asset content | Yes (by hash) | Each content asset reference (e.g. an image `src`) is resolved to the asset's content hash, binding the asset's bytes — not its filename — to identity |
| Asset filenames / paths | No | Resolved away to content hashes; renaming a referenced asset's file does not change the ID |
| Block & anchor id labels | Canonicalized | Relabeled to position-based names (`b0`, `b1`, …); the author's chosen label does not change the ID, and references to it are rewritten to match (section 4.3.1) |
| Fonts & non-content-referenced assets | No | Packaged assets referenced only by the presentation layer (e.g. fonts by family name) are not part of semantic identity; they are still tamper-evident via the hash-pinned asset index bound in the manifest projection (Security Extension section 9.7) |
| Derived content fields | No | `measurement.display` (free-form) and `codeBlock.tokens` (regenerable) — presentational, no canonical form; stripped before hashing. Attested by no signature, so a renderer MUST derive what it shows from the hashed source and MUST NOT present the stored copy as authoritative (Renderer Safety section 6) |
| Presentation | No | Visual rendering instructions — not part of semantic identity |
| Precise layouts | No | Coordinate-level positioning — rendering fidelity; tamper-evident when declared in `presentation[]` (type `precise`) via the file hash bound in the manifest projection (Security Extension section 9.7) |
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
  "content": { /* canonicalized content tree (see 4.3) */ },
  "metadata": { /* Dublin Core projection (see 4.3) */ }
}
```

The canonical structure has exactly two slots, both always present:

- `content` — the content tree (`content/document.json`, including its own `version`) after the content canonicalization of section 4.3.
- `metadata` — the Dublin Core projection of section 4.3 (an empty object `{}` when no projected term survives).

There is no separate asset-hash slot: content-referenced assets are bound by resolving their references to content hashes inside `content`. There is no top-level `version`; the content's own `version` is retained inside `content`.

### 4.3 Canonicalization Rules

These rules are normative: every conformant implementation MUST produce identical bytes for identical canonical content. Canonicalization has two stages — first construct the canonical structure (4.3.1), then serialize it (4.3.2).

#### 4.3.1 Constructing the Canonical Content

The canonical content is a *transform* of the stored parts; the stored files are never modified. Build the two-slot structure of section 4.2 as follows.

**Metadata projection.** From `metadata/dublin-core.json`, take the `terms` object and keep exactly `title`, `creator`, `subject`, `description`, and `language`, flattened to a `{term: value}` object (the `{version, terms}` wrapper and every other term — including the structured `creators` — are dropped). `title` and `description` are strings; `creator`, `subject`, and `language` are arrays (a scalar value is coerced to a one-element array). A term is omitted entirely when it is absent or wholly empty (`""` or `[]`); non-empty array elements are preserved verbatim, in authored order, and an empty (`""`) element inside an otherwise non-empty array is dropped (a term whose elements are all empty is likewise omitted). (`title` and `creator` are required and non-empty, so they always survive.)

**Content transforms.** Apply to `content/document.json`, uniformly across all block types including `namespace:type` extension blocks:

1. **Strip non-content fields**: remove `measurement.display` and `codeBlock.tokens` (presentational/regenerable; no canonical form), and any `crdt` field carried on a block or text node (transient collaboration synchronization state, excluded per section 4.1a).
2. **Resolve asset references**: replace every content-level asset *path* reference — an `image.src`, `svg.src`, or `signature.image`, or an archive-relative `href` on a `link` mark — with the referenced asset's content hash (`algorithm:hexdigest`). A reference resolves iff, after path normalization (no `.` or `..` segments; case-sensitive), it equals an asset's archive path — that asset's category directory (`assets/` followed by its category, i.e. the key under `manifest.assets` that registers it: the standard `images`, `fonts`, or `embeds`, or any additional category) joined with the asset's index `path` (Asset Embedding, section 3). The following are not asset paths and are left verbatim: an `href` beginning with `#` (an internal Content Anchor reference), a reference marked `external`, and any reference carrying a URL scheme (e.g. `https://`); an `svg` with inline `content` and no `src` has nothing to resolve; and an `image.fallback` path is left verbatim, being a backup rather than the bound resource. A reference beginning with `assets/` that matches no registered asset is a canonicalization error. The document ID thereby inherits the integrity of the asset index `hash` values, which MUST be verified against the asset bytes (Asset Embedding, section 8) before the ID can be trusted.
3. **Normalize marks**: within each text node, sort the `marks` array by each mark's JCS serialization (UTF-16 code-unit comparison — so bare formatting marks such as `"bold"` sort before structured marks such as `{"type":"link",…}`), remove marks with identical JCS serialization (deduplicate), and omit the `marks` key entirely when the array is empty (absent ≡ `[]`). Mark order is not semantic.
4. **Merge text nodes**: merge adjacent sibling text nodes that have no intervening non-text inline child and identical canonical mark-sets, concatenating their `value`s. Only a text node whose sole keys are `type`, `value`, and `marks` (after the step 1 stripping) is merge-eligible; a text node that also carries an `id`, `attributes`, or any other field is preserved unchanged and acts as a boundary, so no identifier or annotation is dropped. Offsets are defined over the concatenated text content (Anchors and References, section 3), so this moves no anchor.
5. **Canonicalize identifiers**: relabel author-chosen identifiers to position-based canonical names, so that two documents differing only in their id *labels* produce the same document ID. The relabeled namespace is the shared identifier namespace (Anchors and References, section 4): the `id` of every block (including `namespace:type` extension blocks), the `id` of every `anchor` mark, and the `id` of every in-content sub-block element that carries one — an academic equation line and a `subfigure` — even though those carry no block `type`. These sub-block elements are the array items of an equation group's `lines` and a figure's `subfigures` — the exhaustive set of relabeled sub-block id arrays. Membership is keyed on WHERE an id sits (the enclosing field), not merely on whether the node has a `type` or is an array item: an id-bearing object an extension block carries in its own data array (any array other than `lines`/`subfigures`) is left as authored, even when shaped like a namespace member. In particular a `semantic:bibliography` entry's `id` — a CSL citation key in an `entries` array, referenced by a `citation` mark's `refs` (below) — is not relabeled, though the entry carries a CSL `type` that makes it resemble a block. Likewise an identifier carried on a singular named sub-object — such as a signature block's `signer` `id`, a Person identifier rather than a content-anchor target — is not part of this namespace. Walk the canonical content depth-first — at each node assigning a name to the node's own `id` (if any) before recursing into its members (object members in JCS key order, array elements in index order) — and give each id-defining occurrence the next name in the sequence `b0`, `b1`, `b2`, …; a duplicate id within this namespace is a canonicalization error. Then rewrite every Content Anchor URI reference (`#id`, optionally followed by `/offset` or `/start-end`) whose id is one of these names — preserving the suffix — in the following reference fields: a `link` mark `href`; the `academic:theorem-ref`, `academic:equation-ref`, and `academic:algorithm-ref` mark `target`; the `academic:theorem` `uses`; the `academic:proof` `of`; and the `semantic:ref` and `presentation:reference` block `target`. A Content Anchor URI whose id is not a relabeled id — for example a cross-document anchor — is left unchanged, except that such an unresolved reference MUST NOT itself spell a canonical name (`b` followed by digits): an unresolved `#b0` is a canonicalization error, because left unchanged it would be indistinguishable from a reference that resolved to that block, collapsing two distinct documents onto one ID. Because relabeling an `anchor` id or a `link` `href` changes that mark's serialization, the marks of any affected text node are re-sorted and de-duplicated (item 3) after rewriting.

   The following are left as authored, so a document that differs only in one of these labels is not yet guaranteed to share a document ID: the reference fields that address other namespaces — the `footnote` mark `id`, the `glossary` mark `ref`, `semantic:term` `see`, `citation` `refs`, `entity` `uri`, `index` `term`, and the `academic:algorithm-ref` `line` (a label into an algorithm's line numbering, not an `id`). Equation-line ids and subfigure ids are not in this set: they share the relabeled uniqueness namespace described above. An extension block such as `semantic:footnote` or `semantic:term` still has its own block `id` relabeled like any other block id; only the references into those namespaces are left unchanged. (A single text node is expected to carry at most one `anchor` mark; canonical names for multiple anchors on one node depend on their canonical mark order.)
6. **Preserve everything else as authored**: no other field is added, removed, defaulted, or coalesced. In particular `null` and absent are distinct, and JSON-Schema `default`s (such as `colspan`) are never materialized into hashed content.

#### 4.3.2 Serialization

1. **JSON Canonicalization**: Serialize using [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JCS). In particular:
   - Object keys are sorted by UTF-16 code unit, as mandated by JCS
   - No insignificant whitespace
   - Numbers are serialized per RFC 8785, which mandates the ECMAScript `Number.prototype.toString` algorithm over IEEE-754 double-precision values. Negative zero (`-0`) MUST be serialized as `0`. All hashed numbers are treated as IEEE-754 doubles, so producers MUST NOT rely on numeric precision beyond what a double round-trips; integers in hashed content MUST have magnitude at most 2^53 - 1 (the safe-integer limit).
   - Strings are escaped per RFC 8785

2. **Unicode Normalization**: Producers MUST emit all object keys and string values in Normalization Form C (NFC) and as well-formed Unicode (no unpaired surrogate code points). This applies to the concatenated text content of each block (see Anchors and References, section 3), not merely to individual text-node values: an NFC-combining sequence MUST NOT be split across text-node boundaries. NFC is a property of the stored bytes, not a hash-time transform — implementations MUST NOT normalize while computing a hash, so the stored and hashed bytes are always identical. Content that is not already NFC is non-conformant.

3. **Duplicate Keys**: Any JSON object with duplicate keys MUST be rejected before hashing or verification, in every document state. RFC 8259 parsers disagree on duplicate keys (first wins, last wins, or reject), so an unrejected duplicate lets a signer and a consumer read different values from one signed document (a split-view substitution).

> **Note**: Because JCS sorts all object keys, the order in which fields are written when authoring a document has no effect on its hash — content may be authored in any field order. The worked example below shows authored input being reordered into canonical JCS form.

### 4.4 Computation Steps

```
1. Project the Dublin Core metadata (section 4.3.1)
2. Construct the canonical content tree: strip derived fields, resolve asset references to content hashes, normalize marks, merge text nodes, canonicalize identifiers (section 4.3.1)
3. Build the two-slot canonical structure { content, metadata } (section 4.2)
4. Serialize using JCS (section 4.3.2)
5. Hash the serialized bytes with the algorithm named by the document id prefix
6. Format as "algorithm:hexdigest"
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
  "version": "1.1",
  "terms": { "title": "Test Document", "creator": "Jane Doe" }
}
```

Canonical form (JCS serialized, shown formatted for readability):

```json
{"content":{"blocks":[{"children":[{"type":"text","value":"Hello"}],"level":1,"type":"heading"}],"version":"0.1"},"metadata":{"creator":["Jane Doe"],"title":"Test Document"}}
```

Hash: `sha256:12768052d53d60d457ab47514ddd8be3087dd7d66a1a9dcc984eceec83f6ae70` (computed from the JCS-serialized bytes)

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

These hashes are computed from the raw asset bytes. When a content block references an asset, canonicalization resolves the reference to this hash (section 4.3.1), binding the asset's content — not its filename — to the document ID. An asset that no content block references does not affect the document ID.

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
4. On mismatch, apply the state-keyed disposition (section 6.3; State Machine section 5.4)

**Document-level verification:**
1. Verify all file hashes
2. Recompute document ID from canonical content
3. Compare with ID in manifest
4. On mismatch, apply the state-keyed disposition (section 6.3; State Machine section 5.4)

### 6.3 Hash Mismatch Handling

| Document State | Hash Mismatch Action |
|----------------|---------------------|
| draft | Warning (content may have been edited externally) |
| review | Warning |
| frozen | Error (document integrity compromised) |
| published | Error (document integrity compromised) |

For frozen/published documents, hash mismatches indicate tampering or corruption. The frozen/published *Error* disposition is the INTEGRITY-ERROR of State Machine section 5.4: the document MUST NOT be presented as valid and MUST NOT be edited in place, but MAY be shown read-only behind a prominent integrity warning.

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

The document ID MUST be (re)computed when the document state transitions from `draft` to `review`. A document MUST NOT enter `review` (or any later state) carrying a `pending` or stale ID.

The document ID SHOULD additionally be computed when:

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
{"content":{"blocks":[{"children":[{"type":"text","value":"Hello"}],"type":"paragraph"}],"version":"0.1"},"metadata":{}}
```

### 11.2 Document with Assets

```json
{
  "content": {
    "blocks": [ /* ... each image block's "src" is resolved to the asset's content hash ... */ ],
    "version": "0.1"
  },
  "metadata": {
    "creator": ["Finance Team"],
    "title": "Annual Report"
  }
}
```

### 11.3 Verification Code (Pseudocode)

*Non-normative illustration; the normative algorithm is the set of rules in section 4.3.*

```javascript
function verifyDocument(archive) {
  // 1. Load manifest
  const manifest = parseJSON(archive.read("manifest.json"))

  // 2. Verify file hashes (algorithm from each hash's own prefix)
  for (const fileRef of getAllFileRefs(manifest)) {
    const fileBytes = archive.read(fileRef.path)
    const computedHash = hash(algorithmOf(fileRef.hash), fileBytes)
    if (computedHash !== fileRef.hash) {
      throw new Error(`File hash mismatch: ${fileRef.path}`)
    }
  }

  // 3. Recompute the document ID from canonical content
  const algorithm = algorithmOf(manifest.id)        // derived from the id prefix
  if (manifest.hashAlgorithm && manifest.hashAlgorithm !== algorithm) {
    throw new Error(`hashAlgorithm does not match id prefix`)
  }

  // strip derived fields + crdt, resolve asset refs -> content hash, normalize + merge marks, relabel ids (4.3.1)
  const content = canonicalizeContent(parseJSON(archive.read(manifest.content.path)),
                                      archive, manifest)
  // keep + flatten the five terms, always-array, omit empty (4.3.1)
  const metadata = projectMetadata(parseJSON(archive.read(manifest.metadata.dublinCore)))

  const canonical = { content, metadata }           // two slots, always present
  const canonicalBytes = JCS.serialize(canonical)
  const computedId = algorithm + ":" + hashHex(algorithm, canonicalBytes)

  if (manifest.id !== "pending" && computedId !== manifest.id) {
    throw new Error(`Document ID mismatch`)
  }

  return true
}
```
