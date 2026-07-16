# Asset Embedding

**Section**: Core Specification
**Version**: 0.1

## 1. Overview

Assets are binary resources embedded within a CDX document. This includes images, fonts, and other files that are referenced by content blocks or presentation layers.

## 2. Asset Categories

### 2.1 Categories

| Category | Directory | Purpose |
|----------|-----------|---------|
| Images | `assets/images/` | Photographs, diagrams, icons |
| Fonts | `assets/fonts/` | Typography resources |
| Embeds | `assets/embeds/` | Attached files (spreadsheets, data) |

### 2.2 Directory Structure

```
assets/
├── images/
│   ├── index.json
│   ├── figure1.avif
│   ├── logo.png
│   └── diagram.svg
├── fonts/
│   ├── index.json
│   ├── roboto-regular.woff2
│   └── roboto-bold.woff2
└── embeds/
    ├── index.json
    └── data.xlsx
```

## 3. Asset Index

### 3.1 Index File

Each asset category declared in the manifest MUST have its own index file located at `assets/<category>/index.json`, where `<category>` is the corresponding key in the manifest's `assets` object. Asset `path` values within an index are resolved relative to that category directory. The index catalogs all assets in the category:

```json
{
  "version": "0.1",
  "assets": [
    {
      "id": "figure1",
      "path": "figure1.avif",
      "type": "image/avif",
      "size": 45678,
      "hash": "sha256:...",
      "metadata": {...}
    }
  ]
}
```

**Index integrity.** The manifest's `assets.<category>` reference carries a `hash` of the index file (`{count, totalSize, index, hash}`). Because the index enumerates every asset's — and every image variant's — own `hash`, hash-pinning the one index file transitively fixes the integrity of the whole category. This is what lets a signature attest assets that are otherwise outside the document hash: a scoped signature that covers the manifest projection binds each declared index hash (Security Extension section 9.7), so on a `frozen` or `published` document a repackager cannot swap an image variant or a glyph-remapping font without either failing the variant/font's own hash check or invalidating every manifest-covering signature. The index hash MUST equal the raw hash of the index file (section 8.1).

### 3.2 Asset Entry Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for referencing |
| `path` | string | Yes | File path relative to category directory |
| `type` | string | Yes | MIME type |
| `size` | integer | Yes | File size in bytes |
| `hash` | string | Yes | Content hash |
| `metadata` | object | No | Type-specific metadata |

**Reference resolution.** A content block references an asset by an archive-relative path — `image.src`, `svg.src`, `signature.image`, or a `link` mark `href` (Content Blocks). To resolve it, construct each registered asset's archive path by joining its category directory (`assets/` + the category key under `manifest.assets`) with the entry's `path`, and match the reference — after path normalization (no `.`/`..` segments, case-sensitive) — against it; the matching entry's bytes are the referenced asset. This is the same resolution that binds an asset's content into the document ID (Document Hashing section 4.3.1), so a reference beginning with `assets/` that matches no registered asset is invalid. A reference marked `external`, carrying a URL scheme, or beginning with `#` is not an asset path.

### 3.3 Asset IDs

Asset IDs:

- MUST be unique within their category
- SHOULD be URL-safe (alphanumeric, hyphens, underscores)
- SHOULD be human-readable when practical

## 4. Images

### 4.1 Supported Formats

| Format | MIME Type | Use Case | Compression |
|--------|-----------|----------|-------------|
| AVIF | `image/avif` | Photos, general images | Best |
| WebP | `image/webp` | Photos, general images | Good |
| PNG | `image/png` | Lossless, transparency | Fair |
| JPEG | `image/jpeg` | Photos (legacy) | Good |
| SVG | `image/svg+xml` | Vector graphics | N/A |

**Recommendation**: Use AVIF for photographs and complex images, SVG for diagrams and icons.

### 4.2 Image Metadata

```json
{
  "id": "figure1",
  "path": "figure1.avif",
  "type": "image/avif",
  "size": 45678,
  "hash": "sha256:...",
  "metadata": {
    "width": 1920,
    "height": 1080,
    "colorSpace": "sRGB",
    "hasAlpha": false,
    "dpi": 72
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `width` | integer | Width in pixels |
| `height` | integer | Height in pixels |
| `colorSpace` | string | Color space (sRGB, Display P3, etc.) |
| `hasAlpha` | boolean | Whether image has transparency |
| `dpi` | integer | Dots per inch (for print) |

### 4.3 Resolution Variants

For responsive images, multiple resolutions can be provided:

```json
{
  "id": "hero-image",
  "path": "hero-image.avif",
  "type": "image/avif",
  "size": 125000,
  "hash": "sha256:...",
  "metadata": {
    "width": 1920,
    "height": 1080
  },
  "variants": [
    {
      "path": "hero-image-640.avif",
      "width": 640,
      "size": 25000,
      "hash": "sha256:..."
    },
    {
      "path": "hero-image-1280.avif",
      "width": 1280,
      "size": 65000,
      "hash": "sha256:..."
    }
  ]
}
```

**Variant integrity**: Each variant carries its own `hash`, computed with the parent asset's hash algorithm. A renderer selects a variant by display size (below), so the variant — not the parent — is what a viewer sees; without its own binding a swapped variant would substitute displayed content while the parent hash, the document ID, and any signature all still verify. Implementations MUST verify a variant's bytes against its `hash` before displaying it, applying the same state-keyed disposition as any asset hash (section 8.1): a mismatch is a WARNING in `draft`/`review` and an INTEGRITY-ERROR in `frozen`/`published`. Variant hashes ride in the asset index, which is itself hash-pinned by the manifest and bound into a manifest-covering signature (section 3.1), so a variant is tamper-evident on a signed document.

**Variant selection**: Renderers SHOULD select the variant closest to the display size. If displaying at 800px width, the 640px variant would be used (or the 1280px variant if the renderer prefers to scale down rather than up). If no variant is a good match, fall back to the full-resolution image.

**Missing variants**: If a variant file is missing from the archive, implementations MUST fall back to the full-resolution image. Missing variants SHOULD produce a warning but MUST NOT prevent the image from being displayed.

### 4.4 Image References

Content blocks reference images by path:

```json
{
  "type": "image",
  "src": "assets/images/figure1.avif",
  "alt": "System architecture diagram"
}
```

## 5. Fonts

### 5.1 Supported Formats

| Format | MIME Type | Support |
|--------|-----------|---------|
| WOFF2 | `font/woff2` | Required |
| WOFF | `font/woff` | Optional |
| TTF | `font/ttf` | Optional |
| OTF | `font/otf` | Optional |

**Recommendation**: Use WOFF2 for best compression and broad support.

### 5.2 Font Metadata

```json
{
  "id": "roboto-regular",
  "path": "roboto-regular.woff2",
  "type": "font/woff2",
  "size": 45000,
  "hash": "sha256:...",
  "metadata": {
    "family": "Roboto",
    "weight": 400,
    "style": "normal",
    "unicodeRange": "U+0000-00FF, U+0131, U+0152-0153"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `family` | string | Font family name |
| `weight` | integer | Font weight (100-900) |
| `style` | string | Font style (normal, italic, oblique) |
| `unicodeRange` | string | Supported Unicode ranges |

### 5.3 Font Families

Group related fonts:

```json
{
  "families": [
    {
      "name": "Roboto",
      "fonts": [
        { "id": "roboto-regular", "weight": 400, "style": "normal" },
        { "id": "roboto-italic", "weight": 400, "style": "italic" },
        { "id": "roboto-bold", "weight": 700, "style": "normal" }
      ]
    }
  ]
}
```

### 5.4 Font References

Presentation layers reference fonts by family name:

```json
{
  "styles": {
    "bodyText": {
      "fontFamily": "Roboto, system-ui, sans-serif"
    }
  }
}
```

**Font integrity**: Because a font is referenced by family name rather than by a content path, it is not resolved into the document ID (Document Hashing section 4.1) — a substituted font could otherwise remap glyphs (rendering `1` as `9`, or `APPROVED` as `REJECTED`) while the document ID and any signature still verify. Each font's bytes MUST be verified against its `hash` in the fonts index on load (section 8.1), and the index is hash-pinned by the manifest and bound into a manifest-covering signature (section 3.1), so an embedded font is tamper-evident on a `frozen` or `published` document even though it is outside the document hash.

### 5.5 Font Subsetting

For efficiency, fonts SHOULD be subsetted to include only used characters.

The `metadata.unicodeRange` field indicates the characters available.

### 5.6 Font Licensing

Font embedding must comply with licensing terms. The index MAY include license information:

```json
{
  "id": "roboto-regular",
  "path": "roboto-regular.woff2",
  "license": {
    "name": "Apache License 2.0",
    "url": "https://www.apache.org/licenses/LICENSE-2.0"
  }
}
```

## 6. Embedded Files

### 6.1 Purpose

Embedded files are attachments that accompany the document but are not directly rendered (e.g., source data, supplementary materials).

### 6.2 Embedded File Metadata

```json
{
  "id": "source-data",
  "path": "quarterly-data.xlsx",
  "type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "size": 125000,
  "hash": "sha256:...",
  "metadata": {
    "filename": "Quarterly Financial Data.xlsx",
    "description": "Source data for charts in this document",
    "created": "2025-01-10T08:00:00Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `filename` | string | Original filename (for display) |
| `description` | string | Human-readable description |
| `created` | string | Original file creation date |

### 6.3 Referencing Embedded Files

Embedded files can be referenced from content using a `paragraph` block with a `link` mark pointing to the embedded file:

```json
{
  "type": "paragraph",
  "children": [
    {
      "type": "text",
      "value": "Download source data",
      "marks": [
        {
          "type": "link",
          "href": "assets/embeds/quarterly-data.xlsx",
          "title": "Download source data"
        }
      ]
    }
  ]
}
```

## 7. Asset Compression

### 7.1 Pre-compressed Assets

Already-compressed formats (AVIF, WebP, WOFF2) SHOULD be stored without additional ZIP compression:

```
ZIP entry: assets/images/photo.avif
Compression method: Store (0)
```

### 7.2 Compressible Assets

Uncompressed or less-compressed formats benefit from ZIP compression:

| Format | Recommended ZIP Compression |
|--------|----------------------------|
| SVG | Zstandard or Deflate |
| PNG | Store (already compressed) |
| TTF/OTF | Zstandard or Deflate |
| XML/JSON | Zstandard or Deflate |

## 8. Asset Integrity

### 8.1 Hash Verification

Each asset's hash MUST be verified when loading. This applies to a top-level asset, to each image variant (section 4.3), and to the category index file itself:

1. Read the file from the archive (the asset, the variant, or the index)
2. Compute the hash of its contents
3. Compare with the declared hash — for an asset or variant this is its `hash` in the index; for the index file it is `manifest.assets.<category>.hash` (section 3.1)
4. On mismatch, apply the state-keyed disposition of State Machine section 5.4 — a WARNING in draft/review, an INTEGRITY-ERROR in frozen/published

Verifying the index hash first anchors the per-asset and per-variant hashes it carries: a signed manifest projection binds the index hash (Security Extension section 9.7), so the index — and transitively every asset and variant it lists — is tamper-evident on a `frozen` or `published` document.

### 8.2 Hash Algorithm

Asset hashes use the same algorithm as document hashing (SHA-256 by default):

```
sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## 9. External References

### 9.1 Policy

By default, CDX documents SHOULD be self-contained. External references:

- MAY be allowed for non-critical assets
- MUST NOT be required for core content
- SHOULD include fallback content

### 9.2 External Reference Format

```json
{
  "type": "image",
  "src": "https://example.com/logo.png",
  "external": true,
  "fallback": "assets/images/logo-fallback.png",
  "alt": "Company Logo"
}
```

### 9.3 Security Considerations

External references introduce risks:

- Privacy (tracking pixels)
- Availability (broken links)
- Integrity (content can change)

Implementations SHOULD:

- Warn users about external content
- Provide option to fetch and embed external resources
- Validate URLs against allowlists in sensitive contexts

## 10. Size Optimization

### 10.1 Recommendations

| Asset Type | Recommendation |
|------------|----------------|
| Photos | AVIF quality 60-80, max 2000px dimension |
| Icons | SVG preferred, or PNG with transparency |
| Fonts | WOFF2, subset to used characters |
| Documents | Consider compression or conversion |

### 10.2 Deduplication

Identical assets (same hash) SHOULD be stored only once:

```json
{
  "assets": [
    {
      "id": "logo-header",
      "path": "header-logo.png",
      "type": "image/png",
      "size": 12096,
      "hash": "sha256:abc123..."
    },
    {
      "id": "logo-footer",
      "path": "footer-logo.png",
      "type": "image/png",
      "size": 12096,
      "hash": "sha256:abc123...",
      "aliasOf": "logo-header"
    }
  ]
}
```

`aliasOf` marks that an entry's bytes are identical to another entry's — a hint that storage tooling MAY keep the bytes once. Each entry still carries its own `path`, `type`, `size`, and `hash`; reference resolution (Document Hashing section 4.3.1) uses the entry's own `path` and `hash` and does not dereference `aliasOf`.

## 11. Validation

### 11.1 Required Validation

1. All referenced assets exist in archive
2. MIME types match file contents
3. Hashes verify correctly
4. Sizes match actual file sizes

### 11.2 Optional Validation

1. Images are valid and can be decoded
2. Fonts are valid and contain declared glyphs
3. Embedded files are not malicious

## 12. Examples

### 12.1 Image Index

```json
{
  "version": "0.1",
  "assets": [
    {
      "id": "cover",
      "path": "cover.avif",
      "type": "image/avif",
      "size": 245000,
      "hash": "sha256:a1b2c3...",
      "metadata": {
        "width": 1600,
        "height": 900,
        "colorSpace": "sRGB",
        "hasAlpha": false,
        "dpi": 150
      }
    },
    {
      "id": "architecture-diagram",
      "path": "architecture.svg",
      "type": "image/svg+xml",
      "size": 12500,
      "hash": "sha256:d4e5f6...",
      "metadata": {
        "width": 800,
        "height": 600
      }
    }
  ]
}
```

### 12.2 Font Index

```json
{
  "version": "0.1",
  "families": [
    {
      "name": "Source Serif Pro",
      "fonts": [
        { "id": "source-serif-regular", "weight": 400, "style": "normal" },
        { "id": "source-serif-italic", "weight": 400, "style": "italic" },
        { "id": "source-serif-bold", "weight": 700, "style": "normal" }
      ]
    }
  ],
  "assets": [
    {
      "id": "source-serif-regular",
      "path": "source-serif-pro-regular.woff2",
      "type": "font/woff2",
      "size": 35000,
      "hash": "sha256:789abc...",
      "metadata": {
        "family": "Source Serif Pro",
        "weight": 400,
        "style": "normal",
        "unicodeRange": "U+0000-00FF"
      },
      "license": {
        "name": "SIL Open Font License 1.1",
        "url": "https://scripts.sil.org/OFL"
      }
    }
  ]
}
```
