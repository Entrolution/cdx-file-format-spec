# Metadata

**Section**: Core Specification
**Version**: 0.1

## 1. Overview

Metadata provides descriptive information about a document: its title, author, subject, dates, and other properties. CDX uses Dublin Core as the foundation, with support for extensions.

## 2. Metadata Layers

### 2.1 Layer Structure

```
┌─────────────────────────────────────────┐
│          Application Metadata           │  (App-specific, ephemeral)
├─────────────────────────────────────────┤
│          Extended Metadata              │  (Domain-specific)
├─────────────────────────────────────────┤
│          Dublin Core Metadata           │  (Required, standard)
└─────────────────────────────────────────┘
```

### 2.2 Dublin Core (Required)

Standard descriptive metadata following DCMI terms.

Location: `metadata/dublin-core.json`

### 2.3 Extended Metadata (Optional)

Domain or application-specific metadata.

Location: `metadata/extended.json` (or custom paths)

## 3. Dublin Core Metadata

### 3.1 File Format

The `version` field in Dublin Core metadata refers to the Dublin Core Metadata Element Set standard version (currently 1.1), not the CDX specification version. The CDX specification version is declared in the manifest's `cdx` field.

```json
{
  "version": "1.1",
  "terms": {
    "title": "Annual Report 2025",
    "creator": ["Jane Doe", "John Smith"],
    "subject": ["Finance", "Annual Report"],
    "description": "Comprehensive annual financial report",
    "publisher": "Acme Corporation",
    "contributor": ["Finance Team", "Legal Team"],
    "date": "2025-01-15",
    "type": "Text",
    "format": "application/vnd.cdx+json",
    "identifier": "sha256:3a7bd3e2...",
    "source": null,
    "language": "en",
    "relation": null,
    "coverage": "2024 fiscal year",
    "rights": "Copyright 2025 Acme Corporation. All rights reserved."
  }
}
```

### 3.2 Dublin Core Terms

| Term | Type | Description | Required |
|------|------|-------------|----------|
| `title` | string | Document title | Yes |
| `creator` | string\|array | Author(s) | Yes |
| `subject` | string\|array | Topic/keywords | No |
| `description` | string | Summary/abstract | No |
| `publisher` | string | Publishing entity | No |
| `contributor` | string\|array | Other contributors | No |
| `date` | string | Publication date (ISO 8601) | No |
| `type` | string | Nature of content | No |
| `format` | string | MIME type | No |
| `identifier` | string | Unique identifier | No |
| `source` | string | Source reference | No |
| `language` | string | Language code (BCP 47) | No |
| `relation` | string | Related resource | No |
| `coverage` | string | Scope (temporal/spatial) | No |
| `rights` | string | Rights statement | No |

### 3.3 Term Details

#### 3.3.1 title (Required)

The name of the document.

```json
{
  "title": "Quarterly Financial Report Q4 2024"
}
```

- MUST be a non-empty string
- SHOULD be human-readable and descriptive

#### 3.3.2 creator (Required)

The primary author(s) responsible for the content.

```json
{
  "creator": "Jane Doe"
}
```

Or multiple:

```json
{
  "creator": ["Jane Doe", "John Smith"]
}
```

- MUST have at least one value
- Order indicates primacy

#### 3.3.3 subject

Topics, keywords, or classification.

```json
{
  "subject": ["Finance", "Q4 2024", "Annual Report"]
}
```

- MAY be a single string or array
- Used for search and categorization

#### 3.3.4 description

An abstract or summary.

```json
{
  "description": "This report summarizes the financial performance of Acme Corporation for the fourth quarter of 2024, including revenue, expenses, and outlook for 2025."
}
```

- SHOULD be 1-3 sentences
- Used for preview/indexing

#### 3.3.5 date

Publication or creation date in ISO 8601 format.

```json
{
  "date": "2025-01-15"
}
```

Or with time:

```json
{
  "date": "2025-01-15T14:30:00Z"
}
```

#### 3.3.6 type

The nature or genre of content. DCMI Type values:

| Value | Description |
|-------|-------------|
| `Collection` | Aggregation of resources |
| `Dataset` | Data in structured format |
| `Event` | Non-persistent occurrence |
| `Image` | Visual representation |
| `InteractiveResource` | User interaction required |
| `MovingImage` | Video |
| `PhysicalObject` | Physical item |
| `Service` | System providing functions |
| `Software` | Computer program |
| `Sound` | Audio |
| `StillImage` | Static visual |
| `Text` | Written content |

```json
{
  "type": "Text"
}
```

#### 3.3.7 language

Language code following BCP 47.

```json
{
  "language": "en-US"
}
```

Common codes:
- `en` - English
- `en-US` - American English
- `en-GB` - British English
- `es` - Spanish
- `fr` - French
- `de` - German
- `zh` - Chinese
- `ja` - Japanese
- `ar` - Arabic

For multilingual documents, use array:

```json
{
  "language": ["en", "es"]
}
```

#### 3.3.8 rights

Copyright or licensing statement.

```json
{
  "rights": "Copyright 2025 Acme Corp. Licensed under CC BY 4.0."
}
```

Or structured:

```json
{
  "rights": {
    "statement": "Copyright 2025 Acme Corporation",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/"
  }
}
```

## 4. Extended Metadata

### 4.1 Purpose

Extended metadata supports domain-specific needs not covered by Dublin Core.

### 4.2 Registration in Manifest

```json
{
  "metadata": {
    "dublinCore": "metadata/dublin-core.json",
    "extended": "metadata/extended.json",
    "custom": {
      "legal": "metadata/legal.json"
    }
  }
}
```

### 4.3 Extended Metadata Structure

```json
{
  "version": "0.1",
  "namespace": "https://example.com/metadata/legal",
  "terms": {
    "caseNumber": "2025-CV-12345",
    "court": "Superior Court of California",
    "filingDate": "2025-01-20"
  }
}
```

### 4.4 Common Extensions

#### 4.4.1 Academic/Research

```json
{
  "namespace": "https://cdx.dev/metadata/academic",
  "terms": {
    "doi": "10.1234/example.2025.001",
    "journal": "Journal of Document Engineering",
    "volume": "15",
    "issue": "3",
    "pages": "45-67",
    "peerReviewed": true,
    "keywords": ["document formats", "semantic documents"]
  }
}
```

#### 4.4.2 Legal

```json
{
  "namespace": "https://cdx.dev/metadata/legal",
  "terms": {
    "caseNumber": "2025-CV-12345",
    "jurisdiction": "California",
    "documentType": "Motion",
    "filingDate": "2025-01-20",
    "parties": ["Plaintiff Corp", "Defendant Inc"]
  }
}
```

#### 4.4.3 Business

```json
{
  "namespace": "https://cdx.dev/metadata/business",
  "terms": {
    "department": "Finance",
    "confidentiality": "Internal",
    "retentionPeriod": "7 years",
    "approvedBy": "Jane Smith",
    "approvalDate": "2025-01-15"
  }
}
```

## 5. Semantic Metadata (JSON-LD)

### 5.1 Purpose

For rich semantic interoperability, documents can include JSON-LD metadata that links to external vocabularies and knowledge graphs.

### 5.2 Location

`metadata/jsonld.json`

### 5.3 Structure

```json
{
  "@context": {
    "@vocab": "https://schema.org/",
    "dcterms": "http://purl.org/dc/terms/"
  },
  "@type": "Report",
  "name": "Annual Report 2025",
  "author": {
    "@type": "Person",
    "name": "Jane Doe",
    "affiliation": {
      "@type": "Organization",
      "name": "Acme Corporation"
    }
  },
  "datePublished": "2025-01-15",
  "about": {
    "@type": "Organization",
    "name": "Acme Corporation",
    "identifier": "NYSE:ACME"
  }
}
```

### 5.4 Common Vocabularies

| Vocabulary | Prefix | Use |
|------------|--------|-----|
| Schema.org | (default) | General metadata |
| Dublin Core Terms | `dcterms` | Document metadata |
| FOAF | `foaf` | People and relationships |
| SKOS | `skos` | Classification/taxonomy |
| PRISM | `prism` | Publishing metadata |

## 6. Metadata in Document Hash

### 6.1 Included in Hash

The document hash includes a projection of exactly these Dublin Core terms, extracted from `terms` and flattened (see Document Hashing, section 4.3):

- `title` (string)
- `creator` (array; a scalar is coerced to a one-element array)
- `subject` (array)
- `description` (string)
- `language` (array)

A term that is absent or wholly empty (`""`/`[]`) is omitted from the projection. The structured `creators` array (each entry an object with `name`, `orcid`, `affiliation`, and `email`) is not included.

### 6.2 Excluded from Hash

These terms are NOT part of the hashed metadata projection (they are administrative):

- `date` (changes frequently)
- `publisher`
- `identifier` (avoids the circular dependency of naming a hash-derived id inside the hashed input)
- `rights` (may be updated)

**Security — these fields are unauthenticated.** They sit outside the document-hash
projection, and the Dublin Core file itself is referenced by path only (the manifest
carries no hash for it — Security Extension, section 9.8). So on a `frozen` or
`published` document an excluded field can be rewritten without changing the document
ID or breaking any signature: `rights` flipped to defeat a licensing gate, `publisher`
set to impersonate a source, `identifier` swapped to redirect a DOI or citation, `date`
backdated. A verifier or consumer MUST NOT treat `date`, `publisher`, `identifier`, or
`rights` as authenticated on the strength of a valid signature — this is the metadata
case of a signature's negative coverage (Security Extension, section 9.8).

### 6.3 Rationale

Including the projected semantic terms (section 6.1) in the hash ensures that:

- Document identity reflects what it's about
- Title changes create new document versions
- The projected `creator` attribution is cryptographically bound — but only that
  projection; the administrative fields in section 6.2 are not (see the caveat there)

## 7. Metadata Validation

### 7.1 Required Validation

1. Dublin Core file exists at declared path
2. Required terms (`title`, `creator`) present
3. Date values are valid ISO 8601
4. Language codes are valid BCP 47

### 7.2 Schema Validation

JSON Schema for Dublin Core:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["version", "terms"],
  "properties": {
    "version": { "type": "string" },
    "terms": {
      "type": "object",
      "required": ["title", "creator"],
      "properties": {
        "title": { "type": "string", "minLength": 1 },
        "creator": {
          "oneOf": [
            { "type": "string" },
            { "type": "array", "items": { "type": "string" }, "minItems": 1 }
          ]
        }
      }
    }
  }
}
```

## 8. Metadata Access

### 8.1 Reading Metadata

Applications SHOULD provide easy access to metadata:

```
document.metadata.title       // "Annual Report 2025"
document.metadata.creator     // ["Jane Doe"]
document.metadata.language    // "en"
```

### 8.2 Searching by Metadata

Implementations SHOULD support metadata-based search:

- By title (substring, fuzzy)
- By creator (exact, fuzzy)
- By subject (tag matching)
- By date (range queries)

## 9. Examples

### 9.1 Minimal Dublin Core

```json
{
  "version": "1.1",
  "terms": {
    "title": "Meeting Notes",
    "creator": "Team Lead"
  }
}
```

### 9.2 Complete Dublin Core

```json
{
  "version": "1.1",
  "terms": {
    "title": "Climate Change Impact Assessment 2025",
    "creator": ["Dr. Jane Smith", "Dr. John Doe"],
    "subject": ["Climate Change", "Environmental Science", "Policy Analysis"],
    "description": "A comprehensive assessment of climate change impacts on coastal regions, with policy recommendations for adaptation strategies.",
    "publisher": "Environmental Research Institute",
    "contributor": ["Research Team", "Policy Advisory Board"],
    "date": "2025-01-15",
    "type": "Text",
    "format": "application/vnd.cdx+json",
    "identifier": "sha256:abc123...",
    "source": "https://doi.org/10.1234/previous-study",
    "language": "en",
    "relation": "https://example.org/related-report",
    "coverage": "2020-2024, Global Coastal Regions",
    "rights": "Creative Commons Attribution 4.0 International (CC BY 4.0)"
  }
}
```

### 9.3 With Extended Metadata

Dublin Core (`metadata/dublin-core.json`):

```json
{
  "version": "1.1",
  "terms": {
    "title": "Contract Agreement",
    "creator": "Legal Department"
  }
}
```

Extended (`metadata/legal.json`):

```json
{
  "version": "0.1",
  "namespace": "https://cdx.dev/metadata/legal",
  "terms": {
    "contractType": "Service Agreement",
    "parties": ["Acme Corp", "XYZ Services"],
    "effectiveDate": "2025-02-01",
    "expirationDate": "2026-01-31",
    "governingLaw": "State of Delaware",
    "confidential": true
  }
}
```

Manifest reference:

```json
{
  "metadata": {
    "dublinCore": "metadata/dublin-core.json",
    "custom": {
      "legal": "metadata/legal.json"
    }
  }
}
```
