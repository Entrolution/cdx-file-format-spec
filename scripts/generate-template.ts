#!/usr/bin/env npx tsx

/**
 * Generates minimal valid CDX document templates.
 *
 * Usage:
 *   npx tsx scripts/generate-template.ts --extensions academic,semantic --output ./my-doc
 *   npx tsx scripts/generate-template.ts --preset academic --output ./my-doc
 *   npx tsx scripts/generate-template.ts --list-presets
 */

import * as fs from 'fs';
import * as path from 'path';

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
        equations: { style: 'chapter.number', resetOn: 'chapter' },
        theorems: { style: 'chapter.number' },
        algorithms: { style: 'number', resetOn: 'chapter' },
        exercises: { style: 'chapter.number', resetOn: 'chapter' }
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
    id: 'cdx.security',
    version: '0.1',
    required: false,
    directories: ['security'],
    files: {
      'security/signatures.json': {
        version: '0.1',
        signatures: []
      }
    }
  },
  collaboration: {
    id: 'cdx.collaboration',
    version: '0.2',
    required: false,
    directories: ['collaboration'],
    files: {
      'collaboration/comments.json': {
        version: '0.2',
        threads: []
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

// Generate base manifest
function generateManifest(extensions: string[]): Record<string, unknown> {
  const now = new Date().toISOString();

  const manifest: Record<string, unknown> = {
    cdx: '0.1',
    id: 'pending',
    state: 'draft',
    created: now,
    modified: now,
    content: {
      path: 'content/document.json',
      hash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
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
      hash: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      default: true
    }];
  }

  // Add phantoms reference if phantoms extension is included
  if (extensions.includes('phantoms')) {
    manifest.phantoms = {
      clusters: 'phantoms/clusters.json'
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

// Generate Dublin Core metadata
function generateDublinCore(): Record<string, unknown> {
  return {
    title: 'Untitled Document',
    creator: 'Author Name',
    subject: 'Subject',
    description: 'Document description',
    date: new Date().toISOString().split('T')[0],
    type: 'Text',
    format: 'application/vnd.cdx+zip',
    language: 'en'
  };
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

  // Generate files
  const files: Record<string, unknown> = {
    'manifest.json': generateManifest(extensions),
    'content/document.json': generateContent(),
    'metadata/dublin-core.json': generateDublinCore()
  };

  // Add extension-specific files
  for (const ext of extensions) {
    const config = extensionConfigs[ext];
    if (config.files) {
      Object.assign(files, config.files);
    }
  }

  // Write files
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(outputDir, filePath);
    fs.writeFileSync(fullPath, JSON.stringify(content, null, 2) + '\n');
    console.log(`  Created: ${filePath}`);
  }

  console.log('\nTemplate generated successfully!');
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
