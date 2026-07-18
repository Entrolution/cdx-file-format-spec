# CDX Extensions

This directory contains specifications for CDX extensions. Each extension adds specialized functionality to the core CDX specification.

## Available Extensions

| Extension | ID | Version | Status | Purpose |
|-----------|----|---------|----|---------|
| [Semantic](semantic/README.md) | `cdx.semantic` | 0.1 | Draft | Citations, footnotes, glossary, entity annotations |
| [Academic](academic/README.md) | `cdx.academic` | 0.1 | Draft | Theorems, proofs, exercises, algorithms, equations |
| [Forms](forms/README.md) | `cdx.forms` | 0.1 | Draft | Interactive form fields and validation |
| [Collaboration](collaboration/README.md) | `cdx.collaboration` | 0.2 | Draft | Comments, track changes, real-time collaboration |
| [Security](security/README.md) | `cdx.security` | 0.1 | Draft | Digital signatures, encryption, access control |
| [Phantoms](phantoms/README.md) | `cdx.phantoms` | 0.1 | Draft | Off-page annotation clusters |
| [Presentation](presentation/README.md) | `cdx.presentation` | 0.1 | Draft | Layout templates and rendering hints |
| [Legal](legal/README.md) | `cdx.legal` | 0.1 | Draft | Legal citations, captions, tables of authorities, jurisdiction metadata |

## Extension Compatibility

Extensions are designed to work together. The following matrix shows compatibility between extensions:

| Extension | semantic | academic | forms | collaboration | security | phantoms | presentation | legal |
|-----------|----------|----------|-------|---------------|----------|----------|--------------|-------|
| semantic | - | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| academic | ✓ | - | △* | ✓ | ✓ | ✓ | ✓ | ✓ |
| forms | ✓ | △* | - | ✓ | ✓ | ✓ | ✓ | ✓ |
| collaboration | ✓ | ✓ | ✓ | - | ✓ | ✓ | ✓ | ✓ |
| security | ✓ | ✓ | ✓ | ✓ | - | ✓ | ✓ | ✓ |
| phantoms | ✓ | ✓ | ✓ | ✓ | ✓ | - | ✓ | ✓ |
| presentation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | - | ✓ |
| legal | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | - |

**Legend:**
- ✓ = Fully compatible
- △ = Technically compatible but unusual combination
- ✗ = Incompatible

*Academic and forms are both content-heavy extensions; combining them is technically possible but unusual in practice.

## Common Patterns

### Extension Declaration

Extensions are declared in the manifest:

```json
{
  "extensions": [
    {
      "id": "cdx.semantic",
      "version": "0.1",
      "required": false
    }
  ]
}
```

The `required` field indicates whether the document can be meaningfully viewed without the extension:
- `false`: Document degrades gracefully without extension support
- `true`: Extension is essential to document content

### Extension Data Files

Most extensions store data in dedicated directories:

| Extension | Directory | Primary Files |
|-----------|-----------|---------------|
| semantic | `semantic/` | `bibliography.json`, `glossary.json` |
| academic | `academic/` | `numbering.json` |
| forms | `forms/` | `data.json` |
| collaboration | `collaboration/` | `comments.json`, `changes.json` |
| security | `security/` | `signatures.json`, `encryption.json` |
| phantoms | `phantoms/` | `clusters.json` |

### Shared Definitions

Extensions share common definitions from the core specification:

- **ContentAnchor** (`anchor.schema.json`): Position references used by collaboration, phantoms, annotations
- **Person** (`anchor.schema.json`): Base identity object extended by collaboration (author), security (signer), phantoms (author)

## Integrity Status of Extension Data

A signature does not cover the whole archive. Each extension therefore states, in an **Integrity Status** subsection, which of its constructs a signature authenticates and which it does not, so that out-of-hash data is never presented as authoritative without disclosure.

Extension data falls into one of three integrity tiers:

| Tier | What it holds | Authenticated by |
|------|---------------|------------------|
| **Document hash** | Content blocks and the projected Dublin Core terms — the document's semantic identity (Document Hashing specification, section 4.1) | Every signature (it binds the document ID) |
| **Manifest projection** | Lifecycle state, the content and presentation part hashes, the extension declarations, lineage, the configuration of an extension declared `required: true`, and any `{path, hash}` file reference an extension config slot declares (e.g. academic numbering, semantic bibliography/glossary), regardless of the `required` flag — but **not** the remaining, non-file-reference configuration of a `required: false` extension (security extension, Manifest Projection) | A signature carrying `scope.manifest` (mandatory for `frozen`/`published` documents) |
| **Neither** | A side file the manifest references by path only (no hash), the non-file-reference configuration of a `required: false` extension, and annotation, collaboration, phantom, and form-data bytes | Nothing — see below |

**Tier-three data is advisory.** Data in neither domain is outside every signature and outside the document ID: it can be added, edited, or removed without changing the document ID or invalidating any signature, **even on a `frozen` or `published` document**. A verifier MUST NOT present such data as authenticated, tamper-evident, or non-repudiable.

**Identity and approval claims are advisory even when they are in the hash.** A signature attests the *bytes* of a content block, not the truth of an identity, authorship, signature, or approval claim those bytes carry. An author name, an ORCID, a notary or judge named in content, a "signature" captured as form data, or an `accepted`/`approved` status is **not** authenticated by a signature over the bytes that spell it (security extension, Identity Authority). To authenticate such a claim, place it in **signed content** bound to a credential, declare the carrying extension `required: true` so its configuration enters the manifest projection, or bind the responsible party through a **required-signer policy** (security extension, Signature Set Integrity).

Each extension's **Integrity Status** subsection applies this discipline to its own constructs. Those statements are **categorical**: where a side file or construct is named as advisory, *every* field it carries is advisory — the fields called out are examples, not a closed list.

## Implementation Guidance

When implementing CDX support, consider the following priority order:

### Required for Basic Support
1. Core content blocks
2. Dublin Core metadata
3. Manifest parsing

### Recommended Extensions
1. **Security** - For document integrity verification
2. **Presentation** - For proper rendering

### Content Extensions (as needed)
- **Semantic** - For scholarly documents with citations
- **Academic** - For mathematical/scientific content
- **Forms** - For fillable documents

### Collaboration Extensions
- **Collaboration** - For multi-user editing
- **Phantoms** - For advanced annotation workflows

## Versioning

Each extension carries a `version` in two places: its manifest declaration (`extensions[].version`, see Extension Declaration above) and a `version` field inside each of its data files. Both use `MAJOR.MINOR` and follow semantic versioning:

- Patch: Bug fixes, clarifications
- Minor: New optional features, backward-compatible
- Major: Breaking changes

### Reader behavior on version skew

Core version rules govern only the `cdx` document version (Manifest section 4.1). Each extension version follows the same MAJOR/MINOR discipline, applied per extension:

- **Higher minor, same major** (the reader supports the major version): the reader MUST NOT reject the extension. It SHOULD process the fields and constructs it recognizes and ignore unrecognized additions — a warning disposition (State Machine section 5.4), never an error.
- **Higher major, or an extension the reader does not support at all**: the reader treats the extension as unsupported, and the consequence follows the manifest `required` flag. An unsupported `required: true` extension means the reader MUST refuse to process the document; an unsupported `required: false` extension is ignored — the reader drops that extension's data and renders the rest, degrading gracefully. These are the existing unsupported-required and unsupported-optional rows of State Machine section 5.4; a version the reader cannot process is never, by itself, an integrity failure.

**A published data-file schema is a point-in-time strict artifact, not the forward-compatibility gate.** Each extension ships a JSON Schema that closes its data files to a known field set (`additionalProperties: false`, and closed comment/block subtypes). That schema fixes one MINOR version exactly: it is a strict validator for authoring against that version, not the conformance test for forward compatibility. The forward-compatibility contract above is a **reader** obligation — process recognized fields, ignore unrecognized additions — not a promise that a closed schema will accept a higher-minor document. A validator therefore MUST NOT treat a closed schema's rejection of an unrecognized field as a conformance failure for a higher-minor, same-major document: that document is conformant even though the point-in-time schema rejects it. Tooling that must admit forward-compatible documents SHOULD gate on the reader contract (recognized fields well-formed; unrecognized fields ignored), not on a frozen schema's closed property set.

**Out-of-hash version skew is never an integrity error.** An extension's data files, and the `config` object of any extension not declared `required: true`, are outside the document hash and the manifest projection (Integrity Status of Extension Data above). A version carried in that out-of-hash data degrades rendering at most: a missing or unparseable out-of-hash data part is a WARNING in all states (State Machine section 5.4), and a version the reader cannot process MUST NOT be reported as an INTEGRITY-ERROR.

**Manifest declaration vs data-file version.** The `{id, version, required}` an extension declares in the manifest is bound by the manifest projection for every extension, so on a `frozen` or `published` document it is authenticated; a data file's own `version`, by contrast, is bound only when that file is declared as a `{path, hash}` reference and the manifest is signed, and is out-of-hash tier-three data otherwise. The data-file `version` SHOULD equal the manifest declaration. A reader that finds the two inconsistent applies the skew rules above (using the higher of the two to decide minor/major handling) and SHOULD surface the inconsistency, but MUST NOT escalate it to an integrity failure: a skew is an authoring inconsistency, not third-party tampering — a hash-bound file's bytes are already attested by any surviving signature, and an unbound file's `version` is not authenticated at all — so it degrades rendering at most.

**Note:** Most extensions are at version 0.1 (initial draft). The Collaboration extension is at version 0.2 because it replaced its `blockRef` + `range` addressing pattern with the unified `anchor` field (ContentAnchor objects from the core Anchors and References specification) — a breaking change to how comments and changes reference content, described in the collaboration extension's migration note (section 2). This version difference is intentional and reflects actual specification maturity.

See individual extension READMEs for version history and migration notes.
