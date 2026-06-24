# Container Format

**Section**: Core Specification
**Version**: 0.1

## 1. Overview

A CDX document is packaged as a ZIP archive with the file extension `.cdx`. This approach provides:

- Familiar tooling and broad platform support
- Built-in compression at the container level
- Random access to individual components
- Easy inspection and debugging

## 2. File Extension and MIME Type

### 2.1 File Extension

CDX documents MUST use the file extension `.cdx`.

### 2.2 MIME Types

| Form | MIME Type | Use |
|------|-----------|-----|
| Canonical (JSON) | `application/vnd.cdx+json` | Primary format |
| Binary | `application/vnd.cdx` | Future optimization |

Implementations SHOULD register these MIME types with the operating system for proper file association.

## 3. ZIP Archive Structure

### 3.1 ZIP Format Requirements

CDX documents MUST be valid ZIP archives conforming to [APPNOTE.TXT](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) version 6.3.3 or later.

The following ZIP features are REQUIRED:

- ZIP64 extensions for documents larger than 4GB
- UTF-8 encoding for file names (Language Encoding Flag set)

The following ZIP features MUST NOT be used:

- ZIP encryption (use CDX security extension instead)
- Multi-volume archives

### 3.2 Compression Methods

Individual files within the archive MAY use the following compression methods:

| Method | Code | Use Case |
|--------|------|----------|
| Store | 0 | Pre-compressed assets (AVIF, WebP) |
| Deflate | 8 | General content, wide compatibility |
| Zstandard | 93 | Optimized compression (recommended) |

Implementations MUST support Deflate (method 8). Support for Zstandard (method 93) is RECOMMENDED.

### 3.3 Directory Structure

The archive MUST contain the following structure:

```
/
├── manifest.json           # REQUIRED
├── content/
│   └── document.json       # REQUIRED
├── presentation/           # OPTIONAL
│   ├── paginated.json
│   └── continuous.json
├── assets/                 # OPTIONAL
│   ├── images/
│   ├── fonts/
│   └── embeds/
├── security/               # OPTIONAL
│   └── signatures.json
└── metadata/
    └── dublin-core.json    # REQUIRED
```

#### 3.3.1 Required Files

| Path | Description |
|------|-------------|
| `/manifest.json` | Document manifest with version, state, and structure |
| `/content/document.json` | Semantic content blocks |
| `/metadata/dublin-core.json` | Dublin Core metadata |

#### 3.3.2 Optional Directories

| Path | Description |
|------|-------------|
| `/presentation/` | Presentation layer files |
| `/assets/` | Embedded resources |
| `/security/` | Signatures and encryption metadata |
| `/phantoms/` | Off-page annotation clusters (Phantom Extension) |

### 3.4 File Naming

All file and directory names within the archive:

- MUST be encoded as UTF-8
- MUST use forward slash (`/`) as path separator
- MUST NOT contain backslash (`\`)
- MUST NOT begin with `/` (paths are relative to archive root)
- SHOULD use lowercase for standard paths
- SHOULD use URL-safe characters for asset names

## 4. Archive-Level Metadata

### 4.1 ZIP Comment

The archive MAY include a ZIP comment containing:

```
CDX v0.1
```

This enables format identification without extracting content.

### 4.2 First File Requirement

The first file in the archive MUST be `manifest.json`. This enables:

- Quick format validation
- Streaming access to document metadata
- Efficient partial loading

## 5. Size Limits

### 5.1 Recommended Limits

| Component | Recommended Limit | Rationale |
|-----------|-------------------|-----------|
| Total archive size | 2 GB | Practical processing |
| Individual file size | 500 MB | Memory efficiency |
| Number of files | 10,000 | File system compatibility |
| Path length | 255 characters | Cross-platform compatibility |

Implementations MAY support larger documents but SHOULD warn users about potential compatibility issues.

### 5.2 Minimum Support

Conforming implementations MUST support:

- Archives up to 100 MB
- Individual files up to 50 MB
- At least 1,000 files
- Paths up to 200 characters

## 6. Integrity

### 6.1 ZIP CRC-32

Standard ZIP CRC-32 checksums MUST be present for all files in the archive.

### 6.2 Document Hash

The document's content-addressable hash (see Document Hashing specification) provides integrity verification at the semantic level, independent of container-level checksums.

## 7. Extension Points

### 7.1 Custom Directories

Extensions MAY define additional directories under the root. Custom directories:

- MUST NOT conflict with standard paths
- SHOULD use a namespace prefix (e.g., `/x-myextension/`)
- MUST be documented in the manifest

### 7.2 Forward Compatibility

Implementations MUST ignore unrecognized files and directories. This enables:

- Future specification extensions
- Application-specific metadata
- Gradual migration between versions

### 7.3 Closed by Default Within Files

While unrecognized *files and directories* are ignored (section 7.2), the JSON inside a part file is validated **closed by default**: every object rejects properties the schema does not define, and every enumerated value set rejects values it does not list. An unknown property or enum value is a validation failure, dispositioned by document state (State Machine section 5.4) — never silently accepted.

Forward compatibility *within* a file is provided only at these enumerated extension points, each deliberately open:

- **Extension block types** — an unrecognized block whose `type` is namespaced (`namespace:type`) passes unchecked; a bare unrecognized type is rejected (Content Blocks section 5).
- **Extension mark types** — the same rule for marks within a text node (Content Blocks section 5.1).
- **Extension configuration** — the manifest's per-extension configuration objects and each extension's `config` are open (Manifest sections 4.10, 4.17).
- **Asset metadata** — an asset entry's `metadata` object is open, its shape being asset-type-specific (Asset Embedding).
- **Renderer defaults** — a presentation file's free-form style bags — the root `defaults`, each named style's `base` overrides, and a section's `attributes` — are open, carrying renderer- and theme-specific keys (Presentation Layers).

Everything else — manifest fields, Dublin Core terms, presentation modes, asset-index fields, signature structures — is closed: an unknown name there is a defect, not a forward-compatibility signal. An extension adds new structured data under one of the points above, or in a namespaced file or directory (section 7.1) — never by introducing unknown keys into a closed object.

## 8. Implementation Notes

### 8.1 Creating Archives

When creating a CDX document:

1. Write `manifest.json` as the first entry
2. Add required content and metadata files
3. Add presentation layers (if any)
4. Add assets (if any)
5. Add security files (if any)
6. Use Zstandard compression where supported, Deflate otherwise
7. Store pre-compressed images without additional compression

### 8.2 Reading Archives

When reading a CDX document:

1. Verify the archive is a valid ZIP
2. Read `manifest.json` first to determine version and structure
3. Validate required files exist
4. Load content lazily where possible (especially assets)

### 8.3 Streaming Support

For large documents, implementations SHOULD support:

- Streaming extraction without loading entire archive
- Random access to specific files via ZIP central directory
- Progressive loading of content blocks

## 9. Security Considerations

### 9.1 Path Traversal

Implementations MUST validate that extracted paths do not traverse outside the intended directory (zip slip vulnerability). Paths containing `..` segments MUST be rejected.

### 9.2 Decompression Bombs

Implementations SHOULD impose limits on:

- Compression ratio (reject suspiciously high ratios)
- Decompressed size relative to compressed size
- Total extraction size

### 9.3 Symbolic Links

ZIP archives MAY contain symbolic links. Implementations MUST NOT follow symbolic links that point outside the archive or extraction directory.
