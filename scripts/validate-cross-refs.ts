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

// Validate a reference against known sections
function validateReference(ref: Reference, sections: Section[], files: string[]): boolean {
  const target = ref.target;

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

  // Extract all references
  const allReferences: Reference[] = [];
  for (const file of markdownFiles) {
    const refs = extractReferences(file);
    allReferences.push(...refs);
  }
  console.log(`Found ${allReferences.length} cross-references\n`);

  // Validate references
  const broken: Reference[] = [];
  const valid: Reference[] = [];

  for (const ref of allReferences) {
    if (validateReference(ref, allSections, markdownFiles)) {
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
