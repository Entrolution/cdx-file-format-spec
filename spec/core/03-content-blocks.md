# Content Blocks

**Section**: Core Specification
**Version**: 0.1

## 1. Overview

The content layer represents document content as a tree of semantic blocks. This approach:

- Separates meaning from presentation
- Enables consistent editing across implementations
- Supports reliable machine extraction
- Facilitates accessibility

## 2. Content File

### 2.1 Location and Format

The content file:

- MUST be located at `content/document.json` (or path specified in manifest)
- MUST be valid JSON conforming to [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)
- MUST be encoded as UTF-8 without BOM

### 2.2 Root Structure

```json
{
  "version": "0.1",
  "blocks": [
    { "type": "heading", "level": 1, "children": [...] },
    { "type": "paragraph", "children": [...] },
    ...
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | Yes | Content model version |
| `blocks` | array | Yes | Array of block objects |

## 3. Block Model

### 3.1 Block Object

Every block has the following base structure:

```json
{
  "type": "paragraph",
  "id": "block-123",
  "children": [...],
  "attributes": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Block type identifier |
| `id` | string | No | Unique block identifier within document |
| `children` | array | Varies | Child nodes (blocks or text) |
| `attributes` | object | No | Standard block attributes (closed set — see below) |
| `crdt` | object | No | Transient CRDT synchronization state for the collaboration extension. Library-specific and intentionally open; stripped before the document hash is computed (Document Hashing section 4.3.1), so it never affects the document ID or any signature. |

The `attributes` object is a closed set. It accepts only `dir`, `lang`, and `writingMode` (Internationalization, section 6.1), `style` (a named style resolved by the presentation layer), and `semantic` (a JSON-LD annotation for the block, per the Semantic extension). No other keys are permitted; `attributes` is not an open container for arbitrary type-specific fields.

### 3.2 Block Identifiers

Block IDs:

- MUST be unique within the document
- SHOULD be present on all blocks
- MUST be present when the document uses any extension that references content positions (collaboration, phantoms, semantic, presentation extension)
- MUST be stable across edits for documents in REVIEW or later states
- SHOULD be stable across edits in DRAFT state (for collaboration)
- SHOULD use URL-safe characters

Block IDs share one document-wide identifier namespace with named anchor IDs and with in-content sub-block IDs — academic equation-line IDs and subfigure IDs (see Anchors and References specification). Every ID in this namespace MUST be unique across all of block IDs, anchor IDs, equation-line IDs, and subfigure IDs.

## 4. Core Block Types

### 4.1 Text Leaf Nodes

Text nodes are the leaf nodes that contain actual text content.

```json
{
  "type": "text",
  "value": "Hello, world",
  "marks": ["bold", "italic"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always "text" |
| `value` | string | Yes | Text content |
| `marks` | array | No | Formatting marks |

#### 4.1.1 Standard Marks

| Mark | Description |
|------|-------------|
| `bold` | Bold/strong text |
| `italic` | Italic/emphasized text |
| `underline` | Underlined text |
| `strikethrough` | Struck-through text |
| `code` | Inline code (monospace) |
| `superscript` | Superscript text |
| `subscript` | Subscript text |

#### 4.1.1a Anchor Mark

The `anchor` mark places a named, stable anchor point within text. Anchor marks enable internal references that survive content edits.

```json
{
  "type": "text",
  "value": "key concept",
  "marks": [
    { "type": "anchor", "id": "def-key-concept" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"anchor"` |
| `id` | string | Yes | Unique anchor identifier (shares namespace with block IDs) |

See the Anchors and References specification for full details on the anchor system, including Content Anchor URIs, character offset computation, and validation rules.

#### 4.1.2 Link Mark

Links use an extended mark format:

```json
{
  "type": "text",
  "value": "click here",
  "marks": [
    {
      "type": "link",
      "href": "https://example.com",
      "title": "Example Site"
    }
  ]
}
```

The `href` field also accepts Content Anchor URIs for internal links. Values beginning with `#` are interpreted as internal references:

```json
{
  "type": "text",
  "value": "See the introduction",
  "marks": [
    {
      "type": "link",
      "href": "#intro",
      "title": "Introduction"
    }
  ]
}
```

See the Anchors and References specification for the full Content Anchor URI syntax.

#### 4.1.3 Math Mark

Inline mathematical expressions use the math mark:

```json
{
  "type": "text",
  "value": "7.677(9)×10²",
  "marks": [
    {
      "type": "math",
      "format": "latex",
      "source": "7.677(9) \\times 10^{2}"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"math"` |
| `format` | string | Yes | `"latex"` or `"mathml"` |
| `source` | string | Yes | Math content in specified format |

The text node's `value` field contains the display/fallback text (used for plain text rendering and accessibility). The mark's `source` field contains the mathematical notation for proper typesetting.

This mark enables inline math without breaking text flow, unlike the block-level `math` type which creates a separate block element.

### 4.2 Paragraph

Standard paragraph block.

```json
{
  "type": "paragraph",
  "children": [
    { "type": "text", "value": "This is a paragraph with " },
    { "type": "text", "value": "bold", "marks": ["bold"] },
    { "type": "text", "value": " text." }
  ]
}
```

Children: Text nodes only

### 4.3 Heading

Section heading with level.

```json
{
  "type": "heading",
  "level": 2,
  "children": [
    { "type": "text", "value": "Section Title" }
  ]
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `level` | integer | Yes | Heading level (1-6) |

Children: Text nodes only

### 4.4 List

Ordered or unordered list.

```json
{
  "type": "list",
  "ordered": true,
  "start": 1,
  "children": [
    {
      "type": "listItem",
      "children": [
        { "type": "paragraph", "children": [...] }
      ]
    }
  ]
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `ordered` | boolean | Yes | Whether list is ordered |
| `start` | integer | No | Starting number (ordered lists only) |

Children: `listItem` blocks only

### 4.5 List Item

Individual list item (only valid as child of list).

```json
{
  "type": "listItem",
  "checked": null,
  "children": [
    { "type": "paragraph", "children": [...] }
  ]
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `checked` | boolean\|null | No | Checkbox state (null = not a checkbox) |

Children: Paragraph, list, or other block-level content

### 4.6 Blockquote

Quoted content block.

```json
{
  "type": "blockquote",
  "children": [
    { "type": "paragraph", "children": [...] }
  ]
}
```

Children: Paragraph or other block-level content

### 4.7 Code Block

Block of source code or preformatted text.

```json
{
  "type": "codeBlock",
  "language": "javascript",
  "children": [
    { "type": "text", "value": "function hello() {\n  return 'world';\n}" }
  ]
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `language` | string | No | Programming language identifier |
| `highlighting` | string | No | Highlighting mode: `"none"` or `"tokens"` |
| `tokens` | array | No | Pre-tokenized highlighting (when `highlighting="tokens"`) |

Children: Single text node (no marks)

Language identifiers SHOULD follow common conventions (e.g., "javascript", "python", "rust").

#### 4.7.1 Syntax Highlighting

For documents requiring stable, portable syntax highlighting, code blocks can include pre-tokenized content:

```json
{
  "type": "codeBlock",
  "language": "python",
  "highlighting": "tokens",
  "tokens": [
    { "type": "keyword", "value": "def " },
    { "type": "function", "value": "hello" },
    { "type": "punctuation", "value": "():" },
    { "type": "plain", "value": "\n    " },
    { "type": "keyword", "value": "return " },
    { "type": "string", "value": "\"world\"" }
  ],
  "children": [
    { "type": "text", "value": "def hello():\n    return \"world\"" }
  ]
}
```

**Token Types:**

| Token Type | Description |
|------------|-------------|
| `keyword` | Language keywords (if, for, def, class, etc.) |
| `function` | Function names |
| `class` | Class names |
| `variable` | Variable names |
| `parameter` | Function parameters |
| `string` | String literals |
| `number` | Numeric literals |
| `boolean` | Boolean literals |
| `null` | Null/nil/None values |
| `comment` | Code comments |
| `docstring` | Documentation strings |
| `operator` | Operators (+, -, *, etc.) |
| `punctuation` | Punctuation marks |
| `delimiter` | Delimiters (braces, brackets, etc.) |
| `type` | Type annotations |
| `namespace` | Namespace/module identifiers |
| `decorator` | Decorators/annotations |
| `plain` | Plain text (default/fallback) |

**Behavior:**
- The `children` text node is the **authoritative** source code: it is the only code content inside the document hash (a signature attests it), and MUST always contain the complete source code for rendering, fallback, and accessibility.
- `tokens` is an out-of-hash presentation hint — regenerable syntax highlighting, stripped before hashing (Document Hashing section 4.3.1) and attested by no signature. A renderer MUST NOT take the displayed characters from `tokens`. When `highlighting` is `"tokens"`, a renderer MAY apply the tokens as a *styling overlay* on the `children` text only after verifying that the concatenation of the tokens' `value`s equals the `children` text (the single text node's `value`); on any mismatch — or when it does not support the tokens format — it MUST render `children`, regenerating highlighting from `children` + `language` or showing it unhighlighted. This prevents a tampered out-of-hash `tokens` array from displaying code that is absent from the signed `children` (for example an injected `curl … | sh`); see Renderer Safety section 6.
- If `highlighting` is absent or `"none"`, renderers render the `children` text node directly.

### 4.8 Horizontal Rule

Thematic break between sections.

```json
{
  "type": "horizontalRule"
}
```

Children: None (void element)

### 4.9 Image

Embedded or referenced image.

```json
{
  "type": "image",
  "src": "assets/images/figure1.png",
  "alt": "Diagram showing system architecture",
  "title": "Figure 1: System Architecture",
  "width": 800,
  "height": 600
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `src` | string | Yes | Image source (path or URL) |
| `alt` | string | Yes | Alternative text (accessibility) |
| `title` | string | No | Image title/caption |
| `width` | integer | No | Intrinsic width in pixels |
| `height` | integer | No | Intrinsic height in pixels |
| `external` | boolean | No | When true, `src` is an external URL resolved at render time (left verbatim in the document ID) |
| `fallback` | string | No | Archive-relative path to a packaged fallback image for an unavailable external `src` (left verbatim) |
| `float` | object | No | Float positioning for this image (presentation extension) |

Children: None (void element)

For an embedded image, `src` MUST be a relative path within the archive (e.g., `assets/images/figure1.png`). An image MAY instead be external: when `external` is `true`, `src` is a URL resolved at render time, and a `fallback` relative path SHOULD be provided for when the external resource is unavailable (Asset Embedding section 9). Canonicalization (Document Hashing section 4.3.1) resolves only an archive-relative `src` to an asset hash; an external `src` and any `fallback` are left verbatim.

### 4.10 Table

Tabular data.

```json
{
  "type": "table",
  "children": [
    {
      "type": "tableRow",
      "header": true,
      "children": [
        { "type": "tableCell", "children": [
          { "type": "paragraph", "children": [{ "type": "text", "value": "Name" }] }
        ]},
        { "type": "tableCell", "children": [
          { "type": "paragraph", "children": [{ "type": "text", "value": "Value" }] }
        ]}
      ]
    },
    {
      "type": "tableRow",
      "children": [
        { "type": "tableCell", "children": [
          { "type": "paragraph", "children": [{ "type": "text", "value": "Foo" }] }
        ]},
        { "type": "tableCell", "children": [
          { "type": "paragraph", "children": [{ "type": "text", "value": "42" }] }
        ]}
      ]
    }
  ]
}
```

Children: `tableRow` blocks only

### 4.11 Table Row

Row within a table.

```json
{
  "type": "tableRow",
  "header": false,
  "children": [...]
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `header` | boolean | No | Whether row is a header row |

Children: `tableCell` blocks only

### 4.12 Table Cell

Cell within a table row.

```json
{
  "type": "tableCell",
  "colspan": 1,
  "rowspan": 1,
  "align": "left",
  "children": [...]
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `colspan` | integer | No | Number of columns to span (default: 1) |
| `rowspan` | integer | No | Number of rows to span (default: 1) |
| `align` | string | No | Text alignment: "left", "center", "right" |

Children: Block-level content (typically `paragraph` blocks)

#### 4.12.1 Simplified Cell Content

For simple cells containing only plain or formatted text, implementations MAY accept text nodes directly as children (without wrapping in a paragraph block). This is a shorthand for common cases:

**Standard form (block-level children):**

```json
{
  "type": "tableCell",
  "children": [
    { "type": "paragraph", "children": [{ "type": "text", "value": "Name" }] }
  ]
}
```

**Simplified form (text nodes directly):**

```json
{
  "type": "tableCell",
  "children": [
    { "type": "text", "value": "Name" }
  ]
}
```

Implementations MUST support the standard form. Support for the simplified form is OPTIONAL for readers and SHOULD NOT be used when generating documents intended for maximum compatibility.

### 4.13 Math

Mathematical content using MathML or LaTeX.

```json
{
  "type": "math",
  "display": true,
  "format": "latex",
  "value": "E = mc^2"
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `display` | boolean | Yes | Display mode (true) vs inline (false) |
| `format` | string | Yes | `"latex"` or `"mathml"` |
| `value` | string | Yes | Math content in specified format |

**Format details:**
- `"latex"` — LaTeX math mode using amsmath package conventions. Content is the expression only (no `$` or `\begin{equation}` delimiters). Example: `"E = mc^2"`, `"\\frac{1}{2}"`, `"\\sum_{i=1}^{n} x_i"`
- `"mathml"` — MathML 3.0 (W3C Recommendation). Content is the `<math>` element body

Children: None (content in `value` attribute)

### 4.14 Break

Line break within a block.

```json
{
  "type": "break"
}
```

Children: None (void element)

A `break` is a **block-level** element — a void block placed among other blocks to force a break in the block flow. A line break *within* a paragraph is a soft break (`\n` in a text value), not a `break` block: a paragraph's children are text nodes only (it cannot contain a `break`), as are the children of `heading`, `figcaption`, and `definitionTerm`.

#### 4.14.1 Inline Breaks vs Block Breaks

Text nodes MAY contain newline characters (`\n`) for soft line breaks. These represent inline breaks where the text flow continues but a line break is rendered. Soft breaks are typically used for poetry, addresses, or other content where line breaks are semantically meaningful but not paragraph separators.

The `break` block represents a hard, block-level break — a standalone void block that forces a break in the block flow (for example between stanzas, or among the block children of a list item). It is not an inline element and does not appear inside a paragraph's text; an inline `<br>`-style line break within a paragraph is a soft break (`\n` in a text value).

| Type | Representation | Use Case |
|------|---------------|----------|
| Soft break | `\n` in text value | Poetry lines, addresses, natural line continuation |
| Hard break | `{ "type": "break" }` | Forced breaks in structured content |
| Paragraph break | New paragraph block | Semantic paragraph separation |

**Example with soft breaks:**

```json
{
  "type": "paragraph",
  "children": [
    { "type": "text", "value": "Roses are red,\nViolets are blue" }
  ]
}
```

### 4.15 Definition List

Definition lists represent term-description pairs, commonly used for glossaries, metadata displays, and key-value content.

```json
{
  "type": "definitionList",
  "children": [
    {
      "type": "definitionItem",
      "children": [
        {
          "type": "definitionTerm",
          "children": [{ "type": "text", "value": "Nagasa" }]
        },
        {
          "type": "definitionDescription",
          "children": [
            {
              "type": "paragraph",
              "children": [{ "type": "text", "value": "Blade length measured from mune-machi to kissaki." }]
            }
          ]
        }
      ]
    },
    {
      "type": "definitionItem",
      "children": [
        {
          "type": "definitionTerm",
          "children": [{ "type": "text", "value": "Sori" }]
        },
        {
          "type": "definitionDescription",
          "children": [
            {
              "type": "paragraph",
              "children": [{ "type": "text", "value": "Curvature of the blade." }]
            }
          ]
        }
      ]
    }
  ]
}
```

| Block Type | Children | Description |
|------------|----------|-------------|
| `definitionList` | `definitionItem` only | Container for definition items |
| `definitionItem` | `definitionTerm`, `definitionDescription` | Groups a term with its description(s) |
| `definitionTerm` | Text nodes only | The term being defined |
| `definitionDescription` | Block-level content | The definition or description |

A `definitionItem` MUST contain at least one `definitionTerm` and at least one `definitionDescription`. Multiple terms MAY share a single description, and a single term MAY have multiple descriptions.

### 4.16 Measurement

Semantic representation of a measurement with optional uncertainty and units. Used for scientific, engineering, and metrology documents.

```json
{
  "type": "measurement",
  "value": 7.677,
  "uncertainty": 0.009,
  "uncertaintyNotation": "parenthetical",
  "exponent": 2,
  "unit": "mm",
  "display": "7.677(9)×10² mm"
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `value` | number | Yes | Numeric value |
| `uncertainty` | number | No | Measurement uncertainty |
| `uncertaintyNotation` | string | No | How uncertainty is displayed |
| `exponent` | integer | No | Power of 10 for scientific notation |
| `unit` | string | No | Unit of measurement |
| `display` | string | Yes | Human-readable display string |

#### 4.16.1 Uncertainty Notation

| Value | Display Format | Example |
|-------|---------------|---------|
| `parenthetical` | Uncertainty in last digit(s) | 7.677(9) |
| `plusminus` | Plus-minus format | 7.677 ± 0.009 |
| `range` | Range format | 7.668–7.686 |
| `percent` | Percentage | 7.677 ± 0.12% |

The `display` field is REQUIRED for accessibility and fallback rendering, and SHOULD accurately represent the measurement as intended for human readers. It is, however, a **presentational convenience, not the authoritative value**: `display` is stripped before hashing (Document Hashing section 4.3.1) and attested by no signature, whereas the numeric `value` (with `unit`, `exponent`, `uncertainty`, and `uncertaintyNotation`) is hashed. A renderer MUST treat the hashed fields as the authoritative measurement and MUST NOT present a stored `display` as authoritative: it SHOULD regenerate the display from the hashed fields, and where it does show the stored string it MUST confirm the string is consistent with the hashed `value` and MUST NOT display a `display` that contradicts it. Otherwise a tampered out-of-hash `display` (e.g. `"9999 mm"` over a hashed `value` of `7.677`) would state a different quantity than the signed value; see Renderer Safety section 6.

Children: None (void element)

**Note:** For complex expressions like vectors, matrices, or multi-variable measurements, use the `math` block type with LaTeX or MathML.

### 4.17 Signature

Semantic representation of a signature with optional image, signer information, and timestamp.

```json
{
  "type": "signature",
  "id": "sig-metrologist",
  "signatureType": "handwritten",
  "image": "assets/signatures/metrologist.png",
  "signer": {
    "name": "Dr. Jane Smith",
    "title": "Chief Metrologist",
    "organization": "BayKen Metrology"
  },
  "timestamp": "2026-01-29T14:15:28Z",
  "purpose": "certification",
  "digitalSignatureRef": "security/signatures.json#sig-metrologist"
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `signatureType` | string | Yes | Type of signature |
| `image` | string | No | Path to signature image |
| `signer` | object | No | Signer identity information |
| `timestamp` | string | No | ISO 8601 timestamp |
| `purpose` | string | No | Purpose of the signature |
| `digitalSignatureRef` | string | No | Reference to cryptographic signature |
| `external` | boolean | No | When true, `image` is an external reference resolved at render time (left verbatim in the document ID) |

#### 4.17.1 Signature Types

| Value | Description |
|-------|-------------|
| `handwritten` | Scanned or drawn handwritten signature |
| `digital` | Cryptographic digital signature |
| `electronic` | Typed name or simple electronic mark |
| `stamp` | Official seal or stamp image |

#### 4.17.2 Signature Purpose

| Value | Description |
|-------|-------------|
| `certification` | Certifies document accuracy or compliance |
| `approval` | Approves content or action |
| `witness` | Witnesses another signature or event |
| `acknowledgment` | Acknowledges receipt or understanding |
| `authorship` | Indicates document authorship |

The `signer` object MAY contain:
- `name` (string) - Signer's full name
- `title` (string) - Professional title
- `organization` (string) - Organization name
- `email` (string) - Contact email
- `id` (string) - Unique identifier

Children: None (void element)

### 4.18 SVG

Scalable Vector Graphics for charts, diagrams, and illustrations.

```json
{
  "type": "svg",
  "src": "assets/graphics/chart.svg",
  "alt": "Mass vs Arc Length chart showing linear relationship",
  "title": "Figure 1: Mass/Arc Length Distribution",
  "width": 400,
  "height": 300
}
```

Alternative inline form:

```json
{
  "type": "svg",
  "content": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\">...</svg>",
  "alt": "Simple diagram"
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `src` | string | No* | Path to SVG file |
| `content` | string | No* | Inline SVG content |
| `alt` | string | Yes | Alternative text (accessibility) |
| `title` | string | No | Title/caption |
| `width` | integer | No | Display width in pixels |
| `height` | integer | No | Display height in pixels |
| `external` | boolean | No | When true, `src` is an external reference resolved at render time (left verbatim in the document ID) |

*Either `src` or `content` MUST be provided, but not both.

For `src`, the path MUST be a relative path within the archive (e.g., `assets/graphics/chart.svg`) or a URL. When `external` is `true`, `src` is resolved at render time and left verbatim in the document ID. Unlike `image`, `svg` provides no `fallback` field, so an unavailable external SVG has no packaged backup.

For `content`, the value MUST be a complete SVG element including the `xmlns` attribute.

Children: None (void element)

### 4.19 Barcode

Semantic barcode representation including QR codes, DataMatrix, and linear barcodes.

```json
{
  "type": "barcode",
  "format": "qr",
  "data": "https://example.com/verify/abc123",
  "alt": "Verification QR code linking to certificate validation page",
  "errorCorrection": "M",
  "size": 100
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | Yes | Barcode format |
| `data` | string | Yes | Encoded content |
| `alt` | string | Yes | Alternative text description |
| `errorCorrection` | string | No | Error correction level (QR/DataMatrix) |
| `size` | integer | No | Rendered size in pixels |
| `quietZone` | integer | No | Quiet zone size in modules |

#### 4.19.1 Barcode Formats

| Format | Description |
|--------|-------------|
| `qr` | QR Code (2D matrix) |
| `datamatrix` | Data Matrix (2D matrix) |
| `code128` | Code 128 (linear, alphanumeric) |
| `code39` | Code 39 (linear, alphanumeric) |
| `ean13` | EAN-13 (linear, numeric) |
| `ean8` | EAN-8 (linear, numeric) |
| `upca` | UPC-A (linear, numeric) |
| `pdf417` | PDF417 (2D stacked linear) |

#### 4.19.2 Error Correction Levels

For QR codes and DataMatrix:

| Level | Recovery Capacity |
|-------|------------------|
| `L` | ~7% |
| `M` | ~15% (default) |
| `Q` | ~25% |
| `H` | ~30% |

The `data` field contains the raw content to encode. For URLs, use the full URL. For structured data, implementations SHOULD encode appropriately for the format.

The `alt` field MUST provide a meaningful description of what the barcode represents, not just "QR code" — include the purpose and destination.

Children: None (void element)

### 4.20 Figure

Container for figures with optional captions. Figures group visual content (images, SVGs, tables, charts) with their captions for semantic association and automatic numbering.

```json
{
  "type": "figure",
  "id": "fig-mass-arc",
  "children": [
    {
      "type": "image",
      "src": "assets/images/chart.png",
      "alt": "Line chart showing mass per arc length"
    },
    {
      "type": "figcaption",
      "children": [
        { "type": "text", "value": "Figure 1: Mass / Arc Length Distribution" }
      ]
    }
  ],
  "numbering": "auto"
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `numbering` | string or integer | No | Figure numbering mode |
| `subfigures` | array | No | Array of subfigure objects (alternative to children) |
| `float` | object | No | Float positioning for this figure (presentation extension) |
| `numberingConfig` | object | No | Extended figure numbering configuration (presentation extension) |

#### 4.20.1 Numbering Values

| Value | Description |
|-------|-------------|
| `auto` | Automatically number in document order |
| `none` | No numbering |
| (integer) | Explicit figure number |

**Children:** The figure block MAY contain either:
1. **Standard figure content:**
   - Exactly one content block: `image`, `svg`, `table`, `math`, or `barcode`
   - Zero or one `figcaption` block
2. **Subfigures array** (for multi-panel figures)

The `figcaption` block MAY appear before or after the content block.

#### 4.20.2 Subfigures

For multi-panel figures with individual sub-images and captions, use the `subfigures` array:

```json
{
  "type": "figure",
  "id": "fig-comparison",
  "subfigures": [
    {
      "id": "fig-comparison-a",
      "label": "a",
      "children": [
        {
          "type": "image",
          "src": "assets/images/before.png",
          "alt": "Tissue sample before treatment"
        }
      ],
      "caption": "Before treatment"
    },
    {
      "id": "fig-comparison-b",
      "label": "b",
      "children": [
        {
          "type": "image",
          "src": "assets/images/after.png",
          "alt": "Tissue sample after treatment"
        }
      ],
      "caption": "After treatment"
    }
  ],
  "caption": [
    { "type": "text", "value": "Comparison of tissue samples showing treatment effects" }
  ],
  "numbering": "auto"
}
```

| Subfigure Field | Type | Required | Description |
|-----------------|------|----------|-------------|
| `id` | string | No | Unique subfigure identifier for cross-referencing |
| `label` | string | No | Subfigure label (e.g., "a", "b", "i", "ii") |
| `children` | array | Yes | Content block(s) for this subfigure |
| `caption` | string or array | No | Subfigure-specific caption |

When using `subfigures`, the top-level `caption` field (instead of a `figcaption` child) provides the overall figure caption. This can be a simple string or an array of text nodes for rich formatting.

**Rendering:** Subfigure labels are typically rendered in parentheses (e.g., "(a)", "(b)") adjacent to or below each sub-image. The overall caption references subfigures by their labels (e.g., "Figure 1: (a) Before treatment. (b) After treatment.").

### 4.21 Figure Caption

Caption for a figure. Only valid as a child of `figure`.

```json
{
  "type": "figcaption",
  "children": [
    { "type": "text", "value": "Figure 1: System Architecture Overview" }
  ]
}
```

Children: Text nodes or inline content (including links, marks)

### 4.22 Admonition

Callout boxes for notes, warnings, tips, and other highlighted content commonly used in technical documentation, textbooks, and tutorials.

```json
{
  "type": "admonition",
  "variant": "warning",
  "title": "Caution",
  "children": [
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "High voltage. Disconnect power before servicing." }
      ]
    }
  ]
}
```

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `variant` | string | Yes | Admonition type (see below) |
| `title` | string | No | Custom title (defaults to variant label) |

#### 4.22.1 Admonition Variants

| Variant | Typical Use |
|---------|-------------|
| `note` | General information or supplementary content |
| `tip` | Helpful suggestions or best practices |
| `info` | Additional context or background information |
| `warning` | Potential issues or important considerations |
| `caution` | Actions that may cause problems |
| `danger` | Critical warnings about harmful actions |
| `important` | Key information that should not be missed |
| `example` | Illustrative examples or demonstrations |

Children: Block-level content (typically paragraph blocks)

The `title` field is OPTIONAL. When omitted, implementations SHOULD use a localized label based on the `variant` (e.g., "Note", "Warning", "Tip").

## 5. Extension Block Types

Extensions MAY define additional block types. Extension blocks:

- MUST use a namespaced type (e.g., `"forms:input"`)
- SHOULD define fallback rendering for non-supporting implementations
- MUST be documented in the extension specification

Example:

```json
{
  "type": "forms:textInput",
  "name": "email",
  "label": "Email Address",
  "required": true,
  "fallback": {
    "type": "paragraph",
    "children": [{ "type": "text", "value": "[Email input field]" }]
  }
}
```

### 5.1 Extension Mark Types

Extensions MAY define additional mark types for use within text nodes. An extension mark that is not registered in the core schema MUST use a namespace prefix (e.g., `myorg:flag`), exactly as extension block types do (section 5). The schema validates marks with an open escape: a recognized mark is checked strictly against its definition; an unrecognized **namespaced** mark passes unchecked (open-world forward compatibility); and an unrecognized **bare**, non-namespaced mark is rejected as malformed — which keeps a misspelled core mark (such as `itlaic`) from being silently accepted as an unknown mark. A reader's disposition for each case is given in the State Machine (section 5.4).

A few registered marks carry a namespaced identifier of their own (for example `legal:cite`); these belong to the known set and are validated strictly, not treated as unknown.

Extension marks:
- MUST use a namespace prefix unless registered in the core schema
- SHOULD be documented in the extension specification
- MUST define their field table (type, required fields, optional fields)
- SHOULD avoid names that collide with core marks or marks from commonly-paired extensions

## 6. Internationalization

### 6.1 Text Direction and Writing Mode

Blocks MAY specify text direction and writing mode:

```json
{
  "type": "paragraph",
  "attributes": {
    "dir": "rtl",
    "lang": "ar"
  },
  "children": [...]
}
```

```json
{
  "type": "paragraph",
  "attributes": {
    "lang": "ja",
    "writingMode": "vertical-rl"
  },
  "children": [...]
}
```

| Attribute | Type | Description |
|-----------|------|-------------|
| `dir` | string | Text direction: "ltr", "rtl", "auto" |
| `lang` | string | BCP 47 language tag |
| `writingMode` | string | Text flow direction (see below) |

#### 6.1.1 Writing Mode Values

| Value | Description | Use Case |
|-------|-------------|----------|
| `horizontal-tb` | Horizontal text, top-to-bottom block flow (default) | Latin, Cyrillic, Arabic, Hebrew |
| `vertical-rl` | Vertical text, right-to-left column flow | Traditional Chinese, Japanese, Korean |
| `vertical-lr` | Vertical text, left-to-right column flow | Mongolian |
| `sideways-rl` | Text rotated 90° clockwise | Rotated labels |
| `sideways-lr` | Text rotated 90° counter-clockwise | Rotated labels |

The `writingMode` attribute indicates the semantic writing mode of the content. For CJK text that was authored in vertical mode, this attribute preserves authorial intent even when presentation may vary.

**Relationship to Presentation:** The presentation layer (see Presentation Layers spec, Section 5.1.1) may override the visual rendering of writing mode. The content-level `writingMode` attribute represents the source/semantic writing direction, while the presentation-level `writingMode` style controls actual rendering.

### 6.2 Unicode

All text content MUST be valid Unicode (UTF-8 encoded in JSON). Implementations MUST support:

- All Unicode normalization forms
- Bidirectional text
- Combining characters
- Emoji

## 7. Validation

### 7.1 Structural Rules

1. Blocks MUST have a valid `type`
2. Children MUST be appropriate for the block type
3. Required attributes MUST be present
4. Text nodes MUST have non-null `value`

### 7.2 Content Rules

1. Paragraph children MUST be text nodes
2. Heading children MUST be text nodes
3. List children MUST be listItem blocks
4. Table children MUST be tableRow blocks
5. TableRow children MUST be tableCell blocks
6. TableCell children MUST be block-level content (typically paragraph blocks)
7. DefinitionList children MUST be definitionItem blocks
8. DefinitionItem children MUST include at least one definitionTerm and one definitionDescription
9. Figure children MUST include exactly one content block and zero or one figcaption (or use subfigures array)
10. Figcaption is only valid as a child of figure or subfigure
11. Admonition children MUST be block-level content (typically paragraph blocks)

### 7.3 Cross-References

Image `src` attributes that reference embedded assets MUST correspond to files in the assets directory.

## 8. Processing Model

### 8.1 Parsing

1. Parse JSON
2. Validate root structure
3. Recursively validate blocks
4. Resolve asset references

### 8.2 Serialization

1. Construct block tree
2. Assign IDs if needed
3. Serialize to JSON
4. Compute hash for manifest

### 8.3 Normalization

The canonical form used for hashing is defined normatively in Document Hashing, section 4.3, which is authoritative. In summary, hashed content is normalized so that:

1. Object keys are sorted per JCS (RFC 8785)
2. Object keys and string values are in Unicode Normalization Form C (NFC)

This normalization describes the canonical form that hashed content MUST already have; it is not a transform applied during hash computation.

## 9. Examples

### 9.1 Simple Document

```json
{
  "version": "0.1",
  "blocks": [
    {
      "type": "heading",
      "level": 1,
      "children": [{ "type": "text", "value": "Introduction" }]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "This document describes the " },
        { "type": "text", "value": "CDX", "marks": ["bold"] },
        { "type": "text", "value": " format." }
      ]
    },
    {
      "type": "list",
      "ordered": false,
      "children": [
        {
          "type": "listItem",
          "children": [
            {
              "type": "paragraph",
              "children": [{ "type": "text", "value": "Semantic-first design" }]
            }
          ]
        },
        {
          "type": "listItem",
          "children": [
            {
              "type": "paragraph",
              "children": [{ "type": "text", "value": "Modern security" }]
            }
          ]
        }
      ]
    }
  ]
}
```

### 9.2 Document with Table and Image

```json
{
  "version": "0.1",
  "blocks": [
    {
      "type": "heading",
      "level": 1,
      "children": [{ "type": "text", "value": "Results" }]
    },
    {
      "type": "image",
      "src": "assets/images/chart.png",
      "alt": "Bar chart showing quarterly results",
      "title": "Figure 1: Quarterly Results"
    },
    {
      "type": "table",
      "children": [
        {
          "type": "tableRow",
          "header": true,
          "children": [
            { "type": "tableCell", "children": [
              { "type": "paragraph", "children": [{ "type": "text", "value": "Quarter" }] }
            ]},
            { "type": "tableCell", "children": [
              { "type": "paragraph", "children": [{ "type": "text", "value": "Revenue" }] }
            ]}
          ]
        },
        {
          "type": "tableRow",
          "children": [
            { "type": "tableCell", "children": [
              { "type": "paragraph", "children": [{ "type": "text", "value": "Q1" }] }
            ]},
            { "type": "tableCell", "children": [
              { "type": "paragraph", "children": [{ "type": "text", "value": "$1.2M" }] }
            ]}
          ]
        }
      ]
    }
  ]
}
```
