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

The diagram is illustrative; the transition table (section 4.1) is authoritative for the complete set of transitions, including `revertToDraft()` (REVIEW → DRAFT) and `fork()` from any state carrying a computed `id`.

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
- Add/edit/resolve collaboration data — comments, suggestions, replies, tracked-change acceptance (`collaboration/*.json`, outside the hashing boundary)
- Add additional signatures
- Add/edit/remove phantom clusters (outside hashing boundary)
- Fill and submit forms (`forms/data.json`, outside the hashing boundary)
- Transition to PUBLISHED
- Fork to new DRAFT

The mutable layers on a frozen document are exactly the out-of-hash layers — core annotations, collaboration data, phantom clusters, and form data — each bound by neither the document hash nor the manifest projection, so operating on them never changes the document ID or invalidates a signature. The failure dispositions for these layers are correspondingly WARNING in every state (section 5.4.2).

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
| FROZEN | PUBLISHED | `publish()` | Re-sign over the published projection (see note) |
| REVIEW / FROZEN / PUBLISHED | DRAFT (new) | `fork()` | Parent `id` MUST be a computed content hash (not `pending`); creates new document |

> **Note**: `fork()` records the parent's document ID as `lineage.parent`, which MUST be a computed content hash resolvable by `resolve()` (Provenance and Lineage, section 3). A document whose `id` is still `pending` — every `draft`, and any `review` document reverted by `revertToDraft()` before its next `draft → review` transition — therefore MUST NOT be forked; compute its ID first (via `draft → review`, section 4.2). This is why the DRAFT state (section 3.2) does not list `fork()` among its permitted operations while REVIEW, FROZEN, and PUBLISHED do.

> **Note**: `revertToDraft()` MUST reset `id` to `pending`. A reverted draft is fully editable, so any previously computed ID is stale and MUST be recomputed on the next `draft → review` transition (see Document Hashing, section 7.2) — this prevents a stale ID from surviving edits into a signed, frozen document.

> **Note**: `publish()` changes `state` from `frozen` to `published`. Because the manifest projection binds `state` and every `frozen`/`published` signature MUST cover the projection (Security Extension section 9.8), the pre-existing frozen signatures no longer match the published projection and MUST be regenerated over it — otherwise their stored `scope.manifest` no longer equals the recomputed projection, each such signature is `invalid`, and a conformant verifier does not accept the published document as valid (INTEGRITY-ERROR, section 5.4.2). The document ID is unchanged (content is unchanged), so this is a re-signature over the new projection, not a re-hash.

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
2. Create signature over the scope — the document ID plus the manifest projection, since the target state `frozen` requires manifest coverage (Security Extension section 9.8)
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
5. If any verification fails, apply the disposition of section 5.4

### 5.4 Failure Dispositions

Validation can fail in many ways. This section defines, normatively and in one place, what a conformant reader does for each failure class, keyed by document state. It is the canonical reconciliation of the per-class rules stated throughout the specification (Container Format sections 3.5, 9.1 and 9.3, Document Hashing sections 4.3.2 and 6.3, Anchors and References section 7.2, Asset Embedding section 8, Provenance and Lineage sections 3.3 and 6.7, and the Security Extension sections 3.7 and 3.12); where a referenced section describes the *mechanism* of a check it remains authoritative for that mechanism, while the *disposition* — what the reader does when the check fails — is defined here.

#### 5.4.1 Disposition Vocabulary

A reader's response to a failure is exactly one of the following, in increasing severity:

- **IGNORE** — silently skip the unrecognized element and continue. Reserved for forward compatibility: material that a future version or an unsupported extension may legitimately add. The document remains valid; its editability is governed by document state (sections 5.1–5.2).
- **WARNING** — surface the issue to the user and/or log it, but otherwise process the document normally. The document remains valid and a warning never blocks loading; editability is governed by document state (sections 5.1–5.2).
- **INTEGRITY-ERROR** — the document parses, but an integrity claim cannot be confirmed. The reader MUST surface the failure, MUST NOT present the document as valid or authentic, and MUST NOT permit it to be edited in place (continuing work requires `fork()` to a new draft, section 4.4). The reader MAY render the content read-only behind a prominent, persistent integrity warning, and MAY instead refuse to render it (for example under a strict security policy). INTEGRITY-ERROR is the **minimum** obligation for an integrity failure: a reader MAY escalate any INTEGRITY-ERROR to a refusal, but MUST NOT downgrade one to a mere WARNING on a frozen or published document.
- **REJECT** — the document cannot be coherently or safely loaded at all; the reader MUST refuse to process it. Reserved for failures that leave the document unparseable, ambiguous, or unsupportable.

The line between INTEGRITY-ERROR and REJECT is whether the document can be meaningfully interpreted: a parseable document whose integrity is in doubt is an INTEGRITY-ERROR (the reader MAY show it, never as valid); a document that cannot be parsed, or whose identity cannot be established, is a REJECT.

#### 5.4.2 Disposition by Failure Class

The disposition depends on document state because state is a contract (section 2.2): `draft` and `review` documents are works in progress whose content is expected to change, so most defects are warnings; `frozen` and `published` documents assert fixed, integrity-checked content, so the same defect is an integrity failure.

A second axis is **integrity-binding**. A defect in material bound to the document's identity or integrity — the content tree, a hash-pinned part (`content`, a `presentation` layer), or the Dublin Core metadata whose projection enters the document ID — escalates to INTEGRITY-ERROR on a frozen or published document, because the document asserts that material is fixed. A defect confined to an **out-of-hash layer** — core annotations, collaboration data, phantom clusters, form data, and other tier-three extension data bound by neither the document hash nor the manifest projection (see the extensions overview, Integrity Status of Extension Data) — is a WARNING in *every* state: its bytes are not part of the authenticated document, so its failure cannot signal tampering, exactly as a dangling presentation reference does not (below). This out-of-hash WARNING covers the *internal validity* of those mutable annotation layers; it does not license rendering an **undeclared** presentation or precise-layout file as authoritative appearance. Such a file is bound by neither the hash nor the projection, so on a frozen or published document it is unauthenticated and MUST NOT be presented as the document's appearance (Presentation Layers section 12) — an injected layout is an attempt to alter signed content, not a benign out-of-hash annotation. This axis also separates two kinds of reference. A **core anchor reference** — a `link` mark `href` beginning `#`, an `anchor` mark, or a structured Content Anchor — is part of the document's addressing layer, so a dangling one in hashed content is an internal-consistency failure of signed content. An **extension cross-reference** — a citation, footnote, glossary, or academic/legal reference mark — is resolved at render time to inject a label, number, or definition; a dangling one degrades rendering only (the signed bytes remain intact and hash-verified) and is a WARNING in every state.

| Failure class | DRAFT / REVIEW | FROZEN / PUBLISHED |
|---------------|----------------|--------------------|
| Archive unreadable, or an unsafe entry name or symlink — see the full rejection set in Container Format sections 9.1 and 9.3 (`..`, an absolute or drive/UNC/colon-bearing name, a backslash, a reserved device name, or a symlink or path component whose resolved target escapes the extraction root) | REJECT | REJECT |
| Duplicate JSON keys in any part (Document Hashing section 4.3.2) | REJECT | REJECT |
| Duplicate archive entry path (including a case-only collision), or local-header/central-directory entry-set disagreement (Container Format section 3.5) | REJECT | REJECT |
| A hashed number that is non-finite, or an integer of magnitude > 2^53 - 1 (Document Hashing section 4.3.2) | REJECT | REJECT |
| Manifest absent, unparseable, or missing or mistyping a required field | REJECT | REJECT |
| A `state` value outside the defined lifecycle enum — `draft`/`review`/`frozen`/`published` (section 3.1; Manifest section 4.3) — so the mutability-and-signature contract cannot be established | REJECT | REJECT |
| Unsupported **major** version (Manifest) | REJECT | REJECT |
| Unsupported **minor** version (Manifest section 4.1) | WARNING — process known fields, IGNORE unknown additions | WARNING |
| Unsupported **required** extension (`required: true`) | REJECT | REJECT |
| Unsupported **optional** extension (Manifest section 4.10) | IGNORE — degrade; SHOULD surface | IGNORE |
| Unrecognized file or directory in the archive (Container Format) | IGNORE | IGNORE |
| Unknown **namespaced** block or mark type (Content Blocks sections 5, 5.1) | IGNORE — render a fallback (block) or the unmarked text (mark) | IGNORE |
| Unknown **bare**, non-namespaced block or mark type | REJECT | REJECT |
| Missing the required `content` part (see note 5 for encrypted parts) | REJECT | REJECT |
| Missing required metadata — the Dublin Core part or a required term | WARNING | INTEGRITY-ERROR |
| Missing a referenced part bound by the document hash or manifest projection — e.g. a declared `presentation` layer | WARNING | INTEGRITY-ERROR |
| Missing a referenced part outside the document hash and manifest projection — e.g. the `provenance` record (Security Extension section 9.8) | WARNING | WARNING |
| Structurally malformed block or mark of a **known** type | WARNING | INTEGRITY-ERROR |
| Dangling **core anchor** reference in hashed content — a `link`/`anchor` Content Anchor (Anchors and References section 7.2) | WARNING | INTEGRITY-ERROR |
| Dangling asset reference — a canonicalization error once the ID is computed (Document Hashing section 4.3.1) | WARNING | INTEGRITY-ERROR |
| Dangling presentation reference — a `blockId` or `blockRefs` targeting a non-existent content block (Presentation Layers section 13.4) | WARNING | WARNING |
| Dangling **extension cross-reference** resolved at render time — a citation, glossary, footnote, or academic/legal cross-reference mark whose target does not resolve | WARNING | WARNING |
| Dangling anchor originating in an **out-of-hash annotation layer** — a collaboration comment/change anchor or a phantom cluster anchor pointing into content | WARNING | WARNING |
| Missing or unparseable **out-of-hash extension data** part — a collaboration, phantom, or form data file, or a path-only semantic/academic side file (bibliography, glossary, numbering) | WARNING | WARNING |
| File `hash` or document-ID mismatch (Document Hashing section 6.3) | WARNING | INTEGRITY-ERROR |
| Asset hash mismatch (Asset Embedding section 8) | WARNING | INTEGRITY-ERROR |
| Declared MIME type of a content-referenced asset does not match its actual content bytes (Asset Embedding section 11.1) | WARNING (see note 4) | WARNING (see note 4) |
| Invalid or missing required signature on a frozen or published document (Security Extension section 3.7) | see note 1 | INTEGRITY-ERROR |
| Stripped or downgraded signature set, or a signature that does not cover the manifest projection (Security Extension sections 3.7, 3.12) | — | REJECT (see note 2) |
| Unverifiable **timestamp** (Provenance and Lineage section 6.7; Security Extension section 3.6) | the timestamp is reported *unverified*; the document is unaffected | same |
| **INCOMPLETE** lineage — a link unresolvable, or the traversal bound reached (Provenance and Lineage section 3.3) | WARNING — the chain is not contradicted but cannot be fully walked; no ancestor beyond the break is presented as verified | WARNING |
| A **divergent claimed `depth` or `version`** (Provenance and Lineage sections 3.3–3.4) | WARNING — advisory: the verifier recomputes depth from the resolved walk and cross-checks the claim, never enforcing it (legitimate branching diverges); it does not affect the VERIFIED/INCOMPLETE/REJECTED outcome | WARNING |
| **REJECTED** lineage — a *proven* inconsistency: a cycle, a forged `ancestors` tail, or a root declaring ancestors (Provenance and Lineage section 3.3) | WARNING (forged-lineage) — the lineage MUST be treated as forged: a verifier MUST NOT present *any* of the claimed ancestry as authenticated and MUST surface the proven inconsistency, distinct from a merely unverifiable chain. The document's content identity is unaffected, so it is not blocked on lineage grounds | same |

*Note 1*: a `draft` requires no signature and a `review` document's signature is optional (section 6.2), so a missing signature is not a failure below `frozen`. A signature that is *present* in any state still receives a per-signature state (Security Extension section 3.8).

*Note 2*: a stripped or downgraded signature set is an actively detected attack on an author-declared policy, which the Security Extension requires rejecting (sections 3.7, 3.12) — stricter than the INTEGRITY-ERROR baseline because the author named exactly who must sign. The required-signer policy is carried only in a frozen or published document's signed manifest projection, so it does not apply below `frozen` (—). An individual invalid or missing signature, by contrast, leaves the document viewable-but-untrusted (INTEGRITY-ERROR).

*Note 3 (lifecycle downgrade)*: the projection-coverage and required-signer rows above key off the document's *own* `state`, and a `draft`/`review` document has no mandatory projection (`—`). An attacker can therefore take a `frozen`/`published` document, rewrite `manifest.state` to `draft`/`review`, and present only a content-only signature over the unchanged content — escaping frozen-load validation and required-signer enforcement. This is the lifecycle-downgrade limitation disclosed in Security Extension section 9.8: a verifier MUST NOT represent a document's `state`, or any manifest field, as authenticated on the strength of a content-only signature, and SHOULD warn when a document is presented this way. Authenticating the state against a content-only downgrade is out of scope for this version. The residual is minimal: because every frozen-era signature covers the projection, a downgraded presentation reduces to reusing an honestly-made content-only signature, a fresh content-only attestation under a credential the verifier pins (the minting party's own authenticated identity over genuine content), or unsigned content — in every case tampered content is never presented as signed and no honest party is impersonated (Security Extension section 9.8, the reduction note).

*Note 4 (declared type is advisory)*: the declared MIME type of a content-referenced asset is not part of the document ID — Document Hashing section 4.3.1 resolves the reference to its bytes only — so two documents with the same ID may declare different types for the same bytes. A reader that dispatches a decoder on the declared type can be steered into a decoder the author never chose; a reader SHOULD therefore determine an asset's handling from its verified content, treat the declared type as advisory, and flag a declared-versus-actual mismatch. On a frozen or published document the type still rides in the hash-pinned asset index (Asset Embedding section 3.1), so a post-signature edit of the declared type is separately caught as an index-hash mismatch.

*Note 5 (encrypted parts are present, not missing)*: a referenced part whose logical path is mapped by the security extension's encryption metadata to a stored `.enc` entry satisfies the part's existence requirement — the missing-part rows above MUST NOT fire for it (Security Extension section 4.7). Its hash verification is deferred to post-decryption; a consumer without the decryption key reports the document integrity-indeterminate rather than missing-part-rejected. An encrypted document declares `cdx.security` as `required: true` (Security Extension section 4.7), so a consumer without security-extension support rejects it through the ordinary unsupported-required-extension row rather than misreading the archive.

#### 5.4.3 State-Invariant Rules

The following rules do **not** vary by state and override the table above:

- **Duplicate keys always REJECT.** Any part containing an object with duplicate keys MUST be rejected before hashing or verification, in *every* state (Document Hashing section 4.3.2); an unrejected duplicate permits a split-view substitution.
- **Duplicate archive entries always REJECT.** An archive with a duplicate entry path (including a case-only collision), or whose local-file-header and central-directory views disagree on the entry set, MUST be rejected in *every* state (Container Format section 3.5); like a duplicate JSON key, an unrejected duplicate permits a split-view substitution.
- **An unsafe archive path or symlink always REJECTs.** An entry name that fails the section 9.1 safety checks, or a symbolic-link entry in an untrusted archive (section 9.3), MUST cause the archive to be rejected in *every* state — a zip-slip is a security defect regardless of lifecycle.
- **A non-representable hashed number always REJECTs.** A hashed number that is non-finite, or an integer whose magnitude exceeds 2^53 - 1, MUST be rejected in *every* state (Document Hashing section 4.3.2); the IEEE-754 double the canonicalizer hashes would differ from the value the author wrote, so it is not a value a signature can attest.
- **An unverifiable proof never rejects the document.** A verifier that cannot complete a timestamp or lineage proof (an INCOMPLETE outcome) MUST report *that proof* as unverified and MUST NOT, on those grounds, reject or downgrade the document itself (Provenance and Lineage sections 3.3 and 6.7). The disposition attaches to the proof, not to the document. This covers the *unverifiable* case: a *proven-false* lineage (REJECTED — a cycle, forged tail, or root with ancestors) is not merely unverified but repudiated — the verifier MUST NOT present the claimed ancestry as authenticated (the row above) — though the document's content identity is still unaffected, so it too is not blocked on lineage grounds.
- **An out-of-hash layer's internal validity is a load disposition, not an integrity failure.** A defect confined to the internal graph of an out-of-hash layer — for example a broken phantom-to-phantom `connection` target, or a duplicate phantom id (Phantoms section 4.7) — MAY stop that layer from loading or rendering coherently, but because the layer is bound by neither the document hash nor the manifest projection it MUST NOT escalate to an INTEGRITY-ERROR or downgrade the document, in *any* state. Such load "errors" are layer-validity dispositions distinct from this table's integrity axis.

## 6. Signatures and State

### 6.1 Signature Binding

A signature covers an explicit, signed **scope** — always the document ID (the content hash), and on a `frozen` or `published` document the **manifest projection** as well, which binds `state`, the presentation and asset-index hashes, the required-extension set, the required-signer policy, and the lineage (Security Extension sections 9.5–9.8). The signature is computed over the canonical bytes of that scope, not over the document ID alone:

```
Signature = Sign(PrivateKey, JCS(scope))     // scope = { documentId, [manifest], [layouts] }
```

(Simplified: the detached-JWS signing input is `BASE64URL(protected) + "." + JCS(scope)`, so the protected header — `alg`, `b64:false`, `crit` — is bound too; see Security Extension section 9.5.)

This means:
- Any content change invalidates all signatures (the document ID changes)
- On a `frozen` or `published` document a manifest change also invalidates every manifest-covering signature (the projection changes); such coverage is REQUIRED there, so a signature that omits the projection is rejected (section 5.4.2, note 2; Security Extension section 9.8)
- Multiple parties can sign the same scope

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
      "scope": {
        "documentId": "sha256:abc123...",
        "manifest": { "cdx": "0.1", "state": "frozen", "content": { "path": "content/document.json", "hash": "sha256:def456..." } }
      }
    },
    {
      "id": "sig-2",
      "protected": "eyJhbGci...",
      "signature": "MGQCMA...",
      "scope": {
        "documentId": "sha256:abc123...",
        "manifest": { "cdx": "0.1", "state": "frozen", "content": { "path": "content/document.json", "hash": "sha256:def456..." } }
      }
    }
  ]
}
```

All signatures cover the same scope — the shared document ID plus, on this frozen document, the manifest projection (Security Extension section 9.8; the projection is abbreviated here — see section 9.7 for its full form). See the Security Extension §3.3 for the signature envelope.

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

The cases below are worked instances of the failure dispositions in section 5.4: an invalid or missing signature on a frozen or published document is an INTEGRITY-ERROR — surfaced, never presented as valid, and never editable in place.

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
    "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
    "hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
    "hash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
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
