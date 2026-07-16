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
 *    annotations) and of the `security` block. An extension config file is bound
 *    only when declared as a `{path, hash}` reference; a path-only declaration
 *    (e.g. collaboration comments/changes) is not.
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
  isPlainObject,
  isValidContentHash,
  CanonicalizationError,
} from './canonicalize.js';

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
    throw new CanonicalizationError(`each requiredSigners entry must carry exactly one of: ${REQUIRED_SIGNER_KINDS.join(', ')}`);
  }
  const keys = Object.keys(entry);
  if (keys.length !== 1) {
    throw new CanonicalizationError(`a requiredSigners entry must have no members beyond its identity kind (found: ${keys.join(', ')})`);
  }
  const kind = present[0];
  const value = entry[kind];
  if (typeof value !== 'string' || value === '') {
    throw new CanonicalizationError(`requiredSigners ${kind} must be a non-empty string`);
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
      const existing = byPath.get(v.path);
      if (existing !== undefined && existing !== v.hash) {
        throw new CanonicalizationError(`config file "${v.path}" is declared with conflicting hashes`);
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
    if (!isValidContentHash(cat.hash)) {
      throw new CanonicalizationError(`manifest.assets category "${category}" index hash "${String(cat.hash)}" is malformed`);
    }
    const existing = byPath.get(cat.index);
    if (existing !== undefined && existing !== cat.hash) {
      throw new CanonicalizationError(`asset index "${cat.index}" is declared with conflicting hashes`);
    }
    byPath.set(cat.index, cat.hash);
  }
  const items = [...byPath.entries()].map(([path, hash]) => ({ path, hash }));
  items.sort(byJcs);
  return items;
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
    throw new CanonicalizationError('manifest id is "pending"; a manifest projection is undefined until the document id is assigned');
  }

  const projection: Record<string, unknown> = {};

  // --- cdx (spec version) — always present (manifest required field) ---------
  if (typeof manifest.cdx !== 'string') {
    throw new CanonicalizationError('manifest.cdx must be a string');
  }
  projection.cdx = manifest.cdx;

  // --- state (lifecycle) — always present ------------------------------------
  if (typeof manifest.state !== 'string' || !MANIFEST_STATES.has(manifest.state)) {
    throw new CanonicalizationError(`manifest.state must be one of: ${[...MANIFEST_STATES].join(', ')}`);
  }
  projection.state = manifest.state;

  // --- content {path, hash} — always present; the content file's integrity ----
  const content = manifest.content;
  if (!isPlainObject(content) || typeof content.path !== 'string' || typeof content.hash !== 'string') {
    throw new CanonicalizationError('manifest.content must be an object with string path and hash');
  }
  if (!isValidContentHash(content.hash)) {
    throw new CanonicalizationError(`manifest.content.hash "${content.hash}" is malformed`);
  }
  projection.content = { path: content.path, hash: content.hash };

  // --- presentation[] (optional) — the presentation *declaration* -------------
  // Binds each presentation manifest's {type, path, hash} plus which one is the
  // default. This authenticates the manifest's selection of presentation parts;
  // it does NOT attest visual rendering (precise-layout attestation remains the
  // separate `scope.layouts` mechanism). The array is author-ordered, so it is
  // sorted by JCS to a canonical order; the default-selection is bound as a flag
  // present only on the default entry (no default-value materialization).
  const presentation = manifest.presentation;
  if (Array.isArray(presentation) && presentation.length > 0) {
    const items = presentation.map((entry) => {
      if (!isPlainObject(entry) || typeof entry.type !== 'string' || typeof entry.path !== 'string' || typeof entry.hash !== 'string') {
        throw new CanonicalizationError('each manifest.presentation[] entry must have string type, path and hash');
      }
      if (!isValidContentHash(entry.hash)) {
        throw new CanonicalizationError(`presentation "${entry.path}" has a malformed hash "${entry.hash}"`);
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
        throw new CanonicalizationError(`duplicate extension id "${entry.id}"`);
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
    projection.lineage = manifest.lineage;
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
      throw new CanonicalizationError('manifest.signaturePolicy.requiredSigners must be a non-empty array');
    }
    const items = required.map((entry) => projectRequiredSigner(entry));
    items.sort(byJcs);
    for (let i = 1; i < items.length; i++) {
      if (jcsOf(items[i]) === jcsOf(items[i - 1])) {
        throw new CanonicalizationError('duplicate manifest.signaturePolicy.requiredSigners entry');
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
