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

The **manifest's** `lineage` object (Manifest section 4.13) is the authoritative, signable chain: it carries `parent`, `ancestors`, `depth`, `branch`, `mergedFrom`, `version`, and `note` (Manifest schema). An author who wants a *signed* ancestor chain places `ancestors` (and `mergedFrom`) there, because a frozen or published document's manifest projection binds `manifest.lineage` (Section 3.3, Section 10.3). The **provenance record's** lineage (Section 8.1) restates the same chain with additional auditing context, but it is path-only and **unsigned**, so it is never the authoritative copy. A verifier resolves and checks the chain from `manifest.lineage`; the provenance record is advisory detail.

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

The chain is a **DAG**, not a single spine: a node has a primary `parent` and
zero or more `mergedFrom` parents (Section 3.4), each resolved and chain-checked
alike. Verification is a depth-first walk that follows every parent; a node
re-reached on the *current* path is a cycle (REJECTED), while one re-reached by a
*different* path (a merge diamond) is memoised, not mistaken for a cycle. A
REJECTED anywhere dominates; failing that, any INCOMPLETE makes the subject
INCOMPLETE; only an all-resolved, all-consistent walk to roots is VERIFIED.

```
verify(subject):
  memo = {}                                            // ids of already-VERIFIED subtrees
  return visit(subject, path = {}, depth = 1)

visit(id, path, d):
  if id in path: return REJECTED                       // cycle: revisit on the current path
  if id in memo: return VERIFIED                       // merge diamond: re-reached by another path
  node = resolve(id)
  if node == null: return INCOMPLETE                   // unresolvable; no claim beyond here
  parents = (node.parent == null ? [] : [node.parent]) ++ (node.mergedFrom or [])
  if parents is empty:                                 // root
    if node.ancestors is non-empty: return REJECTED    // a root has no ancestors
    memo += id;  return VERIFIED
  if d >= traversalBound: return INCOMPLETE            // honest deep history, not an error
  if node.ancestors is present:                        // cross-check vs the resolved PRIMARY parent
    parent = resolve(node.parent)
    if parent != null:
      if node.ancestors[0] != node.parent: return REJECTED
      expected = [node.parent] ++ parent.ancestors
      if node.ancestors and expected differ on any shared index: return REJECTED  // forged tail
  outcome = VERIFIED
  for p in parents:                                     // verify EVERY parent (primary + each merge)
    r = visit(p, path ++ {id}, d + 1)
    if r == REJECTED: return REJECTED                   // a proven inconsistency in any parent wins
    if r == INCOMPLETE: outcome = INCOMPLETE            // keep scanning — a later REJECTED still dominates
  if outcome == VERIFIED: memo += id
  return outcome
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

While the hash chain (Section 3) proves *relative* ordering (A before B), timestamp anchoring proves *absolute* existence: that a document hash existed at or before a time T. A provenance record (Section 8.1) MAY carry a `timestamps` array; each entry anchors the document hash to a point in time through one of three mechanisms — an RFC 3161 timestamp authority (`rfc3161`, Section 6.3), a direct blockchain transaction (`blockchain`, Section 6.4), or an aggregated Merkle anchor (`aggregated`, Section 6.5).

Each entry's `time` field is **advisory** (Section 6.6): the authoritative time comes from the validated proof, never from the self-asserted field. A timestamp a verifier cannot validate is reported as **unverified** — never as a valid time — and an unverified, malformed, or absent timestamp never invalidates the document itself (Section 6.7). The *signature* timestamp of the security extension (§3.6) is a different construction that binds `H(protected || "." || signature)`; a provenance timestamp binds the **document hash** (Section 6.2).

### 6.2 Binding to the Document

A timestamp is meaningful only if the hash it commits to is **this document's** hash. CDX fixes the binding:

> The hash a timestamp commits to MUST equal the provenance record's `documentId`, and the record's `documentId` MUST equal the manifest `id`.

The committed hash is named per type:

- **rfc3161** and **blockchain** — the `hash` member (respectively the RFC 3161 messageImprint and the on-chain-committed value).
- **aggregated** — `proof.documentHash`, the Merkle leaf, which MUST *also* equal the top-level `hash`. The binding is keyed on `proof.documentHash`, **not** on the top-level `hash`: the Merkle `path` (Section 6.5) commits to the leaf, so a verifier that checked only `hash` could be shown an entry whose `hash` equals the `documentId` while the path actually anchors a different leaf. Keying on the leaf closes that fail-open.

A verifier MUST report unverified any timestamp whose committed hash does not equal the record `documentId`. The equality is **strict**: a timestamp over the block-level `merkle.root` (Section 4), a prior version's hash, or any other value is not accepted — `merkle.root` in particular is verified nowhere in this version (Section 6.7), so admitting it would be a fail-open. To carry a *prior version's* existence proof, resolve that version's own provenance record through the lineage chain (Section 3.3); a timestamp in this record attests *this* `documentId` only.

**What the binding establishes — and what it does not.** The provenance record is a path-only part: it is **not** covered by the signed manifest projection (security extension §9.8), so its bytes are unsigned. The `documentId == id` equality is therefore a **structural self-consistency** check, not by itself proof that the timestamp is genuine. Two things give it force:

- On a **frozen** or **published** document, `manifest.id` is authenticated: a manifest-covering signature binds `scope.documentId == id` (security extension §9.5), so a surviving valid signature makes `id` tamper-evident, and the timestamp's committed hash — equal to that authenticated `id` — is tied to the authenticated document identity. On a **draft**, `id` is unauthenticated and the equality is only a consistency check.
- The genuine existence proof is the **cryptographic proof itself** — the RFC 3161 token, the blockchain transaction, or the aggregate Merkle path and on-chain anchor — validated against trusted time (Sections 6.3–6.5). A forged or transplanted timestamp fails that validation; the binding only ensures the thing the proof commits to is the document in hand.

### 6.3 RFC 3161 Timestamps

A trusted timestamp authority (TSA) issues a signed token over the document hash:

```json
{
  "type": "rfc3161",
  "time": "2025-01-15T10:00:00Z",
  "hash": "sha256:9e1d310d...",
  "authority": "https://timestamp.digicert.com",
  "token": "MIIEpgYJKoZI..."
}
```

`token` is an RFC 3161 `TimeStampToken` (a CMS `SignedData`), DER base64; `hash` is the timestamped document hash; `authority` is an **advisory** display URL.

**Verification.** A verifier:

1. Parses `token` and confirms its `messageImprint.hashedMessage` equals `hash`, and that `hash` equals the record `documentId` (Section 6.2). A token whose imprint commits to any other value does not timestamp this document.
2. Validates the token's TSA certificate chain to a verifier-configured **TSA trust store** — the same store the signature-timestamp path uses (security extension §3.6), distinct from the signature trust anchors (§3.9) and the `did:web` Web-PKI store (§3.11). An in-document token whose TSA does not validate is **not trusted** — never self-authorizing.
3. Takes the trusted reference time **T** to be the token's genTime (Section 6.6).

### 6.4 Blockchain Anchoring

A transaction on a public blockchain commits the document hash; the block dates it:

```json
{
  "type": "blockchain",
  "chain": "bitcoin",
  "blockHeight": 850000,
  "blockHash": "0000000000000000000209b4...",
  "txId": "abc123...",
  "merkleProof": ["..."],
  "time": "2025-01-15T10:05:00Z",
  "hash": "sha256:9e1d310d..."
}
```

The transaction `txId`, in block `blockHash`, commits `hash` (optionally proven within the block by the SPV `merkleProof`). `hash` MUST equal the record `documentId` (Section 6.2).

**Verification — confirmation and finality are chain-relative.** A verifier locates the transaction by **`blockHash`** — not `blockHeight`, which a reorganization can reassign — and confirms the block is on the canonical chain at the required depth, which differs by chain:

- **Bitcoin** has *probabilistic* finality. A verifier requires a configured **confirmation depth** (commonly 6 blocks) and MUST treat the result as probabilistic — a deeper reorganization can in principle reverse it.
- **Ethereum** has *deterministic* finality (post-Merge Casper FFG). A verifier requires the anchoring block to be at or before the **finalized** checkpoint; an unfinalized block is not yet a valid anchor.

A verifier that cannot reach a trusted node or light client for `chain`, or cannot confirm the transaction commits `hash` at the required depth, MUST report the timestamp **unverified** (Section 6.7).

**Block time is advisory, with chain slack (Section 6.6).** The on-chain existence bound is "at or before the block was confirmed", **not** the block's own timestamp. A block timestamp is producer-influenced: a Bitcoin block timestamp may be set up to ~2 hours ahead of network-adjusted time (it need only exceed the median of the preceding 11 blocks), so it is not even a tight upper bound; Ethereum slot times are tighter but still validator-asserted. The trusted time T is the time the block became canonical at the required depth, treated as an upper bound; the entry's `time` and the block's own timestamp are advisory.

**Supported chains:** `bitcoin`, `ethereum`. This stores only a hash on-chain, never the document.

### 6.5 Aggregated Anchoring

To amortize on-chain cost, an aggregator batches many document hashes into one Merkle tree and anchors only the root (e.g. OpenTimestamps):

```json
{
  "type": "aggregated",
  "provider": "opentimestamps.org",
  "calendar": "https://alice.btc.calendar.opentimestamps.org",
  "time": "2025-01-15T10:10:00Z",
  "hash": "sha256:9e1d310d...",
  "proof": {
    "documentHash": "sha256:9e1d310d...",
    "path": [
      { "position": "right", "hash": "sha256:sibling1..." },
      { "position": "left", "hash": "sha256:sibling2..." }
    ]
  },
  "merkleRoot": "sha256:aggregateroot...",
  "anchor": { "chain": "bitcoin", "blockHeight": 850000, "blockHash": "...", "txId": "..." }
}
```

The Merkle leaf `proof.documentHash` MUST equal the record `documentId` and the top-level `hash` (Section 6.2). `proof.path` ties the leaf to `merkleRoot`; `anchor` commits `merkleRoot` on-chain. `provider` and `calendar` are **advisory** delivery hints.

**Verification.**

1. Recompute the Merkle root from `proof.documentHash` along `proof.path`: fold each sibling by **raw-digest-byte concatenation** — a `left` sibling on the left (`H(sibling || acc)`), a `right` sibling on the right (`H(acc || sibling)`), under the leaf's hash algorithm — and require the result to equal `merkleRoot`. This is the Section 5.2 inclusion-proof algorithm, pinned to raw-byte concatenation: each hash's `algorithm:hexdigest` is decoded to its raw digest bytes before hashing, and every hash in one proof MUST share an algorithm.
2. Verify that `anchor` commits `merkleRoot` on-chain, by the blockchain rules of Section 6.4 (locate by `anchor.blockHash`, chain-relative finality, block time as an upper bound).
3. Take T from the anchor block (Section 6.6).

**The calendar is untrusted.** `provider` and `calendar` only *deliver* the proof; a verifier MUST NOT trust them. The proof self-verifies: an invalid `proof.path`, or a `merkleRoot` not actually committed by `anchor`, makes the timestamp unverified regardless of what the calendar asserts (the §3.9 "in-document material is never self-authorizing" principle). This stores only a root on-chain, timestamping many documents in one transaction.

### 6.6 Trusted Time and Advisory Fields

When a timestamp validates (Sections 6.3–6.5), the trusted reference time **T** is taken from the **proof** — the RFC 3161 genTime, or the anchoring block's confirmation — never from the entry's `time` field. Each entry's `time`, and an rfc3161 `authority`, an aggregated `provider`, and an aggregated `calendar`, are **advisory display only** and MUST NOT feed any verification decision.

A timestamp bounds the document's existence **from above only**: it proves the hash existed *at or before* T, never a lower bound. A verifier MUST NOT present the claimed `time` as an attested time, and SHOULD warn when `time` diverges from T beyond a configured tolerance — and when `time` precedes the record's `created`, which is suspicious. Establishing a *lower* bound — that the document did not exist before some earlier time — requires a pre-existing commitment a timestamp cannot supply (Section 6.7).

### 6.7 Verifier Obligations and Limits

Validating a timestamp is a **verifier obligation**, and a verifier that cannot complete it MUST report the timestamp **unverified** — never valid, and never as grounds to reject the document. The hash bindings of Section 6.2 and the aggregated Merkle recomputation of Section 6.5 are mechanically checkable and enforced by this specification's conformance gates; the cryptographic proofs themselves are obligations a conforming verifier MUST perform but a format-conformance gate cannot:

- **rfc3161** — parsing the token, validating the TSA chain to the TSA trust store, and extracting genTime (no ASN.1 / PKI in a schema gate).
- **blockchain** — querying a trusted node or light client, confirming the transaction commits the hash, and checking confirmation/finality depth (no chain access in a schema gate).
- **aggregated** — the on-chain validation of the `anchor` (the Merkle *path* is recomputed by the gate; the *anchor* is a blockchain obligation, as above).

**Limits (disclosed, not closed):**

- **Antedating.** A timestamp is an upper bound only (Section 6.6): a signer who computes the hash and timestamps promptly, while setting `created` and `time` to any earlier value, is indistinguishable from one who genuinely created the document then. The `created` field and the lineage ordering (Section 3) are **child-asserted** and are not authenticated by any timestamp.
- **`merkle.root` is unverified.** The block-level Merkle tree (Section 4) and the record's `merkle` summary are not verified in this version; a document-hash timestamp says nothing about the block tree.
- **No cross-version carry.** A timestamp attests *this* `documentId`; a prior version's existence proof lives in that version's own provenance record (Section 6.2).
- **Algorithm aging.** A timestamp whose hash or anchor algorithm later weakens is not automatically renewed (the security extension's archive-timestamp mechanism, §7.5, is a separate, deferred concern).

A green conformance build does not certify that any timestamp cryptographically verifies.

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

The `relationship` field describes how the derived document relates to its source: one of `excerpt`, `quotation`, `translation`, `revision`, or `derivation`.

**Security — the provenance record is unauthenticated.** `provenance/record.json` is
referenced by path only; the manifest carries no hash for it, and it sits outside every
signature scope and the manifest projection (section 6.2; Security Extension, section 9.8).
Its bytes are unsigned even on a `frozen` or `published` document, so every field here is
forgeable without changing the document ID or breaking a signature. In particular
`creator.name` and `creator.identifier` are an author's **claim**, not an authenticated
identity — a `did:web:` value does not become authoritative by being named (Security
Extension, section 3.10). A consumer MUST NOT surface the provenance `creator` as the
authenticated author, and MUST NOT trust an in-record `timestamps`, `lineage`, or
`derivedFrom` entry without the out-of-band verification section 6 requires. To
authenticate authorship, bind it in signed content or the manifest projection.

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

Each timestamp type carries a distinct trust dependency, and each is validated against verifier-configured trust — never document-supplied material (Section 6):

- **rfc3161** — trust rests on the TSA, validated to a verifier-configured **TSA trust store** (Section 6.3); an in-document token whose TSA does not anchor is not trusted.
- **blockchain** — trust rests on the chain's consensus, confirmed at a chain-relative depth (Bitcoin: a probabilistic confirmation depth; Ethereum: finalization — Section 6.4).
- **aggregated** — trust rests on the on-chain `anchor`, not the aggregator: `provider` and `calendar` are advisory, and the Merkle proof self-verifies against the anchor (Section 6.5).

In all three, the timestamped hash MUST equal the document `id` (Section 6.2), the claimed `time` is advisory (Section 6.6), and a timestamp the verifier cannot validate is reported **unverified** — never valid, and never grounds to reject the document (Section 6.7). The bound is from above only: a timestamp cannot establish that a document did *not* exist earlier (antedating, Section 6.7).

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
      "hash": "sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
      "token": "MIIEpgYJKoZI..."
    },
    {
      "type": "blockchain",
      "chain": "bitcoin",
      "blockHeight": 880000,
      "blockHash": "0000000000000000000209b4f1e8a2c9d3b7e6f5a4c3d2e1f0a9b8c7d6e5f4a3",
      "txId": "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
      "time": "2025-01-15T10:15:00Z",
      "hash": "sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b"
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
