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
  algorithmOf,
  canonicalContent,
  computeDocumentId,
  parseStrictJson,
  type DocumentParts,
} from './lib/canonicalize.js';

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

test('strip: crdt removed from a block', () => {
  const blocks = canonContent({
    content: { version: '0.1', blocks: [{ type: 'paragraph', id: 'p1', crdt: { seq: 42 }, children: [{ type: 'text', value: 'hi' }] }] },
  }).blocks;
  assert.equal('crdt' in blocks[0], false);
  assert.equal(blocks[0].id, 'p1');
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

test('merge: a text node carrying an id is a boundary (not merged, id preserved)', () => {
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
// Reviewer-driven hardening: determinism seams + regression guards
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
