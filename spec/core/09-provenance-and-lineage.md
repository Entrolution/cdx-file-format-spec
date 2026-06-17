# Provenance and Lineage

**Section**: Core Specification
**Version**: 0.1

## 1. Overview

CDX documents form a cryptographic chain through content-addressable hashing and lineage pointers. This enables:

- Tamper-evident document history
- Verifiable ancestry ("this document descended from that one")
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
- Each document commits to its entire ancestry
- Inserting a forged intermediate document is computationally infeasible
- No external infrastructure required — documents ARE the chain
- Verification requires only the documents themselves

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

The `ancestors` array provides redundancy and fast chain verification:

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
- First element MUST equal `parent`
- Array SHOULD include all ancestors up to reasonable depth (recommended: 10)
- For chains longer than stored depth, final element represents oldest known
- Empty array or omitted field indicates root document

### 3.3 Chain Verification

To verify a document's lineage:

```
1. Compute document's content hash
2. Verify it matches claimed ID
3. If parent exists:
   a. Retrieve parent document
   b. Verify parent's hash matches lineage.parent
   c. Verify this document's hash appears in parent's future chain (if tracked)
   d. Recursively verify parent's lineage
4. Chain is valid if all links verify
```

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
- Keys sorted alphabetically
- No whitespace
- Deterministic number formatting

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

If intermediate documents are unavailable:
- Chain verification stops at gap
- Document is valid but ancestry is partial
- Consider archiving full chains for important documents

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
