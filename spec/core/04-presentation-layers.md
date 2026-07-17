# Presentation Layers

**Section**: Core Specification
**Version**: 0.1

## 1. Overview

Presentation layers define how semantic content is rendered visually. Multiple presentation layers enable the same content to be displayed differently depending on context (print, screen, responsive).

The key principle: **Content is authoritative; presentation is derived.**

## 2. Design Philosophy

### 2.1 Separation of Concerns

```
CONTENT (Semantic)          PRESENTATION (Visual)
├── What the text says      ├── How it looks
├── Document structure      ├── Layout and positioning
├── Meaning and intent      ├── Typography choices
└── Machine-readable        └── Human-optimized
```

### 2.2 Presentation Types

| Type | Use Case | Characteristics |
|------|----------|-----------------|
| `paginated` | Print, PDF export | Fixed pages, precise positioning |
| `continuous` | Screen reading | Vertical scroll, no page breaks |
| `responsive` | Multi-device | Adapts to viewport size |

## 3. Presentation and Document State

### 3.1 State-Aware Progressive Enhancement

Presentation precision evolves with document maturity. The presentation layer follows a progressive enhancement model tied to document state:

| Document State | Presentation Requirement | Rationale |
|----------------|-------------------------|-----------|
| **DRAFT** | Reactive only | Content is fluid, layout doesn't matter yet |
| **REVIEW** | Reactive (precise optional) | Reviewers see approximate pagination |
| **FROZEN** | Reactive (precise when page-precise fidelity is required) | Content immutable; a precise layout declared in `presentation[]` is bound (locked) too |
| **PUBLISHED** | Same as FROZEN | Authoritative, immutable record |

### 3.2 Why State-Awareness Matters

1. **Provenance integrity** — When a frozen document declares a precise layout in `presentation[]`, that layout's file hash is bound into the manifest projection, so it is immutable alongside the content under a manifest-covering signature. The document ID covers semantic content only; appearance is attested by the mandatory manifest projection (Security Extension section 9.7), with scoped `layouts` (section 9.3) available for finer per-layout attestation
2. **Legal/academic needs** — Citations reference "page 7, line 23" with confidence
3. **Lifecycle alignment** — Precision emerges naturally as documents mature
4. **No capability loss** — Semantic content always present for accessibility/search
5. **Stable cross-references** — Internal refs ("see page 7") guaranteed stable once frozen

### 3.3 Reactive vs. Precise Presentation

**Reactive presentation** (paginated, continuous, responsive) provides hints and styles that renderers interpret. The same document may render differently across devices or implementations.

**Precise presentation** (layouts) provides exact coordinates for every element. The document renders identically everywhere.

### 3.4 Transition Requirements

When transitioning to FROZEN or PUBLISHED state:

1. If the document asserts page-precise fidelity (e.g. citable pagination or print/legal use), at least one precise layout MUST exist; otherwise a precise layout is RECOMMENDED but not required
2. Any precise layout present MUST have a `contentHash` matching the current content hash (a staleness guard: it binds the layout to *this* content version, not the layout file's own integrity)
3. If a present layout is stale, the transition MUST fail
4. Every precise-layout file present MUST be declared in `manifest.presentation[]` (type `precise`), so its file hash is bound into the manifest projection (Security Extension section 9.7) and attested by the mandatory manifest-covering signature. An undeclared precise-layout file is unauthenticated — the signature attests only *declared* layouts — so it could be substituted or injected under a valid signature, and a renderer MUST NOT treat it as authoritative (section 12)

Freezing always locks the semantic content (the document ID). When a precise layout is declared in `presentation[]`, its file hash is bound into the manifest projection, so on a frozen or published document — where a manifest-covering signature is mandatory — its appearance is locked alongside the content and tamper-evident: editing the layout to hide, occlude, or inject content changes its hash and invalidates every manifest-covering signature.

## 4. Presentation File Structure

### 4.1 Location

Presentation files are stored in the `presentation/` directory:

```
presentation/
├── paginated.json        # Reactive: print/PDF hints
├── continuous.json       # Reactive: scroll layout hints
├── responsive.json       # Reactive: viewport adaptation
└── layouts/              # Precise: exact coordinates
    ├── letter.json       # Used when page-precise fidelity is required
    └── a4.json           # Additional formats (optional)
```

### 4.2 Root Structure

```json
{
  "version": "0.1",
  "type": "paginated",
  "defaults": {...},
  "pages": [...],
  "styles": {...}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | Yes | Presentation format version |
| `type` | string | Yes | Presentation type identifier |
| `defaults` | object | Yes | Default styling values |
| `pages` | array | Varies | Page definitions (paginated only) |
| `styles` | object | Yes | Style definitions |

## 5. Styling Model

### 5.1 CSS Subset

Presentation styling uses a subset of CSS properties. This provides familiarity while constraining complexity.

#### Supported Properties

**Typography:**
- `fontFamily` - Font family stack
- `fontSize` - Font size (with units)
- `fontWeight` - Font weight (100-900, or keywords `normal`/`bold`/`bolder`/`lighter`)
- `fontStyle` - normal, italic
- `lineHeight` - Line height (unitless ratio or with units)
- `letterSpacing` - Letter spacing
- `textAlign` - left, center, right, justify
- `textDecoration` - none, underline, line-through
- `textTransform` - none, uppercase, lowercase, capitalize
- `color` - Text color
- `writingMode` - Text flow direction (see Section 5.1.1)

#### 5.1.1 Writing Mode

The `writingMode` property controls the direction of text flow and block progression:

| Value | Description | Use Case |
|-------|-------------|----------|
| `horizontal-tb` | Horizontal text, top-to-bottom blocks (default) | Latin, Cyrillic, Greek |
| `vertical-rl` | Vertical text, right-to-left columns | Traditional CJK (Chinese, Japanese, Korean) |
| `vertical-lr` | Vertical text, left-to-right columns | Mongolian |
| `sideways-rl` | Rotated 90° clockwise | Rotated labels |
| `sideways-lr` | Rotated 90° counter-clockwise | Rotated labels |

```json
{
  "styles": {
    "verticalText": {
      "writingMode": "vertical-rl",
      "fontFamily": "Noto Sans JP, sans-serif"
    },
    "rotatedLabel": {
      "writingMode": "sideways-lr",
      "fontSize": "10pt"
    }
  }
}
```

**Note:** The `writingMode` style property works in conjunction with the content-level `writingMode` attribute (see Content Blocks spec). When both are present, the presentation style takes precedence for visual rendering.

**Spacing:**
- `marginTop`, `marginRight`, `marginBottom`, `marginLeft`
- `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`

**Borders:**
- `borderWidth`, `borderStyle`, `borderColor`
- Individual sides: `borderTopWidth`, etc.
- Per-side shorthands: `borderTop`, `borderBottom`, `borderLeft`, `borderRight`
- `borderCollapse` - table border model (`collapse` or `separate`)

**Background:**
- `backgroundColor`
- `backgroundImage` - URL/path to image (see Section 5.4)
- `backgroundSize` - `cover`, `contain`, or dimensions
- `backgroundPosition` - Position keywords or values
- `backgroundRepeat` - `repeat`, `no-repeat`, `repeat-x`, `repeat-y`

**Visual Effects:**
- `opacity` - Transparency from 0.0 (fully transparent) to 1.0 (fully opaque)
- `borderRadius` - Rounded corners (e.g., `"4px"`, `"0.5em"`)
- `boxShadow` - Drop shadow (e.g., `"2px 2px 4px rgba(0,0,0,0.1)"`)

**Layout:**
- `width`, `height`, `maxWidth`, `maxHeight`
- `display` - block, inline, none

### 5.2 Units

Supported units:

| Unit | Description | Use |
|------|-------------|-----|
| `px` | Pixels (96 per inch, CSS reference pixel) | Absolute sizing |
| `pt` | Points (1/72 inch) | Typography |
| `em` | Relative to font size | Responsive sizing |
| `rem` | Relative to root font size | Consistent sizing |
| `%` | Percentage of container | Relative layout |
| `in` | Inches | Print layout |
| `cm` | Centimeters | Print layout |
| `mm` | Millimeters | Print layout |

### 5.3 Colors

Colors may be specified as:

- Named colors: `"red"`, `"blue"`, `"black"`, etc.
- Hex: `"#ff0000"`, `"#f00"`
- RGB: `"rgb(255, 0, 0)"`
- RGBA: `"rgba(255, 0, 0, 0.5)"`

### 5.4 Background Images

Background images enable watermarks, decorative elements, and complex backgrounds:

```json
{
  "styles": {
    "watermarked": {
      "backgroundImage": "assets/images/watermark.png",
      "backgroundSize": "contain",
      "backgroundPosition": "center",
      "backgroundRepeat": "no-repeat",
      "opacity": 0.3
    },
    "certificateBorder": {
      "backgroundImage": "assets/images/border-pattern.svg",
      "backgroundSize": "100% 100%",
      "backgroundRepeat": "no-repeat"
    }
  }
}
```

| Property | Values | Description |
|----------|--------|-------------|
| `backgroundImage` | path or URL | Image source (relative paths for embedded assets) |
| `backgroundSize` | `cover`, `contain`, or dimensions | How image is sized |
| `backgroundPosition` | position keywords or values | Where image is positioned |
| `backgroundRepeat` | `repeat`, `no-repeat`, `repeat-x`, `repeat-y` | Tiling behavior |

**backgroundSize values:**
- `cover` - Scale to cover entire element (may crop)
- `contain` - Scale to fit within element (may leave gaps)
- Dimensions: `"100px 50px"`, `"100% auto"`, etc.

**backgroundPosition values:**
- Keywords: `center`, `top`, `bottom left`, `right center`, etc.
- Lengths: `"10px 20px"`, `"50% 25%"`, etc.

### 5.5 Opacity and Visual Effects

```json
{
  "styles": {
    "subtle": {
      "opacity": 0.7
    },
    "card": {
      "backgroundColor": "#ffffff",
      "borderRadius": "8px",
      "boxShadow": "0 2px 8px rgba(0,0,0,0.15)"
    }
  }
}
```

| Property | Type | Description |
|----------|------|-------------|
| `opacity` | number (0.0-1.0) | Element transparency (0 = invisible, 1 = opaque) |
| `borderRadius` | string | Corner rounding (e.g., `"4px"`, `"0.5em"`, `"50%"`) |
| `boxShadow` | string | Shadow effect using CSS shadow syntax |

**boxShadow syntax:** `"offset-x offset-y blur-radius spread-radius color"`
- `"2px 2px 4px rgba(0,0,0,0.1)"` - subtle drop shadow
- `"0 4px 12px rgba(0,0,0,0.25)"` - elevated card effect
- `"inset 0 1px 2px rgba(0,0,0,0.1)"` - inset shadow

## 6. Paginated Presentation

### 6.1 Structure

```json
{
  "version": "0.1",
  "type": "paginated",
  "defaults": {
    "pageSize": "letter",
    "orientation": "portrait",
    "margins": {
      "top": "1in",
      "right": "1in",
      "bottom": "1in",
      "left": "1in"
    }
  },
  "pages": [
    {
      "number": 1,
      "elements": [...]
    }
  ],
  "styles": {...}
}
```

### 6.2 Page Sizes

| Name | Dimensions | Use |
|------|------------|-----|
| `letter` | 8.5 × 11 in | US standard |
| `legal` | 8.5 × 14 in | US legal |
| `a4` | 210 × 297 mm | International standard |
| `a5` | 148 × 210 mm | Half A4 |
| Custom | `{ "width": "8in", "height": "10in" }` | Any size |

### 6.3 Page Elements

Each page contains positioned elements that reference content blocks:

```json
{
  "number": 1,
  "elements": [
    {
      "blockId": "block-123",
      "position": {
        "x": "1in",
        "y": "1in",
        "width": "6.5in",
        "height": "auto"
      },
      "style": "heading1"
    },
    {
      "blockId": "block-456",
      "position": {
        "x": "1in",
        "y": "2in",
        "width": "6.5in",
        "height": "auto"
      },
      "style": "bodyText"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `blockId` | string | Yes | Reference to content block ID |
| `position` | object | Yes | Position and size |
| `style` | string | No | Named style to apply |
| `overflow` | string | No | "visible", "hidden", "flow" |
| `zIndex` | integer | No | Stacking order (higher values render on top) |
| `transform` | object | No | Transform properties (see Section 16) |

### 6.3.1 Z-Index and Stacking Order

The `zIndex` property controls the stacking order of overlapping elements:

```json
{
  "elements": [
    {
      "blockId": "background-image",
      "position": { "x": "0", "y": "0", "width": "8.5in", "height": "11in" },
      "zIndex": 0
    },
    {
      "blockId": "signature",
      "position": { "x": "5in", "y": "9in", "width": "2in", "height": "1in" },
      "zIndex": 1
    },
    {
      "blockId": "timestamp",
      "position": { "x": "5.5in", "y": "9.5in", "width": "1in", "height": "0.3in" },
      "zIndex": 2
    }
  ]
}
```

**Rules:**
- Default `zIndex` is 0
- Higher values render on top of lower values
- Elements with the same `zIndex` render in document order (later elements on top)
- Negative values are permitted

### 6.4 Flow Elements

For automatic text flow across pages:

```json
{
  "type": "flow",
  "blockIds": ["block-1", "block-2", "block-3"],
  "columns": 1,
  "startPage": 1,
  "regions": [
    {
      "page": 1,
      "position": { "x": "1in", "y": "2in", "width": "6.5in", "height": "8in" }
    },
    {
      "page": 2,
      "position": { "x": "1in", "y": "1in", "width": "6.5in", "height": "9in" }
    }
  ]
}
```

## 7. Continuous Presentation

### 7.1 Structure

```json
{
  "version": "0.1",
  "type": "continuous",
  "defaults": {
    "maxWidth": "800px",
    "padding": "24px"
  },
  "sections": [
    {
      "blockRefs": ["block-1", "block-2"],
      "style": "introduction"
    }
  ],
  "styles": {...}
}
```

### 7.2 Sections

Continuous presentation groups content into sections for styling purposes:

```json
{
  "blockRefs": ["block-1", "block-2", "block-3"],
  "style": "chapter",
  "attributes": {
    "marginTop": "48px",
    "borderTop": "1px solid #ccc"
  }
}
```

## 8. Responsive Presentation

### 8.1 Structure

```json
{
  "version": "0.1",
  "type": "responsive",
  "defaults": {
    "rootFontSize": "16px"
  },
  "breakpoints": [
    { "name": "mobile", "maxWidth": "599px" },
    { "name": "tablet", "minWidth": "600px", "maxWidth": "1023px" },
    { "name": "desktop", "minWidth": "1024px" }
  ],
  "styles": {
    "heading1": {
      "base": { "fontSize": "2rem", "fontWeight": "700" },
      "mobile": { "fontSize": "1.5rem" }
    }
  }
}
```

### 8.2 Breakpoints

```json
{
  "breakpoints": [
    { "name": "mobile", "maxWidth": "599px" },
    { "name": "tablet", "minWidth": "600px", "maxWidth": "1023px" },
    { "name": "desktop", "minWidth": "1024px" }
  ]
}
```

### 8.3 Responsive Styles

Styles can have breakpoint-specific overrides:

```json
{
  "paragraph": {
    "base": {
      "fontSize": "1rem",
      "lineHeight": 1.6,
      "marginBottom": "1em"
    },
    "mobile": {
      "fontSize": "0.9rem",
      "lineHeight": 1.5
    },
    "desktop": {
      "fontSize": "1.1rem"
    }
  }
}
```

## 9. Style Definitions

### 9.1 Named Styles

Styles are defined by name and referenced by elements:

```json
{
  "styles": {
    "heading1": {
      "fontFamily": "Georgia, serif",
      "fontSize": "2em",
      "fontWeight": "700",
      "marginTop": "1.5em",
      "marginBottom": "0.5em",
      "color": "#1a1a1a"
    },
    "bodyText": {
      "fontFamily": "system-ui, sans-serif",
      "fontSize": "1rem",
      "lineHeight": 1.6,
      "marginBottom": "1em",
      "color": "#333333"
    }
  }
}
```

### 9.2 Default Styles

Implementations MUST provide default styles for all block types when not explicitly styled.

Recommended defaults:

| Block Type | Font Size | Font Weight | Margins |
|------------|-----------|-------------|---------|
| heading1 | 2em | 700 | 0.67em top/bottom |
| heading2 | 1.5em | 700 | 0.83em top/bottom |
| heading3 | 1.17em | 700 | 1em top/bottom |
| paragraph | 1em | 400 | 1em bottom |
| list | 1em | 400 | 1em bottom |
| codeBlock | 0.9em | 400 | 1em top/bottom |

### 9.3 Style Inheritance

Styles can inherit from other styles:

```json
{
  "styles": {
    "baseText": {
      "fontFamily": "system-ui, sans-serif",
      "lineHeight": 1.6
    },
    "paragraph": {
      "extends": "baseText",
      "fontSize": "1rem",
      "marginBottom": "1em"
    },
    "lead": {
      "extends": "paragraph",
      "fontSize": "1.2rem",
      "fontWeight": "500"
    }
  }
}
```

## 10. Block Type Styling

### 10.1 Automatic Style Mapping

Content blocks are automatically mapped to styles:

| Block Type | Default Style Name |
|------------|-------------------|
| `heading` (level 1) | `heading1` |
| `heading` (level 2) | `heading2` |
| `heading` (level 3-6) | `heading3`-`heading6` |
| `paragraph` | `paragraph` |
| `list` | `list` |
| `listItem` | `listItem` |
| `blockquote` | `blockquote` |
| `codeBlock` | `codeBlock` |
| `table` | `table` |
| `image` | `image` |

### 10.2 Custom Block Styles

Content blocks can specify a custom style via their `style` attribute:

```json
{
  "type": "paragraph",
  "attributes": {
    "style": "lead"
  },
  "children": [...]
}
```

## 11. Presentation Caching

### 11.1 Cached vs. Computed

Presentation layers MAY be:

1. **Stored (cached)**: Pre-computed and saved in the document
2. **Computed**: Generated on-demand from content and styles

Recommendation:
- Store paginated presentation for print fidelity
- Compute continuous/responsive for flexibility

### 11.2 Cache Invalidation

When content changes, cached presentation layers become stale.

The manifest's content hash can be compared to detect staleness:

```json
{
  "presentation": [
    {
      "type": "paginated",
      "path": "presentation/paginated.json",
      "contentHash": "sha256:abc123...",
      "generated": "2025-01-15T10:00:00Z"
    }
  ]
}
```

If `contentHash` doesn't match current content hash, the presentation should be regenerated.

## 12. Precise Layouts

Precise layouts provide exact coordinates for every element, enabling pixel-perfect reproduction regardless of rendering implementation. They are **required** for FROZEN and PUBLISHED documents that assert page-precise fidelity (e.g. citable pagination or print/legal use), and **RECOMMENDED** otherwise.

A precise layout is declared in `manifest.presentation[]` with `type: "precise"` and the file's `path` and `hash`, exactly like a reactive presentation. Declaring it binds its file hash into the manifest projection (Security Extension section 9.7); on a frozen or published document, where a manifest-covering signature is mandatory, this makes the coordinates tamper-evident — the property page-precise fidelity depends on (section 3.4).

**Only a declared layout is authoritative.** On a `frozen` or `published` document a renderer MUST NOT render a precise-layout file that is not declared in `manifest.presentation[]`. An undeclared layout carries no bound hash, so the mandatory manifest-covering signature does not attest it and an attacker could add or substitute one — a hidden clause, an occluded signature block, an injected "CERTIFIED" stamp — under a still-valid signature. Selecting a layout by scanning `presentation/layouts/` (for example by `targetFormat`) MUST therefore be restricted to declared layouts; an undeclared precise-layout file present in the archive is unauthenticated, MUST NOT be used as the authoritative appearance, and its presence SHOULD be surfaced as an integrity concern rather than treated as a benign out-of-hash layer (State Machine section 5.4.2). Where no declared layout matches, the renderer falls back to a declared presentation.

### 12.1 Location

Precise layouts are stored in `presentation/layouts/`:

```
presentation/
└── layouts/
    ├── letter.json       # US Letter format
    ├── a4.json           # A4 format
    └── legal.json        # US Legal format (if needed)
```

### 12.2 Precise Layout Structure

```json
{
  "version": "0.1",
  "presentationType": "precise",
  "targetFormat": "letter",
  "pageSize": {
    "width": "8.5in",
    "height": "11in"
  },
  "contentHash": "sha256:abc123...",
  "generatedAt": "2025-01-25T10:30:00Z",
  "pageTemplate": {
    "margins": { "top": "1in", "bottom": "1in", "left": "1in", "right": "1in" },
    "header": {
      "content": "Document Title",
      "style": "header",
      "y": "0.5in"
    },
    "footer": {
      "content": "Page {pageNumber} of {totalPages}",
      "style": "footer",
      "y": "10.5in"
    }
  },
  "pages": [...],
  "fonts": {...}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | Yes | Layout format version |
| `presentationType` | string | Yes | Must be `"precise"` |
| `targetFormat` | string | Yes | Page format name (letter, a4, legal, custom) |
| `pageSize` | object | Yes | Exact page dimensions |
| `contentHash` | string | Yes | Hash of content when layout was generated |
| `generatedAt` | string | Yes | ISO 8601 timestamp (when layout was generated — distinct from document `created`/`modified` which are lifecycle timestamps) |
| `pageTemplate` | object | No | Headers, footers, margins for all pages |
| `pages` | array | Yes | Array of page definitions |
| `fonts` | object | No | Font metrics for exact reproduction |

### 12.3 Page Definitions

Each page contains precisely positioned elements:

```json
{
  "pages": [
    {
      "number": 1,
      "elements": [
        {
          "blockId": "block-1",
          "x": "1in",
          "y": "1in",
          "width": "6.5in",
          "height": "0.5in"
        },
        {
          "blockId": "block-2",
          "x": "1in",
          "y": "1.75in",
          "width": "6.5in",
          "height": "2.3in",
          "continues": true
        }
      ]
    },
    {
      "number": 2,
      "elements": [
        {
          "blockId": "block-2",
          "x": "1in",
          "y": "1in",
          "width": "6.5in",
          "height": "1.2in",
          "continuation": true
        }
      ]
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `blockId` | string | Yes | Reference to content block ID |
| `x` | string | Yes | Horizontal position from left edge |
| `y` | string | Yes | Vertical position from top edge |
| `width` | string | Yes | Element width |
| `height` | string | Yes | Element height |
| `continues` | boolean | No | True if element continues to next page |
| `continuation` | boolean | No | True if element is continued from previous page |

### 12.4 Line-Level Precision

For legal documents requiring line citations ("page 7, line 23"), elements MAY include line-level coordinates:

```json
{
  "blockId": "block-5",
  "x": "1in",
  "y": "3in",
  "width": "6.5in",
  "height": "1.5in",
  "lines": [
    { "number": 1, "y": "3in", "height": "0.2in" },
    { "number": 2, "y": "3.25in", "height": "0.2in" },
    { "number": 3, "y": "3.5in", "height": "0.2in" }
  ]
}
```

Line-level precision is **optional** — only needed for legal/court documents where line numbers are referenced.

### 12.5 Font Metrics

For exact text reproduction, precise layouts MAY include font metrics:

```json
{
  "fonts": {
    "main": {
      "family": "Times New Roman",
      "style": "normal",
      "weight": 400,
      "unitsPerEm": 2048,
      "ascender": 1825,
      "descender": -443
    }
  }
}
```

Full font files (if needed) are stored in `assets/fonts/` and referenced from the asset index.

### 12.6 Content Hash Validation

The `contentHash` field enables staleness detection:

1. When generating a precise layout, record the current content hash
2. Before using a layout, compare its `contentHash` to current content
3. If they differ, the layout is **stale** and should not be used for frozen documents

```
Content Hash: sha256:abc123...
Layout Hash:  sha256:abc123...  ✓ Valid

Content Hash: sha256:xyz789...
Layout Hash:  sha256:abc123...  ✗ Stale - content has changed
```

### 12.7 Requirements by State

| State | Precise Layout Required | Staleness Check |
|-------|------------------------|-----------------|
| DRAFT | No | No |
| REVIEW | No | Optional |
| FROZEN | When page-precise fidelity is asserted (else recommended) | **Yes**, if a layout is present |
| PUBLISHED | When page-precise fidelity is asserted (else recommended) | **Yes**, if a layout is present |

## 13. Fallback Behavior

### 13.1 Missing Presentation

If no presentation layer is present:

1. Apply default styles to all blocks
2. Render in continuous vertical scroll
3. Use system fonts and sensible defaults

### 13.2 Unsupported Elements

For content blocks without styling rules:

1. Apply generic block styling
2. Log warning for implementers
3. Render content in fallback style

### 13.3 Unsupported Presentation Type

A presentation's `type` (`paginated`, `continuous`, `responsive`, `precise`) is a **closed** set: it selects the file's entire structure, so unlike a content block it has no defined fallback shape, and the set is intentionally not extensible. A `type` outside this set is a validation failure (State Machine section 5.4), not a forward-compatibility escape, and the `type` MUST agree between the manifest's `presentation` reference and the presentation file's own discriminator — the reactive types with a presentation.schema.json file's `type`, and `precise` with a precise-layout file's `presentationType`.

An implementation that recognizes the `type` but does not implement that presentation mode falls back to default rendering (section 13.1); the document's content is unaffected.

### 13.4 Dangling Presentation Reference

A presentation rule targets content by `blockId` (a `pageElement`) or `blockRefs` (a `section`). If a referenced block does not exist in the content — a stale reference, or a typo — the reader omits that rule and renders the affected content with default styling, surfacing a warning (State Machine section 5.4). Because presentation is outside the document-hash boundary (Document Hashing section 4.1a), a dangling presentation reference degrades rendering but never impugns document integrity, in any state. The presentation file's own integrity — its hash, and its coverage by a signature on a frozen or published document — is a separate matter, dispositioned by the integrity rows of State Machine section 5.4.

## 14. Print Considerations

### 14.1 Page Breaks

Control page breaks in paginated output:

```json
{
  "styles": {
    "chapter": {
      "pageBreakBefore": "always"
    },
    "heading2": {
      "pageBreakAfter": "avoid"
    }
  }
}
```

Values: `auto`, `always`, `avoid`

### 14.2 Headers and Footers

```json
{
  "pageTemplate": {
    "header": {
      "height": "0.5in",
      "content": {
        "left": { "text": "{title}" },
        "center": null,
        "right": { "text": "{date}" }
      }
    },
    "footer": {
      "height": "0.5in",
      "content": {
        "left": null,
        "center": { "text": "Page {pageNumber} of {pageCount}" },
        "right": null
      }
    }
  }
}
```

Variables:
- `{pageNumber}` - Current page number
- `{pageCount}` - Total page count
- `{title}` - Document title from metadata
- `{date}` - Current date
- `{author}` - Author from metadata

## 15. Accessibility

### 15.1 Requirements

Presentation layers MUST NOT:

- Hide content visually that should be accessible
- Use color alone to convey meaning
- Specify text smaller than reasonable minimum (12px recommended)

### 15.2 Contrast

For text colors, ensure sufficient contrast ratio:

- Normal text: 4.5:1 minimum
- Large text (18pt+ or 14pt+ bold): 3:1 minimum

## 16. Transforms

Transforms enable rotation, scaling, skewing, and translation of positioned elements. Transforms are particularly useful for:

- Rotated text (e.g., vertical labels, angled watermarks)
- Scaled elements
- Complex layout effects

### 16.1 Transform Properties

Elements in paginated presentations and precise layouts MAY include a `transform` property:

```json
{
  "blockId": "hash-text",
  "position": { "x": "0.3in", "y": "1in", "width": "9in", "height": "0.5in" },
  "transform": {
    "rotate": "-90deg",
    "origin": "top left"
  }
}
```

| Property | Type | Description |
|----------|------|-------------|
| `rotate` | string | Rotation angle: `"45deg"`, `"-90deg"`, `"0.5rad"`, `"0.25turn"` |
| `scale` | number or object | Uniform scale: `1.5`, or per-axis: `{ "x": 1.5, "y": 1.0 }` |
| `skewX` | string | Horizontal skew angle: `"15deg"` |
| `skewY` | string | Vertical skew angle: `"15deg"` |
| `translateX` | string | Horizontal translation: `"10px"`, `"0.5in"` |
| `translateY` | string | Vertical translation: `"10px"`, `"0.5in"` |
| `matrix` | array | Full 2D transform matrix: `[a, b, c, d, tx, ty]` |
| `origin` | string or object | Transform origin point |

### 16.2 Rotation Units

| Unit | Description | Example |
|------|-------------|---------|
| `deg` | Degrees (360° = full rotation) | `"90deg"`, `"-45deg"` |
| `rad` | Radians (2π = full rotation) | `"1.5708rad"` |
| `turn` | Turns (1 = full rotation) | `"0.25turn"` |

### 16.3 Transform Origin

The `origin` property specifies the point around which transforms are applied:

**Keyword values:**
- Position keywords: `"top left"`, `"center"`, `"bottom right"`, etc.
- Single keyword: `"center"` (equivalent to `"center center"`)

**Coordinate values:**
```json
{
  "origin": { "x": "50%", "y": "0" }
}
```

Default origin is `"center"` (center of the element's bounding box).

### 16.4 Transform Matrix

For complex transforms, use the matrix property with the standard 2D affine transformation matrix:

```json
{
  "transform": {
    "matrix": [1, 0, 0, 1, 0, 0]
  }
}
```

The matrix `[a, b, c, d, tx, ty]` represents:
```
| a  c  tx |
| b  d  ty |
| 0  0  1  |
```

Common matrices:
- Identity (no transform): `[1, 0, 0, 1, 0, 0]`
- 90° clockwise: `[0, 1, -1, 0, 0, 0]`
- Scale 2×: `[2, 0, 0, 2, 0, 0]`

### 16.5 Transform Order

When multiple transform properties are specified, they are applied in this order:

1. `translate` (translateX, translateY)
2. `rotate`
3. `scale`
4. `skew` (skewX, skewY)

If `matrix` is specified, it overrides all other transform properties.

## 17. Examples

### 17.1 Minimal Continuous Presentation

```json
{
  "version": "0.1",
  "type": "continuous",
  "defaults": {
    "maxWidth": "720px",
    "padding": "20px",
    "fontFamily": "Georgia, serif",
    "fontSize": "18px",
    "lineHeight": 1.7
  },
  "styles": {
    "heading1": {
      "fontSize": "2.5rem",
      "fontWeight": "700",
      "marginTop": "2rem",
      "marginBottom": "1rem"
    },
    "paragraph": {
      "marginBottom": "1.2em"
    }
  }
}
```

### 17.2 Print-Ready Paginated Presentation

```json
{
  "version": "0.1",
  "type": "paginated",
  "defaults": {
    "pageSize": "letter",
    "orientation": "portrait",
    "margins": {
      "top": "1in",
      "right": "1in",
      "bottom": "1in",
      "left": "1.25in"
    }
  },
  "pageTemplate": {
    "footer": {
      "height": "0.5in",
      "content": {
        "center": { "text": "{pageNumber}" }
      }
    }
  },
  "styles": {
    "heading1": {
      "fontFamily": "Helvetica, sans-serif",
      "fontSize": "24pt",
      "fontWeight": "700",
      "pageBreakBefore": "always"
    },
    "bodyText": {
      "fontFamily": "Times New Roman, serif",
      "fontSize": "12pt",
      "lineHeight": 1.5,
      "textAlign": "justify"
    }
  }
}
```
