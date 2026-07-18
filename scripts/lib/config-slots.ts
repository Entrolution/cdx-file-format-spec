/**
 * Single source of truth for the manifest's extension-config slots.
 *
 * The manifest leaves each extension's config slot (`legal`, `academic`,
 * `semantic`, `collaboration`) an open `{type: object}` BY DESIGN, so the core
 * manifest schema carries no dependency on extension schemas. That decoupling
 * means a malformed config would otherwise pass the manifest schema unchecked,
 * and the `{path, hash}` file references inside a slot would go hash-unverified.
 * Two gates close those gaps and both must agree on the slot set:
 *   - check-manifest-extension-config.ts validates each slot against the schema
 *     that describes its shape;
 *   - validate-examples.ts walks each slot for `{path, hash}` references and
 *     verifies the declared hash against the referenced file.
 * check-enumeration-coverage.ts asserts these slot keys equal the manifest's own
 * bare `{type: object}` top-level properties, so a newly added config slot cannot
 * drift out of either gate.
 *
 * legal/academic/semantic use their SCHEMA ROOT as the manifest-config shape
 * (e.g. legal's root is `{citationStyle, jurisdiction}`, additionalProperties:false);
 * collaboration uses a dedicated `manifestConfig` $def (its root describes a
 * comments/changes FILE, not the manifest slot).
 */

export interface ConfigSlot {
  schema: string;
  ref?: string;
}

export const CONFIG_SLOTS: Record<string, ConfigSlot> = {
  legal: { schema: 'legal.schema.json' },
  academic: { schema: 'academic.schema.json' },
  semantic: { schema: 'semantic.schema.json' },
  collaboration: { schema: 'collaboration.schema.json', ref: '#/$defs/manifestConfig' },
};
