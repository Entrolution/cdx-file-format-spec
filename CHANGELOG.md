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
- Block-level Merkle tree hardened to the tagged `cdx-bmt-1` construction (core 09 §4.2–4.3): RFC 6962-style leaf/internal domain separation (`0x00`/`0x01`), odd nodes promoted instead of duplicated — closing the two previously disclosed defects (CVE-2012-2459-pattern duplication, leaf/internal ambiguity). The §5.2 block-proof fold is decoupled from the §6.5 aggregated-timestamp fold (which stays untagged raw concatenation, fixed by external aggregators). Adds a `construction` wire identifier, a `block-index.schema.json`, the `scripts/lib/block-merkle.ts` reference implementation with independent-oracle KATs, the `check:block-merkle` gate, and a worked `content/block-index.json` in the comprehensive-document example. The root remains advisory (unbound by the document ID and manifest projection); see DD-020

### Notes
- This is an initial draft specification
- The collaboration extension migrated from v0.1 to v0.2 (anchor-based addressing)
- Feedback welcome via GitHub issues
