# Renderer Safety

**Section**: Core Specification
**Version**: 0.1

## 1. Overview

A CDX document is authored data that is ultimately handed to a renderer — a
browser, a PDF engine, a math typesetter, a native viewer. Much of that data is
author-controlled: link targets, form actions, entity URIs, avatar images,
mathematical source, style values, and embedded markup. A renderer that treats
this data as trusted exposes its host to cross-site scripting, content
injection, server-side request forgery, and denial of service.

Two properties of the format make renderer safety a normative concern rather
than an implementation detail:

- **Signing does not make content safe.** A signature attests *who authored*
  the content and that it has *not been altered* — never that it is *safe to
  render*. A `javascript:` URI carried in signed content is a *signed*
  code-execution primitive: the signature makes it more trustworthy to a naive
  renderer, not less dangerous. Integrity and safety are orthogonal.

- **Schema validation is an authoring guardrail, not a security boundary.** The
  schema-level constraints in this specification (the `safeUri` and
  `safeImageUri` definitions) reject the most common dangerous inputs at
  authoring time, but a renderer MUST NOT rely on a document having been
  validated. A renderer MUST enforce the rules below on every document it
  renders, validated or not (Section 2.3).

This section defines the renderer's obligations. It uses MUST/SHOULD/MAY per
RFC 2119. The obligations apply to *any* component that materializes
author-controlled data into an executable or rendered context; "renderer" below
means any such component.

## 2. Safe URIs

A *safe URI* is an author-controlled URI that a renderer may resolve as a link,
navigation, or action. The format constrains the relevant fields with a
shared, default-deny allowlist; renderers impose the same allowlist
independently.

### 2.1 Navigational and action URIs

Fields whose value is rendered as a hyperlink, a navigation target, or a
submitted action — core `link` mark `href`, the forms extension's form
`action`, the semantic extension's entity `uri` and cross-reference `target`,
and the presentation extension's cross-reference `target` — are constrained by
the shared `safeUri` definition (`anchor.schema.json#/$defs/safeUri`).

`safeUri` is an **allowlist**. It permits:

- `https:` and `http:` URLs (scheme matched case-insensitively),
- `mailto:` URLs,
- fragment references (`#blockId`, `#blockId/offset`),
- relative references (no scheme), including protocol-relative `//host` forms.

Every other scheme is rejected, including `javascript:`, `data:`, `file:`,
`blob:`, `vbscript:`, `tel:`, `ftp:`, and `ws:`. A renderer MUST reject (decline
to navigate to or execute) any value outside this allowlist, and MUST apply the
allowlist *after* performing whatever normalization it would apply before
navigation (trimming leading and embedded control characters and whitespace,
case-folding the scheme). A naive substring check is insufficient: an attacker
can split a dangerous scheme with a tab or newline (`java&#9;script:`) that the
renderer's URL parser will later strip. The renderer MUST normalize first, then
test the scheme against the allowlist.

The allowlist deliberately rejects schemes that are legitimate in some contexts
(`tel:`, `ftp:`, custom application schemes). A profile or application that
requires such a scheme MUST opt in explicitly and accept responsibility for the
resulting navigation; the default-deny posture is the conformant baseline.

### 2.2 Image sources

Fields whose value is rendered as an image source — the collaboration
extension's author `avatar`, and any extension image reference that mirrors the
core image block — are constrained by the shared `safeImageUri` definition
(`anchor.schema.json#/$defs/safeImageUri`).

`safeImageUri` permits the `https:`/`http:` URLs and relative references (no
scheme) that `safeUri` permits, and additionally permits `data:image/<subtype>`
payloads so that legitimate inline raster images (`data:image/png`,
`data:image/jpeg`, `data:image/webp`, `data:image/gif`) are not rejected. It
does not add the `mailto:` scheme. It does **not** permit any `data:image` SVG
subtype (such as `data:image/svg+xml`): an inline SVG is active content that can
carry script, so SVG delivered as a `data:` payload is excluded at the schema
level. A renderer MUST treat any SVG it renders —
external, `data:`, or inline — as untrusted markup and sanitize or sandbox it
per Section 3.1, regardless of how it arrived.

### 2.3 Validation is not a security boundary

A renderer MUST NOT treat schema validation as having sanitized a document. The
`safeUri`/`safeImageUri` constraints exist to catch dangerous values at
authoring time and to document intent; they are a regular expression over a
string and cannot anticipate every renderer-specific normalization. The
renderer is the security boundary: it MUST enforce the safe-scheme allowlist and
the sanitization rules of Section 3 on every document, including documents that
arrive without ever having been validated.

## 3. Sanitizing rendered untrusted strings

Several fields carry strings that are materialized into a rendering context that
can execute or reinterpret them. A renderer MUST sanitize or sandbox each of the
following before rendering.

### 3.1 Inline SVG and vector markup

SVG is active content: it can contain `<script>`, event-handler attributes
(`onload`, `onclick`, …), `<foreignObject>`, and external references. A renderer
that renders author-supplied SVG MUST either sanitize it (removing script
elements, event-handler attributes, `<foreignObject>`, and external fetches) or
render it in a sandbox that cannot execute script or reach the network. This
applies to SVG from any source — an external file, a `data:` payload, or markup
embedded in the document.

### 3.2 Mathematical notation

The academic extension carries mathematical and algorithmic source as LaTeX
(equation lines, algorithm lines) rendered by a typesetting engine such as
KaTeX, MathJax, or a full TeX system. Untrusted LaTeX is a code-execution and
denial-of-service surface. A renderer MUST:

- disable file-access and shell-escape constructs (`\input`, `\include`,
  `\write18`, `\openin`, and equivalents) — a full-TeX engine MUST NOT be
  invoked on untrusted source with these enabled,
- disable or sanitize link- and HTML-emitting macros (`\href`, `\url`,
  `\htmlClass`, and equivalents) so math source cannot inject navigation or
  markup that bypasses Section 2,
- bound macro expansion (expansion depth and output size) so a small input
  cannot expand into an unbounded document.

A renderer SHOULD prefer a restricted, non-Turing-complete math renderer
(KaTeX-class) over a full TeX system for untrusted input.

### 3.3 Style and color values

The collaboration extension carries a CSS `color` value for cursor and
highlight display; other extensions may carry style strings. A renderer MUST NOT
inject an author-supplied style or color string into a stylesheet or a `style`
attribute without validating it against the expected grammar (for `color`, a CSS
color value) or escaping it. An unvalidated value can break out of the intended
property and inject additional declarations, including `url()`, `expression()`,
or `@import` constructs that fetch remote resources or alter layout.

### 3.4 Contact and identity strings

Identity and contact strings — the legal extension's signer name, address,
telephone, and fax fields; party and notary names; and equivalent
advisory-identity fields across extensions — are author-asserted text. A
renderer MUST render them as inert text, escaping any markup, and MUST NOT
auto-linkify or otherwise promote them to a navigation target except through the
safe-URI allowlist of Section 2. (Their *authority* status is governed
separately by the Security Extension section 3.10.)

## 4. Client-side validation patterns

The forms extension lets a field declare a validation `pattern` (a regular
expression) and other client-side validation hints. These are an authoring and
user-experience convenience; they are **not** a trust boundary. Two obligations
follow:

- **The receiving endpoint MUST re-validate.** Client-side validation can be
  bypassed trivially (the data files that carry submitted form values sit
  outside the content hash and any signature). A server or processor that acts
  on submitted values MUST re-validate them independently and MUST NOT treat the
  presence of a client-side `pattern` as having constrained the input.

- **Pattern evaluation is a denial-of-service surface.** An author-supplied
  regular expression can exhibit catastrophic backtracking (ReDoS). A renderer
  that evaluates a `pattern` SHOULD use a linear-time matching engine
  (RE2-class) or otherwise bound evaluation time and input length, and MUST NOT
  let a single pattern evaluation stall the rendering context.

## 5. External reference resolution

Some fields name resources a processor might fetch — most notably the semantic
extension's JSON-LD `@context`, which a JSON-LD processor may dereference. A
processor MUST NOT fetch remote resources named by an untrusted document by
default: doing so is a server-side request forgery surface (the document can
point the processor at internal hosts) and a privacy and availability surface. A
processor MUST default to offline resolution — a bundled or allowlisted context
set — and MAY fetch a remote reference only when an operator has explicitly
allowed that specific origin. The same rule applies to any other author-named
external reference a processor would resolve at render time.

## 6. Active and embedded content

An extension MAY embed a block model inside its own data — most notably the
phantom extension, whose clusters carry an embedded content model and whose
assets are an unverified channel (Phantom Extension section 5.1). A renderer
MUST render embedded and phantom content with the *same* safe-URI allowlist and
sanitization rules it applies to primary content: embedded link targets, image
sources, SVG, math, and style values are no more trustworthy than their
top-level counterparts, and an embedded or out-of-hash channel is frequently
*less* trustworthy. A renderer MUST treat such content as untrusted regardless
of the integrity status of the surrounding document, and MUST NOT grant it any
capability (script execution, navigation, network access) it would deny to
primary content.

## 7. Relationship to identity authority

Renderer safety is concerned with what a renderer may *execute or fetch* from
author-controlled data. It is complementary to, and distinct from, the question
of what a renderer may *present as authoritative*, which is governed by the
Security Extension section 3.10 (Identity Authority) and the integrity-status
discipline of the extension overview. A value can be integrity-protected and
still unsafe to render (a signed `javascript:` link); a value can be safe to
render and still carry no authority (an unauthenticated signer name). A
conformant renderer MUST satisfy both disciplines independently.
