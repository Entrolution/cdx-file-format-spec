# CDX Specification

**Version**: 0.1 (Draft)
**Status**: Working Draft
**Editors**: CDX Specification Team

## Abstract

This specification defines CDX (Content-addressed Document eXchange), an open format for documents that unifies viewing and editing modes while providing modern security, efficient compression, and native machine readability.

## Status of This Document

This is a working draft. The specification is subject to change based on community feedback and implementation experience.

## 1. Introduction

### 1.1 Background

The document format landscape has evolved into two distinct camps:

1. **View-optimized formats** (PDF, DJVU) that prioritize faithful reproduction of visual layout but make editing difficult or impossible
2. **Edit-optimized formats** (DOCX, ODF, Markdown) that enable rich authoring but render inconsistently across applications

This fundamental divide creates significant workflow friction. Documents must be converted between formats as they move from authoring to distribution, losing fidelity and context in the process.

Additionally, existing formats suffer from:

- **Security vulnerabilities**: PDF's signature model has been shown vulnerable to multiple attack classes
- **Poor machine readability**: Even state-of-the-art extraction achieves only 73-96% accuracy on structured content
- **Outdated compression**: Most formats use algorithms designed decades ago
- **Ambiguous document state**: No clear semantic distinction between "draft" and "final" versions

### 1.2 Design Goals

The CDX format addresses these issues through the following design goals:

1. **Semantic-First Architecture**: Content is stored as semantic blocks (headings, paragraphs, lists, etc.) rather than visual instructions. Presentation is derived from semantics, not the other way around.

2. **Content-Addressable Identity**: A document's cryptographic hash serves as its canonical identifier. Any modification creates a new document with a lineage pointer to its predecessor.

3. **Explicit State Machine**: Documents have explicit states (draft, review, frozen, published) with clear transition rules. Signatures bind to specific states.

4. **Modern Security**: Support for current cryptographic standards with algorithm agility to accommodate future advances, including post-quantum cryptography.

5. **Efficient Compression**: Per-stream algorithm selection using modern compression (Zstandard, AVIF, WebP).

6. **Machine Readable by Default**: Structure survives extraction intact. Semantic markup enables reliable AI/ML processing.

7. **Edit-View Continuity**: The same format serves for both authoring and consumption. No format conversion required.

### 1.3 Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this specification are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

### 1.4 Terminology

This section defines key terms used throughout the specification.

#### Core Concepts

**Block**: A discrete unit of content that represents a semantic element of the document (paragraph, heading, image, table, etc.). Blocks form a tree structure where container blocks can have child blocks.

**Text Node**: A leaf node containing actual text content. Text nodes are the only block type that holds text; all other blocks contain children or are void elements.

**Mark**: Inline formatting applied to a range of text within a text node. Marks can be simple strings (`"bold"`, `"italic"`) or objects with additional properties (links, citations, math). Marks do not create new blocks — they annotate existing text.

**Annotation**: External commentary attached to content but stored outside the content layer. Annotations include comments, suggestions, and phantoms. Annotations are always outside the content hash boundary.

**Element**: A generic term used in specific contexts:
- In presentation layers: a positioned item on a page (`pageElement`)
- In DOM/SVG contexts: an XML/HTML element
- In arrays: an item in a JSON array

#### Layers and Structure

**Content Layer**: The semantic representation of document content as a tree of blocks. This layer captures what the document says, independent of how it looks.

**Presentation Layer**: Instructions for rendering content visually. Presentation layers define styles, layouts, and page structures. Multiple presentation layers can exist for the same content.

**Manifest**: The root metadata structure (`manifest.json`) describing a document's contents, properties, extensions, and file references.

**Asset**: An embedded resource (image, font, embedded file) referenced by content blocks. Assets are stored in the `assets/` directory and indexed in the manifest.

#### Document Lifecycle

**Document State**: The lifecycle state of a document: `draft` (active editing), `review` (under review), `frozen` (locked for signing), or `published` (distributed).

**Lineage**: The version history chain linking a document to its predecessors via content-addressable hashes.

**Document ID**: The content-addressable hash that serves as a document's canonical identifier. Computed from the document's semantic content.

#### Extension Terminology

**Extension**: An optional module that adds capabilities beyond the core specification. Extensions are declared in the manifest and use namespaced block types (e.g., `forms:input`, `academic:theorem`).

**Phantom**: An off-page annotation from the Phantom Extension. Phantoms are anchored to content but rendered in margin clusters outside the main document flow.

### 1.5 Document Structure Overview

A CDX document is a ZIP archive containing:

```
document.cdx
├── manifest.json           # Document manifest (required)
├── content/
│   ├── document.json       # Semantic content blocks (required)
│   └── block-index.json    # Block hashes for Merkle proofs (optional)
├── presentation/
│   ├── paginated.json      # Fixed layout presentation (optional)
│   ├── continuous.json     # Reflow presentation (optional)
│   └── layouts/            # Precise layouts (when page-precise fidelity is required)
│       ├── letter.json     # US Letter format coordinates
│       └── a4.json         # A4 format coordinates
├── assets/
│   ├── images/             # Image assets
│   ├── fonts/              # Font assets
│   └── embeds/             # Embedded files
├── security/
│   └── signatures.json     # Digital signatures (optional)
├── provenance/
│   └── record.json         # Lineage, timestamps, derivations (optional)
├── collaboration/
│   ├── comments.json       # Comments and annotations (optional)
│   └── changes.json        # Change tracking (optional)
├── phantoms/
│   ├── clusters.json       # Off-page annotation clusters (optional)
│   └── assets/             # Phantom-specific assets (optional)
└── metadata/
    └── dublin-core.json    # Dublin Core metadata (required)
```

### 1.6 Annotation Layers

CDX provides three annotation storage locations, each serving different purposes:

| Layer | Location | Purpose | Extension Required |
|-------|----------|---------|--------------------|
| Core annotations | `security/annotations.json` | Minimal annotation support for frozen/published documents. Lightweight format for implementations that don't support extensions. | No (core) |
| Collaboration | `collaboration/comments.json` | Full-featured comments, suggestions, change tracking, presence awareness. Supersedes core annotations when active. | `cdx.collaboration` |
| Phantoms | `phantoms/clusters.json` | Spatially-organized off-page annotation clusters (margin notes, mind maps). Orthogonal to inline annotations. | `cdx.phantoms` |

**When to use each layer:**

- **Core annotations**: Use for simple read-only annotation on frozen documents when the collaboration extension is not available. Provides basic comment support without extension dependencies.

- **Collaboration extension**: Use when you need threaded discussions, suggestions with accept/reject workflow, change tracking, or real-time presence. When active, prefer this over core annotations.

- **Phantoms extension**: Use for spatial annotations that exist "off the page" — research notes, margin comments with visual layouts, mind-map style connections between concepts. Phantoms are anchored to content but rendered separately from the document flow.

All annotation layers are **outside the content hash boundary** — adding annotations never changes the document's identity or invalidates signatures.

**Implementation note**: Core annotations live in `security/annotations.json` because they share the security directory's "outside content hash" semantics. When migrating from core annotations to the collaboration extension, implementations SHOULD convert existing annotations to the collaboration format and remove the core annotations file. The two formats SHOULD NOT coexist in the same document to avoid confusion.

### 1.7 Specification Organization

This specification is organized into the following sections:

- **Container Format**: ZIP-based packaging and file structure
- **Manifest**: Root metadata and document properties
- **Content Blocks**: Semantic content model
- **Anchors and References**: Unified sub-block addressing system
- **Presentation Layers**: Visual rendering instructions
- **Asset Embedding**: Resource inclusion and referencing
- **Document Hashing**: Content-addressable identity
- **State Machine**: Document lifecycle management
- **Metadata**: Dublin Core and extended metadata

Extension specifications (optional modules) are defined separately:

- Security Extension
- Collaboration Extension
- Presentation Extension
- Phantom Extension
- Forms Extension
- Semantic Extension
- Academic Extension
- Legal Extension

### 1.8 Versioning

This specification uses semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR**: Breaking changes to core format
- **MINOR**: Backward-compatible additions
- **PATCH**: Clarifications and bug fixes

Documents MUST declare the specification version they conform to in their manifest.

## 2. References

### 2.1 Normative References

- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) - Key words for use in RFCs
- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) - The JSON Data Interchange Format
- [RFC 1951](https://www.rfc-editor.org/rfc/rfc1951) - DEFLATE Compressed Data Format
- [RFC 8878](https://www.rfc-editor.org/rfc/rfc8878) - Zstandard Compression
- [FIPS 180-4](https://csrc.nist.gov/publications/detail/fips/180/4/final) - Secure Hash Standard (SHA)
- [Dublin Core Metadata Element Set](https://www.dublincore.org/specifications/dublin-core/dces/)

### 2.2 Informative References

- [PDF 2.0 (ISO 32000-2:2020)](https://www.iso.org/standard/75839.html)
- [EPUB 3.3](https://www.w3.org/TR/epub-33/)
- [ODF 1.3](https://docs.oasis-open.org/office/OpenDocument/v1.3/)
- [Portable Text Specification](https://github.com/portabletext/portabletext)
