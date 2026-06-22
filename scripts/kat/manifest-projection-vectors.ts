/**
 * Known-answer test (KAT) vectors for the signed manifest projection and the
 * scoped-signature serialization.
 *
 * As with the document-ID vectors, each `expectedJcs` is the canonical RFC 8785
 * (JCS) byte string a faithful projector/serializer MUST produce, and
 * `expectedSha256` is the SHA-256 of those exact bytes computed by an
 * independent serializer (Python's `json` + `hashlib`, NOT this repo's
 * `canonicalize` package). The gate (check-manifest-projection.ts) asserts the
 * implementation reproduces BOTH — so a transform or serializer bug is caught
 * against an independent oracle, not snapshotted.
 *
 * Repeated-character hashes are built with `sha()` so digest lengths are exact
 * (64 hex for sha256) and identical between a vector's input and its expected
 * output; the `expectedSha256` anchors the true structure regardless.
 *
 * `scopeVectors` pin the EXISTING `JCS(scope)` signing construction
 * (spec/extensions/security/README.md §9.5) — which until now had no
 * known-answer test at all — before `scope.manifest` extends it.
 */

/** A repeated-character content hash of the exact length sha256 requires. */
const sha = (c: string): string => `sha256:${c.repeat(64)}`;

/** The real signed-document corpus hashes (so V1 mirrors the on-disk example). */
const DOC_ID = 'sha256:66db6e3c227d306b57068a4fa5e779e3a4b2ab74c9cb6320ecd57ddf280c2b86';
const DOC_CONTENT = 'sha256:dac719a7afeb6b8bfb05fa673154f3a840ba8554348a2c085859889abe240bb7';

export interface ProjectionVector {
  name: string;
  description: string;
  /** Raw JSON text of a manifest.json (the projector's input contract). */
  manifest: string;
  /** Hand-specified canonical JCS of the projection the manifest yields. */
  expectedJcs: string;
  /** sha256 of the UTF-8 bytes of expectedJcs (computed out-of-band). */
  expectedSha256: string;
}

export interface ScopeVector {
  name: string;
  description: string;
  /** A signature `scope` object whose JCS bytes are what a signature signs. */
  scope: unknown;
  expectedJcs: string;
  expectedSha256: string;
}

export interface ErrorVector {
  name: string;
  description: string;
  manifest: string;
  /** Substring the thrown CanonicalizationError message must contain. */
  expectedError: string;
}

export const projectionVectors: ProjectionVector[] = [
  {
    name: 'signed-document-corpus',
    description:
      'The signed-document manifest: id/created/modified/hashAlgorithm/security/metadata and content.compression all drop; content{path,hash} + extensions + lineage(parent:null) + signaturePolicy(requiredSigners) bind.',
    manifest: `{"cdx":"0.1","id":"${DOC_ID}","state":"frozen","hashAlgorithm":"sha256","created":"2025-01-10T08:00:00Z","modified":"2025-01-15T14:22:00Z","content":{"path":"content/document.json","hash":"${DOC_CONTENT}","compression":"zstd"},"security":{"signatures":"security/signatures.json","encryption":null},"extensions":[{"id":"cdx.security","version":"0.1","required":true}],"metadata":{"dublinCore":"metadata/dublin-core.json"},"lineage":{"parent":null,"version":1},"signaturePolicy":{"requiredSigners":[{"did":"did:web:acme.example.com:notary"}]}}`,
    expectedJcs: `{"cdx":"0.1","content":{"hash":"${DOC_CONTENT}","path":"content/document.json"},"extensions":[{"id":"cdx.security","required":true,"version":"0.1"}],"lineage":{"parent":null,"version":1},"signaturePolicy":{"requiredSigners":[{"did":"did:web:acme.example.com:notary"}]},"state":"frozen"}`,
    expectedSha256: 'sha256:839827035e0165d4ad7d1dbff7733c74e4fd4907c8f077b65077d35f31778391',
  },
  {
    name: 'presentation-and-default',
    description:
      'presentation[] is sorted by JCS (paginated before responsive) and only the default entry carries default:true; a default:false is dropped (no default-value materialization).',
    manifest: `{"cdx":"0.1","id":"${sha('1')}","state":"published","content":{"path":"content/document.json","hash":"${sha('2')}"},"presentation":[{"type":"responsive","path":"presentation/responsive.json","hash":"${sha('4')}","default":false},{"type":"paginated","path":"presentation/paginated.json","hash":"${sha('3')}","default":true}]}`,
    expectedJcs: `{"cdx":"0.1","content":{"hash":"${sha('2')}","path":"content/document.json"},"presentation":[{"default":true,"hash":"${sha('3')}","path":"presentation/paginated.json","type":"paginated"},{"hash":"${sha('4')}","path":"presentation/responsive.json","type":"responsive"}],"state":"published"}`,
    expectedSha256: 'sha256:1d912c4633e1c65d26df8808455fd239340c7f7638415599051bbc9b56c05b85',
  },
  {
    name: 'extensions-config-required-only',
    description:
      'config binds for the required extension (cdx.security) and is dropped for the non-required one (cdx.academic); entries sort by JCS (security first).',
    manifest: `{"cdx":"0.1","id":"${sha('5')}","state":"frozen","content":{"path":"content/document.json","hash":"${sha('6')}"},"extensions":[{"id":"cdx.academic","version":"0.2","required":false,"config":{"numbering":"academic/numbering.json"}},{"id":"cdx.security","version":"0.1","required":true,"config":{"policy":"strict"}}]}`,
    expectedJcs: `{"cdx":"0.1","content":{"hash":"${sha('6')}","path":"content/document.json"},"extensions":[{"config":{"policy":"strict"},"id":"cdx.security","required":true,"version":"0.1"},{"id":"cdx.academic","required":false,"version":"0.2"}],"state":"frozen"}`,
    expectedSha256: 'sha256:ea799b1b6f03b7f4fba5dfe01a06381cefd10e802af76cbe664f57c296f9a02a',
  },
  {
    name: 'minimal-no-optionals',
    description: 'Only the always-present fields; absent presentation/extensions/lineage are omitted, never null-materialized.',
    manifest: `{"cdx":"0.1","id":"${sha('7')}","state":"frozen","content":{"path":"content/document.json","hash":"${sha('8')}"}}`,
    expectedJcs: `{"cdx":"0.1","content":{"hash":"${sha('8')}","path":"content/document.json"},"state":"frozen"}`,
    expectedSha256: 'sha256:711be22dd3851024d9d2cf761c6b32d5e72707aa50fd675b2db3e103d666fc1d',
  },
  {
    name: 'lineage-with-ancestors',
    description: 'lineage binds verbatim; the ancestors array preserves its authored (nearest-first) order while object keys sort.',
    manifest: `{"cdx":"0.1","id":"${sha('9')}","state":"published","content":{"path":"content/document.json","hash":"${sha('a')}"},"lineage":{"version":3,"depth":3,"parent":"${sha('b')}","ancestors":["${sha('c')}","${sha('d')}"]}}`,
    expectedJcs: `{"cdx":"0.1","content":{"hash":"${sha('a')}","path":"content/document.json"},"lineage":{"ancestors":["${sha('c')}","${sha('d')}"],"depth":3,"parent":"${sha('b')}","version":3},"state":"published"}`,
    expectedSha256: 'sha256:7c9e3d98dcc4b7977860156c35b58995046c64a3c8b0067c5dcf79e61d8dc4d1',
  },
  {
    name: 'signature-policy-multikind',
    description: 'signaturePolicy.requiredSigners binds all three identity kinds; entries sort by JCS (did < jkt < x5tS256), so authored order is not significant.',
    manifest: `{"cdx":"0.1","id":"${sha('e')}","state":"frozen","content":{"path":"content/document.json","hash":"${sha('f')}"},"signaturePolicy":{"requiredSigners":[{"x5tS256":"x5tThumbprintAAAA"},{"jkt":"jktThumbprintBBBB"},{"did":"did:key:zABC123"}]}}`,
    expectedJcs: `{"cdx":"0.1","content":{"hash":"${sha('f')}","path":"content/document.json"},"signaturePolicy":{"requiredSigners":[{"did":"did:key:zABC123"},{"jkt":"jktThumbprintBBBB"},{"x5tS256":"x5tThumbprintAAAA"}]},"state":"frozen"}`,
    expectedSha256: 'sha256:906acae5439950e154ae402e847359b019058dddef91f216973e81a2c5b58783',
  },
];

export const scopeVectors: ScopeVector[] = [
  {
    name: 'scope-content-only',
    description: 'A content-only scope binds just the document ID — the legacy/default coverage.',
    scope: { documentId: DOC_ID },
    expectedJcs: `{"documentId":"${DOC_ID}"}`,
    expectedSha256: 'sha256:8b63e569bdcc02bde3ae3a9669ec18c0aa7084027ea0f808d521a437f0b434c9',
  },
  {
    name: 'scope-with-layouts',
    description: 'A scope binding the document ID plus precise-layout file hashes (visual attestation).',
    scope: { documentId: sha('1'), layouts: { 'presentation/layouts/letter.json': sha('2') } },
    expectedJcs: `{"documentId":"${sha('1')}","layouts":{"presentation/layouts/letter.json":"${sha('2')}"}}`,
    expectedSha256: 'sha256:e6e0c5b763077a3e8a0eb16688f76e2f9fdea6351095d61b14fa02528ee6d7be',
  },
  {
    name: 'scope-with-manifest',
    description: 'A manifest-covering scope: documentId + the signed-document projection (including the signaturePolicy required-signer set). These are the bytes a frozen manifest-covering signature signs.',
    scope: {
      documentId: DOC_ID,
      manifest: {
        cdx: '0.1',
        state: 'frozen',
        content: { path: 'content/document.json', hash: DOC_CONTENT },
        extensions: [{ id: 'cdx.security', version: '0.1', required: true }],
        lineage: { parent: null, version: 1 },
        signaturePolicy: { requiredSigners: [{ did: 'did:web:acme.example.com:notary' }] },
      },
    },
    expectedJcs: `{"documentId":"${DOC_ID}","manifest":{"cdx":"0.1","content":{"hash":"${DOC_CONTENT}","path":"content/document.json"},"extensions":[{"id":"cdx.security","required":true,"version":"0.1"}],"lineage":{"parent":null,"version":1},"signaturePolicy":{"requiredSigners":[{"did":"did:web:acme.example.com:notary"}]},"state":"frozen"}}`,
    expectedSha256: 'sha256:61d9e3fe0b1d527ac37832e1d76df7eadd8e039db83f0d1a51dba6565487af25',
  },
];

export const errorVectors: ErrorVector[] = [
  {
    name: 'pending-id-forbidden',
    description: 'A draft manifest (id:"pending") has no fixed identity, so a projection over it is forbidden.',
    manifest: `{"cdx":"0.1","id":"pending","state":"draft","content":{"path":"content/document.json","hash":"${sha('1')}"}}`,
    expectedError: 'pending',
  },
  {
    name: 'malformed-content-hash',
    description: 'A content hash that is not a well-formed algorithm:hexdigest is rejected.',
    manifest: `{"cdx":"0.1","id":"${sha('1')}","state":"frozen","content":{"path":"content/document.json","hash":"sha256:1234"}}`,
    expectedError: 'malformed',
  },
  {
    name: 'duplicate-extension-id',
    description: 'Two extensions with the same id make the projection ambiguous and are rejected.',
    manifest: `{"cdx":"0.1","id":"${sha('1')}","state":"frozen","content":{"path":"content/document.json","hash":"${sha('2')}"},"extensions":[{"id":"cdx.security","version":"0.1","required":true},{"id":"cdx.security","version":"0.2","required":false}]}`,
    expectedError: 'duplicate extension id',
  },
  {
    name: 'unknown-state-rejected',
    description: 'A state outside the lifecycle enum fails closed rather than binding a bogus state into a signature.',
    manifest: `{"cdx":"0.1","id":"${sha('1')}","state":"archived","content":{"path":"content/document.json","hash":"${sha('2')}"}}`,
    expectedError: 'manifest.state must be one of',
  },
  {
    name: 'duplicate-required-signer',
    description: 'Two identical required-signer entries make the required set ambiguous and are rejected.',
    manifest: `{"cdx":"0.1","id":"${sha('1')}","state":"frozen","content":{"path":"content/document.json","hash":"${sha('2')}"},"signaturePolicy":{"requiredSigners":[{"did":"did:key:zABC"},{"did":"did:key:zABC"}]}}`,
    expectedError: 'duplicate manifest.signaturePolicy.requiredSigners',
  },
  {
    name: 'empty-required-signers',
    description: 'An empty required-signer set is forbidden so "absent policy" and "empty policy" are not both expressible.',
    manifest: `{"cdx":"0.1","id":"${sha('1')}","state":"frozen","content":{"path":"content/document.json","hash":"${sha('2')}"},"signaturePolicy":{"requiredSigners":[]}}`,
    expectedError: 'must be a non-empty array',
  },
  {
    name: 'required-signer-two-kinds',
    description: 'A required-signer entry carrying two identity kinds is malformed and fails closed.',
    manifest: `{"cdx":"0.1","id":"${sha('1')}","state":"frozen","content":{"path":"content/document.json","hash":"${sha('2')}"},"signaturePolicy":{"requiredSigners":[{"did":"did:key:zABC","jkt":"thumbprint"}]}}`,
    expectedError: 'exactly one of',
  },
];
