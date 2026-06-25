# CDX Profiles

Profiles describe recommended subsets of CDX features for specific use cases. They provide guidance on which features to use (and avoid) for particular document types. Profiles are non-normative: they define no conformance class and place no requirements on documents or implementations (see Introduction section 1.3).

## Available Profiles

| Profile | ID | Purpose |
|---------|-----|---------|
| [Simple Documents](simple-documents.md) | `simple` | Recreational reading, novels, basic articles |

## What is a Profile?

A profile is **non-normative guidance** that:

- Identifies which features are appropriate for a use case
- Recommends a minimal feature set for that use case
- Provides examples tailored to that use case
- Offers migration guidance from other formats

Profiles do NOT:

- Create new features or block types
- Override the core specification
- Require special handling by implementations
- Restrict what a valid CDX document can contain
- Constrain the set of extensions a document may declare

Because a profile restricts nothing, there is no such thing as "conforming to a profile" and no profile-specific conformance test. A document that uses only a profile's recommended features is simply a valid CDX document; one that goes beyond them is equally valid. Conformance is defined against CDX core, not against any profile (Introduction section 1.3).

## Declaring a Profile

Declaring a profile is optional and purely advisory — a hint about the document's intended use, useful to tooling. Documents MAY declare a profile in the manifest:

```json
{
  "cdx": "0.1",
  "profile": "simple",
  ...
}
```

A profile declaration never affects how a document is processed: a consumer treats a document that declares a profile as a standard CDX document, honoring every feature it actually contains regardless of whether that feature falls within the declared profile's guidance, and disregards an unrecognized profile value. These are normative requirements on consumers, stated in Manifest section 4.18. A document that declares `profile: "simple"` but contains, say, a table block is therefore still fully valid and is processed normally.

The declaration is a bare identifier with no version component: profiles are not independently versioned, and a profile carries no conformance level to target.

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
