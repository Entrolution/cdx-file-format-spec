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
| Same cluster | Connections MUST NOT reference phantoms in other clusters | Error in all states |

Implementations MUST validate connection targets when loading phantom data. Broken connection targets (referencing non-existent phantom IDs) indicate data corruption in frozen documents and partial construction in mutable documents.

### 4.8 Known Limitations

Phantom content blocks exist in a separate namespace from the main document content. Anchors within phantom blocks reference other phantom blocks within the same cluster; they cannot directly reference blocks in the main document content tree. To associate phantom content with specific document locations, use the cluster's `anchor` field to attach the phantom cluster to a document position. Cross-referencing between phantom content and document blocks requires an intermediary cluster-level anchor.

## 5. Hashing Boundary

Phantoms are explicitly OUTSIDE the content hash boundary. The `phantoms/` directory has no `hash` field in the manifest reference. Adding, editing, or removing phantoms never changes the document ID or invalidates signatures.

This ensures that phantom annotations are commentary on the document, not part of the document's semantic identity.

## 6. Scope

Each cluster has a scope controlling its visibility:

| Scope | Description |
|-------|-------------|
| `"shared"` | Visible to all users |
| `"private"` | Visible only to the cluster author |
| `"role:{name}"` | Visible to users with the specified role |

Scope enforcement is an application concern. The specification defines the scope values; implementations decide how to enforce visibility.

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

Forked phantoms receive new cluster and phantom IDs to avoid identity collisions between the original and forked documents.

## 9. Phantom Assets

Phantom-specific assets (images, sketches, etc.) are stored in `phantoms/assets/`:

```
phantoms/
└── assets/
    ├── index.json
    └── sketch.png
```

The asset index follows the same structure as the core asset index:

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
