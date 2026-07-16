# CDX Example Documents

These example documents illustrate the CDX container format and its extensions.
They are **teaching artifacts**, not documents to trust: read this trust-boundary
note before copying an example into a security-sensitive context.

## Signatures here are placeholders

Every signature in this corpus is a **non-verifying placeholder**. The protected
headers carry self-labeled placeholder certificates (the `x5c` base64 value itself
reads as `…UNVERIFIEDplaceholderDERcertificate…FORILLUSTRATION…`) and the signature
bytes base64url-decode to literal placeholders like
`PLACEHOLDER_non_verifying_notary_signature`, so no example signature
cryptographically verifies. They
demonstrate the *shape* of a signed document — the JWS envelope, the scope, the
manifest projection — not a real attestation. Do not treat a validating example as
proof that CDX signatures work; run the reference tooling for that.

## What a signature does and does not cover

A CDX signature binds the document ID (semantic content) and, on a `frozen` or
`published` document, the **manifest projection** (the security-relevant manifest
declarations — content/presentation hashes, the required-extension set, lineage,
the required-signer policy, and hashed config-file references). It does **not** bind
everything the archive contains. The authoritative, exhaustive statement is the
Security Extension's *Coverage and Negative Coverage* section (§9.8); the short
version is that anything referenced by the manifest **by path only** is unsigned.

**Fields that read as authoritative but are not authenticated** (forgeable without
breaking any signature, because they sit outside the signed byte-set):

- **Metadata** — `metadata/dublin-core.json` is path-only. The administrative Dublin
  Core terms `rights`, `publisher`, `identifier`, and `date` are outside the hash
  projection; do not gate licensing on `rights` or attribute a source from
  `publisher`/`identifier` on the strength of a valid signature (Core Metadata §6.2).
- **Provenance** — `provenance/record.json` is path-only and entirely unsigned. Its
  `creator` (name and `did:web` identifier), `timestamps`, `lineage`, and
  `derivedFrom` are author claims. A `did:web:` value is not an authenticated
  identity because it is named; RFC 3161 / blockchain timestamps must be verified
  out-of-band, never trusted by inclusion (Core Provenance §8.1).
- **Editorial and collaboration data** — annotation, comment, suggestion, and phantom
  `author`/`content`/`status` are advisory and forgeable (Security Extension §3.10).
  A `security/annotations.json` sits next to `signatures.json` but is not signature-
  adjacent: it is out-of-hash reviewer data.
- **Signer display blocks** — a signature's `signer.name`/`email`/`organization` are
  advisory display; the authoritative identity is the validated credential
  (Security Extension §3.5).

## Per-example notes

- **`signed-provenance-document`** — the "Certificate of Authenticity" template. The
  body narrates a notary issuer, an RFC 3161 timestamp, and a Bitcoin anchor, but all
  of that lives in the path-only, **unsigned** `provenance/record.json`. The single
  notary signature binds only `scope.documentId` + the manifest projection. Treat the
  issuer DID, timestamps, and blockchain anchor as unauthenticated claims to be
  verified out-of-band — not as attested by the signature badge.
- **`signed-document`** — a two-party agreement. Its `signaturePolicy.requiredSigners`
  lists **only the notary**, so the party signatures (`sig-provider`, `sig-client`)
  are *optional* under the policy and can be stripped without failing required-signer
  verification. A verifier reporting "all required signatures present" does not mean
  both parties signed. A real multi-party agreement should list every party it means
  to bind in `requiredSigners`.
- **`signed-semantic-document`** — a frozen document whose `scope.manifest` binds two
  hashed semantic config files (`configFiles`), demonstrating config-file attestation.

## Rendering the illustrative content safely

Some examples embed raw inline SVG and reference a remote JSON-LD `@context`. Inline
SVG must be sanitized/sandboxed before rendering (Renderer Safety §2.2/§3.1), and a
remote `@context` must not be dereferenced by default (Renderer Safety §5). The
examples show the data shape; they do not model the renderer's obligations.
