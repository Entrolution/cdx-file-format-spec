# CDX JSON Schemas

This directory contains JSON Schema definitions for validating CDX document components.

## Schema Files

The tables below are the canonical registry of CDX part paths: each schema is paired with the archive path(s) it governs.

| Schema | Purpose | Validates |
|--------|---------|-----------|
| `manifest.schema.json` | Document manifest | `manifest.json` |
| `content.schema.json` | Semantic content blocks | `content/document.json` |
| `presentation.schema.json` | Presentation layer | `presentation/*.json` |
| `precise-layout.schema.json` | Precise layouts | `presentation/layouts/*.json` |
| `asset-index.schema.json` | Asset index | `assets/<category>/index.json` |
| `dublin-core.schema.json` | Dublin Core metadata | `metadata/dublin-core.json` |
| `provenance.schema.json` | Provenance records | `provenance/record.json` |
| `anchor.schema.json` | Content anchor definitions | (shared definitions) |
| `annotations.schema.json` | Core annotations | `security/annotations.json` |
| `phantoms.schema.json` | Phantom clusters | `phantoms/clusters.json` |

### Extension Schemas

| Schema | Purpose | Validates |
|--------|---------|-----------|
| `semantic.schema.json` | Semantic extension | `semantic:*` blocks and marks |
| `academic.schema.json` | Academic extension | `academic:*` blocks and marks |
| `legal.schema.json` | Legal extension | `legal:*` blocks and marks |
| `collaboration.schema.json` | Collaboration extension | `collaboration/comments.json`, `collaboration/changes.json` |
| `forms.schema.json` | Forms extension | `forms/data.json`, `forms:*` blocks |
| `security.schema.json` | Security extension | `security/signatures.json`, `security/encryption.json` |

## Schema Dependencies

Some schemas reference definitions from other schema files:

```
annotations.schema.json
    └── $ref: anchor.schema.json#/$defs/contentAnchor

collaboration.schema.json
    └── $ref: anchor.schema.json#/$defs/contentAnchor

content.schema.json
    ├── $ref: semantic.schema.json#/$defs/*Mark
    └── $ref: academic.schema.json#/$defs/*Mark

phantoms.schema.json
    └── $ref: anchor.schema.json#/$defs/contentAnchor
```

The `anchor.schema.json` file provides shared definitions for `ContentAnchor`, `ContentAnchorUri`, and `person` that are used by core annotations, phantoms, collaboration, and other extensions.

## Using These Schemas

### With ajv (Node.js)

```bash
npm install -g ajv-cli

# Validate a manifest
ajv validate -s schemas/manifest.schema.json -d document.cdx/manifest.json

# Validate with referenced schemas (for phantoms)
ajv validate -s schemas/phantoms.schema.json -r schemas/anchor.schema.json -d document.cdx/phantoms/clusters.json
```

### With jsonschema (Python)

```python
import json
from jsonschema import validate, RefResolver

# Load schemas
with open('schemas/manifest.schema.json') as f:
    schema = json.load(f)

with open('document.cdx/manifest.json') as f:
    document = json.load(f)

validate(instance=document, schema=schema)
```

For schemas with references, use a RefResolver:

```python
from jsonschema import RefResolver

schema_store = {}
for schema_file in ['anchor.schema.json', 'phantoms.schema.json']:
    with open(f'schemas/{schema_file}') as f:
        schema = json.load(f)
        schema_store[schema['$id']] = schema

resolver = RefResolver.from_schema(schema_store['https://cdx.dev/schemas/phantoms.schema.json'], store=schema_store)
validate(instance=document, schema=phantoms_schema, resolver=resolver)
```

### With check-jsonschema (CLI)

```bash
pip install check-jsonschema

check-jsonschema --schemafile schemas/manifest.schema.json document.cdx/manifest.json
```

## Schema Version

All schemas are written for JSON Schema Draft 2020-12 (`https://json-schema.org/draft/2020-12/schema`).

## Validation Notes

- Schemas use `additionalProperties: false` on most objects to catch typos and invalid properties
- The `metadata` object in `phantoms.schema.json` intentionally allows additional properties for application-specific extensibility
- The `styles` object in `presentation.schema.json` allows arbitrary named styles, but each style definition is strictly validated

## Extension Policy

### additionalProperties Defaults

- **Default**: `additionalProperties: false` for strict validation
- **Exceptions**:
  - `metadata` objects allow custom properties (application extensibility)
  - CSL bibliography entries allow additional fields (CSL spec compatibility)
  - JSON-LD annotations allow arbitrary properties (linked data)
  - Base Person object allows extension-specific fields via `allOf` composition

### Shared Type Composition

Extension schemas that need Person/author objects use `allOf` composition with the base definition from `anchor.schema.json`:

```json
{
  "author": {
    "allOf": [
      { "$ref": "anchor.schema.json#/$defs/person" },
      {
        "type": "object",
        "properties": {
          "extensionSpecificField": { "type": "string" }
        }
      }
    ]
  }
}
```

### Versioning

- Extension READMEs declare version in header (e.g., `Version: 0.1`)
- Data files include `version` field for file format versioning
- Schema `$id` URIs don't include versions (versioned by spec release)
- collaboration v0.2 is intentional (migration from v0.1 with `blockRef`/`range` to `anchor`)
