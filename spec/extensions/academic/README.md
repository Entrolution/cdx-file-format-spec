# Academic Extension

**Extension ID**: `cdx.academic`
**Version**: 0.1
**Status**: Draft

## 1. Overview

The Academic Extension provides structured support for academic and scientific documents:

- Theorem-like environments (theorem, lemma, definition, etc.)
- Proof blocks with method annotations
- Exercises with multi-part support, hints, and solutions
- Exercise sets for grouped problems
- Multi-line equation environments with numbering
- Algorithm blocks with line-numbered pseudocode
- Cross-references for theorems and equations
- Configurable numbering systems

## 2. Extension Declaration

```json
{
  "extensions": [
    {
      "id": "cdx.academic",
      "version": "0.1",
      "required": false
    }
  ],
  "academic": {
    "numbering": { "path": "academic/numbering.json", "hash": "sha256:<numbering-hash>" }
  }
}
```

The `numbering` file is declared as a `{path, hash}` reference; the hash binds its content through the manifest projection (section 13).

## 3. Abstract Block

### 3.1 academic:abstract

The abstract block provides semantic structure for paper/report abstracts with optional keywords and structured sections.

```json
{
  "type": "academic:abstract",
  "children": [
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "This paper presents a novel approach to..." }
      ]
    }
  ],
  "keywords": ["machine learning", "document formats", "semantic web"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"academic:abstract"` |
| `children` | array | Yes (unless `sections`) | Abstract content (paragraph blocks) |
| `keywords` | array | No | List of keywords/key phrases |
| `sections` | array | No | Structured abstract sections, in display order (see below) |

#### 3.1.1 Structured Abstracts

For journals requiring structured abstracts (common in medical and scientific publishing):

```json
{
  "type": "academic:abstract",
  "sections": [
    { "label": "Background", "children": [{ "type": "paragraph", "children": [{ "type": "text", "value": "..." }] }] },
    { "label": "Methods", "children": [{ "type": "paragraph", "children": [{ "type": "text", "value": "..." }] }] },
    { "label": "Results", "children": [{ "type": "paragraph", "children": [{ "type": "text", "value": "..." }] }] },
    { "label": "Conclusions", "children": [{ "type": "paragraph", "children": [{ "type": "text", "value": "..." }] }] }
  ],
  "keywords": ["clinical trial", "randomized controlled"]
}
```

The `sections` array is rendered in order, so authors control the sequence (e.g., Background → Methods → Results → Conclusions) independently of how object keys would sort. Each entry's `label` is the displayed section heading. Common structured abstract section labels:
- `background` / `introduction` / `context`
- `objective` / `purpose` / `aim`
- `methods` / `materials`
- `results` / `findings`
- `conclusions` / `discussion`
- `significance` / `implications`

When `sections` is provided, `children` MUST be omitted (an abstract carries one or the other, not both). Implementations render the sections in array order, each prefixed with its `label` (e.g., "**Background:** ...").

## 4. Theorem-Like Blocks

### 4.1 academic:theorem

Covers built-in variants: theorem, lemma, proposition, corollary, definition, conjecture, remark, example.

```json
{
  "type": "academic:theorem",
  "variant": "theorem",
  "id": "thm-max-principle",
  "number": "2.3.8",
  "numbering": "auto",
  "title": "Maximum Principle",
  "uses": ["#def-harmonic", "#lemma-subharmonic"],
  "restate": false,
  "children": [
    { "type": "paragraph", "children": [...] }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"academic:theorem"` |
| `variant` | string | Yes | Built-in or custom variant name |
| `id` | string | No | Unique identifier for cross-referencing |
| `number` | string | No | Explicit number (e.g., "2.3.8"); authoritative and integrity-protected when present (section 10.5) |
| `numbering` | string | No | `"auto"`, `"none"`, or omit for default; resolution precedence in section 10.5 |
| `title` | string | No | Custom title (e.g., "Hille-Yoshida Theorem") |
| `uses` | array | No | Content Anchor URIs of dependencies (definitions, lemmas used) |
| `restate` | boolean | No | If `true`, this is a restatement of a previously stated theorem |
| `children` | array | Yes | Content blocks |

### 4.2 Built-in Variants

| Variant | Typical Use |
|---------|-------------|
| `theorem` | Major results |
| `lemma` | Supporting results |
| `proposition` | Secondary results |
| `corollary` | Consequences of theorems |
| `definition` | Formal definitions |
| `conjecture` | Unproven statements |
| `remark` | Observations and notes |
| `example` | Illustrative examples |

### 4.3 Custom Variants

Define custom theorem-like environments in the numbering configuration:

```json
{
  "customVariants": {
    "axiom": {
      "label": "Axiom",
      "sharesWith": "definition"
    },
    "postulate": {
      "label": "Postulate",
      "sharesWith": "definition"
    },
    "law": {
      "label": "Law",
      "sharesWith": "theorem"
    },
    "invariant": {
      "label": "Invariant",
      "sharesWith": null
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | string | Yes | Display label for the variant |
| `sharesWith` | string\|null | No | Share counter with this variant, or `null` for independent counter |

## 5. Proof Blocks

### 5.1 academic:proof

```json
{
  "type": "academic:proof",
  "of": "#thm-max-principle",
  "title": "Proof",
  "method": "contradiction",
  "qed": "symbol",
  "children": [
    { "type": "paragraph", "children": [...] }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"academic:proof"` |
| `of` | string | No | Content Anchor URI to the theorem being proved |
| `title` | string | No | Override title (default: "Proof") |
| `method` | string | No | Proof method (see below) |
| `qed` | string | No | QED style: `"symbol"` (default), `"text"`, `"none"` |
| `children` | array | Yes | Proof content |

### 5.2 Proof Methods

| Method | Description |
|--------|-------------|
| `direct` | Direct proof |
| `contradiction` | Proof by contradiction (reductio ad absurdum) |
| `contrapositive` | Proof by contrapositive |
| `induction` | Proof by mathematical induction |
| `strong-induction` | Proof by strong/complete induction |
| `structural-induction` | Proof by structural induction |
| `cases` | Proof by exhaustive cases |
| `construction` | Proof by construction |
| `counting` | Combinatorial/counting argument |
| `probabilistic` | Probabilistic method |

## 6. Exercises

### 6.1 academic:exercise

```json
{
  "type": "academic:exercise",
  "id": "ex-2-5",
  "number": "2.5",
  "difficulty": "medium",
  "children": [
    { "type": "paragraph", "children": [...] }
  ],
  "parts": [
    {
      "label": "a",
      "children": [{ "type": "paragraph", "children": [...] }],
      "hints": [...],
      "solution": { "visibility": "hidden", "children": [...] }
    },
    {
      "label": "b",
      "children": [{ "type": "paragraph", "children": [...] }]
    }
  ],
  "hints": [
    { "type": "paragraph", "children": [...] }
  ],
  "solution": {
    "visibility": "hidden",
    "children": [...]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"academic:exercise"` |
| `id` | string | No | Unique identifier |
| `number` | string | No | Exercise number |
| `difficulty` | string | No | `"easy"`, `"medium"`, `"hard"` |
| `children` | array | Yes | Problem statement (preamble if parts exist) |
| `parts` | array | No | Multi-part sub-exercises |
| `hints` | array | No | Hint paragraphs (applies to whole exercise) |
| `solution` | object | No | Solution with visibility control |

### 6.2 Exercise Parts

Each part in the `parts` array:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | string | Yes | Part label (e.g., "a", "i", "1") |
| `children` | array | Yes | Part problem statement |
| `hints` | array | No | Part-specific hints |
| `solution` | object | No | Part-specific solution |

### 6.3 Solution Visibility

```json
{
  "visibility": "hidden",
  "children": [...]
}
```

| Visibility | Description |
|------------|-------------|
| `visible` | Solution is always shown |
| `hidden` | Solution is not rendered by default |
| `spoiler` | Solution is hidden behind a reveal interaction |
| `instructor-only` | Solution requires instructor/elevated access |

Optional date-based reveal:

```json
{
  "visibility": "hidden",
  "revealAfter": "2025-03-15T00:00:00Z",
  "children": [...]
}
```

### 6.4 Exercise Sets

Group related exercises with shared context:

```json
{
  "type": "academic:exercise-set",
  "id": "exercises-ch2",
  "title": "Chapter 2 Exercises",
  "preamble": [
    { "type": "paragraph", "children": [
      { "type": "text", "value": "In exercises 1-5, let " },
      { "type": "text", "value": "f", "marks": [{ "type": "math", "format": "latex", "source": "f" }] },
      { "type": "text", "value": " be a continuous function on [0,1]." }
    ]}
  ],
  "exercises": [
    { "type": "academic:exercise", "number": "1", ... },
    { "type": "academic:exercise", "number": "2", ... }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"academic:exercise-set"` |
| `id` | string | No | Unique identifier |
| `title` | string | No | Set title (e.g., "Chapter 2 Exercises") |
| `preamble` | array | No | Shared context/instructions for all exercises |
| `exercises` | array | Yes | Array of `academic:exercise` blocks |

## 7. Multi-Line Equations

### 7.1 academic:equation-group

```json
{
  "type": "academic:equation-group",
  "environment": "align",
  "id": "eq-group-1",
  "lines": [
    {
      "value": "f(x) &= x^2 + 1",
      "number": "2.5",
      "id": "eq-fx"
    },
    {
      "value": "&= (x+i)(x-i)",
      "number": null
    },
    {
      "value": "g(x) &= 2x",
      "tag": "*",
      "id": "eq-gx"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"academic:equation-group"` |
| `environment` | string | No | LaTeX environment: `"align"`, `"gather"`, `"alignat"`, `"split"` |
| `id` | string | No | Group identifier |
| `lines` | array | Yes | Array of equation lines |

### 7.2 Equation Lines

Each line in the `lines` array:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `value` | string | Yes | LaTeX for this line |
| `number` | string\|null | No | Line number, `null` for unnumbered |
| `tag` | string | No | Custom tag (e.g., `"*"`, `"\dagger"`) instead of number |
| `id` | string | No | Line identifier for references |

**Note:** A line carries either `number` or `tag`, not both — including both fields is invalid (a `number` of `null` still occupies the number slot). A line with neither is unnumbered.

> **Renderer safety.** Equation `value` and algorithm-line `content` are LaTeX rendered by a math engine, and untrusted LaTeX is a code-execution and denial-of-service surface. A renderer MUST disable file-access and shell-escape constructs and link/HTML-emitting macros, and MUST bound macro expansion, on untrusted source — preferring a restricted (KaTeX-class) renderer over a full TeX system (Renderer Safety section 3.2).

## 7.3 Chemical Formulas (mhchem)

For chemical formulas and reaction equations, use the core `math` block with the mhchem LaTeX package notation. The mhchem package provides intuitive syntax for molecular formulas and chemical reactions.

### 7.3.1 Basic Chemical Formulas

```json
{
  "type": "math",
  "display": true,
  "format": "latex",
  "value": "\\ce{H2SO4}"
}
```

This renders as: H₂SO₄

### 7.3.2 Chemical Reactions

```json
{
  "type": "math",
  "display": true,
  "format": "latex",
  "value": "\\ce{2H2 + O2 -> 2H2O}"
}
```

### 7.3.3 mhchem Syntax Reference

| Syntax | Description | Example | Result |
|--------|-------------|---------|--------|
| `\\ce{H2O}` | Molecular formula | `\\ce{H2O}` | H₂O |
| `->` | Reaction arrow | `\\ce{A -> B}` | A → B |
| `<->` | Equilibrium | `\\ce{A <-> B}` | A ⇌ B |
| `<=>>` | Equilibrium (shifted right) | `\\ce{A <=>> B}` | A ⇄ B |
| `^{2+}` | Charge | `\\ce{Ca^{2+}}` | Ca²⁺ |
| `v` | Precipitate | `\\ce{AgCl v}` | AgCl↓ |
| `^` | Gas evolution | `\\ce{CO2 ^}` | CO₂↑ |
| `[aq]` | State symbols | `\\ce{NaCl[aq]}` | NaCl(aq) |
| `+` | Reactant separator | `\\ce{A + B}` | A + B |

### 7.3.4 Complex Examples

**Acid-base reaction:**
```json
{
  "type": "math",
  "display": true,
  "format": "latex",
  "value": "\\ce{H2SO4 + 2NaOH -> Na2SO4 + 2H2O}"
}
```

**Redox reaction with states:**
```json
{
  "type": "math",
  "display": true,
  "format": "latex",
  "value": "\\ce{Fe^{2+}[aq] + Ce^{4+}[aq] -> Fe^{3+}[aq] + Ce^{3+}[aq]}"
}
```

**Organic chemistry:**
```json
{
  "type": "math",
  "display": true,
  "format": "latex",
  "value": "\\ce{CH3CH2OH ->[\\text{oxidation}] CH3CHO ->[\\text{oxidation}] CH3COOH}"
}
```

**Note:** Implementations rendering math blocks SHOULD support the mhchem package syntax. For maximum compatibility, documents MAY include pre-rendered display text in accompanying elements.

## 8. Algorithm Blocks

### 8.1 academic:algorithm

```json
{
  "type": "academic:algorithm",
  "id": "alg-quicksort",
  "number": "1",
  "title": "QuickSort",
  "caption": "Recursive quicksort algorithm",
  "lineNumbering": true,
  "startLine": 1,
  "lines": [
    { "content": "\\textbf{function} QuickSort(A, lo, hi)", "label": "fn-start" },
    { "content": "  \\textbf{if} lo < hi \\textbf{then}", "indent": 1 },
    { "content": "    p \\gets Partition(A, lo, hi)", "indent": 2 },
    { "content": "    QuickSort(A, lo, p - 1)", "indent": 2 },
    { "content": "    QuickSort(A, p + 1, hi)", "indent": 2 },
    { "content": "  \\textbf{end if}", "indent": 1 },
    { "content": "\\textbf{end function}", "label": "fn-end" }
  ],
  "inputs": [
    { "name": "A", "description": "Array to sort" },
    { "name": "lo", "description": "Lower index" },
    { "name": "hi", "description": "Upper index" }
  ],
  "outputs": [
    { "name": "A", "description": "Sorted array (in-place)" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"academic:algorithm"` |
| `id` | string | No | Unique identifier |
| `number` | string | No | Algorithm number |
| `title` | string | No | Algorithm name |
| `caption` | string | No | Description caption |
| `lineNumbering` | boolean | No | Show line numbers (default: `true`) |
| `startLine` | integer | No | Starting line number (default: 1) |
| `lines` | array | Yes | Pseudocode lines |
| `inputs` | array | No | Input parameters |
| `outputs` | array | No | Output description |

### 8.2 Algorithm Lines

Each line in the `lines` array:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Line content (may include LaTeX for math/formatting) |
| `indent` | integer | No | Indentation level (default: 0) |
| `label` | string | No | Label for line references |
| `comment` | string | No | Inline comment |

### 8.3 Algorithm Input/Output

```json
{
  "name": "A",
  "description": "Array of n integers"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Parameter name |
| `description` | string | No | Parameter description |

## 9. Cross-References

> **Reader dispositions.** Although a `*-ref` `target` uses Content Anchor syntax, the `academic:theorem-ref`, `academic:equation-ref`, and `academic:algorithm-ref` marks are extension cross-references resolved at render time, so a dangling target is a rendering-degradation WARNING in all states (State Machine section 5.4), not the INTEGRITY-ERROR of a dangling core anchor. A reader MUST fill each placeholder from the resolved target at render time; the authored display text carried by the mark's text node is a fallback, used only when the target is unresolvable or a placeholder cannot be filled, and a value resolved from the target takes precedence over any disagreeing cached text. When a placeholder cannot be filled — `{number}` for an unnumbered target, `{title}` for an untitled one — the reader substitutes that authored display text, otherwise the bare target id, and never renders an empty string or the literal `{number}`/`{title}` token.

### 9.1 academic:theorem-ref Mark

Reference a theorem-like block:

```json
{
  "type": "text",
  "value": "Theorem 2.3.8",
  "marks": [
    {
      "type": "academic:theorem-ref",
      "target": "#thm-max-principle",
      "format": "Theorem {number}"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"academic:theorem-ref"` |
| `target` | string | Yes | Content Anchor URI to the theorem |
| `format` | string | No | Display format (default: `"{variant} {number}"`) |

Format placeholders:
- `{variant}` - Variant name (e.g., "Theorem", "Lemma")
- `{number}` - Theorem number
- `{title}` - Theorem title (if present)

### 9.2 academic:equation-ref Mark

Reference a numbered equation:

```json
{
  "type": "text",
  "value": "(2.5)",
  "marks": [
    {
      "type": "academic:equation-ref",
      "target": "#eq-fx",
      "format": "({number})"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"academic:equation-ref"` |
| `target` | string | Yes | Content Anchor URI to the equation |
| `format` | string | No | Display format (default: `"({number})"`) |

`{number}` resolves to the target line's displayed identifier: its `number`, or — when the line is displayed by a `tag` instead (section 7.2) — that `tag`. If the target line is both unnumbered and untagged, `{number}` cannot be filled and the reader uses the fallback in section 9.

### 9.3 academic:algorithm-ref Mark

Reference an algorithm or algorithm line:

```json
{
  "type": "text",
  "value": "Algorithm 1",
  "marks": [
    {
      "type": "academic:algorithm-ref",
      "target": "#alg-quicksort",
      "format": "Algorithm {number}"
    }
  ]
}
```

For line references:

```json
{
  "type": "text",
  "value": "line 1",
  "marks": [
    {
      "type": "academic:algorithm-ref",
      "target": "#alg-quicksort",
      "line": "fn-start",
      "format": "line {line}"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Always `"academic:algorithm-ref"` |
| `target` | string | Yes | Content Anchor URI to the algorithm |
| `line` | string | No | Line label for line-specific references |
| `format` | string | No | Display format |

`{number}` resolves to the target algorithm's own number. `{line}` names a target line by its `label` (section 8.2) and resolves to that line's displayed line number: `startLine` (section 8.1, default 1) plus the line's zero-based position in the algorithm's `lines` array. When the target algorithm sets `lineNumbering: false` it displays no line numbers, so `{line}` cannot be filled and the reader uses the fallback in section 9. A `line` label that matches no line in the target algorithm is a dangling reference — a rendering-degradation WARNING (section 9), resolved to the fallback text.

## 10. Numbering Configuration

Location: `academic/numbering.json`

```json
{
  "version": "0.1",
  "equations": {
    "style": "chapter.number",
    "resetOn": "heading1"
  },
  "theorems": {
    "style": "chapter.section.number",
    "counters": {
      "theorem": { "share": ["lemma", "proposition", "corollary"] },
      "definition": { "share": ["conjecture"] },
      "remark": { "share": ["example"] }
    }
  },
  "algorithms": {
    "style": "number",
    "resetOn": "heading1"
  },
  "exercises": {
    "style": "chapter.number",
    "resetOn": "heading1"
  },
  "customVariants": {
    "axiom": {
      "label": "Axiom",
      "sharesWith": "definition"
    },
    "postulate": {
      "label": "Postulate",
      "sharesWith": "definition"
    },
    "law": {
      "label": "Law",
      "sharesWith": "theorem"
    }
  }
}
```

The `version` field follows the extension version contract in the CDX Extensions overview (Versioning): a higher minor is processed with unrecognized fields ignored; a higher major — or a reader without academic support — follows the manifest `required` flag; and because `academic/numbering.json` is outside the document hash, a version mismatch degrades rendering (a WARNING), never an integrity error.

### 10.1 Numbering Styles

| Style | Example | Description |
|-------|---------|-------------|
| `number` | 1, 2, 3 | Simple sequential |
| `chapter.number` | 2.1, 2.2 | Chapter-prefixed |
| `chapter.section.number` | 2.3.1, 2.3.2 | Full hierarchical |
| `section.number` | 3.1, 3.2 | Section-prefixed |

### 10.2 Counter Sharing

Theorem-like environments can share counters. When counters are shared, all variants in the group increment the same counter:

```json
"counters": {
  "theorem": { "share": ["lemma", "proposition", "corollary"] }
}
```

This produces: Theorem 1, Lemma 2, Proposition 3, Theorem 4, etc.

### 10.3 Reset Triggers

The `resetOn` field accepts heading level identifiers: `heading1` through `heading6`, corresponding to the core `heading` block's `level` attribute. For example, `"heading1"` resets numbering at each level-1 heading.

| Reset On | Description |
|----------|-------------|
| `heading1` | Reset at each level-1 heading |
| `heading2` | Reset at each level-2 heading |
| `heading3` | Reset at each level-3 heading |
| `heading4` | Reset at each level-4 heading |
| `heading5` | Reset at each level-5 heading |
| `heading6` | Reset at each level-6 heading |
| `none` | Never reset (document-wide numbering) |

### 10.4 Auto-Numbering Algorithm

When a number is auto-computed (section 10.5), every conforming reader MUST derive it by the following deterministic procedure, so that two readers display identical numbers.

**Document order.** The reader walks the content tree in document order: a pre-order traversal that follows every array of content blocks — among them `children`, an abstract's `sections[].children`, an equation group's `lines`, an exercise set's `preamble` and `exercises`, an exercise's `parts` and `hints`, a solution's `children`, and an algorithm's `lines` — in array order, descending into a block before continuing to its next sibling. Array order is preserved by the canonical form; only object keys are reordered by hashing (Document Hashing specification, sections 4.3.1–4.3.2).

**Heading counters.** The reader maintains a counter for each heading level 1–6, all initialized to 0. On a core `heading` block of level *L* (its `level` attribute), it increments the level-*L* counter by 1 and resets every counter for a level greater than *L* to 0. The **chapter** component is the level-1 counter; the **section** component is the level-2 counter.

**Environments and numbered units.** Each numbered environment has one sequence counter, initialized to 0. The environments and the units that advance their counters are:

- **theorem-like blocks** — one unit per `academic:theorem` (or custom-variant) block whose `numbering` is `"auto"` (section 10.5);
- **equations** — one unit per auto-numbered display line of an `academic:equation-group` (a `lines[]` entry with neither a `tag` nor an explicit `number`; a `number: null` line is unnumbered);
- **algorithms** — one unit per `academic:algorithm` block;
- **exercises** — one unit per `academic:exercise` block (an `academic:exercise-set` contributes each exercise in its `exercises` array; an exercise's `parts` are lettered sub-items the renderer labels, not separate units).

Equations, algorithms, and exercises are auto-numbered whenever `academic/numbering.json` configures that environment; theorem-like blocks are auto-numbered only when the block sets `numbering: "auto"`.

**Counter sharing.** Variants listed together under `theorems.counters` (section 10.2) share one sequence counter. A custom variant (section 4.3) shares the counter of its `sharesWith` target, or has its own independent counter when `sharesWith` is `null`.

**Reset.** An environment's **reset level** is the heading level named by its `resetOn` when it declares one (equations, algorithms, exercises); a theorem-like environment has no `resetOn`, so its reset level is the deepest heading level named by its `style` prefix — `chapter` is level 1, `section` is level 2 — and a bare `number` style (no prefix) never resets. `resetOn: "none"` never resets. The reader resets a sequence counter to 0 at every heading whose level is at most the environment's reset level, so a new chapter restarts section-scoped counters.

**Advancing and composing.** On reaching a numbered unit whose number is auto-computed, the reader increments its environment's sequence counter by 1 (after any reset triggered by an intervening heading), then forms the number from the environment's `style` (section 10.1): each component is replaced by a counter value — `chapter` → the chapter counter, `section` → the section counter, `number` → the sequence counter — joined with `.`. With `style: "chapter.section.number"`, chapter 2, section 3, and sequence 8 produce `2.3.8`.

**Explicit numbers and restatements.** A unit carrying an explicit number — a theorem-like block with a `number`, or an equation line with a `number` or `tag` — is displayed as authored and does NOT advance its environment's sequence counter (section 10.5). A `restate: true` theorem repeats a theorem stated earlier, so it SHOULD carry that theorem's explicit `number`; it is not auto-numbered and advances no counter (section 10.5).

**Skipped levels.** A component whose heading level has not yet been incremented is the value 0 (for example, a numbered block before any heading, or a `chapter.section` style with no level-2 heading yet in the current chapter). Authors SHOULD ensure the heading levels named by a style occur before the units that use them.

**Integrity.** `academic/numbering.json` is out-of-hash (section 13); a missing or unparseable numbering configuration is a rendering-degradation WARNING in all states (State Machine section 5.4), never an integrity error.

### 10.5 Explicit Numbers and Precedence

A theorem-like block MAY carry an explicit `number` and a `numbering` mode (`"auto"`, `"none"`, or omitted). The reader resolves the displayed number deterministically:

1. If `numbering` is `"none"`, the block is unnumbered: no number is displayed and it advances no counter. A `*-ref` whose target is this block cannot fill `{number}`, so the reader substitutes the authored display text carried by the mark's text node, otherwise the bare target id (section 9). Any `number` present is ignored for display.
2. Otherwise, if an explicit `number` is present, it is displayed verbatim. An explicit `number` is authored content carried in the document hash, so it is integrity-protected (section 13), takes precedence over any auto value, and does not advance the auto sequence counter (section 10.4).
3. Otherwise, if `numbering` is `"auto"`, the number is computed by the auto-numbering algorithm (section 10.4); a number derived this way is advisory and out-of-hash (section 13).
4. Otherwise (no `number`, `numbering` omitted), the block is unnumbered.

Equation lines, algorithm blocks, and exercises have no `numbering` field: they are auto-numbered when `academic/numbering.json` configures their environment (section 10.4), and an explicit per-unit `number` — or, for an equation line, a `tag` — overrides the auto value the same way and likewise advances no counter.

A `restate: true` theorem repeats a previously stated theorem rather than introducing a new one: it is never auto-numbered (rule 3 does not apply), SHOULD carry that theorem's explicit `number` (resolved by rule 2), and advances no counter.

Displayed numbers are therefore author-stored, in signed content, exactly when an explicit `number` is present, and reader-computed otherwise.

## 11. Examples

### 11.1 Complete Theorem with Proof

```json
[
  {
    "type": "academic:theorem",
    "variant": "definition",
    "id": "def-harmonic",
    "number": "2.3.1",
    "children": [
      {
        "type": "paragraph",
        "children": [
          { "type": "text", "value": "A function " },
          { "type": "text", "value": "u", "marks": [{ "type": "math", "format": "latex", "source": "u" }] },
          { "type": "text", "value": " is " },
          { "type": "text", "value": "harmonic", "marks": [{ "type": "strong" }] },
          { "type": "text", "value": " if " },
          { "type": "text", "value": "\\Delta u = 0", "marks": [{ "type": "math", "format": "latex", "source": "\\Delta u = 0" }] },
          { "type": "text", "value": "." }
        ]
      }
    ]
  },
  {
    "type": "academic:theorem",
    "variant": "theorem",
    "id": "thm-max-principle",
    "number": "2.3.8",
    "title": "Maximum Principle",
    "uses": ["#def-harmonic"],
    "children": [
      {
        "type": "paragraph",
        "children": [
          { "type": "text", "value": "Let " },
          { "type": "text", "value": "u", "marks": [{ "type": "math", "format": "latex", "source": "u" }] },
          { "type": "text", "value": " be a harmonic function on a bounded domain " },
          { "type": "text", "value": "\\Omega", "marks": [{ "type": "math", "format": "latex", "source": "\\Omega" }] },
          { "type": "text", "value": ". Then " },
          { "type": "text", "value": "u", "marks": [{ "type": "math", "format": "latex", "source": "u" }] },
          { "type": "text", "value": " attains its maximum on the boundary." }
        ]
      }
    ]
  },
  {
    "type": "academic:proof",
    "of": "#thm-max-principle",
    "method": "contradiction",
    "qed": "symbol",
    "children": [
      {
        "type": "paragraph",
        "children": [
          { "type": "text", "value": "Suppose " },
          { "type": "text", "value": "u", "marks": [{ "type": "math", "format": "latex", "source": "u" }] },
          { "type": "text", "value": " attains a maximum at an interior point. Then by the mean value property..." }
        ]
      }
    ]
  }
]
```

### 11.2 Multi-Part Exercise with Solution

```json
{
  "type": "academic:exercise",
  "id": "ex-2-5",
  "number": "2.5",
  "difficulty": "medium",
  "children": [
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "Let " },
        { "type": "text", "value": "f(x) = x^2 + 1", "marks": [{ "type": "math", "format": "latex", "source": "f(x) = x^2 + 1" }] },
        { "type": "text", "value": "." }
      ]
    }
  ],
  "parts": [
    {
      "label": "a",
      "children": [
        {
          "type": "paragraph",
          "children": [
            { "type": "text", "value": "Find " },
            { "type": "text", "value": "f'(x)", "marks": [{ "type": "math", "format": "latex", "source": "f'(x)" }] },
            { "type": "text", "value": "." }
          ]
        }
      ],
      "solution": {
        "visibility": "spoiler",
        "children": [
          {
            "type": "paragraph",
            "children": [
              { "type": "text", "value": "f'(x) = 2x", "marks": [{ "type": "math", "format": "latex", "source": "f'(x) = 2x" }] }
            ]
          }
        ]
      }
    },
    {
      "label": "b",
      "children": [
        {
          "type": "paragraph",
          "children": [
            { "type": "text", "value": "Find the critical points of " },
            { "type": "text", "value": "f", "marks": [{ "type": "math", "format": "latex", "source": "f" }] },
            { "type": "text", "value": "." }
          ]
        }
      ],
      "hints": [
        {
          "type": "paragraph",
          "children": [
            { "type": "text", "value": "Set the derivative equal to zero." }
          ]
        }
      ],
      "solution": {
        "visibility": "hidden",
        "children": [
          {
            "type": "paragraph",
            "children": [
              { "type": "text", "value": "Setting " },
              { "type": "text", "value": "f'(x) = 0", "marks": [{ "type": "math", "format": "latex", "source": "f'(x) = 0" }] },
              { "type": "text", "value": " gives " },
              { "type": "text", "value": "x = 0", "marks": [{ "type": "math", "format": "latex", "source": "x = 0" }] },
              { "type": "text", "value": "." }
            ]
          }
        ]
      }
    }
  ]
}
```

### 11.3 Algorithm with References

```json
[
  {
    "type": "academic:algorithm",
    "id": "alg-binary-search",
    "number": "2",
    "title": "BinarySearch",
    "caption": "Binary search in a sorted array",
    "lineNumbering": true,
    "inputs": [
      { "name": "A", "description": "Sorted array of n elements" },
      { "name": "target", "description": "Value to find" }
    ],
    "outputs": [
      { "name": "index", "description": "Index of target, or -1 if not found" }
    ],
    "lines": [
      { "content": "lo \\gets 0", "label": "init-lo" },
      { "content": "hi \\gets n - 1", "label": "init-hi" },
      { "content": "\\textbf{while} lo \\leq hi \\textbf{do}", "label": "loop-start" },
      { "content": "mid \\gets \\lfloor (lo + hi) / 2 \\rfloor", "indent": 1 },
      { "content": "\\textbf{if} A[mid] = target \\textbf{then}", "indent": 1 },
      { "content": "\\textbf{return} mid", "indent": 2, "label": "found" },
      { "content": "\\textbf{else if} A[mid] < target \\textbf{then}", "indent": 1 },
      { "content": "lo \\gets mid + 1", "indent": 2 },
      { "content": "\\textbf{else}", "indent": 1 },
      { "content": "hi \\gets mid - 1", "indent": 2 },
      { "content": "\\textbf{end if}", "indent": 1 },
      { "content": "\\textbf{end while}", "label": "loop-end" },
      { "content": "\\textbf{return} -1", "comment": "not found" }
    ]
  },
  {
    "type": "paragraph",
    "children": [
      { "type": "text", "value": "The loop invariant at " },
      {
        "type": "text",
        "value": "line 3",
        "marks": [
          {
            "type": "academic:algorithm-ref",
            "target": "#alg-binary-search",
            "line": "loop-start",
            "format": "line {line}"
          }
        ]
      },
      { "type": "text", "value": " ensures that if target exists, it is in A[lo..hi]." }
    ]
  }
]
```

### 11.4 Equation Group with Custom Tags

```json
{
  "type": "academic:equation-group",
  "environment": "align",
  "id": "eq-maxwell",
  "lines": [
    {
      "value": "\\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\epsilon_0}",
      "number": "1",
      "id": "eq-gauss"
    },
    {
      "value": "\\nabla \\cdot \\mathbf{B} &= 0",
      "number": "2",
      "id": "eq-gauss-mag"
    },
    {
      "value": "\\nabla \\times \\mathbf{E} &= -\\frac{\\partial \\mathbf{B}}{\\partial t}",
      "number": "3",
      "id": "eq-faraday"
    },
    {
      "value": "\\nabla \\times \\mathbf{B} &= \\mu_0 \\mathbf{J} + \\mu_0 \\epsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}",
      "number": "4",
      "id": "eq-ampere"
    },
    {
      "value": "&\\quad\\text{(in Gaussian units)}",
      "tag": "*"
    }
  ]
}
```

### 11.5 Exercise Set with Shared Context

```json
{
  "type": "academic:exercise-set",
  "id": "exercises-integration",
  "title": "Integration Exercises",
  "preamble": [
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "In exercises 1-3, evaluate the integral. Show all work." }
      ]
    }
  ],
  "exercises": [
    {
      "type": "academic:exercise",
      "number": "1",
      "difficulty": "easy",
      "children": [
        {
          "type": "paragraph",
          "children": [
            { "type": "text", "value": "\\int x^2 \\, dx", "marks": [{ "type": "math", "format": "latex", "source": "\\int x^2 \\, dx" }] }
          ]
        }
      ]
    },
    {
      "type": "academic:exercise",
      "number": "2",
      "difficulty": "medium",
      "children": [
        {
          "type": "paragraph",
          "children": [
            { "type": "text", "value": "\\int e^x \\sin x \\, dx", "marks": [{ "type": "math", "format": "latex", "source": "\\int e^x \\sin x \\, dx" }] }
          ]
        }
      ]
    },
    {
      "type": "academic:exercise",
      "number": "3",
      "difficulty": "hard",
      "children": [
        {
          "type": "paragraph",
          "children": [
            { "type": "text", "value": "\\int \\frac{1}{1+x^4} \\, dx", "marks": [{ "type": "math", "format": "latex", "source": "\\int \\frac{1}{1+x^4} \\, dx" }] }
          ]
        }
      ]
    }
  ]
}
```

### 11.6 Restated Theorem Before Proof

```json
[
  {
    "type": "academic:theorem",
    "variant": "theorem",
    "id": "thm-fundamental",
    "number": "1.2.3",
    "title": "Fundamental Theorem of Calculus",
    "restate": true,
    "children": [
      {
        "type": "paragraph",
        "children": [
          { "type": "text", "value": "If " },
          { "type": "text", "value": "f", "marks": [{ "type": "math", "format": "latex", "source": "f" }] },
          { "type": "text", "value": " is continuous on " },
          { "type": "text", "value": "[a,b]", "marks": [{ "type": "math", "format": "latex", "source": "[a,b]" }] },
          { "type": "text", "value": ", then..." }
        ]
      }
    ]
  },
  {
    "type": "academic:proof",
    "of": "#thm-fundamental",
    "method": "direct",
    "children": [
      {
        "type": "paragraph",
        "children": [
          { "type": "text", "value": "We proceed by considering the limit definition..." }
        ]
      }
    ]
  }
]
```

## 12. Author Identification

For scholarly documents, author identification is critical for attribution and citation. The CDX specification uses a base `person` object defined in `anchor.schema.json` that includes an `identifier` field for persistent identifiers.

### 12.1 ORCID Recommendation

For academic documents, the `identifier` field SHOULD use ORCID (Open Researcher and Contributor ID) format:

```json
{
  "name": "Jane Doe",
  "email": "jane.doe@university.edu",
  "identifier": "https://orcid.org/0000-0002-1825-0097"
}
```

ORCID provides:
- Unique, persistent identification across all scholarly outputs
- Automatic disambiguation of authors with similar names
- Links to affiliations, grants, and publications
- Integration with major publishers and funding agencies

### 12.2 Other Identifier Formats

The `identifier` field also supports:

| Format | Example | Use Case |
|--------|---------|----------|
| ORCID | `https://orcid.org/0000-0002-1825-0097` | Researchers (recommended) |
| ISNI | `https://isni.org/isni/0000000121032683` | Name authority records |
| DID | `did:web:example.com:jane` | Decentralized identity |
| Institutional | `https://university.edu/faculty/jdoe` | University profiles |

### 12.3 Dublin Core Integration

Author identifiers should also be included in Dublin Core metadata (`metadata/dublin-core.json`) for discoverability:

```json
{
  "creator": ["Jane Doe", "John Smith"],
  "contributor": ["Research Assistant"]
}
```

For richer author metadata, use the semantic extension's JSON-LD annotations to provide Schema.org `Person` objects with ORCID identifiers.

## 13. Integrity Status

Academic constructs span two integrity tiers (see the extensions overview, Integrity Status of Extension Data).

**Author identity is advisory.** The author name carried in Dublin Core `creator` is part of the document hash, but a signature attests those bytes, not that the named person authored the work. The richer structured author data — an ORCID, an affiliation, the `creators` array of `metadata/dublin-core.json` — is excluded from the document hash altogether (Document Hashing specification, section 4.1). An ORCID, DID, or other identifier (section 12) is an advisory label: it is not authenticated by being named, and an identifier that is DID-shaped is not a signature. To establish authorship cryptographically, sign the document with a security-extension credential bound to the author (security extension, Identity Authority).

**Auto-numbering is bound through the manifest, not the document hash.** When `numbering` is `auto`, the displayed theorem, equation, and algorithm numbers, and the `{number}` text resolved by every `academic:theorem-ref`, `academic:equation-ref`, and `academic:algorithm-ref`, derive from `academic/numbering.json`. The manifest declares that file as a `{path, hash}` reference, so its content is bound by the manifest projection (security extension, section 9.7) even though it is not in the document hash: a manifest-covering signature attests `numbering.json`, and an archive writer who renumbers a `frozen` or signed document changes the file's hash and breaks that signature. The binding requires a manifest-covering signature; a document with no such signature — or a reader that verifies only the document ID — still sees the file unauthenticated. Where a cross-reference number must be integrity-protected regardless, give the referenced block an explicit `number`, carried in signed content.
