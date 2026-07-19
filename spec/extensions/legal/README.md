# Legal Extension

**Extension ID**: `cdx.legal`
**Version**: 0.1
**Status**: Draft
**Maturity**: Draft

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

A document-level default citation style MAY be set in the manifest's `legal` configuration object as `citationStyle` (e.g. `bluebook`); individual citations MAY override it. Where the `legal` configuration carries operative values — a `jurisdiction` or governing-law selection — the document SHOULD declare the extension `required: true`, so that configuration is bound by the manifest projection (see section 9).

The legal structure blocks (`legal:caption`, `legal:signatureBlock`, `legal:tableOfAuthorities`) carry no fallback rendering, so a reader that does not support the extension IGNOREs them as unknown namespaced blocks (Content Blocks specification, section 5; State Machine specification, section 5.4) — silently dropping the court caption, signatories, or table of authorities. A document whose legal meaning depends on these blocks (a filing, a brief, an executed agreement) MUST therefore declare `cdx.legal` `required: true`, so a non-supporting reader fails closed rather than presenting a document with its operative legal structure removed. The `required: false` form above is for documents that merely *cite* legal authorities and degrade acceptably without the extension.

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
      "category": "cases",
      "form": "reporter",
      "parties": "Brown v. Board of Education",
      "volume": "347",
      "reporter": "U.S.",
      "page": "483",
      "year": "1954",
      "shortForm": "Brown"
    }
  ]
}
```

### 3.2 Citation Mark Properties

A `legal:cite` carries structured citation fields rather than a free-text string, so a reader can render the citation, sort and consolidate a Table of Authorities, and detect the same authority deterministically. The structure is selected by `form`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"legal:cite"` |
| `category` | string | Yes | Citation category for TOA grouping |
| `form` | string | Yes | Citation structure: `reporter` (cases), `code` (statutes, regulations), or `other` |
| `parties` | string | No | Case name (reporter form), e.g. "Celotex Corp. v. Catrett" |
| `volume` | string | reporter | Volume number (reporter form) |
| `reporter` | string | reporter | Reporter abbreviation (reporter form), e.g. "U.S.", "F.3d" |
| `page` | string | reporter | First page (reporter form) |
| `court` | string | No | Court (reporter form), e.g. "9th Cir." |
| `year` | string | No | Year (reporter form) |
| `title` | string | code | Title number (code form), e.g. "42" |
| `code` | string | code | Code abbreviation (code form), e.g. "U.S.C.", "C.F.R." |
| `section` | string | code | Section (code form), e.g. "2000e" |
| `suffix` | string | No | Trailing text (code form), e.g. "et seq." |
| `text` | string | other | Verbatim citation text (other form) |
| `pinpoint` | string | No | Pinpoint locator within the source (a page or section), e.g. "323" |
| `shortForm` | string | No | Short form for subsequent references |
| `format` | string | No | Advisory citation-style hint (see section 5) |

The required fields depend on `form`: a `reporter` citation requires `volume`, `reporter`, and `page`; a `code` citation requires `title`, `code`, and `section`; an `other` citation requires `text` (a verbatim string the reader renders as-is, for an authority that is neither a reporter citation nor a code citation). The reader renders the displayed citation from these fields by the canonical algorithm in section 5.

### 3.3 Citation Categories

`citationCategory` accepts any string as an open vocabulary. The following categories are RECOMMENDED for Table of Authorities grouping; implementations MAY use additional categories for jurisdictions or authority types not covered here:

| Category | Description |
|----------|-------------|
| `cases` | Court cases and judicial decisions |
| `statutes` | Statutory law |
| `regulations` | Administrative regulations |
| `constitutions` | Constitutional provisions |
| `treatises` | Legal treatises and books |
| `law-reviews` | Law review articles |
| `other` | Other secondary sources |

An unrecognized category is preserved and grouped under its own heading, not rejected.

### 3.4 Pinpoint Citations

A `pinpoint` is the locator (a page or section) of the specific passage cited, stored as the bare locator value (e.g. `"495"`, not `"at 495"`); the canonical rendering supplies the surrounding punctuation (section 5):

```json
{
  "type": "text",
  "value": "Brown",
  "marks": [
    {
      "type": "legal:cite",
      "category": "cases",
      "form": "reporter",
      "parties": "Brown v. Board of Education",
      "volume": "347",
      "reporter": "U.S.",
      "page": "483",
      "year": "1954",
      "pinpoint": "495",
      "shortForm": "Brown"
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

## 5. Citation Rendering

Every conforming reader MUST derive a `legal:cite`'s displayed citation deterministically from its structured fields (section 3.2) by the canonical rendering below, so that inline citations and the Table of Authorities are byte-identical across readers. The `format` field and the manifest-level `citationStyle` default are advisory hints a richer renderer MAY use to produce a different house style (section 5.2); the canonical rendering is the reproducible baseline.

> **Reader dispositions.** The cross-element relationships in this extension are resolved at render time, so their failures are rendering-degradation WARNINGs in all states, never integrity failures (State Machine section 5.4): a `legal:cite` whose `category` matches no Table of Authorities category, a Table of Authorities category with no citing `legal:cite`, and a `format` (or a default `citationStyle`) naming an unimplemented style all degrade gracefully — the reader renders the canonical form and SHOULD surface the unresolved relationship, and MUST NOT invent a category or fail the document.

### 5.1 Canonical Rendering

The canonical citation string is assembled from the structured fields by `form`. Each component is separated by a single ASCII space; an absent optional component and its separator are omitted, leaving no doubled or trailing space.

**`reporter`.** In order: the case name `{parties}` followed by `", "` (if present); `{volume}` space `{reporter}` space `{page}`; `", "` `{pinpoint}` (if present); then a parenthetical ` (` … `)` whose interior is `{court}` and `{year}` joined by a single space (each omitted if absent). The parenthetical is emitted **only** when at least one of `court`/`year` is present — never an empty `()` and never a trailing space before `)`.

- `{volume:"477", reporter:"U.S.", page:"317", year:"1986"}` → `477 U.S. 317 (1986)`
- `{parties:"Celotex Corp. v. Catrett", volume:"477", reporter:"U.S.", page:"317", pinpoint:"323", year:"1986"}` → `Celotex Corp. v. Catrett, 477 U.S. 317, 323 (1986)`
- `{volume:"225", reporter:"F.3d", page:"1115", pinpoint:"1123", court:"9th Cir.", year:"2000"}` → `225 F.3d 1115, 1123 (9th Cir. 2000)`

**`code`.** `{title}` space `{code}` space `§` space `{section}`, then a space and `{suffix}` (if present), then `", "` and `{pinpoint}` (if present). `§` is U+00A7 (SECTION SIGN).

- `{title:"42", code:"U.S.C.", section:"2000e", suffix:"et seq."}` → `42 U.S.C. § 2000e et seq.`
- `{title:"29", code:"C.F.R.", section:"1602.14"}` → `29 C.F.R. § 1602.14`
- `{title:"42", code:"U.S.C.", section:"2000e", pinpoint:"2000e-2"}` → `42 U.S.C. § 2000e, 2000e-2`

**`other`.** The `text` field, rendered verbatim, then `", "` and `{pinpoint}` (if present).

A `pinpoint` is rendered after the authority's canonical string with a `", "` separator in every form (reporter `317, 323`; code `§ 2000e, 2000e-2`); the short form (section 8.2) renders it as `at {pinpoint}`.

### 5.2 Citation Styles (advisory)

The per-citation `format` field and the manifest-level `citationStyle` default (`manifest.legal.citationStyle`, section 2) name a house style a richer renderer MAY apply instead of the canonical rendering. They are advisory: the canonical rendering of section 5.1 is the reproducible baseline, and a reader that does not implement a named style renders the canonical form. Commonly named styles include `bluebook` (The Bluebook: A Uniform System of Citation), `alwd` (ALWD Guide to Legal Citation), `mcgill` (the Canadian McGill Guide), and `oscola` (the Oxford OSCOLA standard); `format`/`citationStyle` are an open vocabulary, so any style name is accepted.

The manifest `legal` configuration MAY also carry a `jurisdiction` string (for example, a court system or governing-law selector such as `us-federal` or `uk`). It is advisory metadata that a renderer MAY use to pick jurisdiction-appropriate citation defaults; like `citationStyle` it does not change the canonical rendering of section 5.1, and it is unauthenticated unless the extension is declared `required: true` (section 9).

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

The `parties` object supports the role keys `plaintiff`, `defendant`, `appellant`, `appellee`, `petitioner`, and `respondent`; the caption MAY also name the assigned `judge`. Each value is either a plain string (the party name) or a `party` object. A `party` object MAY carry a free-string `role` for a role the keys above do not cover (for example, `intervenor` or `amicus`); those keys are RECOMMENDED, and where a party is reached through a role key, that key is authoritative for the party's role and a `party.role` is supplementary. These caption fields are author-asserted content, not authenticated case identity (see section 9).

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

The signature block `role` is one of `counsel`, `attorney`, `party`, `witness`, or `notary`; the signer object MAY also include a `fax` number. A `legal:signatureBlock` records a signatory for display; it is content, not a cryptographic signature, and attests nothing about execution or notarization (see section 9).

> **Renderer safety.** Signer fields (name, title, bar number, firm, address, telephone, fax, and email — the `email` is an unverified display string, not an asserting `mailto:` target) and party, judge, and notary names are author-asserted text. A renderer MUST render them as inert, escaped text and MUST NOT auto-linkify or otherwise promote them to a navigation target except through the safe-URI allowlist (Renderer Safety section 3.4).

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
              "category": "cases",
              "form": "reporter",
              "parties": "Brown v. Board of Education",
              "volume": "347",
              "reporter": "U.S.",
              "page": "483",
              "year": "1954",
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
              "category": "cases",
              "form": "reporter",
              "parties": "Brown v. Board of Education",
              "volume": "347",
              "reporter": "U.S.",
              "page": "483",
              "year": "1954",
              "pinpoint": "495",
              "shortForm": "Brown"
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
      "category": "statutes",
      "form": "code",
      "title": "42",
      "code": "U.S.C.",
      "section": "1983"
    }
  ]
}
```

## 8. Rendering Guidelines

### 8.1 Table of Authorities

A reader generates a Table of Authorities deterministically from the structured `legal:cite` fields:

1. Collect all `legal:cite` marks in document order.
2. Group them by `category`, matched to the Table of Authorities `categories[].key`; a citation whose `category` matches no configured category forms its own group (see the Reader dispositions note in section 5).
3. Compute each citation's **authority identity** as its canonical rendering (section 5.1) without the `pinpoint`, so two references to one authority that differ only in pinpoint share an identity (e.g. `Celotex Corp. v. Catrett, 477 U.S. 317 (1986)`).
4. Consolidate citations sharing an authority identity into a single entry.
5. Sort entries within each category by the case name `parties` when present, otherwise by the authority identity, comparing by Unicode code unit. This yields a stable, reader-independent order.
6. When `pageReferences` is true, list the page(s) where each authority is cited; when an authority's reference count reaches `passimThreshold`, render "passim" in place of the page list.

### 8.2 Short Form References

The first reference to an authority renders its full canonical citation (section 5.1). A subsequent reference MAY render the short form: `{shortForm}`, followed for a reporter-form authority by `, {volume} {reporter} at {pinpoint}` when a pinpoint is given (e.g. "Celotex, 477 U.S. at 323"). When `shortForm` is absent, the full canonical citation is used.

### 8.3 Id. Citations

A reference immediately consecutive to another reference to the same authority (same authority identity, section 8.1) MAY be rendered as "Id.", followed by "at {pinpoint}" when its pinpoint differs from the prior reference. Because authority identity is computed from the structured fields, "same authority" is deterministic.

## 9. Integrity Status

Legal constructs span two integrity tiers (see the extensions overview, Integrity Status of Extension Data).

**Captions and signature blocks are advisory identity.** A `legal:caption` (court, case number, parties, judge) and a `legal:signatureBlock` (signer, bar number, firm, role — including `notary` — and date) are ordinary content blocks: their bytes are in the document hash, but a signature attests those bytes, not that the named judge presided, the named parties are real, or the named signatory or notary executed anything. A `legal:signatureBlock` is a typeset signature line, not a cryptographic signature. To bind a real execution, notarization, or approval to the document, use a security-extension signature (security extension, Identity Authority), optionally bound through a required-signer policy (security extension, Signature Set Integrity).

**Jurisdiction and citation style are unauthenticated unless the extension is required.** The `legal` configuration in the manifest (`citationStyle`, `jurisdiction`) is outside the document hash, and the manifest projection binds an extension's configuration only when that extension is declared `required: true` (security extension, Manifest Projection). When the legal extension is declared `required: false`, `manifest.legal` is in neither integrity domain: its `jurisdiction` — a legally operative selection — and its default `citationStyle` can be changed on a signed document without breaking a signature, and because a format-less `legal:cite` renders in the default style, editing that default silently restyles every such citation.

A legal document whose `legal` configuration carries operative values SHOULD declare the extension `required: true`, so the configuration enters the manifest projection and is bound by every manifest-covering signature; alternatively, carry the operative value in signed content. The shipped legal example declares `required: true` for this reason.

## 10. Compatibility

The Legal Extension is compatible with:

- **Semantic Extension**: Legal citations can include semantic entity markup. The `legal:cite` mark and the semantic `citation` mark are distinct and feed disjoint outputs — a Table of Authorities collects only `legal:cite` marks (section 8), and a bibliography collects only semantic `citation` marks. An authority cited through both systems appears in both outputs, so a document SHOULD cite a given authority through a single system to avoid duplication.
- **Presentation Extension**: Table of Authorities uses presentation layer styling
- **Academic Extension**: Legal documents may use academic numbering for sections

## 11. Future Considerations

Potential future additions:

- Court filing metadata
- E-filing format compliance (CM/ECF)
- Citation verification services
- International legal citation formats
