# Security Extension

**Extension ID**: `cdx.security`
**Version**: 0.1
**Status**: Draft

## 1. Overview

The Security Extension provides cryptographic capabilities for CDX documents:

- Digital signatures for document authentication and integrity
- Encryption for confidentiality
- Access control for permission management

## 2. Extension Declaration

To use this extension, declare it in the manifest:

```json
{
  "extensions": [
    {
      "id": "cdx.security",
      "version": "0.1",
      "required": true
    }
  ],
  "security": {
    "signatures": "security/signatures.json",
    "encryption": "security/encryption.json"
  }
}
```

## 3. Digital Signatures

### 3.1 Signature Model

A signature covers an explicit, signed **scope** of what it attests. The scope always binds the document ID (the content hash); a scoped signature additionally binds the **manifest projection** (Section 9.7) and/or precise-layout hashes (Section 9.3). A signature is a detached JWS (Section 3.3) over the canonical bytes of that scope — or, for the WebAuthn credential path, an assertion that binds the same bytes through its challenge (Section 6):

```
Signature = JWS(signing key, JCS(scope))      // scope.documentId is always present
```

This means:
- Signatures verify document content integrity
- Multiple signatures can attest to the same content
- Re-packaging doesn't invalidate signatures (only content changes do)

The document ID binds the document's semantic content only. It does **not** bind the rest of the manifest — the lifecycle state, the content and presentation part hashes, the required-extension set, or the lineage — so a content-only signature leaves those unauthenticated. To authenticate them, a signature covers the **manifest projection** (Section 9.7). A signature on a `frozen` or `published` document MUST cover the manifest projection (Section 9.8).

### 3.2 Supported Algorithms

| Algorithm | Identifier | Key Size | Status |
|-----------|------------|----------|--------|
| ECDSA P-256 | `ES256` | 256-bit | Required |
| ECDSA P-384 | `ES384` | 384-bit | Recommended |
| Ed25519 | `EdDSA` | 256-bit | Recommended |
| RSA-PSS | `PS256` | 2048+ bit | Optional |
| ML-DSA-65 | `ML-DSA-65` | PQC | Optional (future) |

Implementations MUST support ES256. Support for other algorithms is RECOMMENDED.

### 3.3 Signature File Structure

Location: `security/signatures.json`

Each signature is a **detached JWS** ([RFC 7515](https://www.rfc-editor.org/rfc/rfc7515), JSON Serialization) with an **unencoded** payload ([RFC 7797](https://www.rfc-editor.org/rfc/rfc7797), `b64:false`). The signed payload is `JCS(scope)`; the readable `scope` object is carried as a sibling member and is reconstructed — not stored — as the detached payload (see section 3.4). The signed protected header binds the algorithm, the signing credential (an X.509 chain or a keyId), and the signing time.

This is a JWS profiled toward **JAdES** ([ETSI TS 119 182-1](https://www.etsi.org/standards)); it does not claim a JAdES baseline conformance level. It omits the JAdES `sigD` descriptor: the detached payload is reconstructed as `JCS(scope)` per this section.

```json
{
  "version": "0.1",
  "documentId": "sha256:3a7bd3e2...",
  "signatures": [
    {
      "id": "sig-1",
      "protected": "eyJhbGciOiJFUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sInNpZ1QiOiIyMDI1Li4uIiwieDVjIjpbIk1JSUIuLi4iXSwieDV0I1MyNTYiOiIuLi4ifQ",
      "signature": "MEUCIQDf9Ky7...",
      "scope": {
        "documentId": "sha256:3a7bd3e2..."
      },
      "signer": { "name": "Jane Doe", "email": "jane@example.com" },
      "timestamp": {}
    }
  ]
}
```

> **Trust model status.** The X.509 certificate-chain trust model is specified in sections 3.7–3.10 and 7.4: a verifier validates the `x5c` chain to a verifier-configured trust store, checks revocation and validity, and assigns a state (section 3.8). The `keyId` (`kid`) credential path is specified for the self-certifying methods `did:key`/`did:jwk` and the out-of-band-resolved `did:web` method (section 3.11), each anchored by a verifier-configured pin. The **WebAuthn** credential path (section 6) is specified as a self-certifying COSE-key path, also anchored by a pin. Signature-**set** integrity against stripping and downgrade is specified in section 3.12 (an author-asserted required-signer set, bound by the manifest projection). Trusted timestamps and timestamp-based long-term validation are specified in sections 3.6 and 7.5. Archive-timestamp renewal for algorithm aging is a subsequent version.

### 3.4 Signature Entry Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique signature identifier |
| `protected` | string | Yes | base64url-encoded signed JWS protected header (see below) |
| `signature` | string | Yes | base64url-encoded JWS signature |
| `scope` | object | Yes | The detached payload — what the signature covers (see section 9) |
| `signer` | object | No | Advisory signer display information (see section 3.5) |
| `timestamp` | object | No | RFC 3161 trusted timestamp over this signature (see section 3.6) |
| `ltv` | object | No | Unsigned long-term-validation material — stapled certificates and revocation (see section 7.5) |

These fields describe the **JWS shape** (the X.509 and keyId credential paths). A WebAuthn signature instead carries a `webauthn` member (section 6) in place of `protected`/`signature`/`timestamp`/`ltv`; `id`, `scope`, and `signer` are common to both. Exactly one shape per signature.

**Protected header.** The base64url-decoded `protected` member is a JSON object. It carries `alg`, `b64`, `crit` and `sigT` on every signature, plus **exactly one credential path** — an X.509 certificate chain (`x5c` + `x5t#S256`) **or** a keyId (`kid`, plus `jkt` for `did:web`; section 3.11). Carrying both, or neither, is invalid.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `alg` | Yes | Signature algorithm (section 3.2) |
| `b64` | Yes | MUST be `false` — the payload is unencoded (RFC 7797) |
| `crit` | Yes | MUST be exactly `["b64"]` (a registered parameter such as `sigT` MUST NOT appear here; `jkt` is a profile parameter a CDX verifier processes despite its absence from `crit`) |
| `sigT` | Yes | Signing time (ISO 8601 UTC), replacing the former unsigned `signedAt` |
| `x5c` | X.509 path | Signing certificate chain — standard base64 (RFC 4648 §4, padded; not base64url) of each certificate's DER, leaf-first |
| `x5t#S256` | X.509 path | base64url SHA-256 thumbprint of the signing certificate |
| `kid` | keyId path | Key identifier — a `did:key`/`did:jwk`/`did:web` DID (section 3.11); mutually exclusive with `x5c`/`x5t#S256` |
| `jkt` | did:web | base64url RFC 7638 SHA-256 thumbprint of the signing key — REQUIRED for `did:web` (it binds the out-of-band-resolved key); MUST NOT appear on any other path |

The signature is computed over the **signing input** `BASE64URL(UTF8(protected)) + '.' + JCS(scope)`. The protected header is signed as its exact stored bytes — a verifier MUST use the stored `protected` string and MUST NOT re-serialize the decoded header. The detached payload, by contrast, is recomputed: a verifier MUST derive it as `JCS(scope)` from the `scope` member it displays, so the bytes verified are always the bytes shown.

### 3.5 Signer Information

The `signer` object carries **advisory** display information only. The authoritative signer identity is the validated credential's identity — the subject of the signing certificate (`x5c`), or the resolved-and-anchored `kid` for the keyId path (sections 3.10, 3.11). A verifier MUST NOT treat these fields as authenticated and MUST NOT elevate `signer.name`/`email` above the credential identity.

```json
{
  "signer": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "organization": "Acme Corporation"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Signer's display name (advisory) |
| `email` | string | No | Signer's email (advisory) |
| `organization` | string | No | Signer's organization (advisory) |

### 3.6 Trusted Timestamps

A signature MAY carry an RFC 3161 trusted timestamp that establishes when it existed, turning the self-asserted `sigT` into a verifiable time. A validated timestamp is the **trusted reference time** the state machine uses (sections 3.7–3.8): it is what lets a verifier detect signing outside the credential's validity window (rule 2) and, with stapled revocation, validate a signature long after the certificate expires (long-term validation, section 7.5).

```json
{
  "timestamp": {
    "token": "MIIEpgYJKoZI...",
    "authority": "https://timestamp.digicert.com",
    "time": "2025-01-15T10:00:05Z"
  }
}
```

**The token binds this signature.** The `token` is an RFC 3161 `TimeStampToken` (a CMS `SignedData`). Its `messageImprint.hashedMessage` MUST equal

```
H( protected || "." || signature )
```

— the hash, under the imprint's own algorithm, of the signature's stored base64url `protected` and `signature` members joined by a single `.`. Binding **both** members (not the signature value alone) commits the signed protected header, and therefore the credential identity (`x5c`/`kid`) and `sigT`: a token cannot be re-pointed at a record whose header the TSA never timestamped. A verifier MUST recompute the imprint over **the record the token is a sibling of** and MUST NOT accept a token whose imprint matches a different record.

**The TSA must be trusted (the section 3.9 principle).** A verifier MUST validate the token's TSA certificate chain to a verifier-configured **TSA trust store** — a third store, distinct from the signature trust anchors (section 3.9) and the `did:web` Web-PKI store (section 3.11). A TSA root MUST NOT double as a signature anchor (or the converse) unless the deployment configures it in both. An in-document token whose TSA does not validate is **not** trusted — never self-authorizing — exactly as an unanchored `x5c` chain is not.

**Trusted time, and what stays advisory.** When a token validates, the trusted reference time **T** is the token's genTime; `authority` and `time` are **advisory display only** and MUST NOT feed any state derivation. The `referenceTimeTrusted` input (section 3.8) is `true` **iff**: the token is well-formed; its imprint binds this record (above); its TSA chain anchors to the TSA store; and the TSA certificate is itself within validity and unrevoked at verification time. Then T replaces `sigT` as the reference time for the validity-window derivations (`signingTimeWithinValidity`, `certCurrentlyExpired`).

**A bad timestamp never invalidates a good signature.** A token that does not validate simply does not grant trusted time: `referenceTimeTrusted` stays `false`, the verifier falls back to the untrusted `sigT` (rule 2 cannot fire), and the signature's own state is unaffected. A failed timestamp MUST NOT make the signature `invalid` (cf. the did:web key-unavailability rule, section 3.11).

**Upper bound only (anti-backdating limit).** A signature-timestamp proves the signature existed **at or before** T; it does not establish a lower bound. The trusted time for all validity and revocation derivations is **T**, never `sigT`; in particular `signingTimeWithinValidity` MUST be derived from T, so backdating `sigT` cannot smuggle a signature into a window T falls outside of. A verifier MUST NOT present `sigT` as an attested signing time on the strength of a timestamp, and SHOULD warn when `sigT` and T diverge beyond a configured tolerance. The residual — a signer who backdates `sigT` while the credential is still valid and timestamps promptly is indistinguishable from one who signed at `sigT` — is disclosed in section 8.5.

> Provenance-record timestamps (core specification 09 §6) are a **different** construction: they bind the document hash, not a signature. The signature timestamp here binds `H(protected || "." || signature)`.

### 3.7 Signature Verification

To verify a signature and assign it a state (section 3.8):

1. Extract the document ID from the manifest (`manifest.id`) and recompute it from the content; the two MUST be equal, or the document fails integrity and every signature over it is `invalid`
2. If the document state is `frozen` or `published`, require that every signature covers the manifest projection (Section 9.8); reject the document otherwise
3. For each signature, compute the inputs to the state rules (a WebAuthn signature computes them per section 6.3 instead of steps a–e):
   a. **Header consistency.** Decode the `protected` header and check (section 3.4): `alg` supported; `b64` false; `crit` exactly `["b64"]`; `sigT` well-formed and not after the reference time; and exactly one credential path that is internally consistent — for X.509, `x5c` present, the signed `x5t#S256` equals the leaf-certificate thumbprint (section 3.10), and the leaf public key's type and curve are consistent with `alg` (an `alg`-versus-key mismatch — e.g. `ES256` over a non-P-256 key — is `invalid`, the X.509 analogue of the keyId and WebAuthn rules); for keyId, `kid` present and well-formed, the self-certifying methods' encoded key usable with `alg`, and a well-formed `jkt` for `did:web` (section 3.11). This is a header-shape check: for `did:web` it does **not** depend on resolution — an unresolvable key is decided at the trust path (step d), not here. A failure makes the state `invalid`
   b. **Signature.** Reconstruct the detached payload as `JCS(scope)` from the `scope` member and the signing input as `protected + "." + JCS(scope)`; verify the JWS signature under the credential's public key — the leaf certificate `x5c[0]` (X.509), the key encoded in `kid` (self-certifying), or, for `did:web`, the resolved verification method whose thumbprint matches the signed `jkt` (section 3.11). A failure makes the state `invalid`. For `did:web`, if no matching key can be resolved the signature is not evaluated here — the credential is key-unavailable and decided at the trust path (step d)
   c. **Scope.** Verify the signed `scope.documentId` equals the recomputed document ID (`manifest.id`, step 1) — the signed scope is the authoritative binding of what the signature covers. The top-level `signatures.documentId` is an **unsigned, advisory** convenience copy that MUST also equal it, but a verifier MUST NOT treat it as authenticated (Section 9.4). When `scope.manifest`/`scope.layouts` are present, perform the scoped checks (section 9.5). A `scope.documentId` that does not equal the recomputed `manifest.id` makes the state `invalid`
   d. **Trust path.** Anchor the credential to verifier-configured trust, yielding `anchored`, `untrusted`, or `unknown`: validate the `x5c` chain against the trust store (section 3.9), or anchor the resolved `kid` against the verifier's pin (section 3.11). For `did:web` this step performs the HTTPS resolution and the `jkt` key-match; an unresolvable or unmatched key is `unknown` (key-unavailable)
   e. **Revocation and validity.** Determine the credential's revocation status and validity window relative to the reference time — a validated signature-timestamp's time T when present (sections 3.6, 7.5), else the untrusted `sigT` (section 7.4)
4. Combine these inputs into a state using the production rules of section 3.8, and report it
5. **Signature-set integrity (document-level).** After every signature has a state, evaluate the completeness of the signature *set* (section 3.12): if the signed manifest projection declares `signaturePolicy.requiredSigners`, every required signer MUST be satisfied by a present signature whose state is `valid`, and a document with any unsatisfied required signer MUST be rejected as stripped or downgraded. For a `frozen` or `published` document that declares no policy, a verifier MUST warn that the signature set is unprotected against stripping

A single signature's state (steps 3–4) is **per-signature**: it carries no meaning about the completeness of the signature *set*. Set integrity is the separate, document-level verdict of step 5 (section 3.12), not a signature state.

### 3.8 Signature States

A verifier MUST assign each signature exactly one state. The inputs are the verdicts computed in section 3.7 step 3; each is bound to an observable fact by the derivation rules in sections 3.9 (trust path) and 7.4 (revocation).

**Production rules (first match wins):**

| # | Condition | State |
|---|-----------|-------|
| 1 | Header/binding inconsistent, or the signature does not verify under the credential key (`x5c[0]`, the key resolved from `kid`, or the WebAuthn `publicKey`) | `invalid` |
| 2 | A trusted timestamp shows the credential was outside its validity when it signed | `invalid` |
| 3 | The credential could not be evaluated | `unknown` |
| 4 | The credential does not anchor to verifier-configured trust | `untrusted` |
| 5 | The credential is revoked | `revoked` |
| 6 | Revocation could not be determined | `unknown` |
| 7 | The credential is expired at verification time | `expired` |
| 8 | Otherwise | `valid` |

A verifier MUST NOT report `valid` for a signature whose credential does not anchor (`untrusted`) or whose revocation could not be confirmed (`unknown`). For any security decision a verifier MUST treat `unknown` as non-acceptance — no weaker than `untrusted` — and MUST NOT fail open. Because the `x5c` chain and any stapled revocation material are document-supplied, their incompleteness MUST NOT downgrade an otherwise-determinable adverse verdict: a verifier SHOULD obtain the missing material independently (fetch the intermediate, query the issuer's OCSP/CRL) rather than let a withheld intermediate or omitted revocation response turn a `revoked` or `untrusted` ground truth into a softer `unknown`. This applies equally to the stapled long-term-validation material in `ltv` (section 7.5): stripping or withholding it MUST NOT turn a determinable `revoked` or `untrusted` verdict into `unknown`.

Rule 2 fires only under a **trusted** reference time: a validated signature-timestamp (section 3.6) establishes time T, and a credential validity window that T falls outside makes the signature `invalid` — an antedated `sigT` cannot hide it, because the derivation uses T, not `sigT`. Absent a validated timestamp the reference time is the self-asserted, untrusted `sigT`, so a `sigT` outside the validity window is ignored rather than taken as proof of out-of-window signing; a verifier MUST NOT present `sigT` as an attested signing time, and SHOULD warn when a signature reports `valid` yet its asserted `sigT` falls outside the window. Long-term validation — keeping a now-`expired` certificate's signature `valid` via a validated timestamp and stapled revocation — is specified in section 7.5; it moves only the `certCurrentlyExpired`/`signingTimeWithinValidity` derivations onto T, not the rules themselves.

### 3.9 Trust Anchors

A signature is trustworthy only relative to a **trust anchor the verifier configures** — never material supplied by the document. The only certificate material in the archive is the `x5c` chain in the (attacker-controllable) signature itself; treating it as self-authorizing is the defeat this section closes: otherwise an attacker self-signs a certificate naming any subject, signs the genuine content, and a verifier reports `valid`.

- A verifier MUST validate the `x5c` chain (leaf `x5c[0]` to a root) against a **verifier-configured trust store** — a set of trusted root certificates, or an equivalent trusted-list policy — supplied by the verifier's deployment. The trust store MUST NOT be derived from the document.
- **Derivation rule (normative).** If the chain has a valid path to a configured anchor, `chainResult` is `anchored`. If it has no such path — including a self-signed certificate, or a chain rooted at an untrusted CA — `chainResult` is `untrusted`. If the path cannot be evaluated (e.g. a required intermediate is unavailable), `chainResult` is `unknown`.
- A document MAY carry a trust-policy hint, but it is advisory: the authoritative anchor is always verifier-side.
- The **keyId** credential path (section 3.11) anchors a resolved key by the same principle — a verifier-configured pin on the specific `kid` (or, for `did:web`, its exact domain), never the DID *method* and never document-supplied material; a key that is not pinned is `untrusted`. `did:web` additionally authenticates its HTTPS resolution against a **Web-PKI trust store** — a second trust store, distinct from these signature anchors (sections 3.11, 8.5).
- The **WebAuthn** credential path (section 6) anchors by the same pin principle — a verifier pin on the self-asserted `publicKey` (plus the configured signing rpId and the UV policy); an unpinned or policy-unmet assertion is `untrusted`. `credentialId` is advisory, never the anchor.

### 3.10 Identity Authority

The authoritative signer identity is the **subject** (and subject-alternative names) of the validated leaf certificate `x5c[0]` — not any document-supplied field.

- A verifier MUST NOT treat `signer.name`, `signer.email`, or any other `signer` field as authenticated, and MUST NOT present them as the signer's identity in preference to the certificate subject. (Forging `signer.name` is otherwise free.)
- The signing certificate is already bound by the signature: `x5c` is part of the signed protected header (section 3.4), so substituting any certificate changes the signing input and breaks verification (rule 1). The header additionally carries `x5t#S256`, which MUST equal `BASE64URL(SHA-256(DER(x5c[0])))` — the unpadded base64url SHA-256 of the DER bytes `x5c[0]` decodes to — as a JAdES-conformant, fail-fast consistency check identifying the leaf certificate. A verifier MUST reject (`invalid`) a signature whose `x5t#S256` does not match `x5c[0]`.
- For the **keyId** credential path there is no certificate subject; the authoritative identity is the resolved-and-anchored `kid` itself (the DID, or its resolved controller — section 3.11). The same advisory rule applies: a verifier MUST NOT present `signer.name`/`email` as the identity in preference to the DID. A DID that appears only as an advisory identifier elsewhere — a `signer` field, or a provenance/author `identifier` — is **not** authenticated by being named; only a signature's resolved-and-anchored credential carries authenticated identity.
- For the **WebAuthn** credential path the authoritative identity is the verifier's binding of the **pinned `publicKey`** (section 6). `credentialId` and `signer` fields are advisory only — a verifier MUST NOT present them as the authenticated identity.
- **In-archive editorial and collaboration metadata is advisory, never authenticated.** The same principle governs everything an editor or reviewer writes into the archive: a core annotation's `author`/`content` (`security/annotations.json`), a collaboration comment's, suggestion's, or change's `author`/`content`/`status`/resolution (the collaboration extension), and a phantom cluster's or phantom's `author` (the phantoms extension). None of it sits in a signature scope or the manifest projection, so all of it is forgeable. The same advisory rule reaches the identity and approval claims the other extensions introduce, whether they sit in a side file or in signed content: a form-captured value — a `forms:signature` image, a consent checkbox (the forms extension) — an author name or ORCID (the academic extension), a `legal:signatureBlock` or `legal:caption` naming a signatory, notary, judge, or party (the legal extension), and document-level JSON-LD authorship (the semantic extension). A signature over the bytes that spell such a claim attests those bytes, not that the named party authored, signed, notarized, or approved anything; each extension's Integrity Status subsection states which of its constructs are advisory in this way. A verifier MUST NOT treat such a field as an authenticated identity or an authenticated decision — an `accepted` status, an approving comment, or an `author` named as a DID is **not** a signature, and an `author` that happens to be DID-shaped is not authenticated by being named (it is an advisory identifier, as above). To authenticate an editorial decision — an approval, a sign-off — place it in **signed content**, or bind the approver through a **required-signer policy** (Section 3.12); do not rely on an annotation or a workflow status. (An authenticated-annotation construction is out of scope for this version.)

### 3.11 keyId Resolution

A signature MAY carry a **keyId** (`kid`) in its protected header instead of an X.509 chain (`x5c`) — exactly one credential path per signature (section 3.4). The `kid` is a [Decentralized Identifier](https://www.w3.org/TR/did-core/) (DID). This version specifies two families: the **self-certifying** methods `did:key` and `did:jwk` (the verification key is encoded in the identifier itself), and the out-of-band-resolved **`did:web`** method (the key is fetched over HTTPS and bound by a signed `jkt` thumbprint — see *did:web resolution* below). The next subsections state the self-certifying rules; `did:web` adds the resolution, key-binding and transport obligations its fetched key requires.

**Resolution (self-certifying).** A verifier resolves a `did:key`/`did:jwk` `kid` by decoding the public key directly from the identifier — no network fetch: for `did:key`, the multibase-encoded key; for `did:jwk`, the base64url-encoded JWK. The decoded key MUST be usable with the header's `alg`; a mismatch makes the header inconsistent (`invalid`, section 3.8 rule 1). A `kid` SHOULD be a DID URL whose fragment selects a single verification method; for `did:key`/`did:jwk` the bare DID already resolves to exactly one key.

**Key binding (self-certifying).** The `kid` is part of the signed protected header, so substituting it changes the signing input and breaks verification (section 3.8 rule 1) — the identifier is bound to the signature exactly as `x5c` is. For these self-certifying methods the key *is* the identifier, so the signed `kid` also binds the key bytes themselves; no separate thumbprint is required, and a `jkt` MUST NOT be present (section 3.4). (The out-of-band `did:web` method returns a key that is **not** covered by the signature; it therefore binds the key with a signed `jkt` thumbprint — the keyId-path analogue of `x5t#S256` (section 3.10) — and checks the resolved key against it before acceptance, below.)

**Trust anchoring — derivation rule (normative).** A resolved key is `anchored` (section 3.8) **iff the specific `kid` is pinned in the verifier's configuration**: an allowlist of trusted DIDs (or trusted controllers/issuers) supplied by the verifier's deployment, never derived from the document. A verifier MUST NOT trust a DID *method* wholesale — anyone can mint a `did:key`/`did:jwk`, so trusting the method trusts everyone and is a fail-open. A self-certifying key that is not pinned is `untrusted`: the in-`kid` key material is self-asserted and, like in-archive certificate material (section 3.9), is never self-authorizing — otherwise an attacker mints a DID, signs the genuine content, and a verifier reports `valid`. If the `kid` cannot be parsed or decoded into a usable key, `chainResult` is `unknown`.

**Validity and revocation.** A self-certifying `did:key`/`did:jwk` key carries no validity window and no revocation responder:
- It has no `[notBefore, notAfter]`, so it is never `expired`, and a signing time is never "outside validity" on this ground alone. By this rule the section 3.8 inputs are `certCurrentlyExpired = false` and `signingTimeWithinValidity = true` — a stated derivation, not a vacuous default.
- Its revocation is governed entirely by the verifier's pin: a still-pinned key's `revocationStatus` is `good`, and an un-pinned key is already `untrusted` at the trust-path step (so revocation is never reached). Because the pin is current, verifier-controlled, and document-independent, treating an anchored self-certifying key as `good` is not a fail-open. To "revoke" such a key the verifier removes it from the allowlist; there is no OCSP/CRL analogue. This is a documented limitation of self-certifying credentials (`did:web`, below, has a genuine deactivation channel).

**did:web resolution.** A `did:web` key is fetched, not encoded, so it carries obligations the self-certifying methods do not. A verifier:

- **Resolves over validated HTTPS.** `did:web:<domain>` resolves to `https://<domain>/.well-known/did.json`; `did:web:<domain>:<a>:<b>` to `https://<domain>/<a>/<b>/did.json` (a `%3A`-encoded port is permitted in the domain). Resolution MUST use HTTPS with the server certificate validated against the verifier's **Web-PKI trust store** — a store distinct from the signature trust anchors (section 3.9). A verifier MUST reject `http://`; MUST NOT resolve a host that is an IP-literal, `localhost`, `*.local`, or that resolves to a private, loopback, or link-local address (an SSRF defence — the verifier fetches an identifier-controlled URL); and MUST NOT follow a redirect to a different origin (a cross-origin redirect is a resolution failure, and the *pinned* name — not the redirect target — always governs anchoring). To resist DNS rebinding it SHOULD pin the resolved address for the connection and re-check it against the deny ranges. These are verifier obligations the conformance gates cannot execute (section 8.5).

- **Obtains the intended key by thumbprint.** The signed `jkt` is the [RFC 7638](https://www.rfc-editor.org/rfc/rfc7638) SHA-256 thumbprint (for OKP/Ed25519 keys, the member set is [RFC 8037](https://www.rfc-editor.org/rfc/rfc8037) §2) of the signing key. A verifier MUST select the resolved verification method whose key thumbprints to `jkt`, recomputing the thumbprint over the **canonical** key — the required JWK members only (`{crv,kty,x,y}` for EC, `{crv,kty,x}` for OKP, `{e,kty,n}` for RSA), lexicographically ordered, no whitespace — never by hashing the served bytes verbatim (RFC 7638 §3.1). A verification method MAY publish its key as `publicKeyJwk` or `publicKeyMultibase` (the latter is converted to a JWK before thumbprinting); a method whose key cannot be expressed as a supported JWK is treated as non-matching. The `jkt` is authoritative: a `kid` fragment, if present, is only a resolution hint, and a verifier MUST NOT accept a fragment-named key whose thumbprint differs from `jkt`. The selected method's `controller` MUST be the resolved DID itself (an absent `controller` defaults to the document subject); a method controlled by a third party is not the signer's key.

- **Binds the key (derivation rule, normative).** Because `jkt` is signed, it binds the key that out-of-band material cannot: substituting the served key changes its thumbprint, which then no longer matches. If **no** served verification method matches `jkt` — resolution failed, the key was rotated away, or a different key is served — the credential is **key-unavailable**: `chainResult` is `unknown` (state `unknown`, section 3.8), never `invalid` (a verifier cannot prove forgery without the key) and never `valid` (fail-closed). The signature is verified only once the matching key is in hand; key-unavailability is carried solely by `chainResult`, so rule 1 never misfires. Only the **current** DID document is testable, so a key rotated away — rather than retained in the document — makes a historical signature `unknown` (the did:web analogue of long-term validation). A validated signature-timestamp (section 3.6) bounds *when* such a signature existed, but, absent retained historical DID-document material, does not re-establish a rotated-away `did:web` key or an un-pinned self-certifying/WebAuthn credential; historical resolution of those is not provided.

- **Anchors to a pinned DID or domain (derivation rule, normative).** A resolved-and-matched key is `anchored` **iff the specific DID, or its exact domain, is pinned in the verifier's configuration** — never the `did:web` method as a whole (that trusts any domain holder: a fail-open). A trusted-domain policy anchors only DIDs under that exact host and port. Pin comparison is exact: the DID allowlist matches the full `kid` byte-for-byte (ignoring any fragment); a domain policy matches the ASCII-lowercased, percent-decoded host and the port exactly (no implicit `:443`). An unpinned key is `untrusted`. As in section 3.9, the anchor is always verifier-side and never derived from the document.

- **Revocation (derivation rule, normative).** A `did:web` DID document MAY be **deactivated**. `revocationStatus` is `revoked` **only** when the resolved document is explicitly `deactivated: true`; an otherwise-resolvable, non-deactivated document is `good`. A document that is unreachable, or whose matching key is merely absent, is *not* `revoked` — it is key-unavailable (`unknown`, above). Because the document is served by the same origin as the key, `deactivated` is suppressible by a malicious or coerced origin: it is present-tense, advisory-grade revocation — weaker than OCSP/CRL — and, lacking trusted time, cannot answer "was it deactivated at signing time."

- **Validity window.** A `did:web` key carries no `[notBefore, notAfter]` (its lifecycle is rotation/deactivation), so — as for the self-certifying methods — `certCurrentlyExpired = false` and `signingTimeWithinValidity = true` (section 3.8).

### 3.12 Signature Set Integrity

Sections 3.7–3.11 decide each signature **in isolation**. A per-signature state cannot, by construction, attest that the signature *set* is complete: the signatures are an independent array, and removing one leaves the others verifying unchanged. So an attacker who **strips** a signature (delete the stronger signer, keep a weaker one), **downgrades** the set (leave only a content-only or draft-era signature), or **shadows** it (add a forged signature beside the genuine ones to imply co-signing) is not detected by the per-signature machine. This section binds the set against stripping and downgrade; a shadow (added) signature is separately denied any required slot, since a forgery cannot reach `valid` under a matching pinned credential (the satisfaction rule below) — the mechanism denies it a slot rather than removing it from the array.

**Mechanism — a signed required-signer set.** A document MAY declare a `signaturePolicy` in its manifest whose `requiredSigners` array lists the credentials that MUST each have a valid signature present. The policy is part of the **manifest projection** (section 9.7), so every manifest-covering signature signs it: while any such signature survives, the required-signer set is authenticated and tamper-evident, and an attacker cannot remove a required signer (the survivors still declare it required) nor edit the set (that breaks each survivor's `scope.manifest`). Because a signature cannot sign itself, this is the only way a set of independent signatures can declare its own expected membership without a designated counter-signer or a signing order.

**Required-signer entries.** Each entry names a credential in **authenticated** terms — the identity a verifier establishes cryptographically (section 3.10), never an advisory `signer` field — carrying exactly one identity kind, each bound to exactly one credential path:

| Kind | Credential path | Matched against |
|------|-----------------|-----------------|
| `did` | keyId (section 3.11) | the signature's signed `kid`, compared fragment-stripped and byte-for-byte |
| `x5tS256` | X.509 (section 3.10) | the signature's signed `x5t#S256` leaf-certificate thumbprint |
| `jkt` | WebAuthn (section 6) | the RFC 7638 thumbprint of the assertion's `publicKey` |

Matching is **path-discriminated**: a `did` entry is satisfiable only by a keyId signature, `x5tS256` only by X.509, `jkt` only by WebAuthn. This is deliberate — a `jkt` and a `did:web` key can both be RFC 7638 thumbprints over a JWK, and without the path discriminator a WebAuthn key whose thumbprint collided with a `did:web` key could satisfy the wrong slot. A verifier MUST reject a malformed entry (none, or more than one, identity kind).

**Satisfaction rule (normative).** A required signer is **satisfied** if and only if some present signature (i) is on the entry's credential path, (ii) matches the entry's identity under that path's comparison — the authenticated identity a verifier derives for the signature (for the keyId path, the `kid` compared fragment-stripped and byte-for-byte, section 3.11; normalization happens before the byte match, not within it), and (iii) has state `valid` (section 3.8). `valid` already subsumes anchored, unrevoked and unexpired, so a present-but-`untrusted`/`unknown`/`expired`/`revoked`/`invalid` signature — the downgrade case — does **not** satisfy a slot. The set is **stripped** if any required signer is unsatisfied, and a verifier MUST reject a stripped `frozen` or `published` document. Two present signatures matching one required entry satisfy it once (no double counting); because entries are de-duplicated and a signature carries one path-and-identity, a present signature satisfies at most one entry.

**A required signer is never a trust anchor.** A `requiredSigners` entry declares an *expectation*, not trust: the verifier's own pin (sections 3.9, 3.11, 6) still decides whether a matching signature is `valid`. An entry naming a credential the verifier does not pin can at best produce an `untrusted` signature, which does not satisfy it — so such a document is **unverifiable**, not trusted. In-document material is never self-authorizing, here as everywhere (section 3.9).

**Default posture.** Set-binding is **author-asserted**: a document that declares no `signaturePolicy` has the same (nonexistent) set integrity it had before this section — stripping an undeclared signer is undetectable. A verifier therefore MUST warn when a `frozen` or `published` document carries no `signaturePolicy`, so the absence of protection is visible rather than silent.

**Residual limitations (disclosed; not closed here).**
- **Optional signers.** Only the *declared required* signers are protected; stripping a signature outside the required set is not detected (it was, by definition, optional). To protect a signer, name it in `requiredSigners`.
- **Signing order and counter-signing.** The set declares *which* signers, not *in what order* — "notarized after signing" is not bound. A signature-timestamp (section 3.6) bounds *when* a signature existed but does not establish a binding order between signatures; counter-signature/order binding is not provided.
- **Late joiners.** The required set is fixed when the manifest is authored (and, for a `frozen` document, when it is frozen); a signer added afterwards cannot be a required signer without re-issuing the document (a new version).
- **State downgrade.** The required set is bound only by *manifest-covering* signatures. An attacker who rewrites `state` to `draft`/`review` and presents only a content-only signature escapes set-binding exactly as it escapes lifecycle binding (section 9.8) — a content-only signature attests no manifest field, including the policy. This is the lifecycle-downgrade limitation (section 9.8), not a new hole: a content-only signature attests no manifest field, and a signature-timestamp (section 3.6) binds a signature's existence, not the manifest state, so it does not close this escape. Closing it requires authenticating the manifest state against a content-only downgrade, which this version does not provide.
- **No trusted time on a given signature.** A required signer whose credential has since expired but whose signature carries a validated timestamp and stapled `good`-at-T is rescued to `valid` by long-term validation (section 7.5) and satisfies its slot. A required signer whose expired or revoked credential *lacks* such a timestamp — or whose revocation at T cannot be established — yields a non-`valid` state and thus an unsatisfied slot, so a legitimately-signed historical document then reads as `unknown`/stripped.

A conforming verifier MUST perform the satisfaction check above; like the rest of the trust model (section 8.5) the identity match itself is a verifier obligation a structural conformance gate cannot execute.

## 4. Encryption

### 4.1 Encryption Model

Documents can be encrypted for confidentiality. The encryption model supports:

- Symmetric encryption with password
- Asymmetric encryption with recipient public keys
- Hybrid encryption (asymmetric key wrapping + symmetric content)

### 4.2 Supported Algorithms

**Content Encryption:**
| Algorithm | Identifier | Status |
|-----------|------------|--------|
| AES-256-GCM | `A256GCM` | Required |
| ChaCha20-Poly1305 | `C20P` | Recommended |

**Key Wrapping:**
| Algorithm | Identifier | Status |
|-----------|------------|--------|
| ECDH-ES+A256KW | `ECDH-ES+A256KW` | Required |
| RSA-OAEP-256 | `RSA-OAEP-256` | Optional |
| PBES2-HS256+A256KW | `PBES2-HS256+A256KW` | Optional (password) |

### 4.3 Encryption Metadata

Location: `security/encryption.json`

```json
{
  "version": "0.1",
  "algorithm": "A256GCM",
  "keyManagement": "ECDH-ES+A256KW",
  "recipients": [
    {
      "id": "recipient-1",
      "name": "Jane Doe",
      "keyId": "did:web:example.com:jane",
      "encryptedKey": "base64...",
      "ephemeralPublicKey": "base64..."
    }
  ],
  "encryptedContent": {
    "iv": "base64...",
    "tag": "base64...",
    "path": "content/document.json.enc"
  }
}
```

### 4.4 Encrypted Files

When encryption is enabled:

- Content files are encrypted in place (`.enc` suffix)
- The manifest remains unencrypted (for metadata access)
- Dublin Core metadata can optionally be encrypted

### 4.5 Decryption Process

1. Parse encryption metadata
2. Identify recipient (by key ID or try each)
3. Unwrap content encryption key using recipient's private key
4. Decrypt content files using CEK
5. Verify authentication tags

## 5. Access Control

### 5.1 Overview

Access control defines what actions different users can perform:

- View content
- Print
- Copy text
- Add annotations
- Edit (if document is unfrozen)

### 5.2 Access Control Structure

```json
{
  "accessControl": {
    "default": {
      "view": true,
      "print": true,
      "copy": false,
      "annotate": true
    },
    "permissions": [
      {
        "principal": "user:jane@example.com",
        "grants": {
          "view": true,
          "print": true,
          "copy": true,
          "annotate": true,
          "edit": true
        }
      }
    ]
  }
}
```

**Enforcement Model:** Access control lists (ACLs) defined in this extension are declarative and advisory. They express the document author's intended access restrictions but do not enforce them cryptographically on their own. For enforceable access control, combine ACLs with the encryption capabilities defined in this extension (see Section 4 — Encryption). When encryption is applied, ACLs serve as metadata for key distribution and access management. Without encryption, ACLs function as guidance for compliant implementations, which SHOULD respect the declared permissions.

### 5.3 Permission Types

| Permission | Description |
|------------|-------------|
| `view` | View document content |
| `print` | Print document |
| `copy` | Copy text to clipboard |
| `annotate` | Add comments/annotations |
| `edit` | Edit content (draft only) |
| `sign` | Add signatures |
| `decrypt` | Decrypt if encrypted |

### 5.4 Principals

Principals identify who permissions apply to:

- `user:email@example.com` - Specific user
- `group:team-name` - Group of users
- `role:reviewer` - Role-based
- `*` - Everyone (public)

## 6. WebAuthn/FIDO2 Integration

### 6.1 Overview

A signature MAY be a **WebAuthn/FIDO2 assertion** instead of a JWS (section 3.4) — a third credential path. Its purpose is narrow but real: it lets a signer use a **non-exportable hardware authenticator** (a passkey or security key that never releases its private key, so a `did:jwk` over that key is impossible — the authenticator only ever produces assertions).

A WebAuthn authenticator signs `authenticatorData || SHA-256(clientDataJSON)`, not `JCS(scope)`. CDX binds the document by setting the assertion's **challenge** to the scope commitment:

```
clientDataJSON.challenge = BASE64URL(SHA-256(JCS(scope)))
```

so a WebAuthn signature attests the same `JCS(scope)` bytes the X.509/keyId paths sign — it is a scoped, manifest-covering signature (the `scope.manifest` coverage requirement for `frozen`/`published` documents, section 9.8, applies to the WebAuthn shape too).

The trust model is the **self-certifying model of section 3.11**: the credential's public key is self-asserted (carried as `publicKey`) and is `untrusted` unless the verifier **pins** it. A WebAuthn credential is, in effect, a `did:key` whose key lives in a FIDO authenticator. This framing is deliberate — it makes three honest limitations expected rather than surprising (section 6.4): **no liveness**, **no phishing resistance**, and **no authenticator-model assurance**.

### 6.2 Signature Structure

A WebAuthn signature carries a `webauthn` member in place of the JWS `protected`/`signature`; the two shapes are mutually exclusive (section 3.4):

```json
{
  "id": "sig-fido",
  "webauthn": {
    "algorithm": "ES256",
    "credentialId": "base64url… (advisory)",
    "authenticatorData": "base64url…",
    "clientDataJSON": "base64url…",
    "signature": "base64url…",
    "publicKey": { "kty": "EC", "crv": "P-256", "x": "base64url…", "y": "base64url…" }
  },
  "scope": { "documentId": "sha256:…", "manifest": {  } },
  "signer": { "name": "…" }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `algorithm` | Yes | COSE signature algorithm — `ES256` (MUST support), `ES384`, or `EdDSA` |
| `authenticatorData` | Yes | base64url authenticatorData (`rpIdHash` ‖ flags ‖ signCount ‖ …) |
| `clientDataJSON` | Yes | base64url of the **exact** clientDataJSON bytes the authenticator signed |
| `signature` | Yes | base64url WebAuthn signature over `authenticatorData ‖ SHA-256(clientDataJSON)` (ECDSA in ASN.1 DER) |
| `publicKey` | Yes | The credential's COSE public key **as a JWK** (EC P-256/P-384 or OKP Ed25519); the trust anchor when pinned |
| `credentialId` | No | base64url WebAuthn credential id — **advisory** routing hint, never the trust anchor |

The COSE public key is carried as a JWK so the pin reuses the same RFC 7638 thumbprint mechanism as `did:web` (section 3.11); the signing tool performs the one-time COSE→JWK conversion.

### 6.3 Verification

To verify a WebAuthn signature and compute the section 3.8 inputs:

1. **Binding** (→ `headerConsistent`; failure makes the state `invalid`). Decode `clientDataJSON` and hash its **exact stored bytes** for step 3; **parse** — never re-serialize, as clientDataJSON is not canonical — to read `type`, `challenge`, `origin`. Require `type == "webauthn.get"`; require the parsed `challenge` to equal `BASE64URL(SHA-256(JCS(scope)))` recomputed from the displayed `scope` (constant-time compare); require `algorithm` to agree with `publicKey`; and require the **User-Present (UP)** flag in `authenticatorData` (a `get` assertion with UP=0 is malformed). The challenge hash is always SHA-256, independent of `algorithm`.
2. **Validity.** A WebAuthn credential has no `[notBefore, notAfter]`, so `certCurrentlyExpired = false` and `signingTimeWithinValidity = true`.
3. **Signature** (→ `signatureVerifies`). Verify the assertion `signature` over `authenticatorData || SHA-256(clientDataJSON)` (the stored bytes) under `publicKey`. ECDSA signatures are ASN.1 DER, not the raw r‖s of JOSE.
4. **Trust** (→ `chainResult`). `anchored` iff the verifier **pins** `publicKey` (by RFC 7638 thumbprint) **and** the assertion's `rpIdHash` matches the verifier's configured signing rpId **and** the **User-Verified (UV)** flag satisfies policy. A genuine but unpinned or policy-unmet assertion is `untrusted` — never `invalid` (it is a real signature the verifier's policy does not accept, exactly as an unpinned `did:key` is `untrusted`, section 3.11).
5. **Revocation** (→ `revocationStatus`). No responder; governed by the pin (an anchored credential is `good`; an unpinned one is already `untrusted`). To revoke, the verifier un-pins the key.

Combine via the production rules of section 3.8.

### 6.4 Trust Model, Identity, and Limits

- **Identity** is the verifier's binding of the **pinned `publicKey`** (section 3.10). `credentialId` and any `signer` field are advisory and MUST NOT be the authenticated identity.
- **origin / rpId is domain separation, not phishing resistance.** A document signer is not a web browser, so nothing independent constrains the `origin`/`rpId` a signing tool writes — an attacker forging an assertion sets them freely. A verifier checks `rpIdHash` against its configured signing rpId only to keep a CDX-signing credential **scoped apart from web-login credentials**; it provides no phishing resistance, and this profile claims none.
- **No liveness.** The challenge is a deterministic function of the document, so the assertion is reusable, not a one-time server nonce. Lifting an assertion onto a document with the **same** `JCS(scope)` succeeds — the identical, accepted property of every detached signature (section 3.1); lifting onto a **different** scope fails the challenge binding (`invalid`). There is no proof a live user approved a session; revocation is un-pinning, and (lacking trusted time) there is no historical validity.
- **The signature counter is not interpreted.** With no server session there is no monotonic state to compare against (and many passkeys report 0), so a verifier MUST NOT attempt clone detection from it.
- **Backup eligibility.** The `BE`/`BS` flags mark a **syncable** (multi-device) credential: a backup-eligible key is **not** hardware-bound — its private key may live in a cloud keychain across the signer's devices. A verifier policy MAY require `BE = 0` for high assurance; this profile does not imply hardware binding for a synced passkey.
- **Attestation is deferred.** This version verifies assertions only, so it learns nothing authenticated about the authenticator model (AAGUID, FIDO certification level). Requiring certified hardware needs attestation (AAGUID + the FIDO Metadata Service), a subsequent version.
- **Fields not honored.** The `appid` extension (legacy U2F), `tokenBinding`, and any `clientDataJSON.crossOrigin: true` are not used; authenticatorData extensions (the `ED` flag) are ignored.

## 7. Key Management Guidance

### 7.1 Key Generation

- Use cryptographically secure random number generators
- Generate keys of appropriate strength (256-bit for symmetric, P-256 or stronger for ECDSA)
- Protect private keys appropriately

### 7.2 Key Storage

Recommendations:
- Use hardware security modules (HSM) for high-value keys
- Use operating system keystores where available
- Never store private keys in documents

### 7.3 Key Rotation

- Plan for certificate expiration
- Support multiple valid certificates during rotation
- Maintain audit trail of key changes

### 7.4 Revocation and Validity (Verifier Obligations)

For the signing-key owner, if a key is compromised:
1. Revoke the certificate (publish to CRL or OCSP)
2. Re-sign documents with a new key if needed
3. Record the revocation in the audit trail

A **verifier** MUST, for each signature — this is what makes revocation meaningful (section 3.8):
- Check the certificate validity window; the certificate is expired when the verification-time clock is past `notAfter`.
- Determine revocation status via OCSP or a CRL — online against the issuing CA, or from revocation material stapled with the signature — yielding `good`, `revoked`, or `unknown`.
- **Derivation rule (normative).** A `good`/`revoked` determination requires a trusted assessment time. Absent a validated signature-timestamp (section 3.6), the reference time is the untrusted `sigT`, so a **stapled** OCSP/CRL response — whose freshness window cannot then be established — MUST be treated as `unknown`, never `good`. An online check against a live responder (which carries its own trusted clock) MAY yield `good`/`revoked`; and with a validated timestamp the trusted time T dates a stapled response (section 7.5).

For a self-certifying **keyId** credential (`did:key`/`did:jwk`, section 3.11) or a **WebAuthn** credential (section 6) there is no certificate validity window and no revocation responder: revocation is governed entirely by the verifier's pin — an anchored (still-pinned) key is `good`, and an un-pinned key is already `untrusted` at the trust-path step (section 3.8). To revoke such a key the verifier removes it from its allowlist. A `did:web` DID instead has a deactivation channel: a resolved document with `deactivated: true` is `revoked`; but, served by the key's own origin, it is suppressible and present-tense (advisory-grade, not an OCSP/CRL — section 3.11).

A verifier that cannot perform these checks MUST NOT report `valid` (section 3.8). Long-term validation — verifying offline after the certificate expires, using stapled revocation material dated by a validated timestamp — is specified in section 7.5.

### 7.5 Long-Term Validation (LTV)

A signature must remain verifiable after its certificate expires and after the issuer's online revocation responders go away. Long-term validation captures, alongside the signature, the material to re-establish "this signature was valid when it was made" offline, dated by a validated signature-timestamp (section 3.6).

**The LTV container.** A signature MAY carry an **unsigned** `ltv` object:

```json
{
  "ltv": {
    "certificates": ["<base64 DER>"],
    "revocationInfo": { "ocsp": ["<base64 DER>"], "crl": ["<base64 DER>"] }
  }
}
```

- `certificates` — stapled DER certificates (intermediates, OCSP-responder certs) for offline path building.
- `revocationInfo.ocsp` / `revocationInfo.crl` — stapled DER revocation responses.

It is **unsigned** because it is added after signing and verified independently against the verifier's trust roots; it is not part of `scope`, so it does not affect the document ID or the manifest projection. Stapling is **fail-closed**: missing material only weakens a verdict (to `unknown`/`expired`), never strengthens one, and forged material fails chain/response validation. Stripping it MUST NOT soften a determinable adverse verdict (section 3.8). (The `ltv` and `timestamp` material in the `signed-document` example is illustrative structure only — placeholder base64, not verifiable DER.)

**Revocation under trusted time (lifts the section 7.4 rule).** Section 7.4 treats a stapled OCSP/CRL as `unknown` while the reference time is the untrusted `sigT`. Once a signature-timestamp validates, the trusted time **T** dates the response: a stapled OCSP/CRL yields `good` or `revoked` — instead of `unknown` — iff (a) it is from the responder/issuer for the credential, (b) its validity interval contains T (`thisUpdate ≤ T ≤ nextUpdate`, within a configured tolerance), and (c) its own signature validates to the responder/CRL-issuer chain anchored in the signature trust store (section 3.9). A response showing the credential `revoked` at T yields `revoked` and MUST NOT be softened. The OCSP responder certificate is relied on per RFC 6960 (`id-pkix-ocsp-nocheck` / short-lived responder certs); a verifier does not recurse into its revocation.

**The `expired → valid` upgrade.** With a validated timestamp placing the signature at T inside the certificate's validity window, and stapled revocation showing the credential `good` at T, a signature whose certificate has **since** expired remains `valid`: the `certCurrentlyExpired` input (section 3.8) is derived against the reference clock T, not `now`, so it is `false` and the expiry rule does not fire. Revocation stays a separate axis — if revocation at T is merely `unknown`, the signature is `unknown`, never `valid`.

**Where the chain bottoms out (and decays).** This version validates the signature-timestamp's TSA chain and revocation at **verification time** against the TSA store; it does not specify capturing the TSA certificate's own revocation for later offline replay. Consequently an LTV verdict resting on a timestamp whose TSA certificate later expires degrades to `unknown` until renewed. **Archive timestamps** — an ordered chain of timestamps, each covering the prior signature, validation material and timestamps, defeating algorithm aging and renewing the TSA chain — are a subsequent version; the `ltv` container does not yet carry them, and a signature whose timestamp hash or TSA algorithm later weakens is not automatically rescued.

## 8. Security Considerations

### 8.1 Algorithm Agility

The format supports algorithm agility to handle:
- Future cryptographic advances
- Algorithm deprecation
- Post-quantum migration

Implementations SHOULD warn about weak algorithms and support migration.

### 8.2 Post-Quantum Readiness

ML-DSA (formerly Dilithium) is included for post-quantum readiness. Hybrid signatures (classical + PQC) are supported.

### 8.3 Timing Attacks

Implementations MUST use constant-time comparison for cryptographic operations.

### 8.4 Side-Channel Attacks

Use well-audited cryptographic libraries that protect against side-channel attacks.

### 8.5 Trust Model Scope and Limits

This extension specifies an **X.509 trust model**: a signature is trustworthy only if its `x5c` chain validates to a verifier-configured trust store (section 3.9). It also specifies a self-certifying **keyId** path (`did:key`/`did:jwk`, section 3.11): such a key is trustworthy only if the specific `kid` is pinned in the verifier's configuration — never on the strength of the in-document identifier alone. The `did:web` method additionally resolves its key over HTTPS, so its trust depends on the **Web-PKI for the pinned domain** — any certificate authority able to issue for that domain, together with the domain's DNS and hosting, joins the trusted base. A `did:web` signature is therefore **weaker than a pinned `did:key`** (a key fixed in the identifier with no live dependency), and deployments SHOULD treat the two accordingly. It also specifies a **WebAuthn** path (section 6): the `did:key` pin model carried via a FIDO assertion, so it can be signed by a non-exportable hardware authenticator — but it adds **no liveness** (the deterministic challenge makes the assertion reusable, not one-time), **no phishing resistance** (a document signer has no browser-enforced origin; `rpId` gives only domain separation), and **no authenticator-model assurance** (attestation is deferred), as section 6.4 states in full. The format is *aligned* with the JAdES/eIDAS model but is **not** CMS/PAdES wire-conformant — it does not interoperate with PDF signature verifiers, and the signer-identity, algorithm, certificate, keyId, and WebAuthn bindings are enforced as **verifier obligations** (sections 3.7–3.11, 6), not as signed CMS attributes.

The conformance gates in this repository check the *structure* of signatures and the *production rules* that map verification verdicts to states (section 3.8); they cannot, and do not, execute a real trust store, certificate-path validation, revocation lookup, DID resolution / key-decoding, keyId-pin (allowlist) evaluation, the HTTPS/TLS validation and SSRF/redirect defences `did:web` resolution requires, the `jkt`-to-resolved-key thumbprint match, or the WebAuthn credential pin and rpId/UV policy (the WebAuthn signature, its scope-challenge binding, and the User-Present flag *are* checked; the credential pin and the rpId/UV policy are not). Those are normative obligations a conforming verifier MUST perform and that an external conformance suite can target. A green build does not certify cryptographic verification.

Trusted timestamps (section 3.6) and long-term validation (section 7.5) are enforced the same way: the gates do not parse an RFC 3161 token, validate a TSA chain to the TSA trust store, or check stapled OCSP/CRL freshness against the trusted time — only the imprint binding `H(protected || "." || signature)` and the state derivations are gated. A signature-timestamp bounds a signature's existence **from above only**: a signer who backdates `sigT` while the credential is still valid and timestamps promptly cannot be distinguished from one who signed at `sigT` (a lower bound requires a pre-signing content commitment, out of scope). The `ltv` container is unsigned and a verifier SHOULD bound its size; archive-timestamp renewal for algorithm aging is not yet specified, so a signature whose timestamp algorithm later weakens is not automatically rescued. A validated `(signature, token)` pair inherits the deterministic-signature replay property (section 9.8): it is reusable on any archive with the same `JCS(scope)`.

Each signature's state is **per-signature**: it does not by itself attest that the signature *set* is complete. A document MAY bind the set with a declared required-signer policy (`signaturePolicy`, section 3.12), which a verifier MUST enforce — where one is present, stripping or downgrading a *required* signer is detected. This is **author-asserted**: a document that declares no policy has no set integrity (a verifier MUST warn on a `frozen`/`published` document with none), and even with one, stripping an *optional* signer, signing order, and a whole-manifest state downgrade remain out of scope (section 3.12): a content-only presentation attests no manifest field, and a signature-timestamp (section 3.6) binds a signature's existence, not the manifest state, so it does not by itself close the state-downgrade escape. The required-set satisfaction check is itself a verifier obligation the conformance gates cannot execute (they run no real trust evaluation), exactly as for the chain, revocation and pin checks above.

### 8.6 Modelling Secure Practice

The `signed-document` example in this repository is **illustrative**. Only its WebAuthn assertion carries a real, verifying signature; the X.509 and keyId entries carry **non-verifying placeholder** `signature` and `x5c` bytes — they show the envelope *shape*, not a validatable signature. The signing-input construction itself (`BASE64URL(protected) + "." + JCS(scope)`, section 3.4) is exercised against a freshly generated, genuinely-verifying signature by the conformance checks, so the construction is real even where a committed example signature is not.

A production document MUST do what the placeholders cannot:

- **Certificate profile.** The X.509 leaf MUST be a proper end-entity certificate — `basicConstraints` `CA:FALSE`, a `keyUsage` asserting `digitalSignature`, and an `extendedKeyUsage` appropriate to document signing — issued by a CA the verifier trusts (section 3.9). A bare self-signed leaf is **`untrusted`**, not `valid`, unless the verifier explicitly pins it.
- **Identity is the credential, not the `signer` block.** The authenticated identity is the certificate subject, the resolved-and-anchored DID, or the pinned WebAuthn key (section 3.10) — never `signer.name`, `signer.email`, `signer.organization`, or a job title. The example deliberately carries no `title`: a "Chief Executive Officer" string is an authority claim bound by nothing, and presenting it as the signer's role is the misuse section 3.10 forbids.
- **A keyId is a real, resolvable key.** The example's `did:key` decodes to an actual Ed25519 public key; an undecodable identifier resolves to `unknown`, not a valid signer (section 3.11).
- **Trust is verifier-side.** None of the in-archive material — the certificate chain, a DID document, the `signer` fields, or annotations (section 3.10) — is self-authorizing; a verifier validates against its own configured trust, or reports a non-`valid` state.

## 9. Scoped Signatures

### 9.1 Overview

Every signature carries a `scope` object — the detached JWS payload — that makes explicit what it covers. The minimal scope binds the document ID (semantic content) only; for use cases that require attesting to more (the manifest state, or the visual appearance of legal documents and notarized contracts), the scope additionally binds the manifest projection (Section 9.7) and/or precise-layout hashes.

### 9.2 Content-Only Signature

A content-only signature has a `scope` that binds just the document ID:

```json
{
  "id": "sig-1",
  "protected": "eyJhbGci...",
  "signature": "MEUCIQDf9Ky7...",
  "scope": { "documentId": "sha256:contenthash..." }
}
```

### 9.3 Scoped Signature (Content + Layout Attestation)

A scoped signature's `scope` additionally binds the manifest projection and/or precise-layout hashes:

```json
{
  "id": "sig-2",
  "protected": "eyJhbGci...",
  "signature": "MEYCIQCa8Bx2...",
  "scope": {
    "documentId": "sha256:contenthash...",
    "layouts": {
      "presentation/layouts/letter.json": "sha256:layouthash..."
    }
  }
}
```

The `scope` object is serialized using JCS ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)) to produce deterministic bytes for signing.

### 9.4 Scope Object Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `documentId` | string | Yes | The signed, authoritative document ID. It MUST equal the recomputed `manifest.id` (Section 3.7 step 1). The unsigned top-level `signatures.documentId` is an advisory copy that MUST also equal it but is never itself authenticated. |
| `manifest` | object | Conditional | The manifest projection (Section 9.7). REQUIRED on a `frozen` or `published` document; otherwise optional. |
| `layouts` | object | No | Map of layout path → layout file hash. Attests visual appearance. |

The `scope` object is **closed**: it is validated with `additionalProperties: false`, and a verifier MUST reject a scope carrying any member not defined here. New scope members may be introduced in future versions of this extension, but because the signature is computed over `JCS(scope)`, a signature's covered set is fixed at signing time — adding a member changes the signed bytes, so it does not retroactively extend a signature made before the member existed.

### 9.5 Verification Algorithm for Scoped Signatures

With `scope` always present, the scoped checks extend section 3.7 step 3:

   a. Verify the signed `scope.documentId` equals the recomputed document ID (`manifest.id`); the unsigned top-level `signatures.documentId` MUST also match but is advisory, never authenticated (Section 9.4)
   b. If `scope.manifest` is present, recompute the manifest projection from `manifest.json` (Section 9.7) and verify it equals `scope.manifest`
   c. If `scope.layouts` is present, verify each layout path exists and its file hash matches the declared hash
   d. The JWS signature is over the signing input `BASE64URL(protected) + "." + JCS(scope)` (section 3.4); the signature's trust evaluation is deferred per section 3.7

### 9.6 Use Case

In legal contexts, a notary signs with `scope` including the letter layout, attesting: "I certify this content rendered in this exact layout." Another signer might sign content-only if appearance is not relevant to their attestation.

### 9.7 Manifest Projection

The document ID binds only the document's semantic content. The rest of the manifest — the lifecycle state, the content and presentation part hashes, the required-extension set, and the lineage — is otherwise unauthenticated. The **manifest projection** is the canonical, signable representation of those security-relevant manifest declarations; a signature attests them by including the projection as `scope.manifest`.

The projection is a deterministic transform of `manifest.json`, serialized with JCS ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)) — the same canonicalization the document ID uses — so a signer and a verifier compute identical bytes. It is defined only once the document ID is fixed; a manifest whose `id` is `pending` (a draft) has no projection.

**Bound fields:**

| Field | Source | Notes |
|-------|--------|-------|
| `cdx` | `manifest.cdx` | Specification version (prevents a silent version downgrade) |
| `state` | `manifest.state` | Lifecycle state |
| `content` | `manifest.content` | Projected to `{path, hash}` |
| `presentation` | `manifest.presentation[]` | Each entry projected to `{type, path, hash}`; the default entry additionally carries `default: true`. Binds the presentation *declaration* (which parts, which is default), not visual rendering — visual attestation remains `scope.layouts` (Section 9.3) |
| `extensions` | `manifest.extensions[]` | Each entry projected to `{id, version, required}`; a required extension additionally carries its `config` |
| `lineage` | `manifest.lineage` | Bound verbatim |
| `signaturePolicy` | `manifest.signaturePolicy` | The required-signer set (Section 3.12). Each `requiredSigners` entry carries its single identity kind (`did`, `x5tS256` or `jkt`) verbatim; entries are sorted by JCS |

**Construction rules** (mirroring the document-ID canonical form, 06 §4.3):

- Absent or empty optional fields (`presentation`, `extensions`, `lineage`) are omitted, never materialized as `null` or `[]`.
- An explicit `null` (e.g. `lineage.parent: null`) is preserved.
- A non-default presentation carries no `default` member; the flag marks only the default entry (`default: false` is never materialized).
- A non-required extension's `config` is omitted; a required extension's `config` is bound, because a required extension's configuration can change how the document is interpreted.
- Arrays of declarations (`presentation`, `extensions`, `signaturePolicy.requiredSigners`) are sorted by the JCS serialization of each element, so authored order is not significant; the `lineage.ancestors` order (nearest-first) is significant and preserved.
- `signaturePolicy.requiredSigners` entries MUST be unique by identity, and the set MUST be non-empty — an empty set is forbidden so an *absent* policy and an *empty* policy are not both expressible. An absent `signaturePolicy` is omitted (a document with no policy has no set integrity; section 3.12).
- Keys and values obey the stored-byte invariants of 06 §4.3.2 (NFC, well-formed Unicode, safe integers).

The document ID is **not** part of the projection — it is carried separately by `scope.documentId`, which a verifier cross-checks against the recomputed `manifest.id` (Section 9.4).

### 9.8 Coverage and Negative Coverage

A signature's coverage is exactly:

- The **document ID** (semantic content) — always.
- The **manifest projection** (Section 9.7) — if and only if `scope.manifest` is present.
- The listed **precise layouts** — if and only if `scope.layouts` is present (Section 9.3).

A signature does **not** cover, in this version of the extension:

- Embedded **fonts** and other non-content assets (excluded from the document ID by design).
- The **bytes** of parts the manifest references by path only — metadata, provenance, phantoms, annotations — and of the `security` block. Only `content` and `presentation[]` carry hashes in the manifest and are bound by the projection.
- **Presentation files the manifest does not declare.** The projection binds the hash of each `presentation[]` entry the manifest *declares*; a document whose manifest omits `presentation` (or a particular entry) binds nothing about a presentation file present in the archive but undeclared. Only declared presentations are tamper-evident against a presentation-swap.
- **Layout files outside `scope.layouts`.** A `scope.layouts` attestation (Section 9.3) binds only the layouts it lists; an unlisted layout file is unbound even on a frozen document.
- The **complete set of signatures**, beyond the declared required set: a `signaturePolicy` (Section 3.12) binds the *declared required* signers against stripping and downgrade, but a signature still cannot attest that an *optional* signature was not removed, that signers signed in a particular order, or — where no policy is declared — anything about set completeness.
- Administrative fields with no integrity meaning: `created`, `modified`, and `hashAlgorithm` (redundant with the document-ID prefix).
- Auxiliary `content` integrity fields (`compression`, `merkleRoot`, `blockCount`) and the advisory `presentation[]` fields (`contentHash`, `generated`): the bound `content.hash` and `presentation[].hash` are authoritative, so these subordinate fields are not separately attested.
- A **non-required** extension's `config` (only a required extension's `config` is bound, Section 9.7), and **any manifest member not enumerated in Section 9.7**: the manifest's top-level object is not closed, so an unrecognized member is dropped from the projection rather than signed.

Implementations MUST NOT represent a signature as covering anything beyond the above.

**Archive identity and replay.** A signature's identity binding is `scope.documentId` (the semantic content) plus, when present, `scope.manifest` (the manifest projection) — there is **no** separate archive nonce, package id, or per-package salt, by design: signing is deterministic and re-packaging the same content and manifest into a new archive does not invalidate a signature (Section 3.1). Two consequences follow. First, a signature **cannot be transplanted** onto a *different* document: different content changes `scope.documentId`, and on a `frozen`/`published` document the mandatory `scope.manifest` (the coverage requirement below) binds the *declared* presentation set, so a swap of any declared presentation that keeps the content hash is caught — a presentation the manifest does not declare is unbound (the negative-coverage bullets above). Second, what is *not* prevented is **reuse of the same signature** on the same content and manifest — the deterministic signature is not one-time, and the WebAuthn challenge inherits this (no liveness; Section 8.5). Binding to a single archive instance beyond its content and manifest is out of scope precisely because re-packaging must remain valid.

**Coverage requirement.** Because a content-only signature leaves the manifest unauthenticated, the manifest projection is mandatory wherever the manifest is final:

- For a document in state `frozen` or `published`, every signature MUST include `scope.manifest`, and a verifier MUST reject the document if any signature omits it.
- For a document in state `draft` or `review`, a signature MAY be content-only; such a signature does not attest the manifest, and an implementation MUST surface that limitation rather than implying manifest coverage.

> **Lifecycle downgrade.** A content-only signature binds neither the lifecycle state nor any other manifest field, so it cannot establish that a document was not `frozen` or `published`. An attacker can take a frozen document, rewrite its manifest (including `state`), and present only a content-only signature over the unchanged content. A verifier MUST NOT represent a document's state — or any manifest field — as authenticated on the strength of a content-only signature, and SHOULD warn when a document is presented this way. A declared required-signer set (Section 3.12) binds the signature set against stripping and downgrade, but only through *manifest-covering* signatures: an attacker who rewrites `state` to `draft`/`review` and presents only a content-only signature escapes the policy exactly as it escapes lifecycle binding, because a content-only signature attests no manifest field, the policy included. A signature-timestamp (Section 3.6) binds a signature's existence, not the manifest state, so it does not close this gap; closing it requires authenticating the manifest state against a content-only downgrade, which this version does not provide.

## 10. Examples

### 10.1 Single Signature

```json
{
  "version": "0.1",
  "documentId": "sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
  "signatures": [
    {
      "id": "sig-1",
      "protected": "eyJhbGciOiJFUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sLi4ufQ",
      "signature": "MEUCIQDf9Ky7BpL5Rj9E8JH3YqKPvXxNmVhKD5bXc4Qz1A2wAiEA7HjKLm8NoPq...",
      "scope": { "documentId": "sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b" },
      "signer": { "name": "Jane Doe", "email": "jane@example.com" }
    }
  ]
}
```

### 10.2 Multiple Signers

```json
{
  "version": "0.1",
  "documentId": "sha256:3a7bd3e2...",
  "signatures": [
    {
      "id": "sig-1",
      "protected": "eyJhbGciOiJFUzI1NiIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sLi4ufQ",
      "signature": "MEUCIQDf...",
      "scope": { "documentId": "sha256:3a7bd3e2..." },
      "signer": { "name": "Author", "email": "author@example.com" }
    },
    {
      "id": "sig-2",
      "protected": "eyJhbGciOiJFUzM4NCIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sLi4ufQ",
      "signature": "MGQCMA...",
      "scope": { "documentId": "sha256:3a7bd3e2..." },
      "signer": { "name": "Approver", "email": "approver@example.com" }
    }
  ]
}
```
