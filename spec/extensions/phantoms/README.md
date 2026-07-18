# Phantom Extension

**Extension ID**: `cdx.phantoms`
**Version**: 0.1
**Status**: Draft

## 1. Overview

The Phantom Extension provides an off-page annotation layer for spatially-organized content that is anchored to document content but rendered outside the page plane. Phantoms enable:

- Research notes and marginalia attached to specific content
- Mind-map style layouts linking related concepts
- Visual annotations with images, sketches, and rich text
- Collaborative annotation clusters with scope control

Phantom clusters are groups of annotation objects that the rendering application decides how to present relative to pages (margin, sidebar, overlay, separate pane).

## 2. Extension Declaration

```json
{
  "extensions": [
    {
      "id": "cdx.phantoms",
      "version": "0.1",
      "required": false
    }
  ]
}
```

A reader that does not support the phantoms extension MUST ignore the entire `phantoms/` directory and the manifest `phantoms` reference, rendering the document without the phantom layer. This is the unsupported-extension behavior in the CDX Extensions overview (Versioning) and State Machine section 5.4; because the layer is outside the document hash (section 5), ignoring it is never an integrity error, and a higher `clusters.json` version is likewise a rendering-degradation WARNING, never an integrity error. When `manifest.phantoms` is present, the document SHOULD declare `cdx.phantoms` in `extensions[]` as shown above so the extension's `version` and `required` flag travel with the layer; the manifest `phantoms` reference is the operative pointer to the data, and the `extensions[]` entry describes the same layer.

## 3. Archive Location

Phantom data is stored in the `phantoms/` directory within the archive:

```
phantoms/
├── clusters.json          # Cluster definitions
└── assets/                # Phantom-specific assets (optional)
    └── index.json
```

## 4. Cluster Structure

### 4.1 Clusters File

Location: `phantoms/clusters.json`

```json
{
  "version": "0.1",
  "clusters": [
    {
      "id": "cluster-1",
      "anchor": { "blockId": "intro", "start": 10, "end": 25 },
      "label": "Research Notes",
      "scope": "shared",
      "author": { "name": "Jane Doe", "email": "jane@example.com" },
      "created": "2025-01-20T10:00:00Z",
      "metadata": { "color": "#ff6b6b", "collapsed": false },
      "phantoms": [
        {
          "id": "phantom-1",
          "position": { "x": 0, "y": 0 },
          "size": { "width": 200, "height": 150 },
          "content": {
            "blocks": [
              {
                "type": "paragraph",
                "children": [{ "type": "text", "value": "Note text." }]
              }
            ]
          },
          "created": "2025-01-20T10:00:00Z",
          "author": { "name": "Jane Doe", "email": "jane@example.com" }
        },
        {
          "id": "phantom-2",
          "position": { "x": 220, "y": 0 },
          "size": { "width": 200, "height": 100 },
          "content": {
            "blocks": [
              {
                "type": "image",
                "src": "phantoms/assets/sketch.png",
                "alt": "Sketch"
              }
            ]
          },
          "connections": [
            { "target": "phantom-1", "style": "arrow", "label": "relates to" }
          ],
          "created": "2025-01-20T10:10:00Z"
        }
      ]
    }
  ]
}
```

The `version` field follows the extension version contract in the CDX Extensions overview (Versioning): a higher minor is processed with unrecognized fields ignored; a higher major — or a reader with no phantom support at all — follows the manifest `required` flag, so for a `required: false` phantom layer the reader ignores `phantoms/clusters.json` and the manifest's phantom layer reference and renders the rest of the document; and because the phantom data is outside the document hash, a version mismatch degrades rendering (a WARNING), never an integrity error.

### 4.2 Cluster Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique cluster identifier |
| `anchor` | ContentAnchor | Yes | Anchor to document content (see Anchors and References spec) |
| `label` | string | No | Display label for the cluster |
| `scope` | string | Yes | Visibility scope (see section 6) |
| `author` | object | No | Cluster creator |
| `created` | string | Yes | ISO 8601 creation timestamp |
| `metadata` | object | No | Application-specific metadata (color, collapsed state, etc.) |
| `phantoms` | array | Yes | Array of phantom objects within this cluster |

> **Reader dispositions.** A cluster `anchor` points into content from the out-of-hash phantom layer, so a dangling cluster anchor — its target block removed — is a WARNING in all states, never an INTEGRITY-ERROR on a frozen or published document (State Machine section 5.4). This is distinct from a broken phantom-to-phantom `connection` target within a cluster, whose disposition is given in section 4.7.

### 4.3 Phantom Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique phantom identifier within the cluster |
| `position` | object | Yes | Position within cluster coordinate space |
| `size` | object | No | Phantom dimensions |
| `content` | object | Yes | Phantom content (uses core content block model) |
| `connections` | array | No | Connections to other phantoms in the cluster |
| `created` | string | Yes | ISO 8601 creation timestamp |
| `author` | object | No | Phantom author |

Cluster `id`s MUST be unique within `phantoms/clusters.json`, and a phantom `id` MUST be unique within its cluster. These identifiers carry no document-hash weight (section 5), but connection resolution (section 4.7) depends on phantom-id uniqueness within a cluster. A loader MUST treat a duplicate id as a Warning in DRAFT/REVIEW and an Error in FROZEN/PUBLISHED (the same severity as a broken connection target, section 4.7 — a layer-load disposition, not a document INTEGRITY-ERROR; State Machine section 5.4.3), and a `connection` whose `target` matches more than one phantom MUST be handled as a broken target rather than resolved to an arbitrary one.

### 4.4 Position and Size

Coordinates are abstract relative units within the cluster — the rendering application decides physical placement relative to the page.

- Origin `(0, 0)` is the top-left of the cluster area
- `x` increases to the right, `y` increases downward
- Units are abstract and application-defined

```json
{
  "position": { "x": 0, "y": 0 },
  "size": { "width": 200, "height": 150 }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `position.x` | number | Yes | Horizontal position |
| `position.y` | number | Yes | Vertical position |
| `size.width` | number | No | Phantom width |
| `size.height` | number | No | Phantom height |

### 4.5 Phantom Content

Phantom content reuses the core content block model. Blocks within phantoms support the same types as document content: paragraphs, images, links, lists, etc.

```json
{
  "content": {
    "blocks": [
      {
        "type": "paragraph",
        "children": [
          { "type": "text", "value": "This is a note with " },
          { "type": "text", "value": "bold", "marks": ["bold"] },
          { "type": "text", "value": " text." }
        ]
      }
    ]
  }
}
```

Phantom block IDs exist in a separate namespace from document content block IDs. Anchors within phantom content reference other phantom blocks, not document blocks.

### 4.6 Connections

Connections between phantoms support mind-map style layouts:

```json
{
  "connections": [
    {
      "target": "phantom-1",
      "style": "arrow",
      "label": "relates to"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | string | Yes | ID of the target phantom within the same cluster |
| `style` | string | No | Connection style: `"line"`, `"arrow"`, `"dashed"` |
| `label` | string | No | Label displayed on the connection |

### 4.7 Connection Validation

Connections between phantoms MUST satisfy the following rules:

| Rule | Requirement | Violation Behavior |
|------|-------------|--------------------|
| Target exists | `target` MUST reference an existing phantom ID within the same cluster | Warning in DRAFT/REVIEW; Error in FROZEN/PUBLISHED |
| No cycles | Connections SHOULD NOT form cycles (A→B→A) | Warning in all states |
| Same cluster | `target` is resolved only within the connection's own cluster; because phantom IDs are unique only within a cluster (section 4.3), a `target` naming a phantom in another cluster is unresolvable here and is treated as a broken target | Warning in DRAFT/REVIEW; Error in FROZEN/PUBLISHED |

Implementations MUST validate connection targets when loading phantom data. A `target` that does not resolve to a phantom in the same cluster — whether the ID exists nowhere or exists only in a different cluster — is a broken target: this indicates data corruption in frozen documents and partial construction in mutable documents.

This `Error` is a layer-load disposition — the phantom graph will not render coherently — not the INTEGRITY-ERROR of the State Machine's integrity axis. Because the phantom layer is outside the document hash (section 5) and bound by no signature, a broken connection never changes the document ID, invalidates a signature, or downgrades the document itself; it is a validity disposition local to the out-of-hash layer (State Machine section 5.4.3).

### 4.8 Known Limitations

Phantom content blocks exist in a separate namespace from the main document content. Anchors within phantom blocks reference other phantom blocks within the same cluster; they cannot directly reference blocks in the main document content tree. To associate phantom content with specific document locations, use the cluster's `anchor` field to attach the phantom cluster to a document position. Cross-referencing between phantom content and document blocks requires an intermediary cluster-level anchor.

### 4.9 Non-Spatial and Accessible Rendering

Phantoms are a spatial, off-page layer (section 4.4), but a conformant consumer need not render that layer spatially. A consumer that cannot — a linear or reflow reader, a print or PDF export, a text extractor, or a screen reader — SHOULD still surface phantom content rather than silently dropping it. Such a consumer SHOULD present each phantom's content associated with its cluster's `anchor` target (section 4.2) — for example, as a marginal note, an endnote, or an annotation region adjacent to the anchored block — and SHOULD expose the cluster `label` so the commentary stays discoverable; within a cluster, phantoms SHOULD be surfaced in a stable order (their array order in `phantoms/clusters.json`). A print or extraction profile MAY define whether phantom layers are included, but a consumer that omits them entirely SHOULD disclose that phantom commentary was dropped rather than present the document as complete. A consumer that does not support the phantoms extension at all MUST ignore the phantom layer (section 5).

## 5. Hashing Boundary

Phantoms are explicitly OUTSIDE the content hash boundary. The `phantoms/` directory has no `hash` field in the manifest reference. Adding, editing, or removing phantoms never changes the document ID or invalidates signatures.

This ensures that phantom annotations are commentary on the document, not part of the document's semantic identity.

Because phantoms are outside the hash and bound by no signature, a cluster's or phantom's `author` and content are **advisory and unauthenticated** — forgeable like any other in-archive editorial metadata. A verifier MUST NOT treat a phantom `author` as an authenticated identity (security extension, Identity Authority).

### 5.1 Integrity Status

All phantom data is in neither the document hash nor the manifest projection (see the extensions overview, Integrity Status of Extension Data); it is mutable in every state (section 7), so an archive writer can add, edit, re-anchor, or remove any of it without changing the document ID or invalidating a signature. This applies categorically — every field of `phantoms/clusters.json`, the full content block tree embedded in a phantom, and every byte under `phantoms/assets/` is advisory. Three consequences are easy to miss:

- **Assets are an unverified channel.** `phantoms/assets/` carries no hash in the manifest, and a phantom asset index is not registered in the document's asset categories, so the bytes are bound to nothing. A renderer MUST treat phantom assets as untrusted content.
- **Anchors can be re-targeted silently.** A cluster `anchor` is a Content Anchor whose optional `contentHash` (Anchors and References specification) detects when its target has changed. Because phantoms are mutable on a `frozen` or `published` document, a note can be re-anchored to a different passage — or left anchored to since-edited content — without breaking a signature. Producers SHOULD populate `contentHash`, and consumers SHOULD warn when it is absent or no longer matches.
- **Forking MUST NOT rely on the `author` field.** The `author` field is forgeable, so the private-cluster carry-over rule (section 8) MUST determine "the forking user is the phantom author" from local or session identity, never from the in-archive `author`; a private cluster whose author cannot be authenticated MUST be stripped from the fork (fail closed).

Beyond integrity, the embedded content block tree is also a *rendering* surface. A renderer MUST apply the same safe-URI allowlist and untrusted-string sanitization to phantom content — link targets, image sources, SVG, math, and style values — that it applies to primary content, and MUST NOT grant phantom or other embedded content any capability (script execution, navigation, network access) it would deny to primary content (Renderer Safety section 6).

## 6. Scope

Each cluster has a scope controlling its visibility:

| Scope | Description |
|-------|-------------|
| `"shared"` | Visible to all users |
| `"private"` | Visible only to the cluster author |
| `"role:{name}"` | Visible to users with the specified role |

In `"role:{name}"`, `{name}` is restricted to the characters `A–Z`, `a–z`, `0–9`, `.`, `_`, and `-` (a role name containing a space or other character does not match the `scope` grammar and is rejected). Applications that map document roles to their own identifiers MUST use names drawn from this character set.

Scope enforcement is an application concern. The specification defines the scope values; implementations decide how to enforce visibility.

> **`private` is not confidentiality.** `scope` controls application-level *visibility*, not cryptographic confidentiality. A `private` cluster's content sits in cleartext inside `phantoms/clusters.json` and is readable by any holder of the archive, independent of any application — so a note written as `private` in the belief that it is hidden is in fact visible to every recipient of the shared archive. Do not place genuinely sensitive material in a phantom expecting `private` to protect it; the fork carry-over rule (section 8) is a data-hygiene convenience, not a data-layer access control. For confidential notes, encrypt the payload with the security extension (`cdx.security`, Encryption) so the plaintext never travels in the archive.

## 7. State Permissions

Phantoms are mutable in ALL document states (DRAFT, REVIEW, FROZEN, PUBLISHED). Since phantoms are outside the hashing boundary, they can be freely added, edited, and removed without affecting document integrity or signatures.

| State | Phantom Operations |
|-------|-------------------|
| DRAFT | Create, edit, delete clusters and phantoms |
| REVIEW | Create, edit, delete clusters and phantoms |
| FROZEN | Create, edit, delete clusters and phantoms |
| PUBLISHED | Create, edit, delete clusters and phantoms |

## 8. Fork Behavior

When a document is forked (any state → new DRAFT), phantom clusters are handled based on their scope:

| Scope | Fork Behavior |
|-------|---------------|
| `"shared"` | Carried over into the fork (copied) |
| `"private"` | Carried over only if the forking user is the phantom author; otherwise stripped |
| `"role:{name}"` | Carried over (role assignments are an application concern) |

**Rationale**: Shared phantoms represent collective knowledge about the document and should travel with it. Private phantoms are personal and should not leak to other users through forks.

The author match for a private cluster MUST be determined from local or session identity, not the in-archive `author`, which is forgeable (see section 5.1).

Forked phantoms receive new cluster and phantom IDs to avoid identity collisions between the original and forked documents.

## 9. Phantom Assets

Phantom-specific assets (images, sketches, etc.) are stored in `phantoms/assets/`:

```
phantoms/
└── assets/
    ├── index.json
    └── sketch.png
```

The asset index mirrors the core asset index, but because phantom assets are out-of-hash and unverified (section 5.1), the per-asset content `hash` and the root `version` are OPTIONAL — a phantom asset index makes no integrity claim, and a consumer MUST treat phantom assets as untrusted regardless of any hash present:

```json
{
  "assets": [
    {
      "id": "sketch",
      "path": "sketch.png",
      "type": "image/png",
      "size": 15360
    }
  ]
}
```

Phantom content references these assets with paths relative to the archive root (e.g., `"src": "phantoms/assets/sketch.png"`).

## 10. Examples

### 10.1 Research Notes Cluster

```json
{
  "version": "0.1",
  "clusters": [
    {
      "id": "research-1",
      "anchor": { "blockId": "methodology" },
      "label": "Literature Review Notes",
      "scope": "shared",
      "author": { "name": "Dr. Smith", "email": "smith@university.edu" },
      "created": "2025-01-20T10:00:00Z",
      "metadata": { "color": "#4ecdc4", "collapsed": false },
      "phantoms": [
        {
          "id": "p1",
          "position": { "x": 0, "y": 0 },
          "size": { "width": 250, "height": 120 },
          "content": {
            "blocks": [
              {
                "type": "paragraph",
                "children": [
                  {
                    "type": "text",
                    "value": "Smith et al. (2024) found similar results using a different methodology. Compare with Table 3."
                  }
                ]
              }
            ]
          },
          "created": "2025-01-20T10:00:00Z",
          "author": { "name": "Dr. Smith" }
        },
        {
          "id": "p2",
          "position": { "x": 270, "y": 0 },
          "size": { "width": 250, "height": 100 },
          "content": {
            "blocks": [
              {
                "type": "paragraph",
                "children": [
                  {
                    "type": "text",
                    "value": "Needs further investigation - compare with control group data."
                  }
                ]
              }
            ]
          },
          "connections": [
            { "target": "p1", "style": "dashed", "label": "follow-up" }
          ],
          "created": "2025-01-20T10:05:00Z",
          "author": { "name": "Dr. Smith" }
        }
      ]
    }
  ]
}
```

### 10.2 Private Annotation

```json
{
  "version": "0.1",
  "clusters": [
    {
      "id": "private-1",
      "anchor": { "blockId": "conclusion", "start": 0, "end": 50 },
      "label": "My Notes",
      "scope": "private",
      "author": { "name": "Reviewer", "email": "reviewer@example.com" },
      "created": "2025-01-21T09:00:00Z",
      "phantoms": [
        {
          "id": "pn1",
          "position": { "x": 0, "y": 0 },
          "size": { "width": 200, "height": 80 },
          "content": {
            "blocks": [
              {
                "type": "paragraph",
                "children": [
                  { "type": "text", "value": "This conclusion seems weak. Need to discuss in meeting." }
                ]
              }
            ]
          },
          "created": "2025-01-21T09:00:00Z"
        }
      ]
    }
  ]
}
```
