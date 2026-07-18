# CDX Format Use Cases

This document describes concrete scenarios where the CDX format provides value over existing solutions.

## 1. Legal Contracts and Agreements

### Scenario
A law firm drafts contracts that require signatures from multiple parties, must be archived for decades, and need to be searchable for due diligence.

### Current Pain Points
- PDF signatures are complex and often break on viewer updates
- Signed PDFs can't be easily searched or analyzed
- No clear "frozen" state — uncertainty about what was actually signed
- Format conversion loses fidelity

### CDX Solution
```
1. Draft contract in CDX editor (state: draft)
2. Submit for review (state: review) — all parties can comment
3. Final version frozen with signatures (state: frozen)
   - Document ID cryptographically binds content to signatures
   - Any modification attempt detected immediately
4. Archive for long-term storage
   - Semantic structure preserved
   - Full-text search works perfectly
   - AI can extract clauses and obligations
```

### Key Benefits
- **Clear freeze semantics**: Signature = content locked
- **Machine readable**: AI can analyze contract terms
- **Long-term validity**: Algorithm-agile signatures can be migrated

---

## 2. Academic Publishing

### Scenario
A researcher publishes a paper with figures, citations, and supplementary data. The paper must be citeable, preservable, and machine-readable for literature analysis.

### Current Pain Points
- PDF figures are not accessible
- Citations are just text, not linked data
- Supplementary materials require separate downloads
- Text extraction for meta-analysis is unreliable

### CDX Solution
```
Paper structure:
├── Semantic content with structured headings
├── Figures as embedded assets with alt text
├── Citations linked to bibliography entries (JSON-LD)
├── Supplementary data as embedded files
├── Author ORCID identifiers in metadata
└── DOI minted after freeze
```

### Key Benefits
- **Semantic citations**: Bibliography as structured data, not just text
- **Accessible figures**: Alt text and full resolution available
- **Machine analysis**: Literature review AI can reliably extract claims
- **Self-contained**: No broken links to supplementary materials

---

## 3. Corporate Reports

### Scenario
A company produces quarterly financial reports that must be:
- Professionally typeset for print
- Accessible on web and mobile
- Machine-readable for financial analysis
- Archived for regulatory compliance

### Current Pain Points
- Separate PDF and web versions maintained
- Data extraction for analysis requires manual work
- Accessibility often an afterthought
- Updates require republishing entire document

### CDX Solution
```
Single source document with:
├── Content layer: semantic financial data
├── Presentation layers:
│   ├── paginated.json (print-ready, A4)
│   ├── continuous.json (web reading)
│   └── responsive.json (mobile)
├── Assets: charts as SVG, photos as AVIF
└── Metadata: JSON-LD with financial data schema
```

### Key Benefits
- **Single source**: One document, multiple presentations
- **Data extraction**: Financial figures are structured, not images
- **Accessibility**: Built-in from semantic structure
- **Efficient updates**: Change content, regenerate presentations

---

## 4. Government Documents

### Scenario
A government agency publishes regulations, forms, and public records that must be accessible, archivable, and legally authoritative.

### Current Pain Points
- PDF forms are difficult to fill on mobile
- Accessibility compliance is expensive
- Long-term preservation uncertain
- Citizen data extraction for research is blocked

### CDX Solution
```
Public regulation document:
├── Content: semantic legal text with section references
├── Forms extension: fillable fields with validation
├── Security: agency signature with timestamp
├── Metadata: Dublin Core + government-specific schema
└── Accessibility: WCAG AAA from semantic structure
```

### Key Benefits
- **Mobile forms**: Native form fields work on any device
- **Built-in accessibility**: Semantic structure = accessible by default
- **Preservation**: Content-addressable hash for permanent citation
- **Open data**: Structure enables citizen analysis

---

## 5. Technical Documentation

### Scenario
A software company maintains documentation that includes code samples, diagrams, and API references. Documentation must stay synchronized with the product.

### Current Pain Points
- Markdown lacks rich formatting
- PDF loses interactivity
- Code samples go stale
- Cross-references break on restructuring

### CDX Solution
```
Documentation structure:
├── Content: semantic docs with code blocks
├── Assets:
│   ├── Diagrams as SVG (editable)
│   └── Screenshots as AVIF (compressed)
├── Semantic extension:
│   ├── API references linked to OpenAPI spec
│   └── Code samples with language tags
└── Version control friendly: JSON diffs work
```

### Key Benefits
- **Rich but version-controlled**: JSON diffs in git
- **Code highlighting**: Language-tagged code blocks
- **Living diagrams**: SVG diagrams can be regenerated
- **Cross-reference stability**: Block IDs survive restructuring

---

## 6. Healthcare Records

### Scenario
A hospital generates patient records that must be:
- Signed by attending physician
- Shared with other providers
- Preserved for legal requirements
- Patient-accessible

### Current Pain Points
- HL7/FHIR for data, PDF for documents — two systems
- Signatures tied to proprietary systems
- Patient portals show images of documents
- Long-term format stability uncertain

### CDX Solution
```
Medical record:
├── Content: clinical notes as semantic blocks
├── Security:
│   ├── Physician signature (ES256)
│   ├── Timestamp from trusted authority
│   └── Encryption for PHI
├── Semantic extension:
│   ├── FHIR resources as JSON-LD
│   └── ICD-10 codes linked
└── Access control: role-based permissions
```

### Key Benefits
- **Unified format**: Clinical data + document in one
- **Interoperability**: FHIR compatibility via JSON-LD
- **Patient access**: Same document, no conversion
- **Compliance**: Signatures meet regulatory requirements

---

## 7. Educational Materials

### Scenario
A university creates course materials including syllabi, lecture notes, and assignments. Materials need to be accessible, printable, and updatable.

### Current Pain Points
- Faculty use mix of Word, PDF, HTML
- Accessibility varies wildly
- No version tracking for materials
- Students print some, view others digitally

### CDX Solution
```
Course syllabus:
├── Content:
│   ├── Course info, schedule, policies
│   └── Assignment descriptions
├── Presentation:
│   ├── Print-friendly (paginated)
│   └── Screen-optimized (continuous)
├── Metadata: course codes, learning outcomes
└── Lineage: tracks semester-to-semester changes
```

### Key Benefits
- **Consistent accessibility**: All materials meet standards
- **Print and screen**: Same source, optimal presentation
- **Version tracking**: Changes documented semester to semester
- **Learning outcome mapping**: Semantic tags enable curriculum analysis

---

## 8. Journalism and Publishing

### Scenario
A news organization publishes investigative reports with primary sources, must protect source documents, and needs long-term citation stability.

### Current Pain Points
- Source documents often just linked (link rot)
- Redaction in PDF is error-prone
- No way to cryptographically prove document unchanged
- Archive.org not reliable for sensitive materials

### CDX Solution
```
Investigative report:
├── Content: article with citations to sources
├── Embedded sources:
│   ├── Redacted documents (original encrypted)
│   └── Images with metadata stripped
├── Security:
│   ├── Reporter signature
│   ├── Editor signature
│   └── Publication timestamp
└── Hash: permanent citation anchor
```

### Key Benefits
- **Self-contained**: Sources embedded, not linked
- **Cryptographic proof**: Document unchanged since publication
- **Controlled redaction**: Original preserved but encrypted
- **Permanent citation**: Hash-based citation never breaks

> **Caveat — an encrypted original is not redaction.** Embedding the full unredacted original (encrypted) keeps the sensitive source travelling inside the public artifact, so the redaction holds only as long as key custody and the cipher hold: a leaked or later-compromised key, a weakened cipher, or future cryptanalysis fully un-redacts a document that has already been distributed. This is the same failure mode as a PDF whose "redacted" text is merely covered — the data is still there. When the goal is to protect a source, prefer the format's selective-disclosure model (README, *Selective disclosure*; DD-013), which **removes** the sensitive data and provides a cryptographic proof of what was removed rather than shipping it under encryption. Reserve the encrypted-original pattern for cases where the original genuinely must remain retrievable by key holders and that retention is an accepted, documented risk.

---

## 9. Real Estate Transactions

### Scenario
A real estate closing involves dozens of documents requiring signatures from multiple parties, with strict regulatory requirements.

### Current Pain Points
- Paper documents scanned to PDF
- e-signature platforms proprietary
- Document packages unwieldy
- Long-term validity of e-signatures uncertain

### CDX Solution
```
Closing package:
├── Manifest: list of all documents
├── Documents (each a CDX):
│   ├── Purchase agreement
│   ├── Deed
│   ├── Title insurance
│   └── ...
├── Security:
│   ├── All parties' signatures
│   ├── Notary signature + seal
│   └── Recording timestamp
└── Lineage: links to prior deed
```

### Key Benefits
- **Open signatures**: Not locked to vendor
- **Package integrity**: All documents linked
- **Regulatory compliance**: Signatures meet recording requirements
- **Chain of title**: Lineage creates deed history

---

## 10. Personal Documents

### Scenario
An individual wants to create, sign, and preserve personal documents (wills, directives, family history) with confidence they'll remain readable.

### Current Pain Points
- Word files require specific software
- PDF readers change over time
- No easy way to self-sign
- Cloud storage may not exist in 50 years

### CDX Solution
```
Personal document:
├── Content: the document itself
├── Security:
│   ├── Personal signature (hardware key or mobile)
│   └── Optional witness signatures
├── Presentation: print-ready layout
└── Self-contained: all assets embedded
```

### Key Benefits
- **Self-signing**: Hardware security key or mobile authenticator
- **Long-term readable**: Open format, simple structure
- **Local storage**: No cloud dependency
- **Family sharing**: Can grant access to specific people

---

## Summary: Format Selection Guide

| Use Case | Key CDX Advantage |
|----------|---------------------|
| Legal | Clear freeze semantics, modern signatures |
| Academic | Semantic citations, machine analysis |
| Corporate | Single source, multiple presentations |
| Government | Accessibility, fillable forms |
| Technical | Version control friendly |
| Healthcare | FHIR integration, encryption |
| Education | Consistent accessibility |
| Journalism | Source embedding, proof of integrity |
| Real Estate | Open signatures, package linking |
| Personal | Self-signing, long-term preservation |

## Success Criteria

A use case implementation is successful when:

1. **No format conversion required** between authoring and distribution
2. **Signatures remain valid** across viewer implementations
3. **Content extraction works** without manual intervention
4. **Accessibility is automatic** from semantic structure
5. **Long-term preservation** is achievable with open tools
