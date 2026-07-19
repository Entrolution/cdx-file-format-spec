# Security Model

**Section**: Core Specification
**Version**: 0.1
**Maturity**: Draft

## 1. Overview

This document is the consolidated map of CDX's security model: the attacker it defends against, the guarantees it makes, the limitations it accepts, and where each is normatively specified. The mechanisms themselves live in the mechanism documents — the Security Extension, Document Hashing, the State Machine, Provenance and Lineage, Renderer Safety — and **those documents govern**: this one consolidates and cross-references, and where a summary here and a mechanism section could be read to disagree, the mechanism section is authoritative.

Two audiences are intended. A **reader or adopter** gets a single answer to "what does a CDX signature actually mean, and what does it not mean?" without archaeology across eight documents. A **security reviewer** gets the attacker model, the complete guarantee/limitation inventory, and the index of verifier obligations that a conformance build cannot execute — the natural scoping brief for an independent assessment.

## 2. Attacker Model

The model defends against an attacker with **full control of the archive**:

- The attacker can create, modify, re-package, truncate, or re-order any byte of a CDX file — the manifest, content, presentation, assets, signatures, encryption metadata, provenance, and every side file — and can deliver the result over any channel.
- The attacker may hold **their own** credentials, including ones the verifier legitimately pins (a colleague inside the same trust domain), and may freshly sign anything with them.
- The attacker can obtain and replay any artifact that ever legitimately circulated (an earlier lifecycle version, a draft-stage archive, a detached signature).

The model assumes the attacker **cannot**:

- Forge a signature without the credential's private key, break the hash function, or defeat the AEAD — cryptography is assumed sound, except where a section explicitly analyzes algorithm compromise (the hybrid profile, Security Extension section 8.2) or algorithm aging (Security Extension section 8.5).
- Tamper with the **verifier's configuration** — the trust stores, pins, and policy are trustworthy and document-independent (Security Extension section 3.9). In-document material is never self-authorizing; a verifier whose trust store is attacker-controlled is outside every guarantee.
- Obtain an honest party's signature over attacker-chosen content — honest signers sign what they intend.

The defender is a **conforming consumer**: it performs the load-time validation and failure dispositions of State Machine section 5.4 and the verifier obligations of the Security Extension (section 8 below).

## 3. Trust Foundations

Four commitments generate most of the model — and most of its accepted limitations follow from them rather than from unfinished work:

1. **Nothing in-document is self-authorizing.** Trust anchors, key pins, and TSA stores are always verifier-side configuration (Security Extension sections 3.6, 3.9, 3.11, 6.3). Consequence: a self-signed chain, a freshly minted DID, or an unpinned WebAuthn key yields `untrusted`, never `valid`.
2. **Fail-closed.** `unknown` is never acceptance, and withheld or stripped material never softens a determinable adverse verdict (Security Extension section 3.8). Consequence: a verifier that cannot complete a check reports non-acceptance, not success.
3. **Deterministic, re-packagable signatures.** A signature binds an explicit scope — never an archive instance — so re-packaging identical content and manifest remains valid (Security Extension sections 3.1, 9.8). Consequence: signatures are reusable on identical scopes by design; there is no one-time nonce.
4. **Self-contained documents, no external infrastructure.** Verification requires no registry, log, or issuing service (Provenance and Lineage section 2.1 names the transparency-log alternative a deliberate non-goal). Consequence: freshness — "is this the latest presentation?" — is unanswerable from the file alone (section 6 below).

## 4. Integrity Domains

Every byte of a CDX archive falls in exactly one of three integrity tiers — the document hash, the manifest projection, or neither — and the tier decides what a signature says about it. The authoritative statements are:

- The **three-tier table** in the extensions overview (spec/extensions/README.md, "Integrity Status of Extension Data"), including the rule that tier-three data is advisory in every state and that identity or approval claims are advisory *even when their bytes are in the hash*.
- The **coverage and negative-coverage enumerations** of Security Extension section 9.8 — the exact list of what a signature covers and, just as normatively, what it does not.
- The **document-ID canonical form** (Document Hashing section 4.1) and the **manifest projection** (Security Extension section 9.7).

The recurring consequence, stated once here: **a signature attests bytes, never the truth of a claim those bytes spell**. An author name, an ORCID, a notary block, a form-captured "signature" image, or an `approved` status is not authenticated by a signature over its bytes (Security Extension section 3.10).

## 5. Guarantees and Non-Guarantees

Summary inventory; every row defers to the cited sections.

| Property | Provided? | Mechanism | Limits (disclosure) |
|----------|-----------|-----------|---------------------|
| Content integrity (semantic content is tamper-evident) | Yes, per valid signature | Document ID bound by every signature scope (Security Extension sections 3.1, 3.7) | Out-of-hash layers are outside it (tier table) |
| Signer authenticity (who signed) | Yes, against verifier-side trust | Chain/pin anchoring; credential is the identity (Security Extension sections 3.9–3.11, 6) | `signer.*` display fields are never authenticated (section 3.10) |
| Lifecycle-state & manifest binding | `frozen`/`published` only | Mandatory projection coverage (Security Extension sections 9.7–9.8) | Downgrade residual — reduced to replay/fresh-attestation/unsigned (section 6 below) |
| Signature-set completeness | Declared required set only | Signed `signaturePolicy.requiredSigners` (Security Extension section 3.12) | Author-asserted; optional-signer stripping undetected; no order binding (OQ-006) |
| Signing time | Upper bound only, with a validated timestamp | RFC 3161 over the signature (Security Extension section 3.6) | Backdating within a validity window is undetectable (section 8.5) |
| Long-term validity | Yes, with timestamp + stapled revocation | LTV (Security Extension section 7.5) | Decays without archive timestamps (roadmap) |
| Lineage / version history | Consistency-checked, proven-false rejected | Backwards resolution; REJECTED on cycles/forged tails (Provenance and Lineage section 3.3) | Child-asserted — descent is not *proved* (section 2.1); unresolvable is unverified, never endorsed |
| Document existence time | Upper bound, per validated proof | Provenance timestamps (Provenance and Lineage section 6) | Antedating undetectable (section 6.7); standalone blockchain type Experimental (section 6.4) |
| Confidentiality | Yes, when encrypted | AEAD + key wrapping (Security Extension section 4) | Misuse rules are load-bearing (sections 4.6, 8.7); composition rules (section 4.7) |
| Access control | Policy *integrity* only | Policy hash in the projection (Security Extension section 9.9) | Enforcement is advisory without encryption (sections 5.2–5.3) |
| Redaction / inclusion proofs | **Not yet** | cdx-bmt-1 tree specified and gated (Provenance and Lineage sections 4–5) | Root unbound by any signature — not trusted evidence (section 5.2; Experimental sections 5.3–5.4; roadmap) |
| Annotations, comments, approvals | **Not authenticated** | — | Advisory in every state (tier table; Security Extension section 3.10; OQ-005) |
| Freshness ("is this the latest?") | **Not provided** | — | Requires external infrastructure — deliberate non-goal (Provenance and Lineage section 2.1) |
| Rendered-content safety | **Not conferred by signing** | — | A signature attests authorship and integrity, never that content is safe to render — a signed `javascript:` URI is a signed code-execution primitive (Renderer Safety sections 1, 2.3) |
| Copy/print restriction (DRM) | **Not provided** | — | Permission names are workflow declarations (Security Extension section 5.3); DRM out of scope (OQ-004) |

## 6. The Lifecycle-Downgrade Residual

The model's most prominent accepted limitation, disclosed at Security Extension section 9.8 and State Machine section 5.4.2 (note 3), with the reduction argument carried in full in the section 9.8 reduction note. In summary:

- On a `frozen`/`published` document every signature covers the projection, so rewriting `state` orphans every frozen-era signature. Every presentation an attacker can still construct is one of exactly three: **reuse** of an honestly-made content-only signature (a freshness problem — foundation 4), a **fresh content-only attestation under the minting party's own pinned credential** over genuine content (honest identity, unauthenticated state), or **unsigned content** (no claim at all).
- In every case the load-bearing guarantee holds: **tampered content is never presented as signed, and no honest party is impersonated.**
- The considered-and-rejected hardening (binding the projection into review-state signatures) is recorded with rationale in the design-decisions register (DD-021); closing the replay case is external-infrastructure work, on the deferred-capabilities roadmap.

## 7. PDF Signature Attack Classes and CDX

*This section is informative.* The introduction motivates CDX partly by PDF's signature attack history; this table makes the comparison concrete. Each row names a published attack class against signed PDFs, the CDX mechanism that forecloses the class, and the honest residual. "Foreclosed" means the *class* does not arise structurally — not that implementations cannot have bugs (section 8).

| PDF attack class | The PDF weakness | CDX mechanism | Residual |
|------------------|------------------|---------------|----------|
| Incremental Saving Attack (ISA) — append an update that changes displayed content while the signed byte range still verifies | Signatures cover a byte range; the format permits appending updates outside it | No incremental-update mechanism exists; the document ID is recomputed over the *entire* canonical content, and any change breaks every signature (Document Hashing section 4.1; Security Extension section 3.7 step 1) | Out-of-hash annotation layers can change freely — but they are *disclosed* as advisory in every state (tier table), never presented as signed |
| Signature Wrapping Attack (SWA) — relocate or duplicate signed byte structures so the validator reads one view and the renderer another | Byte-range indirection; parser/renderer divergence over duplicate objects | No byte ranges: the detached payload is *recomputed* from the displayed scope (Security Extension section 3.4), and split-view carriers are rejected in every state — duplicate JSON keys, duplicate or disagreeing archive entries (State Machine section 5.4.3; Container Format section 3.5; Document Hashing section 4.3.2) | Verifier obligation to actually use strict parsing (section 8) |
| Universal Signature Forgery (USF) — malformed signature objects trick the validator into reporting valid | Validators fail open on unparseable signature structures | Fail-closed production rules: a malformed header or unverifiable signature is `invalid`; an unevaluable one is `unknown`, which is never acceptance (Security Extension section 3.8) — and the rules are mechanized and gate-pinned | Implementation quality; the state machine is testable but not self-enforcing |
| Shadow attacks (Hide / Replace / Hide-and-Replace) — content prepared before signing is revealed or swapped after, without invalidating the signature | Signed documents carry sighted-but-hidden objects; post-signing updates re-wire which content displays | The rendered appearance is bound: a declared presentation's file hash rides the signed projection, and an **undeclared** presentation or layout MUST NOT be rendered as the document's appearance on a frozen/published document (Security Extension sections 9.7–9.8; State Machine section 5.4.2) | A `draft`/`review` presentation with a content-only signature binds no appearance (disclosed, Security Extension section 9.3); renderer discipline for out-of-hash overlays is a Renderer Safety obligation |
| Certification attacks (EAA / SSA) — abuse of PDF certification levels P1–P3 to inject annotations or signatures into a certified document | An in-document permission model meant to constrain modification, enforced inconsistently by validators | The class is avoided by refusing the model: CDX claims **no** in-document modification-permission enforcement (Security Extension sections 5.2–5.3); mutable layers are advisory by construction, and content mutation is governed by the hash, not permissions | The advisory layers *can* change — CDX makes that visible rather than pretending to prevent it |
| Advisory-identity spoofing — a validator surfaces a display name as the signer | Viewer UI trusts unauthenticated fields | The authenticated identity is only the validated credential; display fields MUST NOT be presented as the signer (Security Extension section 3.10) | UI obligation — a non-conforming viewer can still mislead |

Published sources for the PDF classes (informative): Mladenov, Mainka, Meyer zu Selhausen, Grothe & Schwenk, *"1 Trillion Dollar Refund: How To Spoof PDF Signatures"* (ACM CCS 2019 — ISA/SWA/USF, 21 of 22 viewers affected); Mainka, Mladenov & Rohlmann, *"Shadow Attacks: Hiding and Replacing Content in Signed PDFs"* (NDSS 2021); Rohlmann, Mladenov, Mainka & Schwenk, *"Breaking the Specification: PDF Certification"* (IEEE S&P 2021 — EAA/SSA).

## 8. Verifier Obligations Index

The conformance gates in this repository pin structure, canonical bytes, and decision rules; they **cannot execute the trust model**. A green build does not certify cryptographic verification (Security Extension section 8.5). The obligations a conforming verifier MUST perform, consolidated:

- **Certificate-path validation** to a verifier-configured trust store, with revocation via OCSP/CRL and the trusted-time derivation rules (Security Extension sections 3.9, 7.4).
- **keyId resolution and pinning** — did:key/did:jwk decoding, the did:web HTTPS resolution with its SSRF/redirect/rebinding defences, `jkt` thumbprint matching, and exact pin comparison (Security Extension section 3.11).
- **WebAuthn verification** — assertion checks plus the credential pin, signing rpId, and UV policy (Security Extension section 6).
- **TSA validation** for signature timestamps, and stapled-revocation freshness under trusted time for LTV (Security Extension sections 3.6, 7.5).
- **Required-signer satisfaction** — the path-discriminated identity match over `valid` signatures (Security Extension section 3.12).
- **Provenance-proof validation** — RFC 3161 token parsing, chain access for anchors, confirmation/finality policy (Provenance and Lineage section 6.7).
- **Decryption discipline** — AEAD tag before plaintext, nonce uniqueness, KDF parameters, and the sign+encrypt composition rules (Security Extension sections 4.5–4.7, 8.7).
- **Renderer discipline** — safe-URI handling, sanitization of rendered untrusted strings, and the active-content prohibitions (Renderer Safety sections 2–6).
- **Load-time dispositions** — the full failure-disposition table and its state-invariant REJECT rules (State Machine section 5.4).

This list is the intended scope of an external security review: each item is where a conforming-looking implementation can silently fail open.

## 9. Disclosure Index

Where every accepted limitation is normatively disclosed. This index is navigational; the cited sections govern.

| Disclosure | Where |
|------------|-------|
| Trust-model scope and limits (master statement) | Security Extension section 8.5 |
| Lifecycle downgrade + reduction argument | Security Extension section 9.8; State Machine section 5.4.2 note 3; DD-021 |
| Negative coverage (what a signature does not cover) | Security Extension section 9.8 |
| Advisory identity and approval claims | Security Extension section 3.10; extensions overview tier table |
| Signature-set residuals (optional stripping, order, late joiners) | Security Extension section 3.12 |
| Backdating / no lower time bound | Security Extension sections 3.6, 8.5; Provenance and Lineage sections 6.6–6.7 |
| Self-certifying credential revocation limits; did:web weaknesses | Security Extension section 3.11 |
| WebAuthn: no liveness, no phishing resistance, no attestation | Security Extension section 6.4 |
| Hybrid profile limits under single-algorithm break | Security Extension section 8.2 |
| LTV decay / missing archive timestamps | Security Extension sections 7.5, 8.5 |
| Merkle root unbound; proofs not trusted evidence | Provenance and Lineage section 5.2; DD-020 |
| Child-asserted lineage; provable descent a non-goal | Provenance and Lineage section 2.1 |
| Access control advisory without encryption | Security Extension sections 5.2–5.3, 9.9 |
| Signing never makes content safe to render; validation is not a security boundary | Renderer Safety sections 1, 2.3 |
| Deferred capabilities (aggregate) | README roadmap, "Deferred capabilities" |

## 10. References

*Informative.*

- Mladenov, V., Mainka, C., Meyer zu Selhausen, K., Grothe, M., Schwenk, J.: "1 Trillion Dollar Refund: How To Spoof PDF Signatures." ACM CCS 2019.
- Mainka, C., Mladenov, V., Rohlmann, S.: "Shadow Attacks: Hiding and Replacing Content in Signed PDFs." NDSS 2021.
- Rohlmann, S., Mladenov, V., Mainka, C., Schwenk, J.: "Breaking the Specification: PDF Certification." IEEE S&P 2021.
- RFC 6962: Certificate Transparency (the tagged Merkle construction cdx-bmt-1 follows).
