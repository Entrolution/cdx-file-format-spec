# Presentation Extension

**Extension ID**: `cdx.presentation`
**Version**: 0.1
**Status**: Draft

## 1. Overview

The Presentation Extension provides advanced layout and styling capabilities beyond the core specification:

- Advanced page layout (columns, grids)
- Print-specific features (bleeds, crop marks)
- Master pages and templates
- Advanced typography

### File Paths

Presentation extension data is stored within the `presentation/` directory in the CDX archive:

| File | Purpose |
|------|---------|
| `presentation/styles.json` | Typography, colors, and style definitions |
| `presentation/layout.json` | Master pages, templates, and layout rules |
| `presentation/toc.json` | Table of contents configuration |

These files are referenced from the manifest's extension declaration.

## 2. Extension Declaration

```json
{
  "extensions": [
    {
      "id": "cdx.presentation",
      "version": "0.1",
      "required": false
    }
  ]
}
```

## 3. Advanced Page Layout

### 3.1 Multi-Column Layout

```json
{
  "layout": {
    "type": "columns",
    "columns": 2,
    "gap": "0.25in",
    "balance": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `columns` | integer | Number of columns (1-6) |
| `gap` | string | Gap between columns |
| `balance` | boolean | Balance column heights |
| `rule` | object | Column rule (separator line) |

### 3.2 Grid Layout

```json
{
  "layout": {
    "type": "grid",
    "columns": 12,
    "rows": "auto",
    "gap": "16px",
    "areas": [
      { "name": "header", "column": "1 / 13", "row": "1" },
      { "name": "sidebar", "column": "1 / 4", "row": "2" },
      { "name": "content", "column": "4 / 13", "row": "2" }
    ]
  }
}
```

### 3.3 Flow Regions

Define multiple regions for text to flow through:

```json
{
  "flowRegions": [
    {
      "id": "main-flow",
      "regions": [
        { "page": 1, "area": "content" },
        { "page": 2, "area": "full" },
        { "page": 3, "area": "content" }
      ]
    }
  ]
}
```

## 4. Print Features

### 4.1 Bleed and Trim

For professional printing:

```json
{
  "print": {
    "bleed": {
      "top": "0.125in",
      "right": "0.125in",
      "bottom": "0.125in",
      "left": "0.125in"
    },
    "trim": {
      "width": "8.5in",
      "height": "11in"
    },
    "cropMarks": true,
    "registrationMarks": true,
    "colorBars": false
  }
}
```

### 4.2 Color Definitions

A color definition is discriminated by `type`. An `rgb` or `cmyk` color carries a `value` (a hex string for `rgb`, comma-separated components for `cmyk`); a `spot` color carries a `name` and a `fallback` hex color for non-spot rendering.

```json
{
  "colors": {
    "brand-blue": {
      "type": "spot",
      "name": "PANTONE 286 C",
      "fallback": "#0033a0"
    },
    "body-text": {
      "type": "rgb",
      "value": "#1a1a1a"
    },
    "rich-black": {
      "type": "cmyk",
      "value": "0,0,0,1"
    }
  }
}
```

### 4.3 Overprint

```json
{
  "styles": {
    "blackText": {
      "color": "#000000",
      "overprint": true
    }
  }
}
```

### 4.4 PDF/X Compliance

```json
{
  "print": {
    "standard": "PDF/X-4",
    "outputIntent": {
      "profile": "sRGB IEC61966-2.1",
      "condition": "sRGB"
    }
  }
}
```

The `standard` field selects the print/archival output intent. Supported values: `PDF/X-1a`, `PDF/X-3`, `PDF/X-4`, `PDF/A-1`, `PDF/A-2`, and `PDF/A-3`.

## 5. Master Pages

### 5.1 Definition

Master pages define reusable page templates:

```json
{
  "masterPages": {
    "default": {
      "margins": { "top": "1in", "right": "1in", "bottom": "1in", "left": "1in" },
      "header": { "height": "0.5in" },
      "footer": { "height": "0.5in" }
    },
    "chapter-start": {
      "basedOn": "default",
      "margins": { "top": "2in" },
      "header": null
    },
    "full-bleed": {
      "margins": { "top": "0", "right": "0", "bottom": "0", "left": "0" }
    }
  }
}
```

### 5.2 Application

Apply master pages to specific pages:

```json
{
  "pages": [
    { "number": 1, "master": "chapter-start" },
    { "number": 2, "master": "default" },
    { "number": 3, "master": "full-bleed" }
  ]
}
```

### 5.3 Auto-Application Rules

```json
{
  "masterRules": [
    { "match": { "first": true }, "master": "chapter-start" },
    { "match": { "contains": "full-bleed-image" }, "master": "full-bleed" },
    { "match": { "default": true }, "master": "default" }
  ]
}
```

## 6. Advanced Typography

### 6.1 OpenType Features

```json
{
  "styles": {
    "body": {
      "fontFamily": "Source Serif Pro",
      "fontFeatureSettings": {
        "liga": true,
        "kern": true,
        "onum": true,
        "smcp": false
      }
    }
  }
}
```

Common features:
- `liga` - Standard ligatures
- `kern` - Kerning
- `onum` - Oldstyle numerals
- `lnum` - Lining numerals
- `smcp` - Small caps
- `swsh` - Swash
- `frac` - Fractions

### 6.2 Variable Fonts

```json
{
  "styles": {
    "heading": {
      "fontFamily": "Roboto Flex",
      "fontVariationSettings": {
        "wght": 700,
        "wdth": 100,
        "slnt": 0
      }
    }
  }
}
```

### 6.3 Hyphenation

```json
{
  "typography": {
    "hyphenation": {
      "enabled": true,
      "language": "en-US",
      "minWordLength": 6,
      "minBefore": 3,
      "minAfter": 2,
      "maxConsecutive": 2
    }
  }
}
```

### 6.4 Widow/Orphan Control

```json
{
  "typography": {
    "widows": 2,
    "orphans": 2,
    "avoidBreakInside": ["blockquote", "table"]
  }
}
```

### 6.5 Drop Caps

```json
{
  "styles": {
    "chapter-first-para": {
      "dropCap": {
        "lines": 3,
        "fontFamily": "inherit",
        "fontWeight": "bold",
        "marginRight": "0.1em"
      }
    }
  }
}
```

### 6.6 Baseline Grid

```json
{
  "typography": {
    "baselineGrid": {
      "enabled": true,
      "lineHeight": "14pt",
      "offset": "0pt"
    }
  }
}
```

### 6.7 Line Numbering

Line numbering in margins is common for legal briefs, manuscripts, and code review documents.

```json
{
  "typography": {
    "lineNumbering": {
      "enabled": true,
      "start": 1,
      "interval": 1,
      "side": "left",
      "restart": "page"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | Yes | Whether line numbering is active |
| `start` | integer | No | Starting line number (default: 1) |
| `interval` | integer | No | Number every N lines (default: 1, every 5 is common) |
| `side` | string | No | Which margin: `"left"` (default) or `"right"` |
| `restart` | string | No | When to restart numbering (see below) |
| `style` | object | No | Number styling (see below) |

#### 6.7.1 Restart Options

| Value | Description |
|-------|-------------|
| `page` | Restart numbering on each page |
| `section` | Restart at section boundaries |
| `none` | Continuous numbering throughout document |

#### 6.7.2 Line Number Styling

```json
{
  "typography": {
    "lineNumbering": {
      "enabled": true,
      "interval": 5,
      "side": "left",
      "restart": "page",
      "style": {
        "fontSize": "8pt",
        "color": "#666666",
        "fontFamily": "monospace",
        "marginRight": "0.5em"
      }
    }
  }
}
```

#### 6.7.3 Selective Line Numbering

For documents where only certain blocks should be numbered (e.g., code blocks only):

```json
{
  "typography": {
    "lineNumbering": {
      "enabled": true,
      "scope": ["codeBlock", "blockquote"]
    }
  }
}
```

When `scope` is specified, only the listed block types receive line numbers. If omitted, all content is numbered.

## 7. Figures and Floats

> **Note:** The `figure` and `figcaption` block types are now part of the core specification (see Content Blocks, Sections 4.20-4.21). This extension provides additional float positioning and advanced numbering capabilities.

### 7.1 Float Positioning

```json
{
  "type": "image",
  "src": "assets/images/figure1.avif",
  "alt": "Figure 1",
  "float": {
    "position": "top",
    "span": "column",
    "clearance": "1em"
  }
}
```

Position options: `top`, `bottom`, `inline`, `page-top`, `page-bottom`
Span options: `column`, `page`, `spread`

### 7.2 Advanced Figure Numbering

The core `figure` block supports basic `numbering` ("auto", "none", or explicit number). This extension adds chapter-based numbering via the `numberingConfig` field:

The `numberingConfig` field provides extended numbering configuration beyond the core `numbering` field. The core `numbering` field (string or integer) controls basic numbering mode, while `numberingConfig` provides presentation-specific formatting options (`style`, a format template such as `"Figure #"`, and `chapter`, a boolean enabling chapter-based numbering).

```json
{
  "type": "figure",
  "children": [
    { "type": "image", "src": "assets/images/architecture.avif", "alt": "System architecture" },
    {
      "type": "figcaption",
      "children": [{ "type": "text", "value": "Figure 1: System architecture" }]
    }
  ],
  "numberingConfig": {
    "style": "Figure #",
    "chapter": true
  }
}
```

### 7.3 Cross-References

The `presentation:reference` block's `target` field uses Content Anchor URI syntax (see core Anchors and References specification). The `#` prefix identifies internal document references. The block uses the `presentation:` namespace prefix as required by the core content blocks spec (section 5) for extension block types:

> **Renderer safety.** The `target` field is constrained to safe schemes (Renderer Safety section 2.1); fragment and relative references remain permitted, but dangerous schemes such as `javascript:` are rejected.

```json
{
  "type": "text",
  "value": "See ",
  "marks": []
},
{
  "type": "presentation:reference",
  "target": "#fig-architecture",
  "format": "Figure #"
}
```

## 8. Table of Contents

### 8.1 TOC Generation

```json
{
  "tableOfContents": {
    "title": "Contents",
    "levels": [1, 2, 3],
    "styles": {
      "toc1": { "fontWeight": "bold", "marginTop": "1em" },
      "toc2": { "marginLeft": "1em" },
      "toc3": { "marginLeft": "2em", "fontSize": "0.9em" }
    },
    "pageNumbers": true,
    "leaders": "dots"
  }
}
```

The `leaders` style is one of `none`, `dots`, `dashes`, or `underline`.

### 8.2 List of Figures/Tables

```json
{
  "listOfFigures": {
    "title": "List of Figures",
    "style": "toc2"
  },
  "listOfTables": {
    "title": "List of Tables",
    "style": "toc2"
  }
}
```

## 9. Index

### 9.1 Index Entries

In content:

```json
{
  "type": "text",
  "value": "algorithm",
  "marks": [
    { "type": "index", "term": "algorithm", "subterm": "sorting" }
  ]
}
```

### 9.2 Index Generation

```json
{
  "index": {
    "title": "Index",
    "columns": 2,
    "style": {
      "mainEntry": { "fontWeight": "bold" },
      "subEntry": { "marginLeft": "1em" }
    }
  }
}
```

## 10. Footnotes and Endnotes

### 10.1 Footnote Definition

The presentation extension defines a self-contained `presentation:footnote` mark that carries its footnote content directly in a `content` array, for documents that use the presentation extension without the semantic extension.

**Cross-Extension Note:** When both the presentation and semantic extensions are active, the semantic extension provides the canonical footnote model — the bare `footnote` mark with separate `semantic:footnote` blocks for footnote content. The bare `footnote` mark and the `presentation:footnote` mark are distinct marks; a document SHOULD use a single footnote model. Presentation footnote styling (section 10.2) applies to whichever model is in use.

In content:

```json
{
  "type": "text",
  "value": "important claim",
  "marks": [
    {
      "type": "presentation:footnote",
      "id": "fn1",
      "content": [
        { "type": "text", "value": "Source: Annual Report 2024" }
      ]
    }
  ]
}
```

### 10.2 Footnote Styling

The footnote `position` is one of `page-bottom`, `column-bottom`, or `section-end`. The `numbering` style is one of `1`, `a`, `A`, `i`, `I`, or `*` (symbolic/asterisk).

```json
{
  "footnotes": {
    "numbering": "1",
    "position": "page-bottom",
    "separator": {
      "width": "2in",
      "style": "solid",
      "margin": "0.5em"
    },
    "style": {
      "fontSize": "0.85em",
      "lineHeight": 1.4
    }
  }
}
```

### 10.3 Endnotes

```json
{
  "endnotes": {
    "title": "Notes",
    "numbering": "1",
    "perChapter": false
  }
}
```

## 11. Running Headers/Footers

### 11.1 Dynamic Content

```json
{
  "pageTemplate": {
    "header": {
      "left": { "variable": "chapter-title" },
      "right": { "variable": "section-title" }
    },
    "footer": {
      "center": { "text": "Page {pageNumber} of {pageCount}" }
    }
  }
}
```

### 11.2 Variables

| Variable | Description |
|----------|-------------|
| `{pageNumber}` | Current page number |
| `{pageCount}` | Total pages |
| `{chapter-title}` | Current chapter title |
| `{section-title}` | Current section title |
| `{date}` | Current date |
| `{title}` | Document title |
| `{author}` | Document author |

### 11.3 Different Headers for Odd/Even

```json
{
  "pageTemplate": {
    "odd": {
      "header": { "right": { "variable": "section-title" } }
    },
    "even": {
      "header": { "left": { "variable": "chapter-title" } }
    }
  }
}
```

## 12. Examples

### 12.1 Book Layout

```json
{
  "version": "0.1",
  "type": "paginated",
  "defaults": {
    "pageSize": { "width": "6in", "height": "9in" },
    "margins": { "top": "0.75in", "outside": "0.75in", "bottom": "0.875in", "inside": "1in" }
  },
  "masterPages": {
    "chapter": {
      "margins": { "top": "2in" },
      "footer": { "center": { "text": "{pageNumber}" } }
    },
    "body": {
      "header": {
        "outside": { "variable": "section-title" }
      },
      "footer": {
        "outside": { "text": "{pageNumber}" }
      }
    }
  },
  "typography": {
    "hyphenation": { "enabled": true, "language": "en-US" },
    "widows": 2,
    "orphans": 2
  }
}
```
