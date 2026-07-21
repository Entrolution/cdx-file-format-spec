# Writing a CDX Conformance Adapter

> **NON-NORMATIVE.** This document describes how to test an implementation
> against the CDX conformance suite. Nothing here is part of the CDX
> specification; the specification (`spec/`) and the published schemas
> (`schemas/`) are the only normative artifacts. Where anything here appears to
> disagree with `spec/`, the specification governs.

An **adapter** is a small program *you* write that wraps *your* implementation.
The suite hands it deterministic inputs and asks what your implementation
produced; the suite — never the adapter — decides pass or fail. You never adopt
the suite's error vocabulary internally: you map your native errors to suite
codes at the adapter boundary, and nowhere else.

## The one idea

The suite owns every assertion. Your adapter only reports **what happened** —
the bytes it produced, the id it computed, or the error it raised (mapped to a
suite code). This keeps the pass criterion in one place (the suite) so no
implementation can pass by asserting the wrong thing.

## Levels

The contract is tiered so the common case is trivial and the intrusive hooks are
required only where a case genuinely needs them. A **case** declares the lowest
level it needs; an **adapter** declares the highest level it implements
(`adapter.level` in the report).

| Level | Adds | Status |
|-------|------|--------|
| **0 — Vectors** | Pure known-answer vectors: deterministic input → deterministic output. No archive, no clock, no trust store, no network. | **shipped** |
| 1 — Fixtures + clock | Whole-document archive fixtures verified against a per-case virtual clock. | partial (container layer) |
| 2 — Trust + resolver injection | Fixtures whose verdict depends on an injected trust store and identity resolver. | planned |

Level 0 (vectors) and the container layer of Level 1 (document fixtures) ship
now; see [Level 1 — Document fixtures](#level-1--document-fixtures-container-layer).
The `virtual-clock` hook of Level 1 and all of Level 2 arrive in later phases;
their hooks are described here only far enough to show why the tiering exists.

## The minimal Level-0 adapter

At Level 0 you do not even need a separate process. Load the vectors, run your
function, compare. In pseudocode:

```
for file in conformance/vectors/*.json (skip *.schema.json):
    for vector in file.vectors:
        actual = my_implementation(vector)          # your code
        assert actual == expected_field(vector)     # your test runner
        # one kind inverts this: manifest-projection-errors expects your code to
        # RAISE — assert it raises and that the error maps to expect.code
```

That is the JSON-Schema-Test-Suite adoption shape: a few dozen lines, your own
assertions, no protocol. Most implementations start here. The fields each kind
carries are listed in [the per-kind contract](#per-kind-contract) below.

## The file-based protocol (for a machine-checkable verdict)

To get a verdict *from the suite* — and to run across a language boundary, the
way this repository checks a Rust implementation from a TypeScript harness — an
adapter is an **executable** that:

1. **Reads the suite root** (the directory containing `suite.json` and
   `vectors/`), passed as its first argument.
2. **Runs your implementation** over every vector, recording what it produced.
3. **Writes one report object to stdout** — schema:
   [`report.schema.json`](report.schema.json).

The suite harness runs your adapter, reads the report, and renders the verdict.
Nothing is written anywhere else; stdout is the whole interface.

### The report

```jsonc
{
  "suite": "cdx-conformance",
  "suiteVersion": "0.1.0",        // must equal the suite you ran against
  "specVersion": "0.1",
  "adapter": { "name": "my-impl", "version": "1.2.3", "level": 0 },
  "capabilities": ["core", "hash:sha-384"],   // must include "core"
  "results": [
    { "kind": "document-id", "name": "spec-4-5-heading",
      "outcome": "value", "values": { "canonicalJcs": "…", "id": "sha256:…" } },
    { "kind": "manifest-projection-errors", "name": "hash-missing",
      "outcome": "error", "error": { "code": "CDX-E-MANIFEST-HASH-MALFORMED" } },
    { "kind": "jwk-thumbprint", "name": "…",
      "outcome": "skip", "skip": { "reason": "algorithm not implemented" } }
  ]
}
```

Each result has one of three outcomes:

- **`value`** — the operation ran; `values` holds the actuals (keys per the
  contract below).
- **`error`** — the operation raised; put the suite code your native error maps
  to in `error.code` (or `null` if you have no mapping). Only the
  error-expecting kinds treat this as anything but a failure.
- **`skip`** — your adapter declined this vector. Surfaced in the verdict,
  never counted as a pass. Prefer capability declaration (below) over ad-hoc
  skips so the suite can scope cases for you.

You must report a result for every vector the suite considers in scope for your
declared capabilities; a vector left unreported is a failure, not a silent pass.

## Per-kind contract

For each kind: the input fields your adapter reads from the vector, the outcome
it reports, and the `values` keys the suite compares (against the vector's
expected field, shown in parentheses). All are pure functions — no clock, key, or
network is required at Level 0.

| Kind | Reads | Outcome | `values` key → (expected field) |
|------|-------|---------|--------------------------------|
| `document-id` | `parts` (`manifest`,`content`,`dublinCore`,`assetIndexes?`), `algorithm?` | value | `canonicalJcs` → (`expectedCanonicalJcs`); `id` → (`expectedId`) |
| `canonicalize` | `parts`, `algorithm?` | value **or error** | transform: `canonicalJcs` → (`expectedCanonicalJcs`), `id` → (`expectedId`); a reject vector (`expectReject`) expects `outcome: "error"` |
| `canonicalize-robustness` | `robustness` (generative — see below) | value / error | none — `accept` → `value`, `reject` → `error` |
| `structural-constraints` | `structural` (`rule`, `instance`, `blockTypes?`, `root?`, `index?`) | value | `flagged` → (the negation of `structural.expect.valid`) |
| `anchor-offset` | `anchor` (`text`, `start`, `end`) | value | `selection` → (`anchor.expectedSelection`) |
| `presentation-selection` | `selection` (`rule`, + `breakpoints`/`width` or `candidates`) | value | `breakpoint` → `name` (`selection.expect.name`); `default` → `index` (`selection.expect.index`) |
| `manifest-projection` | `manifest` (raw JSON text) | value | `jcs` → (`expectedJcs`); `sha256` → (`expectedSha256`) |
| `manifest-scope` | `scope` | value | `jcs` → (`expectedJcs`); `sha256` → (`expectedSha256`) |
| `manifest-projection-errors` | `manifest` (raw JSON text) | **error** | `error.code` → (`expect.code`) |
| `jws-header` | `header` | value | `protectedHeader` → (`expectedProtected`) |
| `jws-signing-input` | `header`, `scope` | value | `signingInputSha256` → (`expectedSha256`) — the `sha256:`-prefixed digest of the signing-input string |
| `jwk-thumbprint` | `jwk` | value | `thumbprint` → (`expectedJkt`) |
| `multibase` | `multibase` | value | `jwk` → (`expectedJwk`, by value); `thumbprint` → (`expectedJkt`) |
| `block-merkle-root` | `leaves` | value | `root` → (`root`) |
| `block-merkle-inclusion` | `leaf`, `path`, `root` | value | `included` → (`expected`, boolean) |
| `block-merkle-leaf` | `block` | value | `leafJcs` → (`jcs`); `leafHash` → (`hash`) |
| `provenance-timestamp` | `documentId`, `timestamp` | value | `boundToDocument`, `merkleVerified?`, `leaf?`, `problemsEmpty` → (`expected.*`) |

Notes that bite:

- **`multibase.jwk` is compared by value, not member order.** RFC 7638 sorts the
  required members before hashing, so member order does not affect the thumbprint;
  the suite normalises both sides before comparing. Emit the required members
  (`kty`, `crv`, `x`, and `y` for EC) with correct values — the order is yours to
  choose. The `thumbprint` comparison carries the cryptographic assertion.
- **`provenance-timestamp`**: `merkleVerified` and `leaf` are asserted only where
  the vector's `expected` defines them (aggregated timestamps carry them; single
  tokens do not). `problemsEmpty` is `true` iff your structural binding check
  produced no problems. The suite asserts *whether* problems are present, not
  *which* — a deliberate Level-0 granularity limit, so a rejection for the wrong
  reason still satisfies `problemsEmpty: false`.
- **`manifest-projection-errors`** is the only kind that expects an error. Report
  `outcome: "error"` with the mapped `code`; reporting a value fails the case.
- **`canonicalize` reject vectors** (`expectReject: true`) assert only that your
  implementation *rejects* the input — canonicalization defects carry no portable
  code, so report `outcome: "error"` (a `code` is optional and ignored). A vector
  is either a transform (`expectedCanonicalJcs`) or a reject; never both.
- **`canonicalize-robustness` is generative and parameterised by YOUR bound.**
  A case carries `robustness: { part, depth: { boundOffset }, of, expect }`. The
  canonicalization depth limit is implementation-defined (06 §4.3.2), so you
  expand the case relative to your OWN limit: nest `of` to
  `(your max depth) + boundOffset` inside the named `part`
  (`content` = the whole content; `metadata` = a Dublin Core term), then
  canonicalize. `boundOffset: 0` is the exact bound and MUST **accept** (report
  `value`); `boundOffset: 1` is one past and MUST **reject** — with a *catchable*
  error you report as `outcome: "error"`, **never a native stack overflow that
  crashes your adapter** (a crashed adapter produces no report, so the harness
  fails every case). Do not ship a literal deep structure in the vector; generate
  it in memory. Report your limit as `adapter.maxCanonicalizationDepth` so a
  reviewer can see the depth exercised. Granularity limit: `reject` asserts *that*
  the input is refused, not the internal reason — a deeply-nested metadata term,
  for instance, may be refused for depth or for term-validity; both are catchable
  rejections, and that survival is the property under test.
- **`structural-constraints` cases are self-describing.** Run the named `rule`'s
  structural check over `instance` and report `values.flagged` — `true` iff the
  rule found a violation. The suite compares that to `structural.expect.valid`
  (a valid instance is one the rule does NOT flag). Inputs vary by rule:
  containment/cardinality take a block tree (`instance`) plus a `root`
  (`document` | `excerpt`) and the `blockTypes` set to treat as blocks; anchor and
  page-number rules take a node; `asset-index-consistency` takes the manifest
  category as `instance` and the index as `index`; `id-uniqueness` takes an items
  array. **`blockTypes` is shipped in the case on purpose** — the fire/clean
  outcome can depend on which nodes count as blocks (a `tableCell` under a
  `paragraph` violates containment only because `paragraph` is a recognized block,
  giving it a concrete non-excerpt parent), so the vector pins that recognition
  rather than leaving it to your schema. Walk semantics: track the *nearest
  enclosing recognized block* — non-block containers (a `subfigures` array, a
  `marks` array) are transparent, so a child reached through one is attributed to
  the block above it. Two of the asset-index cases (`count`/`totalSize`
  consistency) are `SHOULD` (advisory): those manifest fields are advisory and
  their exact semantics are not normatively fixed, so a differing-but-reasonable
  reading is never fatal.
- **`anchor-offset` is code-point, not UTF-16.** Compute `values.selection` as the
  `[start, end)` slice of `text` **by Unicode scalar value** (code point), not by
  UTF-16 code unit. In most languages the native string index is UTF-16
  (`String.slice`/`charAt`/`substring`, `.length`), which mis-targets any range
  spanning an astral character — the exact defect this kind catches. In
  JavaScript, `Array.from(text).slice(start, end).join('')` is correct; the naive
  `text.slice(start, end)` is not.
- **`presentation-selection` tests only the deterministic rules.** `breakpoint`
  (§8.2): among breakpoints matching the width (bounds inclusive; an omitted bound
  is unbounded), report the `name` of the one with the greatest `minWidth`, and on
  a `minWidth` tie the one appearing **later** in the array; `null` if none match.
  `default` (§4.3): report the `index` of the first entry marked `default:true`,
  else `0`. The §4.3 step-1 target narrowing (screen SHOULD prefer
  continuous/responsive, print SHOULD prefer precise) is advisory and not tested.

## Level 1 — Document fixtures (container layer)

Beyond the Level-0 vectors, the suite ships **whole-document archive fixtures**
under [`fixtures/`](fixtures/). A Level-1 adapter additionally:

1. Enumerates each case directory `fixtures/<kind>/<case>/`; reads its committed
   `case.cdx` (a real `.cdx`/ZIP archive) **in memory**, and its `case.json`
   descriptor for the case's `requires[]`.
2. Runs its container reader over the bytes and reports a **verdict** — what its
   implementation *decided to do* with the document — under `outcome: "value"`:

   ```jsonc
   { "kind": "container", "name": "reject-duplicate-entry",
     "outcome": "value",
     "values": {
       "documentDisposition": "REJECT",              // the reader's decision
       "findings": [ { "code": "CDX-E-ARCHIVE-DUPLICATE-ENTRY",
                       "disposition": "REJECT" } ]    // diagnostic corroboration
     } }
   ```

The suite asserts `documentDisposition` lies within the case's expected
`[atLeast, atMost]` interval over the lattice `IGNORE < WARNING < INTEGRITY-ERROR
< REJECT` (State Machine §5.4.1 — INTEGRITY-ERROR is a floor with MAY-escalation,
so an equality assertion would be toothless), and that each intended finding is
reported — a **subset** check, so reporting additional findings is fine. The
disposition values are diagnostics your adapter maps its native reader's decision
to; the normative assertion is the interval. Codes come from
[`errors.json`](errors.json).

**Read fixtures in memory only.** The corpus deliberately carries zip-slip names,
case-only collisions, and symlink entries. An adapter — or test harness — that
extracts a fixture to disk attacks its own checkout; never materialize one.

**Level reporting.** Report `adapter.level: 1` once you read fixtures. The
`archive-reader` hook is exercised by the container fixtures shipped now; the
`virtual-clock` hook — needed only by the trust-dependent cases a later phase
adds — is not yet required by any case.

| Fixture kind | Reads | Outcome | `values` |
|--------------|-------|---------|----------|
| `container` | `case.cdx` (archive bytes), `case.json` (`requires?`) | value | `documentDisposition` (a disposition); `findings[]` (`{code, disposition}`) |

## Capabilities and scoping

Your adapter declares the capabilities it supports (keys from
[`capabilities.json`](capabilities.json)). The catalogue names optional
features — extra hash algorithms, signature algorithms, DID methods,
timestamping, extensions.

- **`core` is mandatory.** Every adapter declares it; it is the baseline every
  CDX reader implements. A report without `core` is rejected.
- A vector may carry `requires: [key, …]`. If you declare every required
  capability, the vector runs. If not:
  - **Vector cases (Level 0)** are **skipped** — reported explicitly, counted on
    their own, never a silent pass.
  - **Document-fixture cases (Level 1+)** are *not* skipped for a missing
    **extension**: they take the specification's own degradation path as an
    alternate expectation — a *required* extension you do not support MUST make
    the document REJECT, an *optional* one MUST be IGNORED (State Machine §5.4.2,
    the unsupported-required-extension and unsupported-optional-extension rows;
    Extensions README, forward-compatibility). This tests the degradation path
    instead of leaving a hole. (Fixtures arrive later; the rule is stated here so
    the contract is complete.)
- **Experimental constructs** (e.g. ML-DSA-65, blockchain anchors) are a
  normative exclusion, not a capability: no case depends on one.

Declare only what you genuinely support. This repository's reference adapter, for
instance, does **not** declare `hash:blake3` — it recognises the identifier but
cannot compute the digest, and claiming it would be a false report.

The shipped Level-0 vectors gate on these capabilities: `document-id` is pure
`core`; the manifest projection/scope/errors, JWS, JWK, and multibase vectors
require `ext:security`; the block-Merkle and provenance-timestamp vectors require
`provenance`; and the two SHA-384 vectors additionally require `hash:sha-384`. A
reader that declares only `core` therefore runs the document-ID, canonicalization,
canonicalize-robustness, and structural-constraints vectors, and is scoped out of
the security/provenance ones — a truthful, narrow conformance statement, not a
failure.

## MUST vs SHOULD

A vector defaults to **MUST**: a failure is fatal to the run. A vector marked
`severity: "SHOULD"` is **advisory** — a failure is reported separately and never
sinks an otherwise-conformant run. SHOULDs are surfaced, never fatal.

## Running the suite

This repository ships a reference Level-0 adapter and a harness.

```sh
# Produce a report from the reference adapter (the file-based protocol):
npx tsx scripts/conformance-reference-adapter.ts conformance/ > report.json

# Run the whole gate (engine self-test + suite integrity + end-to-end):
npm run check:conformance
```

The reference adapter (`scripts/conformance-reference-adapter.ts`) is the
smallest complete worked example of everything above. It wraps this
repository's own libraries; yours wraps your implementation.

## What a PASS means

A passing run is **evidence, not a certificate**. In full, see `suite.json`'s
`conformanceClaim`; in short:

- A PASS means your implementation reproduced the suite's expected outputs for
  the cases it ran, at the `(suiteVersion, specVersion)` in the report. It is not
  a certification, endorsement, or warranty.
- The suite is a floor, not a ceiling: passing every shipped case does not prove
  the absence of defects the suite does not exercise.
- No trademark or "CDX conformant" badge is conferred. Do not represent a PASS as
  certification by the specification's authors.
- A conformance claim MUST state the suite version, spec version, adapter level,
  and declared capabilities under which it was produced.

## Redistribution

The artifacts in this directory may be vendored into your test tree and
redistributed, provided the non-normative disclaimers and `suite.json`'s
`conformanceClaim` travel with them. See `suite.json`'s `license`.
