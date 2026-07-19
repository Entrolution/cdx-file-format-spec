# Changelog

All notable changes to the CDX file format specification.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1] - 2025-01 (Draft)

### Added

#### Core Specification
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
- Content schema now references legal extension marks (`legal:cite`)
- Document maturity tiers introduced (Introduction §1.8.1: Hardened / Draft / Experimental) and applied — every core doc, extension, and profile carries a `Maturity` header (trust core: Document Hashing, State Machine, Provenance, Security extension → Hardened); Provenance §5.3–5.4 proof shapes and the standalone §6.4 blockchain timestamp type are marked Experimental (the latter a candidate for extraction, with the §6.5 aggregated anchor's use of its rules staying normative); README Roadmap gains a "Deferred capabilities" section aggregating the disclosed-not-closed items with pointers; OQ-005 (authenticated annotations) and OQ-006 (counter-signatures/order binding) added to the design-decisions register
- Security extension: hybrid PQC signing specified as a concrete profile (two independent signatures — classical + ML-DSA-65 — bound via `signaturePolicy.requiredSigners`; §8.2), replacing an unspecified capability claim; new §4.7 defines sign+encrypt composition (sign-then-encrypt only, logical plaintext manifest references, decrypt-incapable consumers fail closed); §5.3 permission vocabulary explicitly labeled workflow declarations, not enforcement; §9.8 lifecycle-downgrade disclosure upgraded with a reduction argument showing the residual is minimal (every downgraded presentation is honest-signature reuse, a fresh pinned-credential attestation of genuine content, or unsigned content — never tampered content presented as signed; see DD-021, which records the considered-and-rejected review-state projection binding); §4.7 also reconciles encrypted-part existence with the core missing-part dispositions (new State Machine note 5); introduction design goal 3 tightened to match §9.8 (frozen/published signatures bind state)
- Block-level Merkle tree hardened to the tagged `cdx-bmt-1` construction (core 09 §4.2–4.3): RFC 6962-style leaf/internal domain separation (`0x00`/`0x01`), odd nodes promoted instead of duplicated — closing the two previously disclosed defects (CVE-2012-2459-pattern duplication, leaf/internal ambiguity). The §5.2 block-proof fold is decoupled from the §6.5 aggregated-timestamp fold (which stays untagged raw concatenation, fixed by external aggregators). Adds a `construction` wire identifier, a `block-index.schema.json`, the `scripts/lib/block-merkle.ts` reference implementation with independent-oracle KATs, the `check:block-merkle` gate, and a worked `content/block-index.json` in the comprehensive-document example. The root remains advisory (unbound by the document ID and manifest projection); see DD-020

### Notes
- This is an initial draft specification
- The collaboration extension migrated from v0.1 to v0.2 (anchor-based addressing)
- Feedback welcome via GitHub issues
