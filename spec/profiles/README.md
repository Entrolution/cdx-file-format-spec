# CDX Profiles

Profiles define subsets of the CDX format optimized for specific use cases. They provide guidance on which features to use (and avoid) for particular document types.

## Available Profiles

| Profile | ID | Purpose |
|---------|-----|---------|
| [Simple Documents](simple-documents.md) | `simple` | Recreational reading, novels, basic articles |

## What is a Profile?

A profile is **non-normative guidance** that:

- Identifies which features are appropriate for a use case
- Defines minimal requirements for that use case
- Provides examples tailored to that use case
- Offers migration guidance from other formats

Profiles do NOT:

- Create new features or block types
- Override the core specification
- Require special handling by implementations
- Restrict what a valid CDX document can contain

## Profile Conformance

Documents are not required to declare profile conformance. A document conforming to a profile is simply a valid CDX document that happens to use only the features recommended by that profile.

However, documents MAY declare their intended profile in the manifest for tooling purposes:

```json
{
  "cdx": "0.1",
  "profile": "simple",
  ...
}
```

Implementations SHOULD ignore unrecognized profile values and treat the document as a standard CDX document.

## Future Profiles

Potential future profiles:

| Profile | Purpose |
|---------|---------|
| `academic` | Research papers, theses, dissertations |
| `legal` | Court filings, contracts, legal briefs |
| `technical` | Technical documentation, manuals |
| `interactive` | Forms, surveys, assessments |
| `archival` | Long-term preservation, institutional records |

## Creating a Profile

When defining a new profile, consider:

1. **Target audience** — Who creates these documents? Who reads them?
2. **Required features** — What is the minimal set of features needed?
3. **Discouraged features** — What adds unnecessary complexity?
4. **Migration path** — What formats do users currently use?
5. **Examples** — Provide complete, realistic examples
