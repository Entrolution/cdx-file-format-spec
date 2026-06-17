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
| [Legal](legal/README.md) | `cdx.legal` | 0.1 | Draft | Legal citations, clause references, jurisdiction metadata |

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
| legal | `legal/` | `citations.json` |

### Shared Definitions

Extensions share common definitions from the core specification:

- **ContentAnchor** (`anchor.schema.json`): Position references used by collaboration, phantoms, annotations
- **Person** (`anchor.schema.json`): Base identity object extended by collaboration (author), security (signer), phantoms (author)

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

- Each extension specifies its version in the manifest declaration
- Data files include a `version` field matching the extension version
- Version changes follow semantic versioning principles:
  - Patch: Bug fixes, clarifications
  - Minor: New optional features, backward-compatible
  - Major: Breaking changes

**Note:** Most extensions are at version 0.1 (initial draft). The Collaboration extension is at version 0.2 because it underwent breaking changes to its comment threading model during development. This version difference is intentional and reflects actual specification maturity.

See individual extension READMEs for version history and migration notes.
