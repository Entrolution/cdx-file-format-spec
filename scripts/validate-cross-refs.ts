#!/usr/bin/env npx tsx

/**
 * Validates cross-references within spec documentation.
 *
 * This script:
 * 1. Extracts all internal references from spec markdown files
 * 2. Builds an index of all sections and anchors
 * 3. Reports broken or invalid references
 */

import * as fs from 'fs';
import * as path from 'path';

const rootDir = path.join(__dirname, '..');
const specDir = path.join(rootDir, 'spec');

interface Section {
  id: string;
  title: string;
  file: string;
  line: number;
}

interface Reference {
  target: string;
  file: string;
  line: number;
  context: string;
}

interface ValidationReport {
  sections: Section[];
  references: Reference[];
  broken: Reference[];
  valid: Reference[];
}

// Extract sections from a markdown file
function extractSections(filePath: string): Section[] {
  const sections: Section[] = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const filename = path.relative(rootDir, filePath);

  lines.forEach((line, index) => {
    // Match headings: # Title, ## Title, etc.
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const title = headingMatch[2];
      // Generate anchor from title (GitHub-style)
      const id = title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();

      sections.push({
        id,
        title,
        file: filename,
        line: index + 1
      });
    }

    // Also match explicit anchors like <a name="xxx">
    const anchorMatch = line.match(/<a\s+name=["']([^"']+)["']/i);
    if (anchorMatch) {
      sections.push({
        id: anchorMatch[1],
        title: `(anchor: ${anchorMatch[1]})`,
        file: filename,
        line: index + 1
      });
    }
  });

  return sections;
}

// Extract references from a markdown file
function extractReferences(filePath: string): Reference[] {
  const references: Reference[] = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const filename = path.relative(rootDir, filePath);

  lines.forEach((line, index) => {
    // Match markdown links: [text](target)
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = linkPattern.exec(line)) !== null) {
      const target = match[2];

      // Only check internal references (not external URLs)
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        references.push({
          target,
          file: filename,
          line: index + 1,
          context: match[0]
        });
      }
    }

    // Match "see section X.Y" patterns
    const sectionRefPattern = /see\s+(section\s+)?(\d+(\.\d+)*)/gi;
    while ((match = sectionRefPattern.exec(line)) !== null) {
      references.push({
        target: `section:${match[2]}`,
        file: filename,
        line: index + 1,
        context: match[0]
      });
    }

    // Match "(see Section X)" patterns
    const parenSectionPattern = /\(see\s+[Ss]ection\s+(\d+(\.\d+)*)\)/g;
    while ((match = parenSectionPattern.exec(line)) !== null) {
      references.push({
        target: `section:${match[1]}`,
        file: filename,
        line: index + 1,
        context: match[0]
      });
    }
  });

  return references;
}

// Recursively find all markdown files
function findMarkdownFiles(dir: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

// Build a canonical document-title -> relative-path index for the cross-document
// "<Document title> section X.Y" reference idiom. Titles come from each file's H1,
// minus the generic top-level "CDX ..." headings (which are never used as a
// reference anchor), plus the documented short-form aliases.
function buildTitleIndex(files: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const h1 = fs.readFileSync(file, 'utf8').split('\n').find((l) => /^#\s+/.test(l));
    if (!h1) continue;
    const title = h1.replace(/^#\s+/, '').trim();
    if (/^CDX\b/.test(title)) continue; // not used as a cross-reference anchor
    index.set(title.toLowerCase(), rel);
  }
  // Documented short forms: the Introduction's H1 is "CDX Specification", and the
  // Provenance and Lineage chapter is sometimes cited as "Provenance".
  index.set('introduction', 'spec/core/00-introduction.md');
  index.set('provenance', 'spec/core/09-provenance-and-lineage.md');
  return index;
}

// Build a per-file index of section numbers (e.g. "5", "5.4", "5.4.1") parsed from
// the leading number token of each heading. Fenced code blocks (``` or ~~~) are
// skipped so that "#"-prefixed lines inside diagrams/JSON snippets are not mistaken
// for headings; a fence is closed only by a fence of the same marker character, so
// a nested fence of the other kind cannot prematurely end the block.
function buildSectionNumberIndex(files: string[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const set = new Set<string>();
    let fence: string | null = null; // the opening fence char ('`' or '~') when inside a fence
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const fenceMatch = line.match(/^\s*(```+|~~~+)/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (fence === null) fence = marker; // opening fence
        else if (marker === fence) fence = null; // matching closing fence
        continue;
      }
      if (fence !== null) continue;
      const m = line.match(/^#{1,6}\s+(\d+(?:\.\d+)*)\b/);
      if (m) set.add(m[1]);
    }
    index.set(rel, set);
  }
  return index;
}

// Extract cross-document "<Document title> [spec] section(s) X.Y[, X.Z][ and X.W]"
// references. Anchored on the known-title set (longest title first) so generic
// prose like "the design goals in section 1.2" is not mistaken for a titled
// reference. Each captured section number becomes its own resolvable reference
// with target shape `titled:<relPath>#<number>`. A range form ("sections X to Y")
// splits on the range operator, so only its endpoints are validated, not interior
// numbers — acceptable while no titled range references exist in the corpus.
function extractTitledRefs(filePath: string, titleIndex: Map<string, string>): Reference[] {
  const references: Reference[] = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const filename = path.relative(rootDir, filePath);

  const titleAlt = [...titleIndex.keys()]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const numList = '\\d+(?:\\.\\d+)*(?:\\s*(?:,|and|–|-|to|&)\\s*\\d+(?:\\.\\d+)*)*';
  const pattern = new RegExp(
    `\\b(${titleAlt})\\b(?:\\s+(?:spec|specification))?\\s+sections?\\s+(${numList})`,
    'gi'
  );

  lines.forEach((line, index) => {
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const targetFile = titleIndex.get(match[1].toLowerCase());
      if (!targetFile) continue;
      const numbers = match[2].split(/\s*(?:,|and|–|-|to|&)\s*/).map((s) => s.trim()).filter(Boolean);
      for (const num of numbers) {
        references.push({
          target: `titled:${targetFile}#${num}`,
          file: filename,
          line: index + 1,
          context: match[0],
        });
      }
    }
  });

  return references;
}

// Validate a reference against known sections
function validateReference(
  ref: Reference,
  sections: Section[],
  files: string[],
  sectionNumbers: Map<string, Set<string>>
): boolean {
  const target = ref.target;

  // Handle cross-document titled section references: titled:<relPath>#<number>.
  // Resolves the named document's section-number index (the dominant cross-doc
  // idiom, previously unchecked).
  if (target.startsWith('titled:')) {
    const rest = target.slice('titled:'.length);
    const hashIdx = rest.lastIndexOf('#');
    const targetFile = rest.slice(0, hashIdx);
    const num = rest.slice(hashIdx + 1);
    const set = sectionNumbers.get(targetFile);
    return set !== undefined && set.has(num);
  }

  // Handle anchor references: #anchor
  if (target.startsWith('#')) {
    const anchor = target.slice(1);
    return sections.some(s => s.id === anchor);
  }

  // Handle file references: path/to/file.md or path/to/file.md#anchor
  if (target.includes('.md')) {
    const [filePart, anchorPart] = target.split('#');
    const resolvedPath = path.resolve(path.dirname(path.join(rootDir, ref.file)), filePart);
    const relativePath = path.relative(rootDir, resolvedPath);

    const fileExists = files.some(f => path.relative(rootDir, f) === relativePath);

    if (!fileExists) {
      return false;
    }

    if (anchorPart) {
      return sections.some(s => s.file === relativePath && s.id === anchorPart);
    }

    return true;
  }

  // Handle section number references: section:1.2.3
  if (target.startsWith('section:')) {
    // Section number references are informational - always valid
    // (They refer to numbered sections in the document, not anchors)
    return true;
  }

  // Handle relative paths without .md extension
  if (target.includes('/')) {
    // Could be a path to another file or directory
    const resolvedPath = path.resolve(path.dirname(path.join(rootDir, ref.file)), target);
    return fs.existsSync(resolvedPath);
  }

  // Default: assume it's an anchor in the same file
  const currentFileAnchor = target.startsWith('#') ? target.slice(1) : target;
  return sections.some(s => s.file === ref.file && s.id === currentFileAnchor);
}

// Main validation
function validateCrossRefs(): ValidationReport {
  console.log('Validating cross-references...\n');

  const markdownFiles = findMarkdownFiles(specDir);
  console.log(`Found ${markdownFiles.length} spec files`);

  // Build section index
  const allSections: Section[] = [];
  for (const file of markdownFiles) {
    const sections = extractSections(file);
    allSections.push(...sections);
  }
  console.log(`Indexed ${allSections.length} sections/anchors`);

  // Build the document-title and section-number indexes for cross-document
  // "<Document title> section X.Y" reference resolution.
  const titleIndex = buildTitleIndex(markdownFiles);
  const sectionNumbers = buildSectionNumberIndex(markdownFiles);

  // Extract all references
  const allReferences: Reference[] = [];
  let titledCount = 0;
  for (const file of markdownFiles) {
    allReferences.push(...extractReferences(file));
    const titled = extractTitledRefs(file, titleIndex);
    titledCount += titled.length;
    allReferences.push(...titled);
  }
  console.log(`Found ${allReferences.length} cross-references (${titledCount} cross-document section refs)\n`);

  // Validate references
  const broken: Reference[] = [];
  const valid: Reference[] = [];

  for (const ref of allReferences) {
    if (validateReference(ref, allSections, markdownFiles, sectionNumbers)) {
      valid.push(ref);
    } else {
      broken.push(ref);
    }
  }

  return {
    sections: allSections,
    references: allReferences,
    broken,
    valid
  };
}

// Run validation
const report = validateCrossRefs();

// Report results
console.log('='.repeat(60));

console.log(`\n✓ ${report.valid.length} valid references`);

if (report.broken.length > 0) {
  console.log(`\n✗ ${report.broken.length} broken references:`);
  report.broken.forEach(ref => {
    console.log(`\n  ${ref.file}:${ref.line}`);
    console.log(`    Target: ${ref.target}`);
    console.log(`    Context: ${ref.context}`);
  });
}

console.log('\n' + '='.repeat(60));

if (report.broken.length > 0) {
  console.log('\nCross-reference validation found issues.');
  process.exit(1);
} else {
  console.log('\nAll cross-references are valid.');
}
