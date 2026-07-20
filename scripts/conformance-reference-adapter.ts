#!/usr/bin/env npx tsx

/**
 * Reference conformance adapter (Level 0) for the CDX conformance suite.
 *
 * This is a worked example of the file-based adapter protocol AND the subject of
 * the `check:conformance` gate. It wraps THIS repository's reference libraries;
 * a third-party adapter wraps its own implementation instead. The shape is the
 * whole contract:
 *
 *   1. Read the suite root (its `suite.json` and `vectors/`), given as argv[2]
 *      or defaulting to ./conformance.
 *   2. For each vector, run the implementation and record what it PRODUCED — a
 *      computed value, or (for the error kind) a native error mapped to a suite
 *      code. The adapter never decides pass or fail.
 *   3. Write one report object to stdout (schema: conformance/report.schema.json).
 *      The suite harness reads it and renders the verdict.
 *
 * A minimal adapter in another language does exactly this: loop the vectors,
 * call your functions, print the actuals. See conformance/ADAPTER.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { canonicalContent, computeDocumentId, jcsOf } from './lib/canonicalize.js';
import { projectManifest, projectManifestToJcs } from './lib/manifest-projection.js';
import { encodeProtectedHeader, jwsSigningInput } from './lib/jws-envelope.js';
import { jwkThumbprint, multibaseKeyToJwk } from './lib/keyid-resolution.js';
import { blockLeafHash, blockMerkleRoot, verifyBlockInclusion } from './lib/block-merkle.js';
import { checkTimestampBinding } from './lib/provenance-timestamp.js';
import type { AdapterReport, AdapterResult } from './lib/conformance-suite.js';

const sha256Of = (s: string): string => 'sha256:' + crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Capabilities this implementation genuinely supports at Level 0. Only what the
 * reference libraries can actually compute or implement is declared:
 *   - `core` — content canonicalization, document ID, SHA-256 (mandatory).
 *   - `ext:security` — the security-extension functions (manifest projection,
 *     JWS protected header / signing input, JWK thumbprint, multibase key).
 *   - `provenance` — cdx-bmt-1 block-Merkle and RFC 3161 timestamp binding.
 *   - the optional hash algorithms the platform can compute.
 * BLAKE3 is deliberately absent: the identifier is recognised but the digest is
 * not available here (canonicalize.ts throws "not available"), so declaring it
 * would be a false claim.
 */
const CAPABILITIES = ['core', 'ext:security', 'provenance', 'hash:sha-384', 'hash:sha-512', 'hash:sha3-256', 'hash:sha3-512'];
const CAP_SET = new Set(CAPABILITIES);

/** Outcome of running one vector, minus the kind/name the driver fills in. */
type RunOutcome = Pick<AdapterResult, 'outcome' | 'values' | 'error'>;

/** One runner per vector kind: vector input in, produced actuals (or a mapped error) out. */
const RUNNERS: Record<string, (v: Record<string, any>) => RunOutcome> = {
  'document-id': (v) => ({
    outcome: 'value',
    values: {
      canonicalJcs: jcsOf(canonicalContent(v.parts)),
      id: computeDocumentId(v.parts, v.algorithm ?? 'sha256'),
    },
  }),

  'manifest-projection': (v) => {
    const jcs = projectManifestToJcs(v.manifest);
    return { outcome: 'value', values: { jcs, sha256: sha256Of(jcs) } };
  },

  'manifest-scope': (v) => {
    const jcs = jcsOf(v.scope);
    return { outcome: 'value', values: { jcs, sha256: sha256Of(jcs) } };
  },

  'manifest-projection-errors': (v) => {
    // The one kind that expects a raised error. The adapter maps its native
    // error to a suite code at this boundary; the implementation is never asked
    // to adopt the vocabulary internally.
    try {
      projectManifest(v.manifest);
      return { outcome: 'value', values: {} }; // ran without raising — the harness will fail it
    } catch (err) {
      return { outcome: 'error', error: { code: (err as { code?: string }).code ?? null } };
    }
  },

  'jws-header': (v) => ({ outcome: 'value', values: { protectedHeader: encodeProtectedHeader(v.header) } }),

  'jws-signing-input': (v) => ({
    outcome: 'value',
    values: { signingInputSha256: sha256Of(jwsSigningInput(encodeProtectedHeader(v.header), v.scope)) },
  }),

  'jwk-thumbprint': (v) => ({ outcome: 'value', values: { thumbprint: jwkThumbprint(v.jwk) } }),

  multibase: (v) => {
    const jwk = multibaseKeyToJwk(v.multibase);
    return { outcome: 'value', values: { jwk, thumbprint: jwkThumbprint(jwk) } };
  },

  'block-merkle-root': (v) => ({ outcome: 'value', values: { root: blockMerkleRoot(v.leaves) } }),

  'block-merkle-inclusion': (v) => ({ outcome: 'value', values: { included: verifyBlockInclusion(v.leaf, v.path, v.root) } }),

  'block-merkle-leaf': (v) => ({ outcome: 'value', values: { leafJcs: jcsOf(v.block), leafHash: blockLeafHash(v.block, 'sha256') } }),

  'provenance-timestamp': (v) => {
    const got = checkTimestampBinding(v.timestamp, v.documentId);
    return {
      outcome: 'value',
      values: {
        boundToDocument: got.boundToDocument,
        merkleVerified: got.merkleVerified,
        leaf: got.leaf,
        problemsEmpty: got.problems.length === 0,
      },
    };
  },
};

function run(kind: string, v: Record<string, any>): RunOutcome {
  const runner = RUNNERS[kind];
  if (runner === undefined) {
    // A kind this adapter does not implement. Declaring it a skip is honest — the
    // harness surfaces it rather than counting a silent pass.
    return { outcome: 'skip' } as RunOutcome;
  }
  try {
    return runner(v);
  } catch (err) {
    // A positive kind that unexpectedly raised. Report the error faithfully; the
    // harness fails it against the expected value, surfacing the real defect.
    return { outcome: 'error', error: { code: (err as { code?: string }).code ?? null } };
  }
}

function main(): void {
  const suiteRoot = process.argv[2] ?? path.join(__dirname, '..', 'conformance');
  const suite = JSON.parse(fs.readFileSync(path.join(suiteRoot, 'suite.json'), 'utf8'));
  const vectorsDir = path.join(suiteRoot, 'vectors');

  const results: AdapterResult[] = [];
  for (const file of fs.readdirSync(vectorsDir).filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json')).sort()) {
    const doc = JSON.parse(fs.readFileSync(path.join(vectorsDir, file), 'utf8'));
    const kind: string = doc.kind;
    const fileRequires: string[] = Array.isArray(doc.requires) ? doc.requires : [];
    for (const v of doc.vectors as Array<Record<string, any>>) {
      // Honour capability scoping: skip a vector needing a capability this
      // adapter did not declare, rather than attempting it and reporting a
      // spurious error. This models a real capability-scoped adapter.
      const required = [...fileRequires, ...(Array.isArray(v.requires) ? v.requires : [])];
      const missing = required.filter((k) => !CAP_SET.has(k));
      if (missing.length > 0) {
        results.push({ kind, name: v.name, outcome: 'skip', skip: { reason: `missing capability: ${missing.join(', ')}` } });
        continue;
      }
      results.push({ kind, name: v.name, ...run(kind, v) });
    }
  }

  const report: AdapterReport = {
    suite: 'cdx-conformance',
    suiteVersion: suite.suiteVersion,
    specVersion: suite.specVersion,
    adapter: { name: 'cdx-reference', version: '0.1.0', level: 0 },
    capabilities: CAPABILITIES,
    results,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main();
