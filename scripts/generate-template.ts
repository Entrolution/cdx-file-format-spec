#!/usr/bin/env npx tsx

/**
 * Generates minimal valid CDX document templates.
 *
 * Usage:
 *   npx tsx scripts/generate-template.ts --extensions academic,semantic --output ./my-doc
 *   npx tsx scripts/generate-template.ts --preset academic --output ./my-doc
 *   npx tsx scripts/generate-template.ts --list-presets
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getValidator, ruleFor } from './lib/part-schema.js';

// Extension configurations
interface ExtensionConfig {
  id: string;
  version: string;
  required: boolean;
  directories?: string[];
  files?: Record<string, unknown>;
}

const extensionConfigs: Record<string, ExtensionConfig> = {
  academic: {
    id: 'cdx.academic',
    version: '0.1',
    required: false,
    directories: ['academic'],
    files: {
      'academic/numbering.json': {
        version: '0.1',
        equations: { style: 'chapter.number', resetOn: 'heading1' },
        theorems: { style: 'chapter.number' },
        algorithms: { style: 'number', resetOn: 'heading1' },
        exercises: { style: 'chapter.number', resetOn: 'heading1' }
      }
    }
  },
  semantic: {
    id: 'cdx.semantic',
    version: '0.1',
    required: false,
    directories: ['semantic'],
    files: {
      'semantic/bibliography.json': {
        version: '0.1',
        entries: []
      },
      'semantic/glossary.json': {
        version: '0.1',
        terms: []
      }
    }
  },
  forms: {
    id: 'cdx.forms',
    version: '0.1',
    required: false,
    directories: ['forms'],
    files: {
      'forms/data.json': {
        version: '0.1',
        values: {}
      }
    }
  },
  security: {
    // A scaffolded document is an unsigned draft. The signatures file is written by
    // a real signing flow — its schema requires at least one genuine signature (an
    // empty set is "claims to be signed but is not"), and a template cannot produce
    // one without a signing key — so the scaffold declares the extension and its
    // directory but emits no signatures file. The manifest references it as empty.
    id: 'cdx.security',
    version: '0.1',
    required: false,
    directories: ['security']
  },
  collaboration: {
    id: 'cdx.collaboration',
    version: '0.2',
    required: false,
    directories: ['collaboration'],
    files: {
      'collaboration/comments.json': {
        version: '0.2',
        comments: []
      },
      'collaboration/changes.json': {
        version: '0.2',
        changes: []
      }
    }
  },
  presentation: {
    id: 'cdx.presentation',
    version: '0.1',
    required: false,
    directories: ['presentation'],
    files: {
      'presentation/paginated.json': {
        version: '0.1',
        type: 'paginated',
        defaults: {
          pageSize: { width: '8.5in', height: '11in' },
          margins: { top: '1in', right: '1in', bottom: '1in', left: '1in' }
        },
        styles: {}
      }
    }
  },
  phantoms: {
    id: 'cdx.phantoms',
    version: '0.1',
    required: false,
    directories: ['phantoms'],
    files: {
      'phantoms/clusters.json': {
        version: '0.1',
        clusters: []
      }
    }
  }
};

// Presets
const presets: Record<string, string[]> = {
  simple: [],
  academic: ['academic', 'semantic'],
  semantic: ['semantic'],
  forms: ['forms'],
  signed: ['security'],
  collaborative: ['collaboration'],
  presentation: ['presentation'],
  phantoms: ['phantoms'],
  all: Object.keys(extensionConfigs)
};

// Generate base manifest. `hashes` maps each hash-referenced part path to its
// real SHA-256 (computed from the exact bytes written to disk).
function generateManifest(extensions: string[], hashes: Record<string, string>): Record<string, unknown> {
  const now = new Date().toISOString();

  const manifest: Record<string, unknown> = {
    cdx: '0.1',
    id: 'pending',
    state: 'draft',
    created: now,
    modified: now,
    content: {
      path: 'content/document.json',
      hash: hashes['content/document.json']
    },
    metadata: {
      dublinCore: 'metadata/dublin-core.json'
    }
  };

  if (extensions.length > 0) {
    manifest.extensions = extensions.map(ext => ({
      id: extensionConfigs[ext].id,
      version: extensionConfigs[ext].version,
      required: extensionConfigs[ext].required
    }));
  }

  // Add presentation reference if presentation extension is included
  if (extensions.includes('presentation')) {
    manifest.presentation = [{
      type: 'paginated',
      path: 'presentation/paginated.json',
      hash: hashes['presentation/paginated.json'],
      default: true
    }];
  }

  // Add phantoms reference if phantoms extension is included
  if (extensions.includes('phantoms')) {
    manifest.phantoms = {
      clusters: 'phantoms/clusters.json'
    };
  }

  // Declare the security slot when the extension is present. The scaffold is an
  // unsigned draft, so both references are empty until a signing/encryption flow
  // populates them.
  if (extensions.includes('security')) {
    manifest.security = {
      signatures: null,
      encryption: null
    };
  }

  // Wire each active extension's config file(s) into its manifest slot. The
  // academic numbering and semantic bibliography/glossary files sit outside the
  // document hash, so they are bound as {path, hash} references (they ride the
  // manifest projection's configFiles and are attested by a manifest-covering
  // signature). Collaboration is intentionally path-only: its comments/changes are
  // mutable collaboration state, referenced by path and not hash-bound.
  if (extensions.includes('academic')) {
    manifest.academic = {
      numbering: { path: 'academic/numbering.json', hash: hashes['academic/numbering.json'] }
    };
  }
  if (extensions.includes('semantic')) {
    manifest.semantic = {
      bibliography: { path: 'semantic/bibliography.json', hash: hashes['semantic/bibliography.json'] },
      glossary: { path: 'semantic/glossary.json', hash: hashes['semantic/glossary.json'] }
    };
  }
  if (extensions.includes('collaboration')) {
    manifest.collaboration = {
      comments: 'collaboration/comments.json',
      changes: 'collaboration/changes.json'
    };
  }

  return manifest;
}

// Generate base content
function generateContent(): Record<string, unknown> {
  return {
    version: '0.1',
    blocks: [
      {
        type: 'heading',
        id: 'title',
        level: 1,
        children: [{ type: 'text', value: 'Document Title' }]
      },
      {
        type: 'paragraph',
        id: 'p1',
        children: [{ type: 'text', value: 'Document content goes here.' }]
      }
    ]
  };
}

// Generate Dublin Core metadata. The schema nests the descriptive fields under
// `terms` and requires a `version`.
function generateDublinCore(): Record<string, unknown> {
  return {
    version: '1.1',
    terms: {
      title: 'Untitled Document',
      creator: 'Author Name',
      subject: 'Subject',
      description: 'Document description',
      date: new Date().toISOString().split('T')[0],
      type: 'Text',
      format: 'application/vnd.cdx+zip',
      language: 'en'
    }
  };
}

// Serialize a part to the exact bytes written to disk (the same string is hashed
// and written, so manifest hashes can never drift from file contents).
function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function sha256(bytes: string | Buffer): string {
  return 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
}

// Generate template
function generateTemplate(outputDir: string, extensions: string[]): void {
  console.log(`Generating template in: ${outputDir}`);
  console.log(`Extensions: ${extensions.length > 0 ? extensions.join(', ') : 'none (simple)'}\n`);

  // Create directories
  const dirs = ['content', 'metadata'];
  for (const ext of extensions) {
    const config = extensionConfigs[ext];
    if (config.directories) {
      dirs.push(...config.directories);
    }
  }

  for (const dir of dirs) {
    const fullPath = path.join(outputDir, dir);
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`  Created: ${dir}/`);
  }

  // Build every part except the manifest, then serialize each to its on-disk
  // bytes so the manifest can carry their real SHA-256 hashes.
  const parts: Record<string, unknown> = {
    'content/document.json': generateContent(),
    'metadata/dublin-core.json': generateDublinCore()
  };
  for (const ext of extensions) {
    const config = extensionConfigs[ext];
    if (config.files) {
      Object.assign(parts, config.files);
    }
  }

  const serialized: Record<string, string> = {};
  for (const [filePath, content] of Object.entries(parts)) {
    serialized[filePath] = serializeJson(content);
  }

  // The hash-referenced parts: content, the paginated presentation (when present),
  // and the hash-bound extension-config files (academic numbering, semantic
  // bibliography/glossary). Hash their exact serialized bytes (§5.1). Collaboration
  // config is path-only and is not hashed here.
  const hashes: Record<string, string> = {
    'content/document.json': sha256(serialized['content/document.json'])
  };
  for (const p of [
    'presentation/paginated.json',
    'academic/numbering.json',
    'semantic/bibliography.json',
    'semantic/glossary.json'
  ]) {
    if (serialized[p]) hashes[p] = sha256(serialized[p]);
  }

  serialized['manifest.json'] = serializeJson(generateManifest(extensions, hashes));

  // Write each file from the same string that was hashed.
  for (const [filePath, text] of Object.entries(serialized)) {
    fs.writeFileSync(path.join(outputDir, filePath), text);
    console.log(`  Created: ${filePath}`);
  }

  console.log('\nValidating generated template...');
  selfValidate(outputDir, Object.keys(serialized));
}

// Validate every emitted part against the same rule table the corpus validator
// uses, and confirm each declared file hash matches the bytes on disk. A failure
// here means the generator produced a non-conforming document — exit non-zero
// rather than print success over an invalid template.
function selfValidate(outputDir: string, relPaths: string[]): void {
  let ok = true;

  for (const relPath of [...relPaths].sort()) {
    const rule = ruleFor(relPath);
    if (!rule) {
      console.error(`  ✗ ${relPath} — no schema rule matched (cannot self-validate)`);
      ok = false;
      continue;
    }
    const data = JSON.parse(fs.readFileSync(path.join(outputDir, relPath), 'utf8'));
    const validate = getValidator(rule.schema, rule.ref);
    if (validate(data)) {
      console.log(`  ✓ ${relPath}`);
    } else {
      ok = false;
      console.error(`  ✗ ${relPath}`);
      for (const e of validate.errors ?? []) {
        console.error(`    - ${e.instancePath || '/'}: ${e.message}`);
      }
    }
  }

  // Every declared file hash must equal the raw SHA-256 of the referenced bytes.
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
  const hashRefs: Array<[string, string, string]> = [];
  if (manifest.content?.path && manifest.content?.hash) {
    hashRefs.push(['content.hash', manifest.content.path, manifest.content.hash]);
  }
  (manifest.presentation ?? []).forEach((pr: { path?: string; hash?: string }, i: number) => {
    if (pr.path && pr.hash) hashRefs.push([`presentation[${i}].hash`, pr.path, pr.hash]);
  });
  // Extension-config {path, hash} references (academic numbering, semantic
  // bibliography/glossary) must resolve to the bytes on disk too — mirror the
  // presentation check. Collaboration is path-only and carries no hash to verify.
  const configRefs: Array<[string, { path?: string; hash?: string } | undefined]> = [
    ['academic.numbering', manifest.academic?.numbering],
    ['semantic.bibliography', manifest.semantic?.bibliography],
    ['semantic.glossary', manifest.semantic?.glossary]
  ];
  for (const [label, ref] of configRefs) {
    if (ref?.path && ref?.hash) hashRefs.push([`${label}.hash`, ref.path, ref.hash]);
  }
  for (const [label, rel, declared] of hashRefs) {
    const actual = sha256(fs.readFileSync(path.join(outputDir, rel)));
    if (actual === declared) {
      console.log(`  ✓ manifest ${label} (${rel})`);
    } else {
      ok = false;
      console.error(`  ✗ manifest ${label} (${rel}) — hash mismatch`);
      console.error(`      declared ${declared}`);
      console.error(`      actual   ${actual}`);
    }
  }

  if (!ok) {
    console.error('\nSelf-validation FAILED: generated template does not conform to its schemas.');
    process.exit(1);
  }
  console.log('\nTemplate generated successfully (self-validation passed).');
}

// Parse command line arguments
function parseArgs(): { extensions: string[]; output: string; listPresets: boolean } {
  const args = process.argv.slice(2);
  let extensions: string[] = [];
  let output = './cdx-document';
  let listPresets = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--list-presets' || arg === '-l') {
      listPresets = true;
    } else if (arg === '--extensions' || arg === '-e') {
      const extList = args[++i];
      if (extList) {
        extensions = extList.split(',').map(e => e.trim());
      }
    } else if (arg === '--preset' || arg === '-p') {
      const preset = args[++i];
      if (preset && presets[preset]) {
        extensions = presets[preset];
      } else {
        console.error(`Unknown preset: ${preset}`);
        console.error(`Available presets: ${Object.keys(presets).join(', ')}`);
        process.exit(1);
      }
    } else if (arg === '--output' || arg === '-o') {
      output = args[++i] || output;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
CDX Document Template Generator

Usage:
  npx tsx scripts/generate-template.ts [options]

Options:
  --extensions, -e <list>  Comma-separated list of extensions to include
  --preset, -p <name>      Use a named preset (see --list-presets)
  --output, -o <dir>       Output directory (default: ./cdx-document)
  --list-presets, -l       List available presets
  --help, -h               Show this help

Examples:
  npx tsx scripts/generate-template.ts --preset academic --output ./my-paper
  npx tsx scripts/generate-template.ts --extensions forms,security --output ./my-form
`);
      process.exit(0);
    }
  }

  // Validate extensions
  for (const ext of extensions) {
    if (!extensionConfigs[ext]) {
      console.error(`Unknown extension: ${ext}`);
      console.error(`Available extensions: ${Object.keys(extensionConfigs).join(', ')}`);
      process.exit(1);
    }
  }

  return { extensions, output, listPresets };
}

// Main
const { extensions, output, listPresets } = parseArgs();

if (listPresets) {
  console.log('Available presets:\n');
  for (const [name, exts] of Object.entries(presets)) {
    console.log(`  ${name.padEnd(15)} ${exts.length > 0 ? exts.join(', ') : '(core only)'}`);
  }
  console.log('\nAvailable extensions:\n');
  for (const [name, config] of Object.entries(extensionConfigs)) {
    console.log(`  ${name.padEnd(15)} ${config.id} v${config.version}`);
  }
  process.exit(0);
}

// Check if output directory exists
if (fs.existsSync(output)) {
  const entries = fs.readdirSync(output);
  if (entries.length > 0) {
    console.error(`Output directory is not empty: ${output}`);
    console.error('Please specify an empty or non-existent directory.');
    process.exit(1);
  }
}

generateTemplate(output, extensions);
