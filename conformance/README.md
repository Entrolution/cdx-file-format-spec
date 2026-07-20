# CDX Conformance Artifacts

> **NON-NORMATIVE.** Nothing in this directory is part of the CDX specification.
> The specification lives in `spec/` and the published schemas in `schemas/`;
> both are normative. This directory holds testing artifacts that *reference*
> the specification and never extend it. Where anything here appears to
> disagree with `spec/`, the specification governs.

## What is here

| File | Purpose |
|------|---------|
| `errors.json` | The defect-code vocabulary — stable identifiers for defect classes, each carrying the specification clause it comes from and the load-time disposition the specification assigns. |
| `errors.schema.json` | Schema for `errors.json`, enforced by `check:enumeration-coverage`. Lives here rather than in `schemas/` because everything in `schemas/` describes normative CDX structures. |

More arrives as the conformance suite is built out (portable known-answer
vectors, document fixtures, test trust material, and an adapter contract).

## The defect-code vocabulary

Known-answer vectors used to assert on substrings of English error messages,
which no third-party implementation can be held to. `errors.json` replaces that
with stable codes such as `CDX-E-MANIFEST-STATE-UNKNOWN`.

**A code is a diagnostic, not a requirement.** The specification mandates
*dispositions* (State Machine section 5.4) and *lineage outcomes* (Provenance
and Lineage section 3.3) — never error identifiers. An implementation is free to
use whatever internal errors it likes and map them to these codes **in its
conformance adapter**; it never has to adopt this vocabulary internally. The
normative half of each entry is its `disposition`, which is taken from the
specification and cites the row it was taken from.

### A null disposition is not permission to ignore

Most of the manifest defect classes carry `"disposition": null`. That records an
honest fact about the specification, not a licence: section 5.4.2 tabulates
dispositions for a specific list of failure classes, and several defects this
implementation fails closed on — a duplicate extension id, a presentation type
outside the enum, conflicting hashes for one declared path, a malformed
required-signer policy — are simply not on that list. Rather than stretch the
generic "missing or mistyping a required field" row to cover them (section 5.4.2
gives the `state` enum its *own* row, which would be redundant if that generic
row reached enum violations), the entry states that no row applies and names it
as a specification gap. The vocabulary never invents normativity it cannot cite.

### Two vocabularies that look alike

The lineage entries carry both an `outcome` and a `disposition`, and these are
**different axes**:

- **Outcome** (`VERIFIED` / `INCOMPLETE` / `REJECTED`) — the result of the
  lineage walk, Provenance and Lineage section 3.3.
- **Disposition** (`IGNORE` / `WARNING` / `INTEGRITY-ERROR` / `REJECT`) — what a
  reader does about it, State Machine section 5.4.

A lineage outcome of **REJECTED is not the disposition REJECT.** A proven-forged
lineage is a **WARNING**: the claimed ancestry must not be presented as
authenticated, but the document's content identity is unaffected and it is *not*
blocked on lineage grounds (State Machine section 5.4.2). Reading `REJECTED` as
"refuse to load" would violate the specification.

### Compatibility

Codes are **append-only and permanently stable**. A published code is never
re-pointed at a different defect; if a meaning must change, a new code is added
and the old one is deprecated (`deprecated: true`, plus `supersededBy` where
applicable) and kept forever. `version` is the vocabulary's own semantic version
and bumps on any addition or deprecation; `specVersion` is the specification
version the `clause` citations resolve against.

`check:enumeration-coverage` enforces the registry against reality: every code
emitted by the reference implementation must be registered, every registered
code must still be emitted (or explicitly deprecated), and every entry must
carry a summary, a clause, and a disposition.
