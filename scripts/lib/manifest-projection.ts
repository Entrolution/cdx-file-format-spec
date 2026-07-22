/**
 * Reference projector for the CDX signed **manifest projection**.
 *
 * A signature today binds only the document ID (the content hash), so the
 * manifest itself — its lifecycle state, the content/presentation part hashes,
 * the required-extension set, and the lineage — is unauthenticated: an attacker
 * can alter any of it without breaking a signature. The manifest projection is
 * the canonical, signable representation of those security-relevant manifest
 * declarations; a scoped signature covers it via `scope.manifest`
 * (spec/extensions/security/README.md §9.7).
 *
 * Like ./canonicalize.ts (the document-ID canonicalizer) this is a *shared
 * library*: the example/KAT checks and any signing/verifying tooling resolve the
 * projection through this one module, so they cannot drift. It deliberately
 * reuses canonicalize.ts's primitives — strict parsing (duplicate-key
 * rejection), the pinned RFC 8785 (JCS) serializer, and the stored-byte
 * invariants — so the projection's bytes obey the exact same rules as the
 * document ID's.
 *
 * The projection is an explicit *transform* of `manifest.json`; the stored file
 * is never modified. It is **envelope-agnostic**: the bytes `serializeProjection`
 * produces are the payload a future signature envelope (the increment that
 * fixes the trust-anchor model) signs, independent of how that envelope is
 * shaped.
 *
 * What the projection BINDS: `cdx` (spec version), `state`, the content part
 * `{path, hash}`, the `presentation[]` declaration (`{type, path, hash}` plus the
 * default-selection flag), the `extensions[]` set (`{id, version, required}`,
 * plus `config` for a required extension), `lineage` verbatim, the
 * `signaturePolicy` required-signer set (§3.12) — the credentials that bind the
 * signature SET against stripping/downgrade — and `configFiles`: the `{path, hash}`
 * references an extension config slot declares (academic numbering, semantic
 * bibliography/glossary), so their content is attested even though it is outside
 * the document hash — and `assets`: the `{path, hash}` of each declared asset
 * category's index file. An index enumerates every asset's (and image variant's)
 * hash, so hash-pinning the index transitively attests assets that sit outside the
 * document ID — notably fonts (referenced by presentation family name) and image
 * variants (selected by display size) — closing the swap-a-variant / remap-a-font
 * substitution that a valid signature would otherwise miss.
 *
 * What it does NOT bind (negative coverage, by design — see the spec §9.8):
 *  - The document ID / content semantics — carried separately by
 *    `scope.documentId` (the projection never repeats it).
 *  - The raw asset *files* directly, or an asset category the manifest does not
 *    declare in `assets`: assets are attested only transitively, through the
 *    hash-pinned index of a declared category (`assets`, above), and only while a
 *    manifest-covering signature is present.
 *  - The *bytes* of path-only parts (metadata, provenance, phantoms,
 *    annotations) and of the path-only `security` references (signatures,
 *    encryption). An auxiliary file is bound only when declared as a `{path, hash}`
 *    reference — an extension config file, an asset-category index, or the
 *    `security.accessControl` policy; a path-only declaration (e.g. collaboration
 *    comments/changes, or the signatures/encryption paths) is not.
 *  - Signatures OUTSIDE the declared required set: the `signaturePolicy` binds
 *    only the *declared required* signers, so stripping an optional signature,
 *    signing order, and late-joiners are not detected (§3.12, §9.8). A document
 *    that declares no `signaturePolicy` has no set integrity at all.
 *  - Administrative fields with no integrity meaning: `created`, `modified`,
 *    `hashAlgorithm` (redundant with the document-ID prefix).
 */

import {
  parseStrictJson,
  jcsOf,
  validateStoredByteInvariants,
  assertBoundedDepth,
  MAX_CANONICALIZATION_DEPTH,
  isPlainObject,
  isValidContentHash,
  CanonicalizationError,
} from './canonicalize.js';

/** Semantic-version pattern for `cdx` and extension/presentation versions. */
const VERSION_PATTERN = /^\d+\.\d+$/;
/** The four presentation part types (mirrors manifest.schema presentationReference.type). */
const PRESENTATION_TYPES = new Set(['paginated', 'continuous', 'responsive', 'precise']);
/** Zip-Slip-safe archive-relative path (mirrors anchor.schema relativePath). */
const RELATIVE_PATH = /^(?!\.\.?(?:\/|$))(?!.*\/\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
/** Per-kind required-signer value patterns (mirror anchor.schema requiredSigner). */
const REQUIRED_SIGNER_PATTERNS: Record<string, RegExp> = {
  did: /^did:(key|jwk|web):[A-Za-z0-9._:%-]+$/,
  x5tS256: /^[A-Za-z0-9_-]{4,}$/,
  jkt: /^[A-Za-z0-9_-]{4,}$/,
};

/**
 * The manifest lifecycle states (mirrors manifest.schema.json). The projector
 * validates `state` against this set so a bogus state fails closed here rather
 * than being bound into a signature — the reference library does not assume the
 * manifest was schema-validated upstream.
 */
const MANIFEST_STATES = new Set(['draft', 'review', 'frozen', 'published']);

/** Order two already-projected array elements by their JCS serialization. */
function byJcs(a: unknown, b: unknown): number {
  const ja = jcsOf(a);
  const jb = jcsOf(b);
  return ja < jb ? -1 : ja > jb ? 1 : 0;
}

/**
 * The authenticated-identity kinds a required-signer entry may carry (§3.12),
 * each mapping to exactly one credential path: `did` → the keyId path's `kid`;
 * `x5tS256` → the X.509 path's leaf-certificate thumbprint; `jkt` → the
 * WebAuthn path's RFC 7638 public-key thumbprint.
 */
const REQUIRED_SIGNER_KINDS = ['did', 'x5tS256', 'jkt'] as const;

/**
 * Validate and project one required-signer entry. An entry MUST carry exactly
 * one identity kind (`did` | `x5tS256` | `jkt`) holding a non-empty string and
 * no other member — any other shape fails closed here rather than being bound
 * into a signature. The verifier matches each kind against the corresponding
 * credential path only, so the kind discriminator also prevents cross-path
 * confusion (e.g. a WebAuthn key satisfying a keyId slot).
 */
function projectRequiredSigner(entry: unknown): Record<string, unknown> {
  if (!isPlainObject(entry)) {
    throw new CanonicalizationError('each requiredSigners entry must be an object');
  }
  const present = REQUIRED_SIGNER_KINDS.filter((k) => entry[k] !== undefined);
  if (present.length !== 1) {
    throw new CanonicalizationError(`each requiredSigners entry must carry exactly one of: ${REQUIRED_SIGNER_KINDS.join(', ')}`, 'CDX-E-MANIFEST-REQUIRED-SIGNER-KIND-AMBIGUOUS');
  }
  const keys = Object.keys(entry);
  if (keys.length !== 1) {
    throw new CanonicalizationError(`a requiredSigners entry must have no members beyond its identity kind (found: ${keys.join(', ')})`);
  }
  const kind = present[0];
  const value = entry[kind];
  if (typeof value !== 'string' || !REQUIRED_SIGNER_PATTERNS[kind].test(value)) {
    throw new CanonicalizationError(`requiredSigners ${kind} is malformed for its identity kind`, 'CDX-E-MANIFEST-REQUIRED-SIGNER-ID-MALFORMED');
  }
  return { [kind]: value };
}

/**
 * The manifest's extension config slots (mirrors manifest.schema.json). Each is an
 * open object owned by its extension; the projector reaches into them only to bind
 * the hashes of declared `{path, hash}` file references — never advisory config
 * such as a citation style.
 */
const EXTENSION_CONFIG_SLOTS = ['academic', 'semantic', 'legal', 'collaboration'] as const;

/**
 * True iff `v` is EXACTLY a `{path, hash}` file reference with a well-formed
 * content hash — no extra members. The strict key set matches the config-schema
 * `fileReference` def (additionalProperties:false), so the projector binds the
 * same shape the schema admits and an advisory object that merely happens to carry
 * a `path`+`hash` pair (plus other fields) is not silently pulled in.
 */
function isFileReference(v: unknown): v is { path: string; hash: string } {
  return (
    isPlainObject(v) &&
    Object.keys(v).length === 2 &&
    typeof v.path === 'string' &&
    isValidContentHash(v.hash)
  );
}

/**
 * Collect every `{path, hash}` file reference declared anywhere in the extension
 * config slots, projected as `{path, hash}` and sorted by JCS. A path declared
 * twice with conflicting hashes is rejected — the binding would be ambiguous.
 */
function collectConfigFileReferences(manifest: Record<string, unknown>): Array<{ path: string; hash: string }> {
  const byPath = new Map<string, string>();
  const visit = (v: unknown): void => {
    if (isFileReference(v)) {
      if (!RELATIVE_PATH.test(v.path)) {
        throw new CanonicalizationError(`config file path "${v.path}" is not a valid archive-relative path`, 'CDX-E-MANIFEST-PATH-TRAVERSAL');
      }
      const existing = byPath.get(v.path);
      if (existing !== undefined && existing !== v.hash) {
        throw new CanonicalizationError(`config file "${v.path}" is declared with conflicting hashes`, 'CDX-E-MANIFEST-REFERENCE-HASH-CONFLICT');
      }
      byPath.set(v.path, v.hash);
      return; // a file reference's members are scalars; nothing to recurse into
    }
    if (Array.isArray(v)) {
      for (const el of v) visit(el);
    } else if (isPlainObject(v)) {
      for (const key of Object.keys(v)) visit(v[key]);
    }
  };
  for (const slot of EXTENSION_CONFIG_SLOTS) visit(manifest[slot]);

  const items = [...byPath.entries()].map(([path, hash]) => ({ path, hash }));
  items.sort(byJcs);
  return items;
}

/**
 * Collect the `{path, hash}` index reference of every asset category declared in
 * `manifest.assets`, projected as `{path: <index>, hash}` and sorted by JCS. Each
 * `assetCategory` (mirrors manifest.schema.json) declares `{count, totalSize,
 * index, hash}`; only the index reference is bound, because the index enumerates
 * every asset's and image variant's own hash — so hash-pinning the one index hash
 * transitively attests the whole category (fonts, image variants included). The
 * advisory `count`/`totalSize` are subordinate to the index and are not bound.
 *
 * Fails closed: a present-but-malformed `assets` block, or a category missing a
 * well-formed index path and hash, throws rather than letting that category escape
 * the binding. Two categories declaring the same index path with conflicting
 * hashes is ambiguous and rejected.
 */
function collectAssetIndexReferences(manifest: Record<string, unknown>): Array<{ path: string; hash: string }> {
  const assets = manifest.assets;
  if (assets === undefined || assets === null) return [];
  if (!isPlainObject(assets)) {
    throw new CanonicalizationError('manifest.assets must be an object');
  }
  const byPath = new Map<string, string>();
  for (const category of Object.keys(assets)) {
    const cat = assets[category];
    if (!isPlainObject(cat)) {
      throw new CanonicalizationError(`manifest.assets category "${category}" must be an object`);
    }
    if (typeof cat.index !== 'string') {
      throw new CanonicalizationError(`manifest.assets category "${category}" must declare a string index path`);
    }
    if (!RELATIVE_PATH.test(cat.index)) {
      throw new CanonicalizationError(`manifest.assets category "${category}" index path "${cat.index}" is not a valid archive-relative path`, 'CDX-E-MANIFEST-PATH-TRAVERSAL');
    }
    if (!isValidContentHash(cat.hash)) {
      throw new CanonicalizationError(`manifest.assets category "${category}" index hash "${String(cat.hash)}" is malformed`, 'CDX-E-MANIFEST-HASH-MALFORMED');
    }
    const existing = byPath.get(cat.index);
    if (existing !== undefined && existing !== cat.hash) {
      throw new CanonicalizationError(`asset index "${cat.index}" is declared with conflicting hashes`, 'CDX-E-MANIFEST-REFERENCE-HASH-CONFLICT');
    }
    byPath.set(cat.index, cat.hash);
  }
  const items = [...byPath.entries()].map(([path, hash]) => ({ path, hash }));
  items.sort(byJcs);
  return items;
}

/** The always-present manifest fields, validated and extracted. */
export interface ManifestCore {
  cdx: string;
  state: string;
  content: { path: string; hash: string };
}

/**
 * Validate and extract the manifest fields that are required in EVERY state — the
 * `cdx` version string, the lifecycle `state`, and the `content` reference — each
 * pattern-checked (not merely typed) and throwing the typed §5.4.2 defect code its
 * violation maps to. Shared by projectManifest (which calls it after its pending-id
 * gate, since a projection is only defined once the id is fixed) and the document
 * mapper (document-verdict.ts), which validates these on every document, INCLUDING
 * a pending-id draft — the draft/review REJECTs for a malformed required field or
 * an off-enum state apply before and independently of any projection.
 */
export function validateManifestCore(manifest: Record<string, unknown>): ManifestCore {
  // A signer skipping manifest-schema validation must not bind a malformed version
  // into the signed projection, so this is a pattern check, not merely a type check.
  if (typeof manifest.cdx !== 'string' || !VERSION_PATTERN.test(manifest.cdx)) {
    throw new CanonicalizationError('manifest.cdx must be a "<major>.<minor>" version string', 'CDX-E-MANIFEST-VERSION-MALFORMED');
  }
  if (typeof manifest.state !== 'string' || !MANIFEST_STATES.has(manifest.state)) {
    throw new CanonicalizationError(`manifest.state must be one of: ${[...MANIFEST_STATES].join(', ')}`, 'CDX-E-MANIFEST-STATE-UNKNOWN');
  }
  const content = manifest.content;
  if (!isPlainObject(content) || typeof content.path !== 'string' || typeof content.hash !== 'string') {
    throw new CanonicalizationError('manifest.content must be an object with string path and hash', 'CDX-E-MANIFEST-REFERENCE-MALFORMED');
  }
  if (!RELATIVE_PATH.test(content.path)) {
    throw new CanonicalizationError(`manifest.content path "${content.path}" is not a valid archive-relative path`, 'CDX-E-MANIFEST-PATH-TRAVERSAL');
  }
  if (!isValidContentHash(content.hash)) {
    throw new CanonicalizationError(`manifest.content.hash "${content.hash}" is malformed`, 'CDX-E-MANIFEST-HASH-MALFORMED');
  }
  return { cdx: manifest.cdx, state: manifest.state, content: { path: content.path, hash: content.hash } };
}

/**
 * Build the canonical manifest projection from the raw text of `manifest.json`.
 * Returns a plain object; serialize it with `serializeProjection` to obtain the
 * signable bytes.
 *
 * Throws `CanonicalizationError` when the manifest cannot yield a projection —
 * notably when `id` is `"pending"` (a draft has no fixed document identity, so a
 * projection over it would be meaningless and is forbidden).
 */
export function projectManifest(manifestText: string): Record<string, unknown> {
  const manifest = parseStrictJson(manifestText);
  if (!isPlainObject(manifest)) {
    throw new CanonicalizationError('manifest is not a JSON object');
  }

  // A projection is only defined once the document identity is fixed. A draft
  // carries `id: "pending"` (07 §5.3) and is never signed; forbid it explicitly
  // rather than project an unstable manifest.
  if (manifest.id === 'pending') {
    throw new CanonicalizationError('manifest id is "pending"; a manifest projection is undefined until the document id is assigned', 'CDX-E-MANIFEST-ID-PENDING');
  }

  // Bound nesting depth before the recursive walks (config-ref collection, byte-invariant
  // validation, JCS) so a deeply nested lineage/config slot fails with a typed error
  // rather than overflowing the native stack (Container Format §5.3).
  assertBoundedDepth(manifest, MAX_CANONICALIZATION_DEPTH);

  const projection: Record<string, unknown> = {};

  // --- cdx, state, content — the always-present required fields ---------------
  // Validated + extracted by the shared core validator (also used by the document
  // mapper, which applies these same REJECTs to a pending-id draft).
  const core = validateManifestCore(manifest);
  projection.cdx = core.cdx;
  projection.state = core.state;
  projection.content = core.content;

  // --- presentation[] (optional) — the presentation *declaration* -------------
  // Binds each presentation part's {type, path, hash} plus which one is the
  // default. For a reactive type (paginated/continuous/responsive) this
  // authenticates the manifest's selection of presentation parts, not the
  // interpreted rendering; for a `precise` layout the bound file hash IS the exact
  // coordinates, so a declared precise layout's appearance is attested here (the
  // optional `scope.layouts` mechanism remains available for finer per-layout
  // attestation). The array is author-ordered, so it is sorted by JCS to a
  // canonical order; the default-selection is bound as a flag present only on the
  // default entry (no default-value materialization).
  const presentation = manifest.presentation;
  if (Array.isArray(presentation) && presentation.length > 0) {
    const items = presentation.map((entry) => {
      if (!isPlainObject(entry) || typeof entry.type !== 'string' || typeof entry.path !== 'string' || typeof entry.hash !== 'string') {
        throw new CanonicalizationError('each manifest.presentation[] entry must have string type, path and hash', 'CDX-E-MANIFEST-REFERENCE-MALFORMED');
      }
      if (!PRESENTATION_TYPES.has(entry.type)) {
        throw new CanonicalizationError(`manifest.presentation[] type "${entry.type}" is not one of: ${[...PRESENTATION_TYPES].join(', ')}`, 'CDX-E-MANIFEST-PRESENTATION-TYPE-UNKNOWN');
      }
      if (!RELATIVE_PATH.test(entry.path)) {
        throw new CanonicalizationError(`manifest.presentation[] path "${entry.path}" is not a valid archive-relative path`, 'CDX-E-MANIFEST-PATH-TRAVERSAL');
      }
      if (!isValidContentHash(entry.hash)) {
        throw new CanonicalizationError(`presentation "${entry.path}" has a malformed hash "${entry.hash}"`, 'CDX-E-MANIFEST-HASH-MALFORMED');
      }
      const projected: Record<string, unknown> = { type: entry.type, path: entry.path, hash: entry.hash };
      if (entry.default === true) projected.default = true;
      return projected;
    });
    items.sort(byJcs);
    for (let i = 1; i < items.length; i++) {
      if (jcsOf(items[i]) === jcsOf(items[i - 1])) {
        throw new CanonicalizationError('duplicate manifest.presentation[] entry');
      }
    }
    projection.presentation = items;
  }

  // --- extensions[] (optional) — the required-extension set -------------------
  // Binds {id, version, required}. `config` is bound only for a *required*
  // extension: a required extension's configuration can change how the document
  // is interpreted, so it is part of what a signature must attest; a
  // non-required extension's config is advisory and left out.
  const extensions = manifest.extensions;
  if (Array.isArray(extensions) && extensions.length > 0) {
    const seen = new Set<string>();
    const items = extensions.map((entry) => {
      if (!isPlainObject(entry) || typeof entry.id !== 'string' || typeof entry.version !== 'string' || typeof entry.required !== 'boolean') {
        throw new CanonicalizationError('each manifest.extensions[] entry must have a string id, string version and boolean required');
      }
      if (seen.has(entry.id)) {
        throw new CanonicalizationError(`duplicate extension id "${entry.id}"`, 'CDX-E-MANIFEST-EXTENSION-DUPLICATE');
      }
      seen.add(entry.id);
      const projected: Record<string, unknown> = { id: entry.id, version: entry.version, required: entry.required };
      if (entry.required === true && entry.config !== undefined) {
        projected.config = entry.config; // semantics-affecting config of a required extension
      }
      return projected;
    });
    items.sort(byJcs);
    projection.extensions = items;
  }

  // --- lineage (optional) — bound verbatim -----------------------------------
  // The whole lineage object (parent, ancestors, version, depth, branch,
  // mergedFrom, note) is security-relevant provenance, so it is bound as
  // authored. Explicit `null` (e.g. `parent: null`) is preserved; an absent
  // lineage is omitted (absent ≠ a present lineage with null fields).
  if (manifest.lineage !== undefined && manifest.lineage !== null) {
    if (!isPlainObject(manifest.lineage)) {
      throw new CanonicalizationError('manifest.lineage must be an object');
    }
    // An empty lineage object is omitted like any absent optional field (§9.7);
    // otherwise a `lineage: {}` would bind different signed bytes than an absent one.
    if (Object.keys(manifest.lineage).length > 0) {
      projection.lineage = manifest.lineage;
    }
  }

  // --- signaturePolicy (optional) — the required-signer set (§3.12) -----------
  // Binds the signature SET against stripping/downgrade: the declared required
  // signers ride in the signed projection, so any manifest-covering signature
  // attests them, and removing a required signer is detectable while any
  // signature survives. Each entry names a credential in AUTHENTICATED terms
  // (one of a keyId `did`, an X.509 `x5tS256` thumbprint, or a WebAuthn `jkt`
  // thumbprint) — never an advisory signer field. An empty required-signer set
  // is forbidden, so "absent policy" and "empty policy" are not both
  // expressible; an absent policy is omitted (a document with no policy has no
  // set integrity — surfaced as a verifier-side warning, §3.12, not bound here).
  if (manifest.signaturePolicy !== undefined && manifest.signaturePolicy !== null) {
    const policy = manifest.signaturePolicy;
    if (!isPlainObject(policy)) {
      throw new CanonicalizationError('manifest.signaturePolicy must be an object');
    }
    const required = policy.requiredSigners;
    if (!Array.isArray(required) || required.length === 0) {
      throw new CanonicalizationError('manifest.signaturePolicy.requiredSigners must be a non-empty array', 'CDX-E-MANIFEST-REQUIRED-SIGNER-SET-INVALID');
    }
    const items = required.map((entry) => projectRequiredSigner(entry));
    items.sort(byJcs);
    for (let i = 1; i < items.length; i++) {
      if (jcsOf(items[i]) === jcsOf(items[i - 1])) {
        throw new CanonicalizationError('duplicate manifest.signaturePolicy.requiredSigners entry', 'CDX-E-MANIFEST-REQUIRED-SIGNER-DUPLICATE');
      }
    }
    projection.signaturePolicy = { requiredSigners: items };
  }

  // --- extension config file references (optional) — bind their hashes ---------
  // An extension config slot (manifest.academic, manifest.semantic, …) MAY declare
  // auxiliary files — academic numbering, semantic bibliography/glossary — that are
  // NOT in the document hash yet drive rendered numbers, citations, and definitions.
  // Bind every `{path, hash}` reference found in those slots so a manifest-covering
  // signature attests each file's content; a repackager can no longer silently
  // renumber or re-cite a frozen document while a signature still verifies. The bind
  // is generic — keyed on the `{path, hash}` SHAPE, not on the field name — so a new
  // hashed config file is covered without changing this projector. The references are
  // sorted by JCS to a canonical order; absent → the field is omitted.
  const configFiles = collectConfigFileReferences(manifest);
  if (configFiles.length > 0) projection.configFiles = configFiles;

  // --- asset-index references (optional) — hash-pin each category's index -------
  // A category's assets — fonts (referenced by presentation family name) and image
  // variants (selected by display size) — are NOT resolved into the document ID, so
  // a repackager can swap a variant file or a glyph-remapping font while a content
  // signature still verifies. Bind each declared category's index file `{path, hash}`:
  // the index lists every asset's and variant's own hash, so pinning the index hash
  // transitively attests the whole category. A tampered asset then either fails its
  // load-time hash check (05 §4.3, §8.1) or forces an index edit that breaks this
  // binding. Sorted by JCS; absent → the field is omitted.
  const assetIndexes = collectAssetIndexReferences(manifest);
  if (assetIndexes.length > 0) projection.assets = assetIndexes;

  // --- access-control policy reference (optional) — bind its hash ---------------
  // manifest.security.accessControl is the ONE security-block reference carried as a
  // {path, hash} rather than a bare path, precisely so a manifest-covering signature
  // attests the access-control policy's content: a repackager cannot swap the policy
  // (e.g. widen permissions) while a signature still verifies. Only {path, hash} is
  // bound — any advisory storage hints (compression, merkleRoot) are dropped like
  // other non-integrity fields. The path-only security references (signatures,
  // encryption) remain unbound by design: signatures cannot self-sign and the
  // encryption block is not a signed-content claim. Absent → the field is omitted.
  const security = manifest.security;
  if (isPlainObject(security) && security.accessControl !== undefined && security.accessControl !== null) {
    const ref = security.accessControl;
    // The reference SHAPE and the hash VALUE are distinct defects: a missing or
    // non-string path is a malformed {path, hash} reference (§9.9), not a bad
    // hash, and a conformance consumer must be able to tell them apart.
    if (!isPlainObject(ref) || typeof ref.path !== 'string') {
      throw new CanonicalizationError('manifest.security.accessControl must be a {path, hash} reference with a string path', 'CDX-E-MANIFEST-REFERENCE-MALFORMED');
    }
    if (!isValidContentHash(ref.hash)) {
      throw new CanonicalizationError(`manifest.security.accessControl hash "${String(ref.hash)}" is malformed`, 'CDX-E-MANIFEST-HASH-MALFORMED');
    }
    if (!RELATIVE_PATH.test(ref.path)) {
      throw new CanonicalizationError(`manifest.security.accessControl path "${ref.path}" is not a valid archive-relative path`, 'CDX-E-MANIFEST-PATH-TRAVERSAL');
    }
    projection.accessControl = { path: ref.path, hash: ref.hash };
  }

  // The projected bytes obey the same stored-byte invariants as the document ID
  // (NFC, well-formed Unicode, safe integers) — validate, never normalize.
  validateStoredByteInvariants(projection);

  return projection;
}

/** Serialize a projection to its canonical RFC 8785 (JCS) bytes — the signable form. */
export function serializeProjection(projection: unknown): string {
  return jcsOf(projection);
}

/**
 * Convenience: project `manifest.json` text straight to its canonical JCS bytes.
 */
export function projectManifestToJcs(manifestText: string): string {
  return serializeProjection(projectManifest(manifestText));
}
