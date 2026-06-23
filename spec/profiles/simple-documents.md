# Simple Documents Profile

**Profile ID**: `simple`
**Version**: 0.1
**Status**: Draft

## 1. Overview

The Simple Documents profile defines a minimal subset of CDX for recreational reading, basic articles, and straightforward prose documents. It is designed to be:

- **Lightweight** — minimal required files and structure
- **Easy to create** — no extensions, no presentation layers, no precise layouts
- **Universally renderable** — any CDX reader can display these documents
- **EPUB-comparable** — similar complexity for similar use cases

This profile is non-normative guidance. Documents conforming to this profile are fully valid CDX documents that happen to use only a subset of available features.

## 2. Use Cases

The Simple Documents profile is appropriate for:

- Novels and fiction
- Essays and articles
- Blog posts and web content
- Simple reports without complex formatting
- Any document primarily consisting of prose with basic structure

It is NOT intended for:

- Academic papers (use Academic Extension)
- Legal documents (use Legal Extension)
- Fillable forms (use Forms Extension)
- Documents requiring precise print layout
- Collaborative editing workflows

## 3. Document Structure

### 3.1 Required Files

A Simple Document requires only three files:

```
document.cdx
├── manifest.json           # Minimal manifest
├── content/
│   └── document.json       # All content in one file
└── metadata/
    └── dublin-core.json    # Basic metadata
```

### 3.2 Optional Files

Simple Documents MAY include:

```
├── assets/
│   └── images/             # Cover image, illustrations
└── presentation/
    └── continuous.json     # Reading hints (optional)
```

### 3.3 Files NOT Required

Simple Documents do not need:

- `presentation/paginated.json` — no fixed pagination
- `presentation/layouts/` — no precise coordinates
- `security/` — no signatures (unless distributing)
- `collaboration/` — no comments or change tracking
- `phantoms/` — no margin annotations
- `provenance/` — no lineage tracking
- Extension-specific directories

## 4. Manifest

### 4.1 Minimal Manifest

```json
{
  "cdx": "0.1",
  "id": "pending",
  "state": "draft",
  "created": "2025-01-15T10:30:00Z",
  "modified": "2025-01-15T10:30:00Z",
  "content": {
    "path": "content/document.json"
  },
  "metadata": {
    "dublinCore": "metadata/dublin-core.json"
  }
}
```

### 4.2 Manifest Fields

| Field | Required | Notes |
|-------|----------|-------|
| `cdx` | Yes | Specification version |
| `id` | Yes | Use `"pending"` for drafts |
| `state` | Yes | Typically `"draft"` for simple documents |
| `created` | Yes | ISO 8601 creation timestamp |
| `modified` | Yes | ISO 8601 last modification timestamp |
| `content` | Yes | Path to content file |
| `metadata.dublinCore` | Yes | Path to Dublin Core metadata |
| `extensions` | No | Simple Documents use no extensions |
| `assets` | No | Only if images/fonts are embedded |
| `presentation` | No | Renderers apply defaults |

### 4.3 With Cover Image

```json
{
  "cdx": "0.1",
  "id": "pending",
  "state": "draft",
  "created": "2025-01-15T10:30:00Z",
  "modified": "2025-01-15T10:30:00Z",
  "content": {
    "path": "content/document.json"
  },
  "metadata": {
    "dublinCore": "metadata/dublin-core.json"
  },
  "assets": {
    "images": {
      "count": 1,
      "totalSize": 102400,
      "index": "assets/images/index.json"
    }
  }
}
```

## 5. Content Model

### 5.1 Recommended Block Types

Simple Documents typically use only these block types:

| Block Type | Purpose | Frequency |
|------------|---------|-----------|
| `heading` | Chapter titles, section headings | Common |
| `paragraph` | Body text | Very common |
| `blockquote` | Quoted passages, epigraphs | Occasional |
| `list` | Enumerations | Occasional |
| `horizontalRule` | Scene breaks, section dividers | Occasional |
| `image` | Illustrations, cover | Occasional |

### 5.2 Recommended Marks

| Mark | Purpose |
|------|---------|
| `bold` | Strong emphasis |
| `italic` | Emphasis, titles, foreign words |
| `link` | External references |

### 5.3 Block Types to Avoid

For simplicity, these block types are discouraged in Simple Documents:

- `table` — use prose descriptions instead
- `codeBlock` — not typical for recreational reading
- `math` — requires specialized rendering
- `figure` with `figcaption` — use simple `image` blocks
- Extension block types — add complexity

### 5.4 Example Content Structure

```json
{
  "version": "0.1",
  "blocks": [
    {
      "type": "heading",
      "level": 1,
      "children": [{ "type": "text", "value": "Chapter One" }]
    },
    {
      "type": "heading",
      "level": 2,
      "children": [{ "type": "text", "value": "The House of Chains" }]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "\"It was in my hair, Severian,\" Dorcas said. \"So I stood under the waterfall in the hot stone room—I don't know if the men's side is arranged in the same way.\"" }
      ]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "\"That's natural enough,\" I said. \"You were probably the first stranger to enter the place in a month.\"" }
      ]
    },
    {
      "type": "horizontalRule"
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "Thrax is a crooked dagger entering the heart of the mountains. It lies in a narrow defile of the valley of the " },
        {
          "type": "text",
          "value": "Acis",
          "marks": ["italic"]
        },
        { "type": "text", "value": ", and extends up it to Acies Castle." }
      ]
    }
  ]
}
```

## 6. Metadata

### 6.1 Minimal Dublin Core

```json
{
  "version": "1.1",
  "terms": {
    "title": "The Book of the New Sun",
    "creator": "Gene Wolfe",
    "language": "en"
  }
}
```

### 6.2 Recommended Fields

| Field | Purpose | Required |
|-------|---------|----------|
| `title` | Document title | Yes |
| `creator` | Author name | Yes |
| `language` | ISO 639-1 code | Yes |
| `description` | Synopsis or blurb | Recommended |
| `publisher` | Publisher name | Optional |
| `date` | Publication date | Optional |
| `subject` | Genre or topics | Optional |
| `identifier` | ISBN or other ID | Optional |
| `rights` | Copyright notice | Optional |

### 6.3 Full Example

```json
{
  "version": "1.1",
  "terms": {
    "title": "Sword and Citadel",
    "creator": "Gene Wolfe",
    "language": "en",
    "description": "The final two books of The Book of the New Sun tetralogy.",
    "publisher": "Tor Books",
    "date": "1994",
    "subject": ["Science Fiction", "Fantasy"],
    "identifier": "978-0312890186",
    "rights": "Copyright © 1981, 1982 Gene Wolfe"
  }
}
```

## 7. Presentation

### 7.1 No Presentation Required

Simple Documents do not require any presentation files. Renderers MUST apply sensible defaults when no presentation is specified:

- Continuous vertical scroll layout
- System fonts or reader-preferred fonts
- Comfortable reading width (typically 60-80 characters)
- Appropriate line height for prose (1.5-1.8)
- Standard heading hierarchy styling

### 7.2 Optional Reading Hints

Authors MAY include a minimal `presentation/continuous.json` for reading hints:

```json
{
  "version": "0.1",
  "type": "continuous",
  "defaults": {
    "maxWidth": "40em",
    "fontFamily": "Georgia, serif",
    "fontSize": "1.1rem",
    "lineHeight": 1.7
  },
  "styles": {
    "heading1": {
      "fontSize": "1.8em",
      "marginTop": "2em",
      "marginBottom": "0.5em",
      "pageBreakBefore": "always"
    }
  }
}
```

Renderers MAY ignore these hints in favor of user preferences.

## 8. Document State

### 8.1 Draft State

Simple Documents are typically in `draft` state:

- No content hash computation required
- No precise layouts required
- Document can be freely edited
- ID may be `"pending"`

### 8.2 Published State

For distribution (e.g., ebook stores), Simple Documents MAY transition to `published`:

1. Compute document ID from content hash
2. Optionally add a precise layout for consistent pagination
3. Optionally sign the document

However, many Simple Documents will remain in draft state permanently, which is valid.

## 9. Size Considerations

### 9.1 Content Overhead

JSON is more verbose than XHTML for prose:

| Format | Example paragraph |
|--------|-------------------|
| XHTML | `<p>"Hello," she said.</p>` (27 bytes) |
| CDX | `{"type":"paragraph","children":[{"type":"text","value":"\"Hello,\" she said."}]}` (81 bytes) |

Raw JSON is approximately 3× larger than XHTML for prose content.

### 9.2 Compression

With Zstandard compression (CDX default), the size difference is minimal:

| Document | EPUB (deflate) | CDX (zstd) | Difference |
|----------|----------------|--------------|------------|
| 100KB novel | ~35KB | ~40KB | +14% |
| 500KB novel | ~170KB | ~190KB | +12% |

The difference is negligible for practical purposes.

### 9.3 Tradeoffs

The JSON verbosity provides:

- Unambiguous parsing (no HTML quirks mode)
- Consistent structure for machine processing
- Easy transformation and analysis
- No need for HTML/XML parsers

## 10. Migration from EPUB

### 10.1 Structure Mapping

| EPUB | CDX Simple |
|------|--------------|
| `mimetype` | (not needed) |
| `META-INF/container.xml` | (not needed) |
| `content.opf` | `manifest.json` |
| `*.xhtml` chapters | `content/document.json` |
| `*.css` stylesheets | `presentation/continuous.json` (optional) |
| `toc.ncx` / `nav.xhtml` | (generated from headings) |
| Dublin Core in OPF | `metadata/dublin-core.json` |

### 10.2 Content Mapping

| XHTML | CDX Block |
|-------|-------------|
| `<h1>` - `<h6>` | `heading` (level 1-6) |
| `<p>` | `paragraph` |
| `<blockquote>` | `blockquote` |
| `<ul>`, `<ol>` | `list` |
| `<li>` | `listItem` |
| `<hr>` | `horizontalRule` |
| `<img>` | `image` |
| `<strong>`, `<b>` | `bold` mark |
| `<em>`, `<i>` | `italic` mark |
| `<a href="...">` | `link` mark |

### 10.3 Conversion Notes

1. **Consolidate chapters** — EPUB splits content across files; CDX uses one file
2. **Flatten CSS** — Convert CSS classes to presentation styles or omit
3. **Extract metadata** — Move Dublin Core from OPF to separate JSON file
4. **Simplify navigation** — Table of contents is generated from headings
5. **Preserve reading order** — EPUB spine order becomes block array order

## 11. Complete Example

A minimal novel in three files:

### 11.1 manifest.json

```json
{
  "cdx": "0.1",
  "id": "pending",
  "state": "draft",
  "created": "2025-01-15T10:30:00Z",
  "modified": "2025-01-15T10:30:00Z",
  "content": {
    "path": "content/document.json"
  },
  "metadata": {
    "dublinCore": "metadata/dublin-core.json"
  }
}
```

### 11.2 metadata/dublin-core.json

```json
{
  "version": "1.1",
  "terms": {
    "title": "A Simple Novel",
    "creator": "Jane Author",
    "language": "en",
    "description": "A story about adventures.",
    "date": "2025"
  }
}
```

### 11.3 content/document.json

```json
{
  "version": "0.1",
  "blocks": [
    {
      "type": "heading",
      "level": 1,
      "children": [{ "type": "text", "value": "Part One" }]
    },
    {
      "type": "heading",
      "level": 2,
      "children": [{ "type": "text", "value": "Chapter 1: The Beginning" }]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "It was a dark and stormy night. The wind howled through the ancient oaks surrounding the manor house, their branches scraping against the windows like skeletal fingers seeking entry." }
      ]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "Inside, Margaret sat by the fire, a book open on her lap. She wasn't reading—she was listening." }
      ]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "\"Did you hear that?\" she whispered to no one in particular." }
      ]
    },
    {
      "type": "horizontalRule"
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "The next morning dawned clear and bright, as if the storm had never happened. Margaret found herself wondering if she had dreamed the whole thing." }
      ]
    },
    {
      "type": "heading",
      "level": 2,
      "children": [{ "type": "text", "value": "Chapter 2: The Discovery" }]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "The letter arrived at precisely ten o'clock..." }
      ]
    }
  ]
}
```

## 12. Implementation Guidance

### 12.1 For Authors

1. Start with the three required files
2. Use only basic block types
3. Keep structure flat (avoid deep nesting)
4. Let renderers handle presentation
5. Add a cover image if desired

### 12.2 For Readers/Renderers

1. Check for presentation files; use defaults if absent
2. Generate table of contents from headings
3. Apply user preferences over author hints
4. Support comfortable reading settings (font size, margins, themes)
5. Handle missing optional files gracefully

### 12.3 For Converters

1. EPUB → CDX conversion should be straightforward
2. Consolidate multiple XHTML files into single document.json
3. Preserve reading order from EPUB spine
4. Extract Dublin Core metadata
5. Optionally convert CSS to presentation hints

## 13. Future Considerations

Potential additions to this profile:

- **Series metadata** — series name, volume number
- **Reading progress** — bookmarks, last position (outside content hash)
- **Annotations** — personal highlights and notes (using core annotations; advisory and unauthenticated — see the security extension, Identity Authority)
- **Audio narration** — synchronized audio tracks
- **Accessibility metadata** — reading level, content warnings

These would remain optional and backward-compatible.
