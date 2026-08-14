# Design Decisions

This document records key design decisions made during the CDX format specification development.

## DD-001: ZIP Container Format

**Decision**: Use ZIP archive as the container format.

**Alternatives Considered**:
1. Custom binary format
2. Single JSON file
3. Tar archive
4. SQLite database

**Rationale**:
- ZIP is universally supported across platforms
- Enables random access to individual files
- Familiar tooling for debugging and inspection
- Built-in compression support
- EPUB, DOCX, ODF all use ZIP successfully

**Consequences**:
- Slight overhead compared to custom format
- Must handle ZIP-specific edge cases (path traversal, etc.)

---

## DD-002: JSON as Primary Data Format

**Decision**: Use JSON for all structured data (manifest, content, metadata).

**Alternatives Considered**:
1. XML
2. YAML
3. Protocol Buffers
4. MessagePack/CBOR

**Rationale**:
- JSON is human-readable for debugging
- Universal parser support across languages
- Easy to version control (text diffs work)
- JSON Schema provides validation
- JCS (RFC 8785) enables deterministic hashing

**Consequences**:
- Larger file sizes than binary formats
- Some types require conventions (dates as ISO 8601 strings)
- Deep nesting can be verbose

---

## DD-003: Semantic-First Content Model

**Decision**: Store content as semantic blocks, not visual instructions.

**Alternatives Considered**:
1. PDF-style drawing operators
2. HTML-like tag soup
3. Markdown with extensions

**Rationale**:
- Separates meaning from presentation
- Enables multiple output formats from single source
- Machine extraction works reliably
- Accessibility is natural, not bolted on
- Aligns with modern editor architectures (ProseMirror, Slate)

**Consequences**:
- Requires presentation layer for visual rendering
- Some legacy documents harder to convert
- More complex than flat text

---

## DD-004: Content-Addressable Document Identity

**Decision**: Document ID is the hash of its canonical content.

**Alternatives Considered**:
1. UUID assigned at creation
2. Sequential version numbers
3. Timestamp-based IDs
4. No formal ID (filename only)

**Rationale**:
- Hash = identity enables integrity verification
- No central authority needed for ID assignment
- Identical content produces identical IDs (deduplication)
- Enables distributed storage and caching
- Git uses this model successfully

**Consequences**:
- Draft documents need special handling (pending ID)
- Hash must be recomputed on content change
- Canonical form must be precisely defined

---

## DD-005: Explicit Document State Machine

**Decision**: Documents have explicit states (draft, review, frozen, published).

**Alternatives Considered**:
1. Implicit state from signatures (PDF model)
2. No state concept
3. Continuous versioning only

**Rationale**:
- PDF's implicit model has proven confusing and exploitable
- Clear states communicate author intent
- Enables proper enforcement (frozen = no edits)
- Supports workflow integration

**Consequences**:
- State transitions must be validated
- Implementations must respect state semantics
- Adds complexity over simple version numbers

---

## DD-006: SHA-256 as Default Hash Algorithm

**Decision**: Use SHA-256 as the default hashing algorithm, with algorithm agility.

**Alternatives Considered**:
1. SHA-1 (legacy compatibility)
2. SHA-3 only (newest)
3. BLAKE3 (fastest)
4. Multiple required algorithms

**Rationale**:
- SHA-256 has excellent security margin
- Universally implemented
- Matches common certificate standards
- Algorithm agility allows future migration
- SHA-3 and BLAKE3 as options for those who want them

**Consequences**:
- Must specify algorithm in hash string
- Implementations must support migration path

---

## DD-007: ES256 as Required Signature Algorithm

**Decision**: ECDSA with P-256 (ES256) is the minimum required signature algorithm.

**Alternatives Considered**:
1. RSA only (legacy)
2. Ed25519 only (modern)
3. Multiple required algorithms

**Rationale**:
- ES256 balances security, performance, and compatibility
- Required by WebAuthn, widely deployed
- Ed25519 recommended but not required (support still growing)
- RSA optional for legacy integration

**Consequences**:
- Must support at least one ECDSA implementation
- Post-quantum algorithms as optional extension

---

## DD-008: Optional Presentation Layers

**Decision**: Presentation layers are optional; default rendering from semantics.

**Alternatives Considered**:
1. Required presentation layer
2. No presentation concept (pure semantic)
3. Inline styling only

**Rationale**:
- Simple documents don't need complex layouts
- Semantic content can be rendered with defaults
- Presentation is an optimization, not requirement
- Enables progressive enhancement

**Consequences**:
- Implementations must provide default styles
- Rendering may vary slightly across implementations
- Complex layouts require explicit presentation

---

## DD-009: Modular Extension Architecture

**Decision**: Core specification is minimal; features added via extensions.

**Alternatives Considered**:
1. Monolithic specification
2. Profiles (subsets)
3. Completely open extension model

**Rationale**:
- Keeps core simple and implementable
- Extensions can evolve independently
- Implementations can support what they need
- Prevents specification bloat

**Consequences**:
- Must define extension registration mechanism
- Required vs optional extensions need clear semantics
- Interoperability requires common extension support

---

## DD-010: No Scripting in Core

**Decision**: Core specification does not support executable content.

**Alternatives Considered**:
1. JavaScript support (like PDF)
2. Sandboxed scripting
3. Declarative interactivity only

**Rationale**:
- Security risks outweigh benefits
- PDF JavaScript is a major attack vector
- Interactivity can be achieved through forms extension
- Static documents are easier to preserve

**Consequences**:
- Some PDF features not directly portable
- Interactive features require extension or viewer support
- Clearer security model

---

## DD-011: Dublin Core as Required Metadata

**Decision**: Dublin Core metadata is required for all documents.

**Alternatives Considered**:
1. Custom metadata schema
2. XMP (Adobe)
3. No required metadata
4. Schema.org only

**Rationale**:
- Dublin Core is an established standard (ISO 15836)
- Minimal required set (title, creator)
- Extensible for domain-specific needs
- Compatible with library and archive systems

**Consequences**:
- All documents have basic discoverability
- Additional schemas as extensions
- Slight overhead for very simple documents

---

## DD-012: Annotation Layer Separate from Content

**Decision**: Annotations on frozen documents are stored separately, not affecting content hash.

**Alternatives Considered**:
1. Annotations as content (changes hash)
2. No annotations on frozen documents
3. Annotation versioning separate from content

**Rationale**:
- Frozen means content unchanged
- Annotations are commentary, not content
- Enables review workflows on final documents
- Maintains signature validity

**Consequences**:
- Annotations may not be portable
- Need clear boundary between content and annotation
- Annotation integrity separate concern

---

## DD-013: Hash Chain Lineage with Merkle Trees

**Decision**: Documents form a hash chain via parent references, with block-level Merkle trees for granular proofs.

**Alternatives Considered**:
1. External version control only (Git, etc.)
2. Simple parent pointer without Merkle trees
3. Full blockchain with consensus mechanism
4. Centralized version registry

**Rationale**:
- Documents themselves become the chain — no external infrastructure required
- Content-addressable identity (hash = ID) makes forgery computationally infeasible
- Merkle trees enable block-level proofs without revealing entire document
- Supports selective disclosure and redaction proofs
- Compatible with external timestamping (RFC 3161, blockchain anchoring)
- Git has proven this model works at scale
- Decentralized verification — anyone with the documents can verify the chain

**Consequences**:
- Slightly larger documents (block index adds ~50-100 bytes per block)
- Hash algorithm becomes critical dependency (algorithm agility required)
- Chain verification requires access to ancestor documents (or trust in chain)
- Merkle proofs add complexity for implementers

**Key Insight**: The "blockchain-like" property comes from the hash chain structure, not from consensus mechanisms or distributed networks. The documents ARE the chain.

---

## DD-014: Timestamp Anchoring Options

**Decision**: Support multiple timestamp anchoring methods: RFC 3161 TSAs, blockchain anchoring, and aggregated timestamps.

**Alternatives Considered**:
1. RFC 3161 only (traditional)
2. Blockchain only (decentralized)
3. No timestamp support (signatures only)
4. Proprietary timestamp service

**Rationale**:
- RFC 3161 is established standard, widely supported
- Blockchain anchoring provides decentralized, censorship-resistant timestamps
- Aggregated timestamps (OpenTimestamps-style) provide efficiency for high-volume use
- Different use cases have different trust requirements
- Legal contexts may require specific timestamp authorities
- Academic/archival contexts may prefer decentralized proofs

**Consequences**:
- Multiple code paths for timestamp verification
- Trust model varies by timestamp type
- Blockchain timestamps have latency (Bitcoin: ~10 min, Ethereum: ~12 sec)
- RFC 3161 requires trust in TSA; blockchain requires trust in chain security

---

## DD-015: State-Aware Progressive Enhancement Presentation

**Decision**: Presentation precision evolves with document maturity — reactive presentation for drafts, with precise layout snapshots required for FROZEN and PUBLISHED documents **that assert page-precise fidelity** (e.g. citable pagination or print/legal use), and recommended otherwise.

**Alternatives Considered**:
1. Always require precise layouts (PDF model)
2. Never require precise layouts (pure semantic)
3. Optional precise layouts regardless of state
4. External rendering only (no stored layouts)

**Rationale**:
- **Rendering fidelity** — When a frozen document asserts page-precise fidelity, a precise layout is required (recommended otherwise); the document ID covers semantic content only. A precise layout declared in `presentation[]` is bound into the signed manifest projection, so its appearance is attested by a manifest-covering signature (see Security Extension; DD-018).
- **Legal/academic needs** — Citations reference "page 7, line 23" with confidence
- **Lifecycle alignment** — Precision emerges naturally as documents mature
- **No capability loss** — Semantic content always present for accessibility/search
- **Stable cross-references** — Internal refs ("see page 7") guaranteed stable once frozen
- Draft documents are fluid; layout doesn't matter yet
- Review documents can preview approximate pagination
- Frozen/published documents become immutable records with exact appearance

**Presentation Types**:
| Type | Purpose | When Required |
|------|---------|---------------|
| Reactive (paginated, continuous, responsive) | Hints and styles for renderers | Optional always |
| Precise (layouts/) | Exact coordinates for pixel-perfect reproduction | Required for FROZEN/PUBLISHED when page-precise fidelity is asserted; recommended otherwise |

**Precise Layout Features**:
- Exact element coordinates (x, y, width, height)
- Content hash for staleness detection
- Page continuation markers for multi-page blocks
- Optional line-level precision for legal documents
- Font metrics for exact text reproduction

**Consequences**:
- FROZEN/PUBLISHED validation must check for a precise layout when the document asserts page-precise fidelity
- Layout content hash must match current content (staleness check)
- State transition to FROZEN may fail if a fidelity-asserting document has no precise layout
- Layout generation is external tooling responsibility
- Increases document size for frozen documents (layout data)

**Key Insight**: Just as document content becomes immutable when frozen, so does its visual appearance. The precise layout is part of the immutable record, but the document ID covers semantic content only. Scoped signatures (DD-018) allow separate attestation of appearance when required.

---

## DD-016: Unified Anchor System

**Decision**: Define a single anchor addressing system (Content Anchor URIs and ContentAnchor objects) in the core specification, consumed by all extensions.

**Alternatives Considered**:
1. Per-extension addressing (each extension defines its own `blockRef` + `range`)
2. Only named anchors (no offset-based addressing)
3. XPath-style addressing
4. Character offsets only (no block-level anchors)

**Rationale**:
- **Consistency** — All extensions (collaboration, phantoms, presentation, semantic) use the same addressing model
- **Reduces duplication** — One schema definition, one validation rule set, one offset computation algorithm
- **Named anchors as stable alternative** — Offset-based anchors are fragile under edits; named anchor marks provide a stable alternative that moves with content
- **State-dependent validation** — Broken anchors are warnings in DRAFT/REVIEW (content is fluid) but errors in FROZEN/PUBLISHED (content is immutable)
- **Link mark integration** — Internal links use the same URI syntax (`#blockId`) as external links use URLs, keeping the mark model simple

**Consequences**:
- Block IDs are now SHOULD (upgraded from MAY) for all blocks
- Block IDs are MUST when any referencing extension is active
- Named anchor IDs share the namespace with block IDs (uniqueness constraint)
- Implementations need offset adjustment logic for mutable documents

---

## DD-017: Phantom Layer

**Decision**: Provide an off-page annotation layer (phantoms) that is outside the hashing boundary and mutable in all states.

**Alternatives Considered**:
1. Extend the collaboration extension with spatial annotations
2. Use the core annotation layer for all annotation types
3. Embed annotations inline in content blocks
4. No spatial annotation support

**Rationale**:
- **Orthogonal to inline annotations** — Phantoms are spatially organized clusters, not inline comments. They serve a different purpose (research notes, marginalia, mind-maps)
- **Outside hashing boundary** — Phantoms are commentary, not content. Adding a margin note should never change document identity or invalidate signatures
- **Mutable in all states** — Even frozen/published documents benefit from annotation. This follows the PDF model where annotations don't affect the document
- **Scope control** — Private, shared, and role-based visibility allows personal notes alongside team annotations
- **Fork behavior** — Shared phantoms travel with the document; private ones stay with their author

**Consequences**:
- New `phantoms/` directory in the archive
- Phantom block IDs are in a separate namespace from document content
- Applications must decide how to render clusters spatially (margin, sidebar, overlay)
- Fork operations must handle per-scope phantom copying

---

## DD-018: Scoped Signatures for Appearance Attestation

**Decision**: Add optional `scope` field to signatures, enabling per-signature attestation of content plus layout.

**Alternatives Considered**:
1. Include layout in the content hash (makes layout part of document identity)
2. Separate signature files for content vs. appearance
3. Always sign appearance (all signatures cover layout)
4. No appearance attestation (content-only signatures always)

**Rationale**:
- **Content identity vs. appearance attestation** — The document ID should represent semantic identity (what it says), not visual appearance (how it looks). But legal/notarial use cases need to attest that a specific rendering was certified
- **Backward compatible** — Existing signatures (no `scope`) continue to work unchanged as content-only attestation
- **Flexible** — Different signers can attest to different things. A notary signs content + letter layout; a reviewer signs content only
- **Extensible** — The `scope` object can be extended with additional fields (metadata, assets) without breaking existing signatures
- **JCS for determinism** — Using JCS serialization of the scope object provides deterministic bytes for signing

**Consequences**:
- Verification algorithm has two paths (legacy vs. scoped)
- Scoped signatures are larger (include scope object)
- Layout file hashes must be computed and included in scope
- Applications must expose the scope distinction in signature UI

---

## DD-019: Declarative Forms Validation Only

**Decision**: Form validation rules must be purely declarative JSON. No executable expressions (JavaScript or otherwise) are permitted.

**Alternatives Considered**:
1. JavaScript expression strings (like PDF form scripts)
2. Sandboxed expression language
3. WebAssembly-based validators
4. No custom validation (built-in validators only)

**Rationale**:
- **Consistent with DD-010** — The core specification explicitly excludes executable content. PDF JavaScript is cited as a cautionary tale in DD-010, and allowing it in form validation would undermine that decision
- **Security** — Expression evaluation opens injection attack vectors. Even "sandboxed" JavaScript has a long history of sandbox escapes
- **Declarative sufficiency** — The built-in validators (`required`, `minLength`, `maxLength`, `min`, `max`, `pattern`, `email`, `url`, `containsUppercase`, `containsLowercase`, `containsDigit`, `containsSpecial`, `matchesField`) cover the vast majority of form validation needs
- **Pattern validator as escape hatch** — The `pattern` validator accepts regular expressions, providing complex string matching without executable code
- **Implementer simplicity** — Declarative rules can be validated by any JSON processor without requiring a JavaScript runtime

**Consequences**:
- Field-dependent validation is still expressible declaratively through the `conditionalValidation` construct: a `when` condition on another field (`equals`, `notEquals`, `isEmpty`, `isNotEmpty`) gates a `then` set of validators — for example, "field B is required only when field A is non-empty". What remains out of scope is validation requiring arbitrary computed predicates, such as the numeric comparison "field A > 10", since evaluating those would need an expression evaluator; that logic belongs in the application layer, not the document format
- The `pattern` validator inherits regex complexity concerns, but regex is well-understood and does not enable arbitrary code execution

---

## DD-020: Tagged Block Merkle Construction (cdx-bmt-1)

**Decision**: The block-level Merkle tree (core 09 §4) uses RFC 6962-style tagged hashing — leaf = `H(0x00 ‖ JCS(block))`, internal = `H(0x01 ‖ left ‖ right)` — and promotes an unpaired odd node unchanged to the next level. The construction carries a wire identifier (`cdx-bmt-1`) in the block index, the manifest `content` reference, and the provenance `merkle` summary. The §5.2 block-proof fold is thereby **decoupled** from the §6.5 aggregated-timestamp fold, which remains untagged raw concatenation.

**Alternatives Considered**:
1. Keep the disclosed-but-open construction (untagged, duplicate-odd) — the prior status quo
2. RFC 6962 Merkle Tree Hash exactly (split at the largest power of two below n)
3. Reject odd node counts outright (require padding at the data layer)
4. Tagged hashing with odd-node promotion (chosen)

**Rationale**:
- **Pre-ossification window** — no code, fixture, or implementation had yet computed a block-level root, so the construction could be hardened with zero migration cost; domain-separation tags are exactly the kind of change that cannot be retrofitted compatibly once roots circulate
- **Closes both disclosed defects** — duplicate-odd lets two distinct block sets share one root (the CVE-2012-2459 pattern); untagged nodes let an internal value be replayed as a leaf. Tags plus promotion close both, and promotion is collision-safe precisely *because* of the tags (a promoted value can never be reinterpreted at the other role)
- **Promotion over the 6962 split** — promotion keeps the §4.3 pairing algorithm a three-line loop and yields the same security properties under tagging; the 6962 split changes tree shape for no additional guarantee here
- **Why §6.5 stays untagged** — the aggregated-anchor proof shape is fixed by external aggregators (OpenTimestamps); CDX tags cannot be imposed on it. The two folds were previously pinned identical in prose; they are now defined as deliberately distinct, and `check:block-merkle` regression-pins the divergence in both directions
- **Wire-detectable evolution** — the `construction` identifier means any future change produces a detectably different declaration instead of silently altering what a stored root means

**Consequences**:
- The block-level root remains **advisory** in this version: it is bound by neither the document ID nor the manifest projection (`construction`, like `merkleRoot`/`blockCount`, is dropped from the projection — pinned by a manifest-projection KAT vector). Binding the root, and with it trusted redaction/inclusion proofs, is deferred future work
- `scripts/lib/block-merkle.ts` is the executable reference (independent-oracle KATs, corpus grounding of the shipped block index); `check:block-merkle` gates it in CI
- An implementation that applied the §6.5 untagged fold to block proofs (or vice versa) now fails verification instead of silently interoperating with the wrong construction

---

## DD-021: Review-State Projection Binding Considered and Rejected

**Decision**: Signatures on `draft`/`review` documents remain permitted to be content-only (`scope.documentId` alone); the manifest-projection coverage requirement stays scoped to `frozen`/`published` (security extension section 9.8). The lifecycle-downgrade residual is instead *argued minimal* — the section 9.8 reduction note decomposes every downgraded presentation into reuse of an honestly-made content-only signature, a fresh content-only attestation under a pinned credential (the minting party's own identity over genuine content), or unsigned content; in no case is tampered content presented as signed or an honest non-signer impersonated.

**Alternatives Considered**:
1. Require `scope.manifest` on every signature once the document ID is computed (review state included)
2. Add a minimal signed `scope.state` field short of the full projection
3. Keep content-only review signatures and document the reduction (chosen)

**Rationale**:
- **The hardening buys little** — requiring review-state projection coverage narrows the residual only from "replay an honest review-era artifact with a spoofable manifest" to "replay the exact review-era artifact"; the replay itself — the substantive attack — remains, because freshness is unsolvable inside a self-contained file (the provenance chain's no-external-infrastructure principle names the transparency-log alternative a deliberate non-goal, core 09 §2.1)
- **And costs real workflow** — a review document's manifest legitimately churns (presentation layers added, lineage notes edited, extensions declared); binding the projection would invalidate every signature on each such edit, precisely at the lifecycle stage where signatures are optional advisory attestations rather than the frozen contract
- **A signed `scope.state` alone (alternative 2)** inherits the same churn problem for state transitions while authenticating too little to close anything the full projection would not
- **Fail-honest posture preserved** — the verifier obligations stand: state is never represented as authenticated on a content-only signature, and a content-only presentation draws a warning (section 9.8)

**Consequences**:
- Content-only signatures remain available below `frozen`, preserving signature survival across review-stage manifest churn
- The lifecycle-downgrade disclosure is upgraded from "known limitation" to "disclosed residual with a minimality argument" (section 9.8 reduction note; State Machine section 5.4.2 note 3)
- Closing the replay case, if ever required, is external-infrastructure work (a transparency log or verifier-side expected-ID pinning), not a signature-scope change

---

## DD-022: Extension-Namespace Block Ids Left as Authored

**Decision**: A `semantic:term` and a `semantic:footnote` block keep their own `id` as authored through canonicalization (Document Hashing section 4.3.1 item 5). The id stays a full member of the shared identifier namespace — it occupies the uniqueness space, a duplicate is a canonicalization error, and a Content Anchor URI resolves against it — and only the *relabeling* skips it. Because it is left as authored it MUST NOT spell a canonical name (`b` followed by digits), and the `b<n>` sequence compacts over it rather than reserving an index.

**The problem**: These two blocks are the *defining* side of references that address separate namespaces and are themselves never relabeled — a `glossary` mark's `ref` and a `semantic:term` `see` resolve against a term block's `id` (Semantic Extension section 8.3 rule 2), and a `footnote` mark against a `semantic:footnote` block (section 4.5.2). Relabeling only the definition left both rules unsatisfiable on the canonical form: the block became `b0` while the reference still named `term-algorithm`. Resolution therefore had to run over raw stored content for the rules to have any effect at all.

**Alternatives Considered**:
1. Relabel the `glossary` `ref` and `see` into the canonical namespace instead, so both sides move together
2. Remove these ids from the shared namespace entirely, making them a private extension namespace
3. Leave the ids as authored while keeping them in the shared namespace (chosen)

**Rationale**:
- **Alternative 1 only works when no external glossary is declared.** Section 8.3 makes an external `semantic/glossary.json` authoritative when present, and a `ref` then resolves against the *file's* term ids, not the in-document blocks'. Relabeling the `ref` would make the document ID depend on whether a glossary file happens to be attached — the same content hashing to two different ids according to a side file that is not itself in the document hash.
- **Alternative 2 breaks anchor resolution and collision detection.** `definedId` is the single membership test, shared by the renamer and by the conformance reference resolver. Removing these ids from it would silently make `#term-id` links dangle and stop reporting a duplicate term id, trading one unsatisfiable rule for two broken ones.
- **Both rules were already correct** and merely unsatisfiable post-canonicalization. That neither needed rewording under the chosen option — verified against section 8.3 rule 2 and section 4.5.2 directly — is the evidence that the defect was in the relabeling, not in the prose.

**Consequences**:
- **An explicit exception to id-label purity.** A document differing only in a term or footnote id label no longer shares a document ID. Item 5's opening promise ("two documents differing only in their id *labels* produce the same document ID") now holds for every namespace member except these two.
- **Membership is keyed on block `type`**, departing from item 5's stated "membership is keyed on WHERE an id sits" principle. This is a necessity rather than an oversight: a term block's id sits directly on the block, exactly where any other block id sits, so position cannot distinguish it. Recorded in the spec text so a future reader does not read it as an inconsistency.
- **A new canonicalization error carries the weight.** Duplicate detection compares *authored* ids, so an authored `b0` on a preserved block does not collide with the `b0` generated for another block; without the prohibition both reach the canonical output under one identifier and a `#b0` reference binds to whichever the reader meets first. This is the one place a subtle bug would survive otherwise-green gates.
- **Index compaction is stated, not implied.** Reserving an index for a preserved occurrence is equally implementable and yields a different document ID for identical content, which would fork two conformant implementations.
- **Document ids change** for any document carrying a term or footnote block id.

---

## Open Questions

### OQ-001: Binary Variant

Should there be an optimized binary serialization (CBOR/MessagePack)?

**Status**: Deferred to v1.x
**Considerations**: Performance vs complexity tradeoff

### OQ-002: Streaming Support

How should very large documents support streaming/chunked access?

**Status**: Under investigation
**Considerations**: ZIP supports range requests; content chunking TBD

### OQ-003: Collaborative Editing Protocol

Should the spec define a sync protocol or just data structures?

**Status**: Extension territory
**Considerations**: Many existing protocols; don't reinvent

### OQ-004: Digital Rights Management

Should the format support DRM?

**Status**: Explicitly out of scope
**Considerations**: Opens governance issues; encryption provides confidentiality

---

### OQ-005: Authenticated Annotations

Should there be an annotation-signature construction — a signature over an annotation's bytes plus the document ID — so approvals, sign-offs, and review decisions can be authenticated without re-freezing the document?

**Status**: Open; disclosed as out of scope for this version (security extension §3.10)
**Considerations**: Today every annotation, comment, and workflow status is advisory; authenticating a decision requires signed content or a required-signer policy, both of which force a new frozen version per approval. The collaboration and legal use cases will likely demand this first. Design tension: annotations live outside the hash boundary precisely so they never disturb document identity — an authenticated-annotation layer must preserve that while binding annotation bytes to a credential.

### OQ-006: Counter-Signatures and Signing-Order Binding

Should signatures be able to bind *over* other signatures ("notarized after signing"), establishing verifiable order?

**Status**: Open; disclosed as a residual limitation (security extension §3.12)
**Considerations**: The required-signer set declares which signers, never in what order; a signature-timestamp bounds when a signature existed but establishes no inter-signature order. A counter-signature scope (covering another signature's bytes) is the classic mechanism, but it breaks the current "independent, unordered set" model and its re-signing ergonomics. Relevant to the legal profile's notarization narrative (security extension §9.6).

### OQ-007: Defect Classes State Machine §5.4.2 Assigns No Row

Which disposition applies to a defect the §5.4.2 table does not tabulate?

**Status**: Open. Recorded here rather than only inside `conformance/errors.json`, so the gaps are visible in the register. A 2026-07 erratum closed several of these by adding rows (a divergent asset-index path, an undeclared presentation file), and a 2026-08 erratum closed two more (the stored-byte Unicode invariants, and the content root envelope). The rest are deliberately left, because closing them requires deciding normative content rather than transcribing it.

**Considerations**: Five distinct groups remain. **A `semantic:footnote` marker-uniqueness violation nothing references** — Semantic Extension §4.5.2 states "The resolution key MUST be unique across the document: no two `semantic:footnote` blocks may share an `id`, and — absent `id`s — no two may share a `number` or a `symbol`", but its reader rule is scoped to "a reader that finds a marker RESOLVING to more than one block". Two such blocks that no mark references therefore violate the MUST while §5.4.2 assigns nothing, and the suite reports nothing. Reporting it would mean choosing a disposition the specification does not state; the shared-`id` half is already covered, since block ids are in the document-wide identifier namespace where a duplicate is `CDX-E-ID-COLLISION`. **A canonicalization error with no reporting path at all** — a `semantic:term` or `semantic:footnote` id spelling a canonical name (§4.3.1 item 5's `b<digits>` prohibition, DD-022). This one is worse than a missing disposition: the throw is swallowed by the document-ID recompute's catch, which has no row to defer to, so the document loads reporting *nothing* and its declared `manifest.id` goes unverified. TWO silent throws now remain (this one and excess nesting depth), and they suppress the document-id signal identically; what distinguishes this one is reachability. Excess nesting depth needs structurally anomalous content, whereas `id: "b0"` is innocuous on its face and valid under the schema's id pattern, so an injected block carrying it suppresses the mismatch for the whole document without looking like an attack. No stored-byte arm is silent any longer: an unsafe integer, a non-NFC string and an ill-formed one are all reported by pre-canonicalization scans, and the 2026-08 erratum gave the latter two their own rows. Closing it needs a row and a code, not a stretched reading; the same shape as the rows the errata have added. **Manifest defects the generic row does not reach** — a duplicate `extensions[]` id, a presentation `type` outside the enum, one declared path carrying conflicting hashes, and four malformed `requiredSigners` shapes. The manifest projection fails closed on each (the projected bytes would otherwise be ambiguous), but "missing or mistyping a required field" does not describe a well-formed field carrying a bad *value*, and §5.4.2 gives the `state` enum its own row rather than relying on that generic one — evidence the generic row is not meant to absorb enum violations. These carry `disposition: null`, which the vocabulary is explicit is a gap and not permission to ignore. **A structurally invalid anchor POSITION** — Anchors and References §7.3 states `start < end`, non-negative offsets, and §2.2 states the field-combination and named-anchor rules, all as MUSTs; but §7.2's severity table covers only three conditions (a target that does not exist, a position exceeding the target's text length, an id collision), and §5.4.2 has no row of its own. The out-of-bounds case IS tabulated and so carries a concrete disposition; its structural sibling carries `disposition: null` on `CDX-E-ANCHOR-POSITION-INVALID`. **A hash-bound part that is present but unusable** — an asset index that parses yet yields no assets. The table's hash-bound row now reads "missing or unparseable", which covers an index that will not parse; what it still does not cover is one that PARSES and yields no usable assets, and Asset Embedding §3.1 makes having a *usable* index a MUST — so the suite reads that row as governing and records the reading. A dedicated row would make it transcribed rather than inferred. Note the shape of the argument in all five groups is the same one the errata accepted for the rows they added: where the specification states a MUST but the disposition table is silent, a row is the fix, not a stretched reading.

### OQ-008: What a Non-Array `marks` Means for §4.3.1 Item 5

`content.schema.json` requires a text node's `marks` to be an array. What should canonicalization do when it is a single object instead?

**Status**: Open. The reference implementation currently sweeps an id-bearing object under a non-array `marks` into the relabelled namespace, while leaving the identical object alone inside a valid `marks` array — a difference produced by the `Array.isArray` dispatch rather than by any rule §4.3.1 states. `scripts/test-canonicalize.ts` pins the behaviour so it cannot drift silently, deliberately as a unit test rather than a `document-id` known-answer vector: that kind publishes byte-exact expectations for third parties, and a conformant implementation may legitimately reject this content at schema validation and never run it.

**Considerations**: Item 5's namespace is stated as keyed on *where* an id sits, and it excludes "an identifier carried on a singular named sub-object" — which is arguably what a non-array `marks` value is, pointing at leaving the id as authored. Against that, the relabelled namespace is stated to include "the `id` of every block (including `namespace:type` extension blocks)", and the reference implementation reads a typed object outside a mark collection as one. Note the current behaviour is internally uneven: the same node is treated as a block for item 5 (its id relabels) but not for item 1 (its `crdt` is kept, correctly — a mark is neither a block nor a text node). Settling it needs an erratum plus paired changes to `walkContentNodes` and `rewriteIds`, which dispatch on `Array.isArray` independently. Related: the same question exists for any other field whose schema type is violated, so a general rule ("canonicalization is defined only over schema-valid content; a violation is a canonicalization error") may be the better fix than a per-field one.

---

### OQ-009: How a `footnote` Mark Whose `id` Matches No Block Resolves

Semantic Extension §4.5.2 says a `footnote` mark "resolves to its `semantic:footnote` block by a single key: when both the mark and a block carry an `id`, the mark's `id` MUST equal the block's `id` (id match takes precedence); otherwise the mark resolves by its marker value". What happens when the mark carries an `id` that matches no block, while its `number` or `symbol` matches one exactly?

**Status**: Open, and the reading is recorded rather than settled. The reference implementation falls back to the marker and reports nothing; `scripts/test-document-verdict.ts` pins that so it cannot drift silently, and `CDX-E-FOOTNOTE-REFERENCE-DANGLING`'s note records it. Recorded here as well, so the register — not a JSON `note` — is where the open readings live.

**Considerations**: The strict reading is at least as well supported and arguably better: "by a single key" selects one key, so a mark carrying an `id` is resolved by `id` and a miss is dangling. It is also the only reading under which §4.5.2's MUST can be violated at all — the charitable reading effectively re-reads the antecedent "when both … carry an `id`" as "when both carry an `id` *and they match*", which makes the MUST unfalsifiable. Two things nevertheless argue for recording rather than settling: the repo's standing rule is to prefer the non-reporting arm under an unsettled reading rather than invent a defect; and no published fixture or vector carries the disputed shape, so a third-party reader implementing the strict reading still passes the corpus, the comparator being a subset check. Note the divergence is warn-versus-silent, not one WARNING against another. Settling it needs an erratum to §4.5.2, not an implementation change. Same shape as OQ-008: a reading the implementation resolves one way, pinned by a unit test rather than a published vector.

### OQ-010: Whether Reference Resolution Descends into Opaque Extension Interiors

The content classifier treats an unknown `namespace:type` block's interior as opaque — "the reader does NOT interpret its interior as CDX content" — while canonicalization hashes those bytes and `collectDefinedIds` admits ids found there. Which model should the reference resolvers follow?

**Status**: Open, deferred to conformance phase B1b-3c, whose scope is extension-block interiors. Today all three semantic arms (citation, glossary, footnote) descend, following the hashing model.

**Considerations**: The descent is pre-existing and harmless for the citation and glossary arms, because those resolve against a flat id set where over-collection can only SUPPRESS a dangling report — the conservative direction. The footnote arm counts blocks per marker, and a count can MANUFACTURE a finding: a `semantic:footnote`-shaped object inside a `vendor:widget` payload makes a legitimately unique marker look ambiguous, and the mirror case resolves a mark whose only candidate lives in an ignored subtree. That inverts the direction stated throughout the codebase, e.g. `CollectOptions.assetMap`'s "rather than manufacturing a false one". Against fixing it here: §4.5.2 says nothing about opaque interiors, so this is a judgement call rather than a settled reading; pruning needs the derived vocabulary threaded into the walk shared with the canon-mirroring consumers; and fixing one arm would leave it inconsistent with the two beside it. The clean resolution is one pruning rule applied to all three arms at once, in the phase that owns interiors.

### OQ-011: Whether an Out-of-Range Anchor Position Escalates on an Extension Cross-Reference

Anchors and References §7.2 tabulates "Offset/range exceeds target block text length" at Warning in draft/review and **Error** in frozen/published, keyed on the *condition* and not on the field carrying it; §7.3 repeats the rule unqualified, and §7.2 closes by mapping its own table onto the disposition vocabulary with no field qualifier at all — "These severities are the WARNING and INTEGRITY-ERROR dispositions of State Machine section 5.4." State Machine §5.4.2 gives the `academic:*-ref` marks a row that is WARNING in **every** state, and its integrity-binding preamble keys that on the *kind* of reference: such a mark is resolved at render time, so a defect in it degrades rendering only while the signed bytes remain intact and hash-verified. Which governs a stale offset in an `academic:theorem-ref`?

**Status**: Open, and recorded rather than settled. Both readings assign WARNING in draft/review, so the conflict is confined to the frozen/published column, which B3 lights up; nothing observable diverges before then. What could not wait for B3 is the **code**: `CDX-E-CROSS-REFERENCE-POSITION-OUT-OF-RANGE` was split from `CDX-E-ANCHOR-POSITION-OUT-OF-RANGE` in B1b-3c-1a precisely so the column can be settled either way later. `conformance/errors.json` is append-only, so a single code shared across the two rows would have to be re-pointed to separate them — which the compatibility policy forbids. Splitting is available only *before* a disposition is published, never after.

**Considerations**: The asymmetry that makes this a genuine conflict rather than a preference is which rows reach the position case at all. §5.4.2's core-anchor row cites §7.2, and §7.2's table covers the offset condition, so that row reaches a position defect *by its own citation* — which is why `CDX-E-ANCHOR-POSITION-OUT-OF-RANGE` escalates without controversy. The cross-reference row cites no such table and covers a mark "whose target does not resolve", so it reaches the position case only by extension from the same field's dangle; meanwhile §7.2 reaches the condition directly, escalates it, and closes by mapping its table onto §5.4's dispositions unqualified. Reading §5.4.2 as governing has the stronger structural argument — §5.4's preamble names itself "the canonical reconciliation of the per-class rules stated throughout the specification", listing Anchors and References §7.2 among the sections it reconciles, and reserves the *mechanism* to those sections while defining the *disposition* itself.

**What tips it, without settling it**, is that the specification has already made this exact choice for the *neighbouring* failure in these *same* fields. Academic Extension §9 states that although a `*-ref` `target` "uses Content Anchor syntax", the three marks "are extension cross-references resolved at render time, so a dangling target is a rendering-degradation WARNING in all states (State Machine section 5.4), not the INTEGRITY-ERROR of a dangling core anchor" — and it says the same of `academic:proof`'s `of` and `academic:theorem`'s `uses`, calling out "**not** the FROZEN/PUBLISHED Error that Anchors and References section 7.2 assigns a dangling core anchor". That is *kind beats condition*, chosen explicitly and against §7.2 by name. It does not literally reach the position case, so it does not settle this question; what it does is make the two readings unequal, and it means any settling erratum has a **third** site to touch, not two. Note also what the escalating reading implies if taken: within one mark, a target that is **missing entirely** would stay a WARNING while one whose offset is merely **stale** became an INTEGRITY-ERROR — the milder defect disposed of more harshly, and in direct tension with the §9 text above.

**Where §9 does and does not reach, since an earlier draft of this entry got it backwards.** Both of §9's dispositions are scoped to "a **dangling** target"; neither mentions an offset or a range. So §9 settles the frozen column for a *dangling* `academic:proof.of` or `academic:theorem.uses[]` — which is `CDX-E-BLOCK-REFERENCE-DANGLING`'s case, not a position case — and reaches no position code at all. The sibling `CDX-E-BLOCK-REFERENCE-POSITION-OUT-OF-RANGE` therefore carries a *wider* contest than its dangling counterpart, not a narrower one: all four of its fields remain contested. And what §9 *does* settle cuts the other way for it, because classifying `of` and `uses` as render-time cross-references moves those two fields **into** the conflict recorded here rather than out of it.

That inversion has a consequence worth stating plainly, because it is cheap to record now and expensive to discover in B3. `CDX-E-BLOCK-REFERENCE-DANGLING` covers four fields under one scalar disposition, and §9 settles the frozen column for two of them while leaving the other two contested. If B3 takes the core-anchor reading for `semantic:ref.target` and `presentation:reference.target`, those escalate while §9 holds `of`/`uses` at WARNING — one code, two frozen columns. Separating them is exactly the remedy the position arm used, but that code was **published at v0.13**, so the split is no longer free: it now costs a successor code and a deprecation rather than a separation. The window that made the position split cheap is the same window that has already closed on its dangling sibling.

### OQ-012: Whether an Extension Block With Text-Node Children Is a Text-Bearing Anchor Target

Anchors and References §3 defines a text-bearing block as "a block whose `children` are text nodes", illustrating it with five core types. `semantic.schema.json`'s `refBlock` (`semantic:ref`) declares `children.items.$ref` pointing at `content.schema.json`'s `textNode` — so by §3's definition it is text-bearing, and a character offset into it should address its concatenated text. Is it a legitimate anchor target?

**Status**: Open, and the reference implementation currently says NO — by omission rather than by decision. `deriveContentVocabulary` reads only `content.schema.json`'s `$defs`, so no extension-defined block can enter the text-bearing set. The observable effect is the same class of defect the `codeBlock` fix closed: an in-bounds anchor into a `semantic:ref` reports `CDX-E-ANCHOR-POSITION-INVALID` ("target is not a text-bearing block") on conformant content, and an out-of-bounds one is downgraded from the WARNING §7.2 tabulates to that null disposition. Measured, not inferred. The blast radius is exactly one type: `semantic:ref` is the only block outside `content.schema.json` whose children reach `textNode`.

**Considerations**: This is a specification question before it is an implementation one, which is why it is recorded rather than fixed. `refBlock`'s `children` are described as "Display content (text nodes)" and it separately carries `format`, a "Display format template" such as `'Section {number}'` — so if a reader generates the rendered text from `format` and the resolved target rather than taking it from `children`, what a character offset into such a block addresses is genuinely ambiguous: the authored fallback text, or the generated text, which differ. §3 does not contemplate a block whose text is generated. Two coherent answers exist — extend the derived set to extension schemas and treat authored `children` as the addressable text, or state that extension blocks are not character-offset anchor targets at all — and the second is arguably better aligned with §3's requirement that a character-offset anchor target a block whose text content is well defined. Note also that the Python oracle hand-transcribes the same five names, so it **shares** the blind spot: unlike `codeBlock`, where the two implementations were corrected together, no cross-implementation disagreement can surface this one. That makes it a case the corpus cannot catch, and the reason it is written down here instead. Settling it belongs with B1b-3c-1b, whose scope is extension-block interiors, and whichever way it goes the fix must land on both implementations at once.

## Strategic Insights

This section captures key strategic insights from early design discussions that inform the specification's direction and adoption approach. Full discussion notes are archived in `docs/archive/`.

### SI-001: Technical Merit vs Adoption

**Insight**: Technical problems are real and documented, but technical merit is approximately 20% of what determines format success. The other 80% is ecosystem, timing, and adoption strategy.

**Evidence**:
- PDF signature vulnerabilities proven in published security research (21 of 22 desktop viewers vulnerable)
- View/edit divide creates universal workflow friction
- Multi-billion dollar AI extraction industry exists because PDF structure is unreliable

**Implication**: Technical case is necessary but not sufficient. A spec without robust tooling is just documentation.

---

### SI-002: Beachhead Strategy — Academia First

**Insight**: Academia is the optimal initial adoption target, with legal/enterprise as a secondary market.

**Why Academia**:
- Lower switching costs (no enterprise contracts, IT approval chains)
- Cultural alignment with open standards
- Acute pain points: citations as flat text, figures as inaccessible blobs, unreliable text extraction
- LaTeX users prove academics tolerate complexity for better output
- Natural integration points: Overleaf, Zotero, Pandoc, Jupyter
- Long-term pipeline: grad student → professor → journal editor → department mandate (10-15 year arc)

**Why Legal Secondary**:
- High pain point but high friction (entrenched tooling, tech-averse users)
- Better play: become "killer feature" for tooling vendor entering legal market
- "If lawyers trust it for contracts" provides powerful social proof

---

### SI-003: Development Philosophy

**Insight**: Start solo, design for OSS. Empty repos don't attract contributors; working code does.

**Approach**:
1. Begin implementation alone to move fast and establish patterns
2. Design for OSS from day one (clear architecture, good docs, contribution points)
3. Open implementation once there's something functional to contribute to
4. The spec is already open — that's the legitimacy part

**Rationale**: Speed now, community later. Avoid "design by committee" early.

---

### SI-004: Implementation Priorities

**Insight**: Pandoc integration is the highest-leverage early move.

**Build Order**:
1. **cdx-core** (Rust library) — Foundation everything else builds on
2. **cdx-cli** — Dogfoods the core library, essential for tooling development
3. **Pandoc writer** — Markdown → CDX (the academia unlock)
4. **Web viewer** — cdx-core compiled to WASM (zero-install demonstration)

**Why Pandoc**: Academics don't adopt new editors, they adopt new export targets. A Pandoc writer fits existing workflows with zero friction for authors.

---

### SI-005: Spec Evolution Principles

**Insight**: Specs accumulate ad-hoc solutions. Catching inconsistencies early (pre-v1.0) and unifying is much cheaper than fixing later.

**Lessons Learned**:
- "Where does this live?" is the critical question for new features (inside vs outside hashing boundary)
- Contradictions hide in prose — normative algorithms trump aspirational text
- Each fix pulls on connected threads — changes are individually clean but interdependent

**Example**: Three extensions independently invented sub-block addressing. Unifying into the anchor system prevented fragmentation.
