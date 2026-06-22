# Provenance and Lineage

**Section**: Core Specification
**Version**: 0.1

## 1. Overview

CDX documents form a cryptographic chain through content-addressable hashing and lineage pointers. This enables:

- Tamper-evident document history
- Verifiable lineage *consistency* (a resolvable ancestor chain, checked for tampering — Section 3.3)
- Block-level provenance proofs
- Partial disclosure with integrity guarantees
- Decentralized verification without central authority

## 2. Design Principles

### 2.1 Documents as a Hash Chain

Each CDX document's identity IS its content hash. When a document references its parent by hash, it creates an immutable link:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Document v1     │     │ Document v2     │     │ Document v3     │
│                 │     │                 │     │                 │
│ id: sha256:aaa  │◄────│ id: sha256:bbb  │◄────│ id: sha256:ccc  │
│ parent: null    │     │ parent: aaa     │     │ parent: bbb     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

**Properties:**
- A child's `parent` is a content hash, so a child provably references *that exact parent's content* — it cannot point at a parent that does not exist as content.
- A forged *intermediate* is detectable **when the chain is resolved**: a resolved parent's committed ancestor chain must match the child's (Section 3.3).
- No external *registry* is required, but verifying ancestry requires the ancestor documents themselves, resolved from a verifier-supplied content-addressed store (Section 3.3).

**Limits (what this does NOT prove).** Lineage is **child-asserted**: a `parent`/`ancestors` pointer records only that the child's author *wrote down* that hash, not descent. A parent created before its children cannot commit to them, so forward-links are not achievable, and an ancestor a verifier cannot resolve is **unverified, never endorsed**. Authenticating the pointers themselves rests on the **signed manifest projection** (the security extension binds `manifest.lineage`), not on this chain. Stronger provable-descent mechanisms — a parent-issued *supersedes* attestation (mutual attestation), or an append-only transparency log (non-equivocation) — are deliberate **non-goals** of this no-external-infrastructure design.

### 2.2 Block-Level Provenance

Beyond document-level hashing, individual content blocks have their own hashes. This enables:

- Proving a specific block existed in a document
- Selective disclosure (reveal one section, prove it's authentic)
- Efficient change detection (which blocks changed?)
- Redaction proofs (prove what was removed)

## 3. Document Hash Chain

### 3.1 Chain Structure

The provenance lineage extends the manifest's summary lineage (which contains `parent`, `version`, `branch`, `note`) with additional fields for the full ancestor chain, depth, and merge history. The manifest provides quick access to the immediate parent and version; the provenance record provides the complete lineage for verification and auditing.

The provenance lineage:

```json
{
  "lineage": {
    "parent": "sha256:abc123...",
    "ancestors": [
      "sha256:abc123...",
      "sha256:def456...",
      "sha256:789ghi..."
    ],
    "version": 4,
    "depth": 4
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `parent` | string | No | Immediate parent document hash |
| `ancestors` | array | No | Chain of ancestor hashes (nearest first) |
| `version` | integer | No | Sequential version number |
| `depth` | integer | No | Distance from root document |

### 3.2 Ancestor Chain

The `ancestors` array is an **advisory** redundancy / fast-path hint, nearest-first. It is authoritative ONLY where a resolved parent corroborates it (Section 3.3): a verifier MUST NOT present an `ancestors` entry as a verified ancestor on the strength of the array alone.

```json
{
  "ancestors": [
    "sha256:parent...",
    "sha256:grandparent...",
    "sha256:greatgrandparent...",
    "sha256:root..."
  ]
}
```

**Rules:**
- Ordering is **nearest-first and significant**: `ancestors[0]` MUST equal `parent`, `ancestors[1]` the grandparent, and so on.
- A document's `ancestors` MUST equal `[parent] ++ parent.ancestors` over the range the parent committed to; Section 3.3 cross-checks this, and a contradiction is **rejected**.
- The array MAY be truncated to a stored depth (recommended 10–20). Entries beyond a resolved parent's committed range are advisory and are verified only if the verifier resolves them.
- An empty (or omitted) `ancestors` with `parent: null` indicates a root document; a non-empty `ancestors` on a root is inconsistent (Section 3.3).

### 3.3 Chain Verification

Lineage verification resolves the chain **backwards** from a subject document and assigns one of three outcomes. The resolved walk is authoritative; the `ancestors` array (Section 3.2) is only an advisory cross-check.

**Outcomes.**
- **VERIFIED** — the walk reached a root (`parent: null`) with every link resolved and consistent.
- **INCOMPLETE** — a link could not be resolved, or the traversal bound was reached. The chain is not contradicted but cannot be fully walked. INCOMPLETE is **not** "valid": a verifier MUST NOT present any ancestor beyond the break as verified, and MUST NOT treat an INCOMPLETE chain as authenticated ancestry.
- **REJECTED** — a proven inconsistency (below). The lineage MUST be treated as forged/broken.

**Ancestor resolution.** Ancestors are resolved from a **verifier-supplied content-addressed store** (an archive, a local cache, a configured registry) — never from a document-supplied URL or locator. A verifier recomputes each resolved document's content hash and confirms it equals the id it was resolved for (in a content-addressed store this holds by construction). A parent that cannot be resolved yields INCOMPLETE.

**Algorithm.**

```
verify(subject):
  visited = {}
  node = subject; depth = 0
  loop:
    if node.id in visited: return REJECTED            // cycle
    visited += node.id;  depth += 1
    if node.parent == null:
      if node.ancestors is non-empty: return REJECTED // a root has no ancestors
      return VERIFIED
    if depth >= traversalBound: return INCOMPLETE      // honest deep history, not an error
    parent = resolve(node.parent)
    if parent == null: return INCOMPLETE               // unresolvable; no claim beyond here
    if node.ancestors is present:
      if node.ancestors[0] != node.parent: return REJECTED
      expected = [node.parent] ++ parent.ancestors
      if node.ancestors and expected differ on any shared index: return REJECTED  // forged tail
    node = parent
```

**Rejection conditions (a proven inconsistency):**
- A **cycle** — a content-addressed chain cannot revisit an id (a document cannot be its own ancestor).
- A **forged tail** — an `ancestors` entry that contradicts the resolved parent's committed chain over their shared range, or `ancestors[0] != parent`.
- A **root with ancestors** — `parent: null` alongside a non-empty `ancestors`.

A forged ancestor *beyond* a resolved parent's committed range is not rejected — it is simply **unverified** (the parent never vouched for it). The authoritative chain is the resolved walk, not the array, so such an entry is ignored, never endorsed.

**Traversal bound (cycle / DoS safety).** A verifier MUST bound the walk; reaching the bound yields INCOMPLETE — never REJECTED, since a legitimately deep history is not an inconsistency. The bound is a verifier configuration; a conforming verifier MUST support a bound of at least **64** links and MAY allow a larger one. Cycle detection is separate and always rejects.

**`depth` and `version` are advisory.** A verifier recomputes the chain depth from the resolved walk; a document's *claimed* `depth` and `version` are cross-checked only as warnings, never as rejection conditions. A hard `parent + 1` rule would reject legitimate branching (Section 3.4) and honest authoring mistakes: `depth` derives structurally from the resolved chain, and `version` is author-assigned and advisory.

**Merges.** A `mergedFrom` entry (Section 3.4) is **verified like a `parent`**: each merge parent MUST resolve (else INCOMPLETE) and is itself chain-checked by this procedure, so a merge parent that is unresolvable, forged, or internally inconsistent makes the merge child INCOMPLETE or REJECTED — never VERIFIED. (A merge diamond — a shared ancestor reached by two paths — is not a cycle.) A merge child's `depth` derives as `max(parents.depth) + 1`; its `version` is advisory (a merge has no single predecessor).

**What verification does NOT establish.** A VERIFIED chain proves the links are *consistent and resolvable*, not that the subject genuinely *descended* from its claimed ancestors (lineage is child-asserted — Section 2.1). Authenticated lineage requires the **signed** copy: the security extension binds `manifest.lineage` into a frozen/published document's signatures (the manifest projection), so on a signed document the manifest's lineage is tamper-evident. The provenance record's lineage (Section 8.1) is path-only and **unsigned**; an author who wants a signed ancestor chain SHOULD place `ancestors` in `manifest.lineage` (which the projection binds), not only in the provenance record. The `derivedFrom` pointers (Section 8.1) carry the same child-asserted caveat and have no signed copy.

### 3.4 Branching and Merging

Multiple documents may share the same parent (branching):

```
           ┌─── sha256:branch-a (parent: root)
sha256:root┤
           └─── sha256:branch-b (parent: root)
```

The lineage can track branch information:

```json
{
  "lineage": {
    "parent": "sha256:root...",
    "branch": "feature-x",
    "mergedFrom": ["sha256:branch-b..."]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `branch` | string | Branch identifier |
| `mergedFrom` | array | Document hashes merged into this version |

Branching is legitimate — two children may share a parent — so `version` is **not** globally monotonic and is advisory (Section 3.3). A merge's parents (`parent` plus each `mergedFrom` entry) are each resolved and verified per Section 3.3; the merge's `depth` derives as `max(parents.depth) + 1`.

## 4. Block-Level Hashing (Merkle Tree)

### 4.1 Merkle Tree Structure

Content blocks form a Merkle tree, enabling efficient proofs:

```
                    ┌─────────────────┐
                    │   Root Hash     │
                    │   (in manifest) │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
       ┌──────┴──────┐               ┌──────┴──────┐
       │  Hash(L+R)  │               │  Hash(L+R)  │
       └──────┬──────┘               └──────┬──────┘
              │                             │
       ┌──────┴──────┐               ┌──────┴──────┐
       │             │               │             │
   ┌───┴───┐    ┌───┴───┐       ┌───┴───┐    ┌───┴───┐
   │Block 1│    │Block 2│       │Block 3│    │Block 4│
   └───────┘    └───────┘       └───────┘    └───────┘
```

### 4.2 Block Hash Computation

Each block's hash is computed from its canonical JSON representation:

```
BlockHash = SHA256(CanonicalJSON(block))
```

Where canonical JSON follows RFC 8785 (JCS):
- Keys sorted by UTF-16 code unit (per JCS)
- No whitespace
- Deterministic number formatting (per RFC 8785)

### 4.3 Tree Construction

```
1. Compute hash of each content block
2. If odd number of blocks, duplicate last hash
3. Pair hashes and compute parent: Hash(left + right)
4. Repeat until single root hash remains
5. Store root hash in manifest
```

### 4.4 Manifest Integration

```json
{
  "content": {
    "path": "content/document.json",
    "hash": "sha256:contenthash...",
    "merkleRoot": "sha256:merkleroot...",
    "blockCount": 42
  }
}
```

### 4.5 Block Index

For efficient proof generation, store block hashes:

Location: `content/block-index.json`

```json
{
  "version": "0.1",
  "algorithm": "sha256",
  "root": "sha256:merkleroot...",
  "blocks": [
    {
      "id": "block-1",
      "hash": "sha256:blockhash1...",
      "index": 0
    },
    {
      "id": "block-2",
      "hash": "sha256:blockhash2...",
      "index": 1
    }
  ]
}
```

## 5. Merkle Proofs

### 5.1 Inclusion Proofs

Prove a block exists in a document without revealing other blocks:

```json
{
  "proof": {
    "type": "inclusion",
    "documentId": "sha256:docid...",
    "merkleRoot": "sha256:root...",
    "block": {
      "id": "block-5",
      "hash": "sha256:blockhash...",
      "index": 4
    },
    "path": [
      { "position": "right", "hash": "sha256:sibling1..." },
      { "position": "left", "hash": "sha256:sibling2..." },
      { "position": "right", "hash": "sha256:sibling3..." }
    ]
  }
}
```

### 5.2 Proof Verification

```
1. Start with block hash
2. For each path element:
   a. If position is "left": hash = Hash(element.hash + hash)
   b. If position is "right": hash = Hash(hash + element.hash)
3. Final hash must equal merkleRoot
4. merkleRoot must match document's manifest
```

### 5.3 Exclusion Proofs

Prove a block does NOT exist (useful for redaction verification):

```json
{
  "proof": {
    "type": "exclusion",
    "documentId": "sha256:docid...",
    "merkleRoot": "sha256:root...",
    "removedBlockHash": "sha256:removed...",
    "adjacentBlocks": [
      { "index": 3, "hash": "sha256:before..." },
      { "index": 5, "hash": "sha256:after..." }
    ],
    "path": [...]
  }
}
```

### 5.4 Redaction Proofs

When content is redacted, prove the relationship between original and redacted:

```json
{
  "redaction": {
    "originalDocument": "sha256:original...",
    "redactedDocument": "sha256:redacted...",
    "removedBlocks": [
      {
        "id": "confidential-section",
        "originalIndex": 5,
        "proof": { /* inclusion proof in original */ }
      }
    ],
    "retainedBlocks": [
      {
        "id": "public-section",
        "proof": { /* inclusion proof in both */ }
      }
    ]
  }
}
```

## 6. Timestamp Anchoring

### 6.1 Purpose

While the hash chain proves relative ordering (A before B), timestamp anchoring proves absolute time ("hash H existed at time T").

### 6.2 RFC 3161 Timestamps

Traditional trusted timestamp authorities:

```json
{
  "timestamps": [
    {
      "type": "rfc3161",
      "authority": "https://timestamp.digicert.com",
      "time": "2025-01-15T10:00:00Z",
      "hash": "sha256:docid...",
      "token": "MIIEpgYJKoZI..."
    }
  ]
}
```

### 6.3 Blockchain Anchoring

Decentralized timestamping via public blockchains:

```json
{
  "timestamps": [
    {
      "type": "blockchain",
      "chain": "bitcoin",
      "blockHeight": 850000,
      "blockHash": "00000000000000000002a7c4...",
      "txId": "abc123...",
      "merkleProof": [...],
      "time": "2025-01-15T10:05:00Z",
      "hash": "sha256:docid..."
    }
  ]
}
```

**Supported chains:**
- `bitcoin` — Most secure, ~10 minute blocks
- `ethereum` — ~12 second blocks

**Note:** This only stores a hash on-chain, not the document. The blockchain provides timestamping, not storage.

### 6.4 Aggregated Anchoring

For efficiency, multiple document hashes can be combined:

```json
{
  "timestamps": [
    {
      "type": "aggregated",
      "provider": "opentimestamps.org",
      "calendar": "https://alice.btc.calendar.opentimestamps.org",
      "merkleRoot": "sha256:aggregateroot...",
      "proof": {
        "documentHash": "sha256:docid...",
        "path": [...]
      },
      "anchor": {
        "chain": "bitcoin",
        "blockHeight": 850000,
        "txId": "abc123..."
      }
    }
  ]
}
```

This allows timestamping many documents in one blockchain transaction.

## 7. Cross-Document References

### 7.1 Hash References

Documents can reference other documents by hash:

```json
{
  "type": "reference",
  "documentId": "sha256:otherdoc...",
  "blockId": "section-3",
  "description": "See related analysis"
}
```

This creates a verifiable link — the referenced document cannot change without breaking the reference.

### 7.2 Citation Chains

Academic/legal citations can form their own provenance chain:

```json
{
  "citations": [
    {
      "id": "cite-1",
      "target": {
        "documentId": "sha256:sourcedoc...",
        "blockId": "theorem-1"
      },
      "context": "As proven in [1]..."
    }
  ]
}
```

## 8. Provenance Metadata

### 8.1 Document Provenance Record

Location: `provenance/record.json`

```json
{
  "version": "0.1",
  "documentId": "sha256:current...",
  "created": "2025-01-15T10:00:00Z",
  "creator": {
    "name": "Jane Doe",
    "identifier": "did:web:example.com:jane"
  },
  "lineage": {
    "parent": "sha256:parent...",
    "ancestors": ["sha256:parent...", "sha256:grandparent..."],
    "depth": 3
  },
  "merkle": {
    "root": "sha256:merkleroot...",
    "blockCount": 42,
    "algorithm": "sha256"
  },
  "timestamps": [...],
  "derivedFrom": [
    {
      "documentId": "sha256:source1...",
      "relationship": "excerpt",
      "blocks": ["block-5", "block-6"]
    }
  ]
}
```

### 8.2 Provenance Queries

The provenance record enables queries like:

- "Show me all ancestors of this document"
- "When was this document first timestamped?"
- "Prove block X existed in document Y"
- "What documents cite this one?" (requires external index)

## 9. Implementation Notes

### 9.1 Performance Considerations

- **Merkle tree construction**: O(n) where n = number of blocks
- **Proof generation**: O(log n)
- **Proof verification**: O(log n)
- **Chain traversal**: O(depth) — store ancestors to avoid repeated fetches

### 9.2 Storage Efficiency

- Block index adds ~50-100 bytes per block
- Merkle proofs are O(log n) hashes (~32 bytes each for SHA-256)
- Ancestor chain capped at reasonable depth (10-20) to limit growth

### 9.3 Lazy Computation

- Merkle tree can be computed on-demand
- Block index can be generated when needed
- Only root hash is required in manifest

## 10. Security Considerations

### 10.1 Hash Algorithm Strength

The chain's security depends on hash collision resistance:
- SHA-256: ~128 bits security (quantum), ~256 bits (classical)
- Recommend migration path if hash weaknesses discovered

### 10.2 Timestamp Trust

- RFC 3161: Trust depends on TSA integrity
- Blockchain: Trust depends on chain security (Bitcoin = very high)
- Aggregated: Trust depends on aggregator + anchor chain

### 10.3 Lineage Gaps

If an ancestor cannot be resolved, chain verification is **INCOMPLETE**, not "valid" (Section 3.3):
- The walk stops at the unresolvable link; no ancestor beyond it is verified.
- An INCOMPLETE chain MUST NOT be presented as authenticated ancestry, and a verifier MUST NOT endorse the unverified `ancestors` entries — an attacker can force INCOMPLETE by referencing an unresolvable parent, leaving a fabricated tail unchecked.
- Archive full chains (and place `ancestors` in the signed `manifest.lineage`) for documents whose ancestry must be verifiable offline.

## 11. Examples

### 11.1 Simple Lineage

```json
{
  "cdx": "0.1",
  "id": "sha256:abc123...",
  "state": "frozen",
  "lineage": {
    "parent": "sha256:parent...",
    "version": 3
  }
}
```

### 11.2 Full Provenance Record

```json
{
  "version": "0.1",
  "documentId": "sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
  "created": "2025-01-15T10:00:00Z",
  "creator": {
    "name": "Research Team",
    "identifier": "did:web:university.edu:research"
  },
  "lineage": {
    "parent": "sha256:v2hash...",
    "ancestors": [
      "sha256:v2hash...",
      "sha256:v1hash...",
      "sha256:originalhash..."
    ],
    "depth": 4,
    "branch": "main"
  },
  "merkle": {
    "root": "sha256:merkleroot...",
    "blockCount": 127,
    "algorithm": "sha256"
  },
  "timestamps": [
    {
      "type": "rfc3161",
      "authority": "https://timestamp.university.edu",
      "time": "2025-01-15T10:00:05Z",
      "token": "..."
    },
    {
      "type": "blockchain",
      "chain": "bitcoin",
      "blockHeight": 880000,
      "time": "2025-01-15T10:15:00Z",
      "txId": "..."
    }
  ]
}
```

### 11.3 Block Inclusion Proof

```json
{
  "proof": {
    "type": "inclusion",
    "documentId": "sha256:3a7bd3e2...",
    "merkleRoot": "sha256:merkleroot...",
    "block": {
      "id": "conclusion",
      "hash": "sha256:blockhash...",
      "index": 42
    },
    "path": [
      { "position": "right", "hash": "sha256:h1..." },
      { "position": "left", "hash": "sha256:h2..." },
      { "position": "right", "hash": "sha256:h3..." },
      { "position": "left", "hash": "sha256:h4..." },
      { "position": "right", "hash": "sha256:h5..." },
      { "position": "left", "hash": "sha256:h6..." },
      { "position": "right", "hash": "sha256:h7..." }
    ]
  }
}
```

Verification: Starting with block hash, apply path to reach root.
