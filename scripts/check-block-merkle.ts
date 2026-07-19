#!/usr/bin/env npx tsx

/**
 * Enforcing gate for the cdx-bmt-1 block-level Merkle construction (core 09
 * §4.2–4.3, §5.1–5.2).
 *
 * Part 1 — Construction vectors: blockLeafHash / blockMerkleRoot /
 *   verifyBlockInclusion reproduce independent-oracle values across tree
 *   sizes, including the single-leaf identity, the §4.3 promotion rule, and
 *   proof-position sensitivity. The vectors also pin two REJECTIONS: the
 *   legacy untagged duplicate-odd root (the CVE-2012-2459 pattern this
 *   construction closed) and an untagged-fold value must both fail to verify.
 *
 * Part 2 — Fold decoupling: the §5.2 tagged fold and the §6.5 aggregated
 *   untagged fold (provenance-timestamp.ts) MUST disagree on identical proof
 *   inputs. The two were previously pinned identical in prose; 09 now defines
 *   them as deliberately distinct, and this check turns that distinction into
 *   a regression gate in both directions.
 *
 * Part 3 — Proof round-trip: generateBlockInclusionProof over each vector
 *   tree verifies for every leaf against the oracle root — the generator and
 *   verifier agree with each other AND with the oracle.
 *
 * Part 4 — Corpus grounding: every example shipping a content/block-index.json
 *   is recomputed from its content/document.json top-level blocks — ids,
 *   order, leaf hashes, root, and the declared construction — and any
 *   merkle summary in the manifest or provenance record must agree. This
 *   keeps a committed block index from rotting when content changes.
 *
 * The root remains ADVISORY in this version (09 §5.2): it is bound by neither
 * the document ID nor the manifest projection, and a green run here certifies
 * construction bytes, not a trust claim.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  blockLeafHash,
  blockMerkleRoot,
  generateBlockInclusionProof,
  verifyBlockInclusion,
  BLOCK_MERKLE_CONSTRUCTION,
} from './lib/block-merkle.js';
import { verifyMerkleInclusion } from './lib/provenance-timestamp.js';
import {
  rootVectors,
  inclusionVectors,
  LEAF_BLOCK,
  LEAF_BLOCK_HASH,
  LEAF_C,
  ROOT_TWO,
  ROOT_THREE,
  UNTAGGED_FOLD_C,
} from './kat/block-merkle-vectors.js';

let failures = 0;
const fail = (msg: string): void => {
  console.log(`  ✗ ${msg}`);
  failures++;
};

// --- Part 1: construction vectors -------------------------------------------
console.log('cdx-bmt-1 construction vectors:');

{
  const got = blockLeafHash(LEAF_BLOCK, 'sha256');
  if (got !== LEAF_BLOCK_HASH) {
    fail(`leaf hash H(0x00 || JCS(block)) — got ${got}, oracle ${LEAF_BLOCK_HASH}`);
  } else {
    console.log('  ✓ tagged leaf hash matches oracle');
  }
}

for (const vec of rootVectors) {
  const got = blockMerkleRoot(vec.leaves);
  if (got !== vec.root) {
    fail(`${vec.name} — root ${got} != oracle ${vec.root}`);
  } else {
    console.log(`  ✓ ${vec.name}`);
  }
}

for (const vec of inclusionVectors) {
  const got = verifyBlockInclusion(vec.leaf, vec.path, vec.root);
  if (got !== vec.expected) {
    fail(`${vec.name} — verified=${got}, expected ${vec.expected}`);
  } else {
    console.log(`  ✓ ${vec.name}`);
  }
}

// Defence-in-depth: both an accepted and a rejected outcome must be exercised.
const outcomes = new Set(inclusionVectors.map((v) => v.expected));
if (!outcomes.has(true) || !outcomes.has(false)) {
  fail('inclusion vectors must exercise both a verifying and a failing proof');
}

// Defence-in-depth: an over-long path is a compute-DoS vector — reject outright.
{
  const h = 'sha256:' + 'a'.repeat(64);
  const overLong = Array.from({ length: 257 }, () => ({ position: 'left' as const, hash: h }));
  try {
    verifyBlockInclusion(h, overLong, h);
    fail('over-long block path (257) must be rejected by the path-length cap');
  } catch {
    console.log('  ✓ over-long block path (257) rejected by the path-length cap');
  }
}

// --- Part 2: §5.2 / §6.5 fold decoupling -------------------------------------
console.log('\nFold decoupling (tagged §5.2 vs untagged §6.5):');
{
  const proofPath = [{ position: 'left' as const, hash: ROOT_TWO }];
  // The SAME inputs: tagged fold reproduces the cdx-bmt-1 root; the untagged
  // aggregated fold must NOT (and vice versa for the untagged value).
  const taggedOk = verifyBlockInclusion(LEAF_C, proofPath, ROOT_THREE);
  const untaggedOnTagged = verifyMerkleInclusion(LEAF_C, proofPath, ROOT_THREE);
  const untaggedOk = verifyMerkleInclusion(LEAF_C, proofPath, UNTAGGED_FOLD_C);
  const taggedOnUntagged = verifyBlockInclusion(LEAF_C, proofPath, UNTAGGED_FOLD_C);
  if (!taggedOk) fail('tagged fold must reproduce the cdx-bmt-1 root');
  if (untaggedOnTagged) fail('untagged §6.5 fold must NOT reproduce a cdx-bmt-1 root (folds coincide!)');
  if (!untaggedOk) fail('untagged fold must reproduce its own oracle value');
  if (taggedOnUntagged) fail('tagged §5.2 fold must NOT reproduce an untagged root (folds coincide!)');
  if (taggedOk && !untaggedOnTagged && untaggedOk && !taggedOnUntagged) {
    console.log('  ✓ tagged and untagged folds disagree on identical inputs, both directions');
  }
}

// --- Part 3: proof round-trip ------------------------------------------------
console.log('\nProof generation round-trip:');
for (const vec of rootVectors) {
  let ok = true;
  for (let i = 0; i < vec.leaves.length; i++) {
    const proof = generateBlockInclusionProof(vec.leaves, i);
    if (!verifyBlockInclusion(vec.leaves[i], proof, vec.root)) {
      fail(`${vec.name} — generated proof for leaf ${i} does not verify against the oracle root`);
      ok = false;
    }
  }
  if (ok) console.log(`  ✓ ${vec.name} — every leaf's generated proof verifies`);
}

// --- Part 4: corpus grounding ------------------------------------------------
console.log('\nCorpus block-index grounding:');
const examplesDir = path.join(__dirname, '..', 'examples');
let checked = 0;
for (const name of fs.readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const dir = path.join(examplesDir, name);
  const indexPath = path.join(dir, 'content', 'block-index.json');

  // A block-merkle SUMMARY (manifest content.merkleRoot, or a provenance
  // `merkle` block) without the index it summarizes is ungroundable — the
  // summary could rot undetected if the index were simply deleted. Fail
  // closed rather than skip. (An aggregated-timestamp `merkleRoot` inside
  // `timestamps[]` is a §6.5 construct and is NOT a block-merkle summary.)
  if (!fs.existsSync(indexPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      if (manifest.content?.merkleRoot !== undefined) {
        fail(`${name} — manifest declares content.merkleRoot but ships no content/block-index.json to ground it`);
        continue;
      }
      const provRel = typeof manifest.provenance === 'string' ? manifest.provenance : undefined;
      if (provRel && fs.existsSync(path.join(dir, provRel))) {
        const rec = JSON.parse(fs.readFileSync(path.join(dir, provRel), 'utf8'));
        if (rec.merkle !== undefined) {
          fail(`${name} — provenance record declares a merkle summary but ships no content/block-index.json to ground it`);
        }
      }
    } catch { /* unparseable manifests/records are other gates' concern */ }
    continue;
  }

  let index: any, document: any, manifest: any;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    document = JSON.parse(fs.readFileSync(path.join(dir, 'content', 'document.json'), 'utf8'));
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch (err) {
    fail(`${name} — parse error: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  const declared = index.construction ?? BLOCK_MERKLE_CONSTRUCTION;
  if (declared !== BLOCK_MERKLE_CONSTRUCTION) {
    fail(`${name} — unknown construction "${declared}" (this gate implements ${BLOCK_MERKLE_CONSTRUCTION})`);
    continue;
  }

  const blocks: any[] = Array.isArray(document.blocks) ? document.blocks : [];
  const algorithm: string = index.algorithm ?? 'sha256';
  let ok = true;

  if (!Array.isArray(index.blocks) || index.blocks.length !== blocks.length) {
    fail(`${name} — block-index has ${index.blocks?.length} entries, document has ${blocks.length} top-level blocks`);
    ok = false;
  } else {
    for (let i = 0; i < blocks.length; i++) {
      const entry = index.blocks[i];
      const expectedLeaf = blockLeafHash(blocks[i], algorithm);
      if (entry.index !== i) { fail(`${name} — blocks[${i}].index is ${entry.index}`); ok = false; }
      if (entry.id !== blocks[i].id) { fail(`${name} — blocks[${i}].id "${entry.id}" != document block id "${blocks[i].id}"`); ok = false; }
      if (entry.hash !== expectedLeaf) { fail(`${name} — blocks[${i}].hash does not equal the recomputed tagged leaf hash`); ok = false; }
    }
  }

  if (ok) {
    // Diagnostic rather than stack trace on a degenerate index (zero blocks —
    // schema-invalid but reachable here without schema validation — or an
    // algorithm like blake3 with no Node binding).
    let root: string | undefined;
    try {
      root = blockMerkleRoot(index.blocks.map((b: any) => b.hash));
    } catch (err) {
      fail(`${name} — cannot recompute root: ${err instanceof Error ? err.message : String(err)}`);
      ok = false;
    }
    if (root !== undefined && root !== index.root) { fail(`${name} — recomputed root ${root} != declared root ${index.root}`); ok = false; }

    // Any merkle summary elsewhere in the example must agree with the index.
    const mc = manifest.content ?? {};
    if (mc.merkleRoot !== undefined && mc.merkleRoot !== index.root) { fail(`${name} — manifest content.merkleRoot disagrees with block-index root`); ok = false; }
    if (mc.blockCount !== undefined && mc.blockCount !== blocks.length) { fail(`${name} — manifest content.blockCount (${mc.blockCount}) != ${blocks.length}`); ok = false; }
    if (mc.construction !== undefined && mc.construction !== declared) { fail(`${name} — manifest content.construction disagrees with block-index`); ok = false; }
    const provRel = typeof manifest.provenance === 'string' ? manifest.provenance : undefined;
    if (provRel && fs.existsSync(path.join(dir, provRel))) {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(dir, provRel), 'utf8'));
        const m = rec.merkle;
        if (m?.root !== undefined && m.root !== index.root) { fail(`${name} — provenance merkle.root disagrees with block-index root`); ok = false; }
        if (m?.blockCount !== undefined && m.blockCount !== blocks.length) { fail(`${name} — provenance merkle.blockCount (${m.blockCount}) != ${blocks.length}`); ok = false; }
        if (m?.algorithm !== undefined && m.algorithm !== algorithm) { fail(`${name} — provenance merkle.algorithm disagrees with block-index`); ok = false; }
        if (m?.construction !== undefined && m.construction !== declared) { fail(`${name} — provenance merkle.construction disagrees with block-index`); ok = false; }
      } catch { /* provenance parse problems are another gate's concern */ }
    }
  }

  if (ok) {
    console.log(`  ✓ ${name} (${blocks.length} blocks; root recomputed and consistent)`);
    checked++;
  }
}
if (checked === 0) fail('no corpus block-index found to ground against');

if (failures > 0) {
  console.log(`\n${failures} failure(s). Block-merkle check failed.`);
  process.exit(1);
}
console.log(`\nAll construction vectors verified; corpus grounding passed (${checked} index(es)).`);
