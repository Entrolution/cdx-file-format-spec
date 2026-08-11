# Changelog

All notable changes to the CDX file format specification.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1] - 2025-01 (Draft)

### Added

#### Core Specification
- Security Model document (spec/core/11-security-model.md): consolidated attacker model, guarantees/non-guarantees inventory, the lifecycle-downgrade reduction in context, an informative mapping of the published PDF signature attack classes (ISA/SWA/USF, shadow attacks, certification attacks) onto CDX mechanisms and residuals, a verifier-obligations index (the scoping brief for external review), and a disclosure index locating every accepted-limitation statement
- Document manifest with state machine (draft → review → frozen → published)
- Content block model with 22 block types
- Dublin Core metadata support
- Asset embedding and management
- Provenance and lineage tracking
- Anchors and references system
- Presentation layers (paginated, continuous, responsive, precise)
- Highlight annotation documentation in collaboration extension (Section 4.7)

#### Extensions
- **Academic** (`cdx.academic`) - Theorems, proofs, exercises, algorithms, equation groups
- **Collaboration** (`cdx.collaboration` v0.2) - CRDT integration, comments, change tracking, presence
- **Forms** (`cdx.forms`) - Interactive form fields with validation
- **Legal** (`cdx.legal`) - Citations, Table of Authorities, court captions, signature blocks
- **Phantoms** (`cdx.phantoms`) - Off-page annotation layer for spatially-organized content (research notes, marginalia, mind-maps)
- **Presentation** (`cdx.presentation`) - Advanced typography, master pages, print features
- **Security** (`cdx.security`) - Digital signatures, encryption, redaction, scoped signatures
- **Semantic** (`cdx.semantic`) - Bibliography, footnotes, glossary, entity markup, JSON-LD

#### Profiles
- Simple Documents profile for recreational reading

#### Examples
- Legal extension example document (`examples/legal-document/`)
- Precise layout example (`examples/presentation-document/presentation/layouts/letter.json`)

#### Tooling
- Conformance defect vocabulary `conformance/errors.json` **v0.11**: new code `CDX-E-MANIFEST-FIELD-MISSING` (REJECT) for an absent required manifest field, taking the no-`metadata`-reference arm that `CDX-E-METADATA-PART-MISSING` previously carried at WARNING; `CDX-E-ASSET-INDEX-PATH-DIVERGENT` moves from `disposition: null` to REJECT now that §5.4.2 assigns it a row. The `compatibilityPolicy` gains four rules stating what a specification erratum may change in a published entry — `clause`/`dispositionClause` re-synced to amended text, a null disposition made concrete when the gap closes, a `summary` narrowed (never widened) when one of its arms moves to a new code, and rows cited by quoting them rather than by number. A concrete disposition still never becomes a different concrete disposition
- JSON Schema validation for all specification components
- Example document validation
- Cross-reference validation
- Spec-schema synchronization checking
- Example coverage checking capability in sync checker
- Template generation script

### Fixed
- Broken cross-reference in presentation layers spec (Section 5.1.2 → 5.4)
- Sync checker false positives for MIME types, token types, and enum values

### Changed
- **Specification errata (five decisions transcribed into normative text).** Each closes a place where the conformance suite had to record a *reading* because §5.4.2 assigned no row or the specification contradicted itself. (1) **Absent metadata is a manifest defect, not a metadata defect** — §5.4.2's metadata row is now explicitly PART-level (a Dublin Core part referenced but absent or unparseable, or a missing required term), and an absent or mistyped `metadata`/`metadata.dublinCore` *field* falls under the manifest row instead. This is a normative TIGHTENING: a manifest declaring no `metadata` previously loaded with a warning and is now REJECT, which is what the schema always implied, `metadata` being required and `dublinCore` required within it. (2) **The out-of-hash extension-data row's examples corrected** — a semantic bibliography or glossary and an academic numbering configuration are declared as `{path, hash}` pairs that the manifest projection binds, so they were never "path-only" and the row's own qualifier excluded them; the hash-bound row governs, making them INTEGRITY-ERROR when frozen rather than WARNING. That row keeps genuinely path-only data such as `metadata.jsonld`. The HASH-BOUND row correspondingly gains "or unparseable" (excluding the `content` part, which its own row rejects, and the unobtainable-bytes cases of notes 5 and 6), so a projection-bound side file that is present but will not parse is not stranded between the two. The academic extension's own integrity note, which asserted the opposite disposition for `numbering.json`, is corrected to match. (3) **A declared asset-index path that diverges from the derived location is now REJECT** — Asset Embedding §3.1 stated the equality as a MUST and then resolved a disagreement leniently ("the derived path governs"); that sentence is deleted and §5.4.2 gains a REJECT row, because a divergence leaves the document ambiguous — a reader honouring the declaration and one honouring the derivation resolve the category's assets differently — and splits identity from attestation, the projection binding the declared path's hash while the document ID inherits the asset hashes listed in the file at the derived path. No projected bytes change: for every loadable document the two paths name one file. The row states the comparison rule (§4.3.1 path normalization) so "does not equal" is not left to the reader. (4) **`flowElement.blockIds` named** — Presentation Layers §13.4 and the dangling-presentation-reference row enumerated only `blockId` and `blockRefs`, though a flow element's `blockIds` references content blocks identically (§6.4). §13.4 now names all three and scopes the completeness claim to fields *within a presentation-layer or precise-layout file*, since a `presentation:reference` block's `target` also addresses a content block but lives in the content tree rather than a presentation file (which row disposes of a dangling one is a separate question the erratum does not settle); the `blockId` parenthetical also picks up `preciseElement` (§12.3), which is a different type from `pageElement`. No behavioural change. (5) **A dedicated §5.4.2 row for an undeclared presentation or precise-layout file** — WARNING in draft/review, INTEGRITY-ERROR when frozen or published, replacing a disposition previously inferred from the §5.4.2 preamble and Presentation Layers §12. The row states the membership test the disposition turns on (a precise layout carries `presentationType`, a reactive presentation a `type` of `paginated`, `continuous`, or `responsive`; any other file under `presentation/` stays IGNORE) and the unrecognized-file row is carved out to match, so the two no longer both reach one artifact. A second normative TIGHTENING: §12's "SHOULD be surfaced as an integrity concern" becomes a MUST, since an INTEGRITY-ERROR obliges a reader to surface the failure (§5.4.1) and a SHOULD cannot support that; §12 also now states that an undeclared *reactive* presentation file is covered, which it previously left to the §5.4.2 preamble alone
- Container Format §3.2's compression-method table is now stated to be the **complete permitted set**, and a reader MUST NOT infer a method from the data (in particular MUST NOT treat an unrecognized method as Deflate). This is a normative NARROWING: "MAY use the following" granted permission for those three methods without by itself forbidding others, and §3.1's APPNOTE.TXT conformance defines BZIP2, LZMA, XZ and PPMd — so an archive using one of those was arguably conformant and now is not. Two new State Machine §5.4.2 rows dispose of the closed set (a forbidden method, and an entry that will not decode under a permitted one — both REJECT), and a new note 6 covers the opposite case: an entry using a PERMITTED method the reader has not implemented (Zstandard is RECOMMENDED, not required) is not a defect, is reported integrity-indeterminate, and MUST NOT fire the missing-part rows — mirroring note 5 for encrypted parts, including its document-level conclusion where the entry carries required or hash-bound content. §5.4.1 gains a paragraph stating that integrity-indeterminate is not one of the four dispositions. Motivated by a reference-reader defect: treating every non-Store method as Deflate meant a Zstandard entry threw, the throw was swallowed, and the archive reported clean with its CRC-32 and every hash over those bytes unverified
- Content schema now references legal extension marks (`legal:cite`)
- Document maturity tiers introduced (Introduction §1.8.1: Hardened / Draft / Experimental) and applied — every core doc, extension, and profile carries a `Maturity` header (trust core: Document Hashing, State Machine, Provenance, Security extension → Hardened); Provenance §5.3–5.4 proof shapes and the standalone §6.4 blockchain timestamp type are marked Experimental (the latter a candidate for extraction, with the §6.5 aggregated anchor's use of its rules staying normative); README Roadmap gains a "Deferred capabilities" section aggregating the disclosed-not-closed items with pointers; OQ-005 (authenticated annotations) and OQ-006 (counter-signatures/order binding) added to the design-decisions register
- Security extension: hybrid PQC signing specified as a concrete profile (two independent signatures — classical + ML-DSA-65 — bound via `signaturePolicy.requiredSigners`; §8.2), replacing an unspecified capability claim; new §4.7 defines sign+encrypt composition (sign-then-encrypt only, logical plaintext manifest references, decrypt-incapable consumers fail closed); §5.3 permission vocabulary explicitly labeled workflow declarations, not enforcement; §9.8 lifecycle-downgrade disclosure upgraded with a reduction argument showing the residual is minimal (every downgraded presentation is honest-signature reuse, a fresh pinned-credential attestation of genuine content, or unsigned content — never tampered content presented as signed; see DD-021, which records the considered-and-rejected review-state projection binding); §4.7 also reconciles encrypted-part existence with the core missing-part dispositions (new State Machine note 5); introduction design goal 3 tightened to match §9.8 (frozen/published signatures bind state)
- Block-level Merkle tree hardened to the tagged `cdx-bmt-1` construction (core 09 §4.2–4.3): RFC 6962-style leaf/internal domain separation (`0x00`/`0x01`), odd nodes promoted instead of duplicated — closing the two previously disclosed defects (CVE-2012-2459-pattern duplication, leaf/internal ambiguity). The §5.2 block-proof fold is decoupled from the §6.5 aggregated-timestamp fold (which stays untagged raw concatenation, fixed by external aggregators). Adds a `construction` wire identifier, a `block-index.schema.json`, the `scripts/lib/block-merkle.ts` reference implementation with independent-oracle KATs, the `check:block-merkle` gate, and a worked `content/block-index.json` in the comprehensive-document example. The root remains advisory (unbound by the document ID and manifest projection); see DD-020

### Notes
- This is an initial draft specification
- The collaboration extension migrated from v0.1 to v0.2 (anchor-based addressing)
- Feedback welcome via GitHub issues
