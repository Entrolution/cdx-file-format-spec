# Legal Extension

**Extension ID**: `cdx.legal`
**Version**: 0.1
**Status**: Draft

## 1. Overview

The Legal Extension provides specialized blocks and marks for legal documents, including:

- Table of Authorities (auto-generated citation index)
- Legal citation marks with citation style support
- Support for common legal citation formats (Bluebook, ALWD, McGill, OSCOLA)

## 2. Extension Declaration

```json
{
  "extensions": [
    {
      "id": "cdx.legal",
      "version": "0.1",
      "required": false
    }
  ]
}
```

## 3. Legal Citation Mark

The `legal:cite` mark annotates text with legal citation information for automatic Table of Authorities generation.

> **Note:** The `legal:cite` mark uses the `legal:` namespace prefix to distinguish it from the semantic extension's `citation` mark, which serves a different purpose (scholarly citations vs. legal citations). See the core Content Blocks specification (Section 5) for the extension mark naming convention.

### 3.1 Basic Usage

```json
{
  "type": "text",
  "value": "Brown v. Board of Education",
  "marks": [
    {
      "type": "legal:cite",
      "citation": "347 U.S. 483 (1954)",
      "category": "cases",
      "shortForm": "Brown"
    }
  ]
}
```

### 3.2 Citation Mark Properties

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"legal:cite"` |
| `citation` | string | Yes | Full citation string |
| `category` | string | Yes | Citation category for TOA grouping |
| `shortForm` | string | No | Short form for subsequent references |
| `pinpoint` | string | No | Specific page, paragraph, or section reference |
| `format` | string | No | Citation style override |

### 3.3 Citation Categories

Standard categories for Table of Authorities grouping:

| Category | Description |
|----------|-------------|
| `cases` | Court cases and judicial decisions |
| `statutes` | Statutory law |
| `regulations` | Administrative regulations |
| `constitutions` | Constitutional provisions |
| `treatises` | Legal treatises and books |
| `law-reviews` | Law review articles |
| `other` | Other secondary sources |

### 3.4 Pinpoint Citations

For citations to specific locations within a source:

```json
{
  "type": "text",
  "value": "Brown",
  "marks": [
    {
      "type": "legal:cite",
      "citation": "347 U.S. 483 (1954)",
      "category": "cases",
      "shortForm": "Brown",
      "pinpoint": "at 495"
    }
  ]
}
```

## 4. Table of Authorities Block

The `legal:tableOfAuthorities` block generates an auto-indexed table of all cited authorities.

### 4.1 Basic Usage

```json
{
  "type": "legal:tableOfAuthorities",
  "id": "toa",
  "title": "Table of Authorities"
}
```

### 4.2 Configuration Options

```json
{
  "type": "legal:tableOfAuthorities",
  "id": "toa",
  "title": "Table of Authorities",
  "categories": [
    { "name": "Cases", "key": "cases", "format": "bluebook" },
    { "name": "Statutes", "key": "statutes", "format": "bluebook" },
    { "name": "Regulations", "key": "regulations", "format": "bluebook" },
    { "name": "Constitutional Provisions", "key": "constitutions", "format": "bluebook" },
    { "name": "Secondary Sources", "key": "treatises", "format": "bluebook" }
  ],
  "pageReferences": true,
  "passimThreshold": 5
}
```

### 4.3 Table of Authorities Properties

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"legal:tableOfAuthorities"` |
| `id` | string | No | Block identifier |
| `title` | string | No | Section title (default: "Table of Authorities") |
| `categories` | array | No | Category configuration (see below) |
| `pageReferences` | boolean | No | Include page references (default: true) |
| `passimThreshold` | integer | No | Number of references before showing "passim" instead of page list |

### 4.4 Category Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name for the category |
| `key` | string | Yes | Category key (matches citation mark category) |
| `format` | string | No | Citation style for this category |

## 5. Citation Formats

The Legal Extension supports common legal citation styles:

### 5.1 Bluebook

The Bluebook: A Uniform System of Citation (US legal standard)

```json
{
  "type": "legal:cite",
  "citation": "347 U.S. 483 (1954)",
  "format": "bluebook"
}
```

### 5.2 ALWD

ALWD Guide to Legal Citation

```json
{
  "type": "legal:cite",
  "citation": "Brown v. Bd. of Educ., 347 U.S. 483 (1954)",
  "format": "alwd"
}
```

### 5.3 McGill

Canadian Guide to Uniform Legal Citation (McGill Guide)

```json
{
  "type": "legal:cite",
  "citation": "Brown v Board of Education, 347 US 483 (1954)",
  "format": "mcgill"
}
```

### 5.4 OSCOLA

Oxford University Standard for Citation of Legal Authorities (UK)

```json
{
  "type": "legal:cite",
  "citation": "Brown v Board of Education (1954) 347 US 483",
  "format": "oscola"
}
```

## 6. Legal Document Structure Blocks

### 6.1 Court Caption

```json
{
  "type": "legal:caption",
  "court": "Supreme Court of the United States",
  "caseNumber": "No. 1",
  "parties": {
    "plaintiff": "Oliver Brown, et al.",
    "defendant": "Board of Education of Topeka, et al."
  },
  "docket": "October Term, 1953"
}
```

### 6.2 Signature Block

Legal documents often require specific signature block formats:

```json
{
  "type": "legal:signatureBlock",
  "role": "counsel",
  "signer": {
    "name": "Thurgood Marshall",
    "title": "Counsel for Appellants",
    "barNumber": "12345",
    "firm": "NAACP Legal Defense Fund",
    "address": "10 Columbus Circle, New York, NY 10019",
    "telephone": "(212) 555-1234"
  }
}
```

## 7. Examples

### 7.1 Legal Brief with Table of Authorities

```json
{
  "version": "0.1",
  "blocks": [
    {
      "type": "legal:tableOfAuthorities",
      "id": "toa",
      "title": "Table of Authorities",
      "categories": [
        { "name": "Cases", "key": "cases" },
        { "name": "Statutes", "key": "statutes" }
      ]
    },
    {
      "type": "heading",
      "level": 1,
      "children": [{ "type": "text", "value": "Argument" }]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "In " },
        {
          "type": "text",
          "value": "Brown v. Board of Education",
          "marks": [
            {
              "type": "legal:cite",
              "citation": "347 U.S. 483 (1954)",
              "category": "cases",
              "shortForm": "Brown"
            }
          ]
        },
        { "type": "text", "value": ", the Supreme Court held that 'separate but equal' has no place in public education. " }
      ]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "This principle was reaffirmed in " },
        {
          "type": "text",
          "value": "Brown",
          "marks": [
            {
              "type": "legal:cite",
              "citation": "347 U.S. 483 (1954)",
              "category": "cases",
              "shortForm": "Brown",
              "pinpoint": "at 495"
            }
          ]
        },
        { "type": "text", "value": ", where the Court explained the psychological impact of segregation." }
      ]
    }
  ]
}
```

### 7.2 Statute Citation

```json
{
  "type": "text",
  "value": "42 U.S.C. § 1983",
  "marks": [
    {
      "type": "legal:cite",
      "citation": "42 U.S.C. § 1983",
      "category": "statutes"
    }
  ]
}
```

## 8. Rendering Guidelines

### 8.1 Table of Authorities

Renderers generating a Table of Authorities SHOULD:

1. Collect all `legal:cite` marks in document order
2. Group citations by category
3. Sort entries alphabetically within each category
4. Consolidate multiple references to the same authority
5. List page numbers where each authority is cited
6. Use "passim" when references exceed the threshold

### 8.2 Short Form References

After the first full citation, subsequent references MAY use the short form:

- First reference: "Brown v. Board of Education, 347 U.S. 483 (1954)"
- Subsequent: "Brown, 347 U.S. at 495"

### 8.3 Id. Citations

For consecutive citations to the same source, renderers MAY substitute "Id." according to citation style rules.

## 9. Compatibility

The Legal Extension is compatible with:

- **Semantic Extension**: Legal citations can include semantic entity markup
- **Presentation Extension**: Table of Authorities uses presentation layer styling
- **Academic Extension**: Legal documents may use academic numbering for sections

## 10. Future Considerations

Potential future additions:

- Court filing metadata
- E-filing format compliance (CM/ECF)
- Citation verification services
- International legal citation formats
