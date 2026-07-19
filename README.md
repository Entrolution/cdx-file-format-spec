# CDX

[![Validate Schemas](https://github.com/Entrolution/cdx-file-format-spec/actions/workflows/validate-schemas.yml/badge.svg)](https://github.com/Entrolution/cdx-file-format-spec/actions/workflows/validate-schemas.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**CDX — Content-addressed Document eXchange.** An open specification for documents that unify viewing and editing, with modern security and machine readability.

> Status: Draft Specification (v0.1)

## Problem Statement

The document landscape is fundamentally divided:

- **View-optimized formats** (PDF, DJVU) offer layout fidelity but poor editability
- **Edit-optimized formats** (DOCX, ODF, Markdown) enable rich editing but render inconsistently
- **No existing format** excels at both viewing and editing

This divide creates workflow friction, format conversion overhead, and lost fidelity. Additionally:

- **PDF's security model is broken**: 21 of 22 desktop viewers vulnerable to signature attacks
- **Machine readability is an afterthought**: 73-96% accuracy even with state-of-the-art extraction
- **Compression is outdated**: PDF uses 30-year-old DEFLATE, missing modern algorithms
- **No clear "frozen" semantics**: Signatures don't truly lock documents
- **No verifiable history**: Document lineage and provenance are external concerns, not built-in
- **Appearance varies by viewer**: Even PDF renders differently across implementations

## Design Goals

### Primary Goals

1. **Unified View/Edit Mode**: One format from draft to archive, no conversion step
2. **Semantic-First**: Content stored as meaning, presentation derived
3. **Modern Security**: Algorithm-agile cryptography, post-quantum ready
4. **Machine Readable**: AI/ML extraction works reliably by design
5. **Content-Addressable**: Document hash is its identity; modifications create new versions
6. **Verifiable Provenance**: Built-in hash chains and Merkle trees for tamper-evident history

### Secondary Goals

- Efficient compression using modern algorithms (Zstandard, AVIF)
- Clear document state machine (draft → review → frozen/signed)
- State-aware presentation (reactive for drafts, precise when page-precise fidelity is required)
- Block-level proofs (prove a section exists without revealing the whole document)
- Timestamp anchoring (RFC 3161, blockchain)
- Accessibility built-in (WCAG-aligned)

### Non-Goals

- Replacing PDF for legacy/archival use cases
- Supporting scripting/executable content (security risk)
- Achieving 100% PDF import fidelity

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    DOCUMENT CONTAINER                        │
│  (ZIP archive, content-addressable hash = identifier)        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │ MANIFEST         │  │ CONTENT STREAMS                  │ │
│  │ - Version        │  │ ┌────────────────────────────┐   │ │
│  │ - State          │  │ │ Semantic Document Layer    │   │ │
│  │ - Signatures[]   │  │ │ (JSON blocks + Merkle tree)│   │ │
│  │ - Lineage        │  │ └────────────────────────────┘   │ │
│  │ - Merkle root    │  │ ┌────────────────────────────┐   │ │
│  └──────────────────┘  │ │ Presentation Layer(s)      │   │ │
│                        │ │ - Reactive (hints/styles)  │   │ │
│  ┌──────────────────┐  │ │ - Precise (exact coords)   │   │ │
│  │ SECURITY LAYER   │  │ └────────────────────────────┘   │ │
│  │ - Signatures     │  │ ┌────────────────────────────┐   │ │
│  │ - Encryption     │  │ │ Assets                     │   │ │
│  │ - Timestamps     │  │ │ (images, fonts, embeds)    │   │ │
│  └──────────────────┘  │ └────────────────────────────┘   │ │
│                        └──────────────────────────────────┘ │
│  ┌──────────────────┐                                       │
│  │ PROVENANCE       │  ← Links to parent document hash      │
│  │ - Parent hash    │    (documents form a hash chain)      │
│  │ - Ancestors      │                                       │
│  │ - Timestamps     │                                       │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

## Key Feature: Verifiable Provenance

CDX documents form a **cryptographic hash chain** — each document's identity IS its content hash, and each document can reference its parent by hash:

```
doc-v1 (sha256:aaa)  ←──  doc-v2 (sha256:bbb)  ←──  doc-v3 (sha256:ccc)
      │                        │                        │
      └── parent: null         └── parent: aaa          └── parent: bbb
```

This enables:

- **Tamper-evident history**: Forging an intermediate version is computationally infeasible
- **No external infrastructure**: Documents themselves ARE the chain
- **Block-level Merkle proofs**: Prove a specific section exists without revealing the whole document
- **Selective disclosure**: Share redacted documents with cryptographic proof of what was removed
- **Timestamp anchoring**: Anchor document hashes to RFC 3161 TSAs or public blockchains

## Key Feature: State-Aware Presentation

CDX uses **progressive enhancement** for presentation — the level of layout precision evolves with document maturity:

| Document State | Presentation Requirement | What's Frozen |
|----------------|-------------------------|---------------|
| DRAFT | Reactive only (hints/styles) | Nothing — content flows freely |
| REVIEW | Reactive (precise optional) | Nothing — still editing |
| FROZEN | Reactive (precise when fidelity required) | Content immutable; a declared precise layout is bound (locked) |
| PUBLISHED | Same as FROZEN | Authoritative, immutable record |

### Why This Matters

When a frozen or published document includes a **precise layout** (exact coordinates for every element), that layout becomes part of the immutable record:

- **Semantic content is the hash**: The document ID covers semantic content only — what it says, not how it looks
- **Appearance is locked alongside content**: A precise layout is separate from the content hash, but declaring it in the manifest binds its file hash into the manifest projection — which a frozen or published document's signature must cover — so its appearance is attested by default (Security Extension)
- **Citations are reliable**: "Page 7, line 23" means the same thing in every viewer
- **Legal/archival integrity**: documents that assert page-precise fidelity commit an immutable, signature-bound layout that cannot be silently altered
- **No viewer inconsistency**: Unlike PDF, whose appearance varies by renderer

This is the key insight: **the state machine isn't just about workflow** — it ties presentation precision to content stability. Freezing always locks the semantic content; documents that assert page-precise fidelity also declare the precise layout in the manifest, binding it into the signature-covered projection so it cannot be silently altered.

```
DRAFT                    FROZEN/PUBLISHED
┌─────────────────┐      ┌─────────────────┐
│ Semantic content│      │ Semantic content│  ← Document ID
│ (JSON blocks)   │      │ (JSON blocks)   │    (content hash)
├─────────────────┤      ├─────────────────┤
│ Reactive hints  │  →   │ Reactive hints  │
│ (optional)      │      │ + Precise layout│ ← When fidelity required
└─────────────────┘      │ (exact coords)  │    (bound into the
                         └─────────────────┘     manifest projection)
```

## Specification Structure

The specification is modular:

### Core Specification (Required)

- [Container Format](spec/core/01-container-format.md) - ZIP-based packaging
- [Manifest](spec/core/02-manifest.md) - Document metadata and structure
- [Content Blocks](spec/core/03-content-blocks.md) - Semantic content model
- [Anchors and References](spec/core/03a-anchors-and-references.md) - Unified sub-block addressing
- [Presentation Layers](spec/core/04-presentation-layers.md) - Rendering instructions
- [Asset Embedding](spec/core/05-asset-embedding.md) - Images, fonts, files
- [Document Hashing](spec/core/06-document-hashing.md) - Content-addressable identity
- [State Machine](spec/core/07-state-machine.md) - Draft/frozen lifecycle
- [Metadata](spec/core/08-metadata.md) - Dublin Core and extensions
- [Provenance and Lineage](spec/core/09-provenance-and-lineage.md) - Hash chains, Merkle trees, timestamping
- [Renderer Safety](spec/core/10-renderer-safety.md) - Safe URIs and untrusted-content sanitization

### Extension Specifications (Optional)

- [Security Extension](spec/extensions/security/) - Signatures, encryption, access control
- [Collaboration Extension](spec/extensions/collaboration/) - CRDT hooks, comments, change tracking
- [Presentation Extension](spec/extensions/presentation/) - Advanced layout, print styling
- [Forms Extension](spec/extensions/forms/) - Input fields, validation
- [Semantic Extension](spec/extensions/semantic/) - JSON-LD, knowledge graphs, citations
- [Academic Extension](spec/extensions/academic/) - Theorems, proofs, exercises, algorithms, equations
- [Phantoms Extension](spec/extensions/phantoms/) - Off-page annotation clusters
- [Legal Extension](spec/extensions/legal/) - Legal citations, clause references, jurisdiction metadata

## Quick Start

### Document Structure

A CDX document is a ZIP archive with this structure:

```
document.cdx
├── manifest.json          # Document manifest (includes lineage, Merkle root)
├── content/
│   ├── document.json      # Semantic content blocks
│   └── block-index.json   # Leaf hashes for Merkle proofs
├── presentation/
│   ├── paginated.json     # Print hints (reactive)
│   ├── continuous.json    # Screen hints (reactive)
│   ├── responsive.json    # Viewport hints (reactive)
│   └── layouts/           # Precise layouts (when fidelity required)
│       ├── letter.json    # US Letter format coordinates
│       └── a4.json        # A4 format coordinates
├── assets/
│   ├── images/
│   ├── fonts/
│   └── embeds/
├── security/
│   └── signatures.json    # Digital signatures
├── provenance/
│   └── record.json        # Lineage, timestamps, derivations
└── metadata/
    └── dublin-core.json   # Standard metadata
```

### Minimal Example

The manifest carries document identity and references the content file by path and hash — the content blocks are not embedded inline:

```json
{
  "cdx": "0.1",
  "id": "sha256:a1b2c3...",
  "state": "draft",
  "content": {
    "path": "content/document.json",
    "hash": "sha256:e3b0c4..."
  }
}
```

The blocks live in `content/document.json`:

```json
{
  "version": "0.1",
  "blocks": [
    {
      "type": "heading",
      "level": 1,
      "children": [{ "type": "text", "value": "Hello, World" }]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "This is a " },
        { "type": "text", "value": "CDX", "marks": ["bold"] },
        { "type": "text", "value": " document." }
      ]
    }
  ]
}
```

## File Extension and MIME Type

- **Extension**: `.cdx`
- **MIME Type**: `application/vnd.cdx+json` (canonical JSON form)
- **Alternative**: `application/vnd.cdx` (binary/packed form)

## Roadmap

### Phase 1: Core Specification
- [x] Complete core specification documents
- [x] JSON Schema for validation
- [x] Example documents

### Phase 2: Extensions
- [x] Security extension (signatures, encryption)
- [x] Collaboration extension (CRDT integration)
- [x] Presentation extension (advanced layout)
- [x] Forms extension (input fields, validation)
- [x] Semantic extension (JSON-LD, citations)

### Phase 3: Reference Implementation (Current)
- [ ] TypeScript parser/writer library
- [ ] Web-based viewer
- [ ] Basic editor integration

### Phase 4: Ecosystem
- [ ] Conversion tools (PDF, DOCX import/export)
- [ ] CLI tools (validate, sign, verify)
- [ ] Standards body submission

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This specification and all associated code are licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

## Acknowledgments

This specification draws inspiration from:
- PDF (ISO 32000) for document packaging concepts
- Portable Text (Sanity) for semantic content modeling
- EPUB for reflowable document structure
- CRDTs (Yjs, Automerge) for collaboration patterns
- Git for content-addressable storage and hash chain lineage
- Merkle trees for efficient integrity proofs
- OpenTimestamps for decentralized timestamp anchoring
