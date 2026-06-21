/**
 * Known-answer test (KAT) vectors for the document-ID canonicalizer.
 *
 * Each vector's `expectedCanonicalJcs` is **hand-authored** (the canonical bytes
 * a faithful implementation MUST produce per spec/core/06-document-hashing.md
 * §4.3), and `expectedId` is the hash of those exact bytes computed by an
 * out-of-band tool (`shasum`), NOT by this repo's canonicalizer. The gate
 * (check-document-id.ts) asserts the canonicalizer reproduces both — so a bug in
 * the transform or the serializer is caught against an independent oracle, and a
 * mistyped vector cannot pass by matching a wrong implementation (the hand bytes,
 * the impl bytes, and the external hash would three-way disagree).
 *
 * `parts` are raw JSON text (the canonicalizer's input contract) so byte-level
 * cases such as -0 survive (JSON.stringify would fold -0 to 0).
 */

export interface KatVector {
  name: string;
  description: string;
  /** Document-ID hash algorithm (derived from the id prefix in real use). Default sha256. */
  algorithm?: string;
  parts: {
    manifest: string;
    content: string;
    dublinCore: string;
    assetIndexes?: Record<string, string>;
  };
  /** Hand-authored RFC 8785 (JCS) serialization of the canonical {content, metadata}. */
  expectedCanonicalJcs: string;
  /** `algorithm:hexdigest` of the UTF-8 bytes of expectedCanonicalJcs (computed out-of-band). */
  expectedId: string;
}

const DC = '{"version":"1.1","terms":{"title":"T","creator":"C"}}';
const META = '"metadata":{"creator":["C"],"title":"T"}';
/** A fixed, valid content hash an asset reference resolves to. */
const ASSET_HASH = 'sha256:' + 'a'.repeat(64);

export const vectors: KatVector[] = [
  {
    name: 'spec-4.5-heading',
    description: 'The worked example from 06 §4.5: heading + scalar creator coerced to an array.',
    parts: {
      manifest: '{}',
      content: '{"version":"0.1","blocks":[{"type":"heading","level":1,"children":[{"type":"text","value":"Hello"}]}]}',
      dublinCore: '{"version":"1.1","terms":{"title":"Test Document","creator":"Jane Doe"}}',
    },
    expectedCanonicalJcs:
      '{"content":{"blocks":[{"children":[{"type":"text","value":"Hello"}],"level":1,"type":"heading"}],"version":"0.1"},"metadata":{"creator":["Jane Doe"],"title":"Test Document"}}',
    expectedId: 'sha256:12768052d53d60d457ab47514ddd8be3087dd7d66a1a9dcc984eceec83f6ae70',
  },
  {
    name: 'metadata-projection',
    description: 'Keep five terms; multi-author array preserved; empty description and all of creators/date/publisher dropped.',
    parts: {
      manifest: '{}',
      content: '{"version":"0.1","blocks":[]}',
      dublinCore:
        '{"version":"1.1","terms":{"title":"Report","creator":["Alice","Bob"],"subject":["Fin","Q4"],"description":"","language":"en","creators":[{"name":"Alice"}],"date":"2025-01-01","publisher":"Acme"}}',
    },
    expectedCanonicalJcs:
      '{"content":{"blocks":[],"version":"0.1"},"metadata":{"creator":["Alice","Bob"],"language":["en"],"subject":["Fin","Q4"],"title":"Report"}}',
    expectedId: 'sha256:51e48e3b7ed0874406c3bf1f5b42d0b13054cb01bd3a3e75befff9d60ce3849a',
  },
  {
    name: 'null-vs-absent',
    description: 'listItem.checked:null is preserved; tableCell colspan/rowspan defaults are NOT materialized.',
    parts: {
      manifest: '{}',
      content:
        '{"version":"0.1","blocks":[{"type":"list","ordered":true,"children":[{"type":"listItem","checked":null,"children":[]}]},{"type":"table","children":[{"type":"tableRow","children":[{"type":"tableCell","children":[]}]}]}]}',
      dublinCore: DC,
    },
    expectedCanonicalJcs:
      `{"content":{"blocks":[{"children":[{"checked":null,"children":[],"type":"listItem"}],"ordered":true,"type":"list"},{"children":[{"children":[{"children":[],"type":"tableCell"}],"type":"tableRow"}],"type":"table"}],"version":"0.1"},${META}}`,
    expectedId: 'sha256:493738f7fb41d3233b5fbb796eb824f86c135b395ec8410fb72be0a4877ae43e',
  },
  {
    name: 'non-bmp-nfc',
    description: 'NFC precomposed e-acute, a non-BMP emoji, and CJK pass through verbatim as UTF-8 (not escaped).',
    parts: {
      manifest: '{}',
      content: '{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"caf\u00e9 \ud83d\ude00 \u65e5\u672c\u8a9e"}]}]}',
      dublinCore: DC,
    },
    expectedCanonicalJcs:
      `{"content":{"blocks":[{"children":[{"type":"text","value":"caf\u00e9 \ud83d\ude00 \u65e5\u672c\u8a9e"}],"type":"paragraph"}],"version":"0.1"},${META}}`,
    expectedId: 'sha256:10c70f72a9732b2f464cd57c04b4d1f9e227059040e2277224d09478b040590a',
  },
  {
    name: 'marks-sort-dedup',
    description: 'Marks sort by JCS (bare strings before objects), duplicates removed; link with URL scheme left verbatim.',
    parts: {
      manifest: '{}',
      content:
        '{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"x","marks":[{"type":"link","href":"https://x"},"italic","bold","bold",{"type":"link","href":"https://x"}]}]}]}',
      dublinCore: DC,
    },
    expectedCanonicalJcs:
      `{"content":{"blocks":[{"children":[{"marks":["bold","italic",{"href":"https://x","type":"link"}],"type":"text","value":"x"}],"type":"paragraph"}],"version":"0.1"},${META}}`,
    expectedId: 'sha256:2bdbc97a7badc0c50c46b2ad48c37cd9000324c9e12147266565f65306cbb573',
  },
  {
    name: 'merge-and-id-boundary',
    description: 'Adjacent equal-mark text nodes merge; a text node carrying an id is a boundary, and that id is alpha-renamed (k → b0).',
    parts: {
      manifest: '{}',
      content:
        '{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"Hello "},{"type":"text","value":"world"},{"type":"text","value":"!","id":"k"},{"type":"text","value":"?"}]}]}',
      dublinCore: DC,
    },
    expectedCanonicalJcs:
      `{"content":{"blocks":[{"children":[{"type":"text","value":"Hello world"},{"id":"b0","type":"text","value":"!"},{"type":"text","value":"?"}],"type":"paragraph"}],"version":"0.1"},${META}}`,
    expectedId: 'sha256:ae20d2e4a55e2113d93e4c99bc5b6abf3654b0ae177211cc5845fcdfcce2d4c8',
  },
  {
    name: 'strip-derived-and-crdt',
    description: 'measurement.display, codeBlock.tokens, and crdt are stripped; codeBlock.highlighting is preserved.',
    parts: {
      manifest: '{}',
      content:
        '{"version":"0.1","blocks":[{"type":"measurement","value":9.81,"unit":"m/s^2","display":"9.81 m/s2","crdt":{"seq":1}},{"type":"codeBlock","language":"js","highlighting":"tokens","tokens":[{"type":"keyword","value":"const"}],"children":[{"type":"text","value":"const x = 1"}]}]}',
      dublinCore: DC,
    },
    expectedCanonicalJcs:
      `{"content":{"blocks":[{"type":"measurement","unit":"m/s^2","value":9.81},{"children":[{"type":"text","value":"const x = 1"}],"highlighting":"tokens","language":"js","type":"codeBlock"}],"version":"0.1"},${META}}`,
    expectedId: 'sha256:e7a1c3ff23b60482cb394e03bd01d6d653383484a21cf8ec030b9df36ff1178a',
  },
  {
    name: 'asset-purity-original',
    description: 'An image src resolves to the asset content hash (filename "orig.png").',
    parts: {
      manifest: '{"assets":{"images":{"count":1,"totalSize":1,"index":"assets/images/index.json"}}}',
      content: '{"version":"0.1","blocks":[{"type":"image","src":"assets/images/orig.png","alt":"x"}]}',
      dublinCore: DC,
      assetIndexes: {
        images: `{"version":"0.1","assets":[{"id":"a","path":"orig.png","type":"image/png","size":1,"hash":"${ASSET_HASH}"}]}`,
      },
    },
    expectedCanonicalJcs: `{"content":{"blocks":[{"alt":"x","src":"${ASSET_HASH}","type":"image"}],"version":"0.1"},${META}}`,
    expectedId: 'sha256:4b010de38220bab2ce3032e7809772e71876d70af70714c24338b882e02f3f6e',
  },
  {
    name: 'asset-purity-renamed',
    description: 'Same content + same asset bytes under a different filename ("renamed.png") — MUST produce the same id as asset-purity-original.',
    parts: {
      manifest: '{"assets":{"images":{"count":1,"totalSize":1,"index":"assets/images/index.json"}}}',
      content: '{"version":"0.1","blocks":[{"type":"image","src":"assets/images/renamed.png","alt":"x"}]}',
      dublinCore: DC,
      assetIndexes: {
        images: `{"version":"0.1","assets":[{"id":"a","path":"renamed.png","type":"image/png","size":1,"hash":"${ASSET_HASH}"}]}`,
      },
    },
    expectedCanonicalJcs: `{"content":{"blocks":[{"alt":"x","src":"${ASSET_HASH}","type":"image"}],"version":"0.1"},${META}}`,
    expectedId: 'sha256:4b010de38220bab2ce3032e7809772e71876d70af70714c24338b882e02f3f6e',
  },
  {
    name: 'negative-zero',
    description: 'A numeric -0 serializes as 0 (RFC 8785).',
    parts: {
      manifest: '{}',
      content: '{"version":"0.1","blocks":[{"type":"measurement","value":-0,"display":"zero"}]}',
      dublinCore: DC,
    },
    expectedCanonicalJcs: `{"content":{"blocks":[{"type":"measurement","value":0}],"version":"0.1"},${META}}`,
    expectedId: 'sha256:2320cb5d06128605864af81a49c0a0bd4ef56848a8ced0b456248b990355afea',
  },
  {
    name: 'sha384-document',
    description: 'The document-ID algorithm follows the id prefix (sha384), not a hardcoded default.',
    algorithm: 'sha384',
    parts: {
      manifest: '{}',
      content: '{"version":"0.1","blocks":[{"type":"paragraph","children":[{"type":"text","value":"sha384"}]}]}',
      dublinCore: DC,
    },
    expectedCanonicalJcs:
      `{"content":{"blocks":[{"children":[{"type":"text","value":"sha384"}],"type":"paragraph"}],"version":"0.1"},${META}}`,
    expectedId: 'sha384:8776ca4466e5194913ee9cb5999402f5403a532b530faefdd052adeb1695a8042341130f4a83af765e5bc7b55c260070',
  },
  {
    name: 'alpha-rename-labels-a',
    description: 'Alpha-renaming: author labels title/intro become b0/b1 and the link #title is rewritten to #b0 (§4.3.1 item 5).',
    parts: {
      manifest: '{}',
      content:
        '{"version":"0.1","blocks":[{"type":"heading","id":"title","level":1,"children":[{"type":"text","value":"Title"}]},{"type":"paragraph","id":"intro","children":[{"type":"text","value":"x","marks":[{"type":"link","href":"#title"}]}]}]}',
      dublinCore: DC,
    },
    expectedCanonicalJcs:
      `{"content":{"blocks":[{"children":[{"type":"text","value":"Title"}],"id":"b0","level":1,"type":"heading"},{"children":[{"marks":[{"href":"#b0","type":"link"}],"type":"text","value":"x"}],"id":"b1","type":"paragraph"}],"version":"0.1"},${META}}`,
    expectedId: 'sha256:4c036a36cb087408573539bc639253056cebbd39e7bd5ca3d40207bc91791d0d',
  },
  {
    name: 'alpha-rename-labels-b',
    description: 'Same structure as -a with DIFFERENT author labels (sec/body, #sec) — MUST canonicalize identically (block-id purity).',
    parts: {
      manifest: '{}',
      content:
        '{"version":"0.1","blocks":[{"type":"heading","id":"sec","level":1,"children":[{"type":"text","value":"Title"}]},{"type":"paragraph","id":"body","children":[{"type":"text","value":"x","marks":[{"type":"link","href":"#sec"}]}]}]}',
      dublinCore: DC,
    },
    expectedCanonicalJcs:
      `{"content":{"blocks":[{"children":[{"type":"text","value":"Title"}],"id":"b0","level":1,"type":"heading"},{"children":[{"marks":[{"href":"#b0","type":"link"}],"type":"text","value":"x"}],"id":"b1","type":"paragraph"}],"version":"0.1"},${META}}`,
    expectedId: 'sha256:4c036a36cb087408573539bc639253056cebbd39e7bd5ca3d40207bc91791d0d',
  },
  {
    name: 'alpha-rename-academic-refs',
    description: 'Academic uses[] and proof.of references are rewritten to canonical block-id names (#def→#b0, #thm→#b1).',
    parts: {
      manifest: '{}',
      content:
        '{"version":"0.1","blocks":[{"type":"academic:theorem","id":"def","variant":"definition","children":[]},{"type":"academic:theorem","id":"thm","variant":"theorem","uses":["#def"],"children":[]},{"type":"academic:proof","of":"#thm","children":[]}]}',
      dublinCore: DC,
    },
    expectedCanonicalJcs:
      `{"content":{"blocks":[{"children":[],"id":"b0","type":"academic:theorem","variant":"definition"},{"children":[],"id":"b1","type":"academic:theorem","uses":["#b0"],"variant":"theorem"},{"children":[],"of":"#b1","type":"academic:proof"}],"version":"0.1"},${META}}`,
    expectedId: 'sha256:67c275865c3fdab3e46f85600ae82a6efad7171ce05d2953e3b59a4d53ffb349',
  },
];
