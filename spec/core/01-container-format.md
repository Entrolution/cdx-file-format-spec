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

### 3.5 Unique Entry Paths

Each path MUST appear at most once in the archive, in every document state. An archive MUST NOT contain two entries that resolve to the same path (compared after the section 3.4 normalization: UTF-8 and forward-slash separators). A reader MUST reject such an archive rather than pick a view. The comparison is case-sensitive, but a reader MUST **additionally** reject two entries whose paths differ only in case: they collide when extracted onto a case-insensitive filesystem (the default on macOS and Windows), reintroducing the ambiguity this rule removes.

The **central directory is the authoritative index**: a reader MAY resolve every part directly from it by byte-exact name, and to keep the hashed view and the rendered view identical it SHOULD do so rather than extract-then-read through a case-folding filesystem lookup. A reader that also performs a sequential/local scan MUST find, for every local file header, exactly one central-directory record with the same name, and MUST reject an archive whose local-header and central-directory views disagree on the entry set or that places file data outside the entries the central directory enumerates.

ZIP permits duplicate entry names, and permits the local file headers to disagree with the central directory; libraries resolve the ambiguity differently (first-wins, last-wins, or central-directory-wins). This is the container-level counterpart of the duplicate-JSON-key rejection in Document Hashing (section 4.3.2): both close a **split-view substitution**, in which a signer's tooling hashes one set of bytes for `content/document.json` into the document ID while a victim's reader materializes a different entry of the same name — under one still-valid signature.

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

A ZIP entry name is attacker-controlled, so an implementation that extracts entries to disk MUST validate every **actual archive entry name** — not merely the paths declared inside JSON parts — and MUST reject the archive, in every document state, if any entry name:

- contains a `..` path segment (`../`, `..\`, a trailing `/..`, or a bare `..`),
- begins with `/` or `\` (a POSIX or UNC-style absolute path),
- contains a backslash (`\`) — forbidden as a separator by section 3.4, and treated as a path separator on Windows,
- contains a colon (`:`) — this subsumes a leading Windows drive letter (`C:…`) and blocks an NTFS alternate-data-stream suffix (`file:stream`); no CDX path defined in section 3.3 contains one,
- has a segment that is a reserved Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, compared case-insensitively and ignoring any extension), or a segment with a trailing dot or space (which Windows strips, folding it onto another entry), or
- is not well-formed, shortest-form UTF-8 (an overlong encoding can smuggle a `..` past a byte comparison).

Rejecting `..` alone is insufficient: on Windows `..\..\evil` and an absolute `/etc/cron.d/x` both escape an extraction directory that screens only for `..`, and a colon, a device name, or a trailing-dot fold redirects a write *within* the tree without ever traversing out of it. Beyond the per-segment checks above — which are a fast-fail layer — an implementation MUST resolve each entry's target against the extraction root and MUST confirm the **canonicalized real path** (resolving any symbolic-link components as they exist at write time) remains inside that root before writing; a purely lexical containment check can be defeated by a symlink component (section 9.3). This resolved-containment check is the authoritative defence.

These are **consumer** obligations, evaluated over the *entire* entry set, and they take precedence over the ignore-unrecognized rule (section 7.2): an entry in an unknown namespace directory is still subject to name-safety and uniqueness. The section 3.4 rules constrain a well-behaved writer, but a malicious archive ignores them, so a reader MUST NOT rely on producer-side path form having been enforced.

### 9.2 Decompression Bombs

Implementations SHOULD impose limits on:

- Compression ratio (reject suspiciously high ratios)
- Decompressed size relative to compressed size
- Total extraction size

### 9.3 Symbolic Links

ZIP archives MAY carry entries that encode symbolic links (a Unix mode with the symlink bit set). CDX defines no legitimate use for one (section 3.3), and a symlink is a second path-traversal vector: a link entry whose target is absolute or contains `..` can redirect a later write — or a read — outside the extraction directory even when every entry *name* passed section 9.1, and a link left in place can defeat a purely lexical containment check on a subsequent entry.

An implementation MUST NOT follow a symbolic link that points outside the extraction directory, and when extracting an untrusted archive to disk it MUST NOT materialize a symbolic-link entry at all. The section 9.1 resolved-containment check is therefore evaluated against a real path that contains no archive-created links.
