# Worldsmith — Data Model

Every persisted shape, where it lives, and the rules that keep it stable. TypeScript
definitions live in `src/core/types/`; this document is the human-readable contract.

Conventions:

- **IDs.** Entities, tasks, edges, layouts, worlds, block instances: UUID v4
  (`crypto.randomUUID()` with a `getRandomValues` fallback). Schemas (types), fields,
  sections, statuses, relation types: stable **slug IDs** (`character`, `fullName`). Slug IDs
  are immutable once created; renaming changes the *label* only.
- **Timestamps.** Epoch milliseconds (`number`).
- **`rev`.** Incremented on every write of a record; used for change detection.
- **`v`.** Record shape version, used by record migrations.
- **Envelope.** Every file is `{ "format": "worldsmith/<kind>", "v": n, ... }`.
- Fields marked *(M3)* etc. are defined now and implemented in that milestone.

---

## 1. Manifest — `_worldsmith/manifest.json`

```jsonc
{
  "format": "worldsmith/manifest",
  "v": 1,
  "storageVersion": 1,          // folder-layout version, drives storage migrations
  "createdAt": 1791000000000,
  "activeWorldId": "8a1f…",
  "worlds": [
    { "id": "8a1f…", "name": "The Ashen Crown", "folder": "worlds/8a1f…" }
  ]
}
```

Multiple worlds are supported by the storage model from day one; each world is a
self-contained folder that can be backed up, exported or deleted independently.

## 2. World — `worlds/<id>/world.json`

```jsonc
{
  "format": "worldsmith/world", "v": 1,
  "id": "8a1f…",
  "name": "The Ashen Crown",
  "description": "A dying empire, a god in chains…",
  "icon": "crown",                      // Lucide icon id
  "banner": { "path": "Art/ashen.png", "focalY": 0.4, "height": 220 } | null,
  "statuses": [                          // world-level, user-editable
    { "id": "idea",  "label": "Idea",           "color": "gray",   "category": "idea" },
    { "id": "draft", "label": "Draft",          "color": "yellow", "category": "active" },
    { "id": "dev",   "label": "In development", "color": "blue",   "category": "active" },
    { "id": "done",  "label": "Complete",       "color": "green",  "category": "done" },
    { "id": "archived", "label": "Archived",    "color": "gray",   "category": "archived" }
  ],
  "defaultStatus": "idea",
  "sidebar": {
    "groups": [
      { "id": "world", "label": "World", "collapsed": false,
        "items": [ { "kind": "type", "typeId": "character" }, … ] },
      { "id": "tools", "label": "Tools",
        "items": [ { "kind": "route", "route": "tasks" }, … ] }   // 0.11 adds maps, trees, graph after timeline
    ],
    "hidden": [ "type:technology" ]
  },
  "progress": { "mode": "tasks" | "fields" | "blend", "includeOptional": false },  // default "blend"
  "pages": {                             // customizable pages (M4: the Tasks home)
    "tasks": { "blocks": [ BlockInstance, … ] }   // absent → the default layout
  },
  "dashboards": [                        // M7: extra dashboards, in sidebar order (Home isn't listed)
    { "id": "3f9a1c2e", "name": "Politics", "icon": "landmark", "color": "red",
      "description": "Who holds power…", "createdAt": …,
      "seeded": true }                   // created with widgets: wait for them if they sync late
  ],
  "tasksSeeded": true,                   // default checklists were added to existing entries once
  "familyFields": true,                  // 0.12: Parents/Children/Spouses were offered to character types once
  "pageBanners": {                       // 0.10: banners on other pages
    "tasks": { "path": "Art/b.png", "focalY": 0.5 },
    "dashboard:3f9a1c2e": { … }, "type:character": { … },  // a type's database
    "page:maps": { … }                   // 0.12.2: a Tools page (search, timeline, health, maps, trees, graph, media, trash)
  },
  "mainCalendar": "c81d…" | null,        // 0.10: null = the earliest calendar (or plain years)
  "timeline": {                          // 0.10: Timeline page settings ([] = everything)
    "types": [], "tags": [], "bands": ["era"],
    "spans": { "character": { "start": "birthDate", "end": "deathDate" } }  // absent = guessed
  },
  "health": { "ignored": ["duplicates:a,b"] },  // 0.10: findings someone chose to ignore
                                         // 0.11 adds the check "map-links" (ids "map-links:<map>:<item>:<problem>")
  "createdAt": …, "updatedAt": …, "rev": 3
}
```

`color` values are **semantic names** (`red`, `orange`, `yellow`, `green`, `cyan`, `blue`,
`purple`, `pink`, `gray`) mapped to Obsidian's `--color-*` variables, so themes control the
actual hues.

## 3. Entity type (schema) — `worlds/<id>/schemas/<typeId>.json`

Stored as a one-record bucket (the same `BucketStore` envelope as entities):
`{ "format": "worldsmith/schema-bucket", "v": 1, "bucket": "character", "records": [ <schema> ] }`.
The schema record:

```jsonc
{
  "v": 1,
  "id": "character",
  "singular": "Character",
  "plural": "Characters",
  "icon": "user-round",
  "description": "People and persons of your world.",
  "color": "purple",                      // optional accent (semantic)
  "group": "world",                       // default sidebar group
  "fields":   [ FieldDefinition, … ],     // canonical field list (all fields)
  "sections": [ SectionDefinition, … ],   // display grouping & order
  "display": {
    "subtitleFields": ["storyRole", "species"],   // "Protagonist • Human"
    "cardFields": ["species", "age", "affiliations"]
  },
  "hierarchy": { "allowParent": true, "parentTypes": ["character"], "childTypes": [] },
  "defaultTasks": [ TaskTemplate, … ],
  "defaultLayout": LayoutDoc | null,      // (M6) if null, built-in default for the type
  "origin": { "templateId": "character", "templateVersion": 1 } | null,  // null = user-created
  "createdAt": …, "updatedAt": …, "rev": 1
}
```

### FieldDefinition

```jsonc
{
  "id": "age",                 // immutable, unique within the schema, /^[a-zA-Z][\w]*$/
  "type": "number",            // FieldTypeRegistry id
  "label": "Age",
  "description": "Age at story start",
  "icon": "hourglass",
  "required": false,
  "recommended": true,         // counts toward field-based completeness
  "defaultValue": null,
  "placeholder": "e.g. 23",
  "hidden": false,
  "advanced": false,           // shown under the section's "More fields" disclosure
  "width": "half",             // "full" | "half" | "third" within a properties grid
  "display": null,             // display style variant offered by the field type
  "config": { "min": 0, "unit": "years" }   // type-specific, validated by the field type
}
```

Type-specific `config` examples:

| Type | config |
|---|---|
| `select` / `multiselect` | `{ "options": [{ "id": "hero", "label": "Protagonist", "color": "blue" }] }` |
| `number` | `{ "min", "max", "step", "unit", "format": "plain"\|"percent" }` |
| `rating` | `{ "max": 5, "icon": "star" }` |
| `progress` | `{ "max": 100 }` |
| `relation` | `{ "relationType": "mentorship", "direction": "forward"\|"reverse", "targetTypes": ["character"], "max": null }` |
| `rollup` | `{ "relationField": "<link field id>", "targetField": "<field id>"\|"__name"\|null, "aggregate": "count"\|"sum"\|… }` |
| `formula` *(later)* | `{ "expression": "…" }` |
| `chrono` | `{ "calendar": "default" }` |

Values that are *computed* (rollup, formula, child entities) are never stored on the
entity; they are produced by the compute layer.

### SectionDefinition

```jsonc
{ "id": "personality", "label": "Personality", "icon": "sparkles",
  "fieldIds": ["personalitySummary", "traits", "fears", …],
  "collapsed": false, "advanced": false }
```

A field belongs to at most one section; fields in no section appear under **Other**.

### TaskTemplate

```jsonc
{ "id": "core-motivation", "title": "Define core motivation", "category": "Personality",
  "priority": 2, "optional": false, "description": "What do they want most, and why?" }
```

## 4. Entity — `worlds/<id>/entities/<aa>/<entityId>.json`

Stored as a one-record bucket:

```jsonc
{
  "format": "worldsmith/entity-bucket", "v": 1, "bucket": "3f2c…",
  "records": [ {
    "v": 1,
    "id": "3f2c9a8e-…",                // permanent identity
    "worldId": "8a1f…",
    "typeId": "character",
    "name": "Auron Vale",
    "aliases": ["The Ash Knight"],
    "tags": ["night-guard"],
    "description": "A disgraced knight…",
    "status": "dev",
    "values": {                        // keyed by FieldDefinition.id
      "age": 23,
      "storyRole": "hero",
      "traits": ["stubborn", "loyal"]
    },
    "media": {
      "icon": "sword",
      "portrait": { "path": "Art/auron.png", "fit": "cover", "focalX": 0.5, "focalY": 0.3, "zoom": 1.4 },
      "banner":   { "path": "Art/ash-plain.png", "focalY": 0.4, "height": 220 },
      "symbol": null,
      "gallery": [ { "id": "…", "path": "Art/auron-2.png", "caption": "Ch. 3" } ]
    },
    "parentId": null,                  // generic nesting (World → Continent → City …)
    "sortOrder": 0,
    "flags": { "favorite": true, "pinned": false, "hidden": false },
    "linkedNote": { "path": "Characters/Auron Vale.md" } | null,
    "moreNotes": [ { "path": "Drafts/Auron.md", "label": "Draft" } ],  // 0.10, no duplicates
    "createdAt": …, "updatedAt": …, "rev": 12,
    "archivedAt": null,                // archived = kept, hidden from default views
    "trashedAt": null                  // in trash; purged only by explicit empty-trash
  } ]
}
```

Core properties (`name`, `aliases`, `tags`, `description`, `status`, `media`, `parentId`,
`flags`, `linkedNote`) exist on **every** entity regardless of schema, because every block,
search, and dashboard relies on them. Everything type-specific lives in `values`.

### Unused data — `values._orphaned`

Values that no longer fit the schema are never dropped. They're kept on the entity:

```jsonc
"values": {
  "_orphaned": {
    "occupation": {                    // key = old field id ("id~2" if orphaned twice)
      "value": "Lord Commander",       // the value exactly as stored
      "label": "Occupation",           // field label at the time
      "type": "text",                  // field kind at the time
      "reason": "deleted",             // "deleted" | "type-change"
      "at": 1767000000000,
      "text": "Lord Commander",        // readable form (choice ids → labels, dates formatted)
      "portable": "Lord Commander",    // kind-neutral form used when restoring into another kind
      "field": { "id": "occupation", "type": "text", "label": "Occupation" },  // deletes only
      "sectionId": "basic"                                                   // deletes only
    }
  }
}
```

`_orphaned` is not a field id (field ids match `/^[a-zA-Z]\w*$/`), so it can't collide.
The entity page's **Unused data** block restores (into the existing field, or by
re-creating a deleted one), copies or discards these values.

### Linked notes

`linkedNote.path` is a vault path. Obsidian has no stable file IDs, so Worldsmith listens to
vault `rename` events and updates the path. The note never contains the structured data.
Notes created by Worldsmith get a `worldsmith: <entityId>` frontmatter key so a moved note
can be re-matched even if the rename happened while the plugin was off.

*(0.18)* A **deleted note is no longer unlinked**: the path stays, the entry shows the note as
missing, and the note reconnects by itself if it comes back at that path (Obsidian's trash,
sync, a restore). "Find it again" offers notes whose front matter names the entry
(`worldsmith-id` or `worldsmith`), then notes with the same file name that no entry holds;
relinking only changes the path. Unlinking is always the person's choice.

**Adopted notes** *(0.18)* are ordinary linked notes made from notes the person already had
(drag and drop onto a type page, or Add existing note). Nothing new is stored: the new entry's
`linkedNote` is `{ path }`, and the note is never written to, moved or renamed. A note is
refused when any entry already holds it (`linkedNote`, `moreNotes` or `nativeNote`, trashed
entries included), when its `worldsmith-id`/`worldsmith` names an entry of this world, when its
`worldsmith-world` names another world, or when it sits in the data folder. The planner is
`services/notes/adoption.ts` (pure). The editable Embedded note widget stores
`config.editable: true` (absent = false, as before).

### Images *(M5)*

Every image reference is an `ImageRef`: a vault-relative `path` plus how it's framed.

```jsonc
{ "path": "Art/auron.png",
  "focalX": 0.5, "focalY": 0.3,   // 0–1, the point kept in view (CSS object-position)
  "zoom": 1.4,                    // 1–4, scales around the focal point (absent = 1)
  "fit": "cover" | "contain",     // absent = cover
  "caption": "Ch. 3",             // gallery items
  "height": 300 }                 // banners only, 100–480 px
```

Values are clamped when read; unknown keys are kept. References live in `media.portrait`,
`media.banner`, `media.symbol`, `media.gallery[]` (items also have an `id`), in fields of
kinds that declare `media` (Image, Gallery, Vault file), in `world.banner`, in
`world.pageBanners` (role `page-banner`) and, from 0.11, in each map's `image` (role `map`,
page `map:<mapId>`).

- **Moves are followed.** Vault `rename` events (files and folders) rewrite every
  reference; framing and captions are kept.
- **Deletes are not.** A reference to a missing file stays as it is, so the image returns
  if the file comes back (undo, sync, plugin re-enabled). **Media → Missing** lists them,
  suggests same-named files found elsewhere in the vault and relinks them.
- Images added from outside the vault (upload, paste, drop, link) are copied into
  `settings.media.folder` (or Obsidian's attachment folder) and then referenced like any
  other vault image.

## 5. Relations

### Relationship type — `worlds/<id>/relation-types/<typeId>.json`

One-record bucket per type:

```jsonc
{ "v": 1, "id": "mentorship",
  "label": "Mentorship",               // the connection itself
  "forwardLabel": "Students",          // how a `from` entry lists its `to` entries
  "reverseLabel": "Mentors",           // how a `to` entry lists its `from` entries
  "symmetric": false,                  // true: both sides use forwardLabel (friendship, alliance…)
  "category": "Personal", "description": "…", "icon": "graduation-cap", "color": null,
  "sourceTypes": ["character"],        // picker hints only; empty = any; never enforced on data
  "targetTypes": ["character"],
  "fields": [ FieldDefinition, … ],    // custom properties of each connection (values in edge.props)
  "origin": { "templateId": "mentorship", "templateVersion": 1 } | null,
  "createdAt": …, "updatedAt": …, "rev": 0 }
```

### Connection (edge) — `worlds/<id>/relations/<shard>.json` (shard = hash(from) % 256)

```jsonc
{ "v": 1, "id": "…", "type": "mentorship", "from": "<maren>", "to": "<auron>",
  "status": "active" | "strained" | "ended" | "unknown" | null,
  "strength": 1–5 | null, "secret": false,
  "start": ChronoDate | null, "end": ChronoDate | null,
  "description": "Took him in after the trial.",   // one line, shown on both entries
  "notes": "",                                      // Markdown
  "props": { "trust": 80 },                         // custom properties; never pruned
  "order": 1767000000000, "createdAt": …, "updatedAt": …, "rev": 0 }
```

A relation field reads edges; it stores nothing on the entity:

```jsonc
{ "id": "mentors", "type": "relation", "label": "Mentors",
  "config": { "relationType": "mentorship",
              "direction": "reverse",        // this entry is the edge's `to`
              "targetTypes": ["character"],  // empty = any
              "max": null } }                // 1 = single link
```

Kael's *Mentors* (reverse) and Auron's *Students* (forward) read the same edge, so the two
sides can't disagree. Trashing an entry keeps its edges (hidden); deleting it permanently
removes them. Deleting a relation **field** never deletes edges — they stay listed under
Connections.

### Rollup field

```jsonc
{ "id": "memberCount", "type": "rollup", "label": "Member count",
  "config": { "relationField": "members",     // a relation/parent/children field on the same type
              "targetField": "age" | "__name" | null,
              "aggregate": "count" | "list" | "unique" | "sum" | "avg" | "min" | "max" | "earliest" | "latest" } }
```

Computed on read; never stored.

## 6. Development tasks *(M4)* — `worlds/<id>/tasks/<shard>.json`

A shard holds the tasks of the entries whose id hashes to it (`hash(entityId ?? taskId)`),
so an entry's whole checklist lives in one file and syncs as one change.

```jsonc
{ "v": 1, "id": "…", "entityId": "<auron>" | null, "typeId": "character" | null,
  "templateId": "core-motivation" | null,   // links back to the schema template
  "title": "Define core motivation", "notes": "", "category": "Personality",
  "status": "open" | "in-progress" | "blocked" | "done",   // "complete" (pre-0.4) reads as "done"
  "optional": false, "priority": 0,          // 0 none, 1 low, 2 medium, 3 high, 4 urgent
  "due": "2026-10-20" | null,                // real-world date, local calendar day (YYYY-MM-DD)
  "repeat": "daily" | "weekly" | "monthly" | "yearly" | null,
  "order": 3,
  "createdAt": …, "updatedAt": …, "completedAt": null, "rev": 1 }
```

- Tasks are instantiated from `schema.defaultTasks` when an entity is created. `templateId`
  lets *Add to existing entries* add only what's missing. Worlds made before 0.4 get their
  default checklists once, on first open (`world.tasksSeeded`).
- Completing a repeating task with a due date schedules the next one (same details, next
  date; month ends clamp, e.g. Jan 31 → Feb 28).
- Tasks of trashed entries are hidden; tasks of deleted entries are deleted with them.
  Duplicating an entry copies its checklist (reset to open).
- `typeId` mirrors the entry's type and follows type changes.

**Progress** for an entity (mode from `world.progress`):
- `tasks`: done ÷ (non-optional tasks, plus optional ones if `includeOptional`)
- `fields`: filled (`required` + `recommended`) fields ÷ total of those
- `blend` (default): mean of both when both exist; whichever exists otherwise

**Stat tiles** on the Tasks home are block config (`config.tiles` of the `task-stats`
block): `{ id, label, icon, color, metric, statuses, due, types, minPriority, period,
compare, ring }`, where `metric` is `tasks | done-in-period | percent-done | entries |
avg-progress`.

## 7. Layouts *(engine M1, editor M6)* — `worlds/<id>/layouts/<layoutId>.json`

One file per layout. The id is derived from the scope, so two devices customizing the same
page write the same file (Obsidian Sync merges a single file instead of two duplicates):

| Scope | Id | Used by |
|---|---|---|
| `{ "kind": "type", "typeId": "character" }` | `type-character` | every page of that type |
| `{ "kind": "entity", "entityId": "…" }` | `entity-<entityId>` | one entry's own page |
| `{ "kind": "dashboard", "dashboardId": "home" }` | `dashboard-home` | Home, once customized |
| `{ "kind": "dashboard", "dashboardId": "<id>" }` | `dashboard-<id>` | an extra dashboard's widgets |
| `{ "kind": "global" }` | reserved | — |

The file is a one-record bucket (`{ "format": "worldsmith/layout-bucket", "v": 1, "bucket": "type-character", "records": [ … ] }`); the record:

```jsonc
{
  "v": 1,
  "id": "type-character",
  "scope": { "kind": "type", "typeId": "character" },
  "name": "",
  "columns": 12,
  "blocks": [
    { "id": "hero", "type": "hero", "x": 0, "y": 0, "w": 12, "h": 1, "config": {} },
    { "id": "kf-1a2b3c4d", "type": "key-facts", "x": 0, "y": 1, "w": 12, "h": 1,
      "config": { "fields": ["storyRole", "species", "age"] },
      "title": null, "collapsed": false,
      "height": 420 }                 // optional: a fixed height in px (80–2400) set while customizing
  ],
  "createdAt": …, "updatedAt": …, "rev": 3
}
```

**Resolution** for an entry page: the entry's own layout → its type's layout → the built-in
default for the type (`layouts/defaults.ts`). A layout with no blocks is never stored —
saving an empty layout removes the file, so the page falls back a level.

**Validation on read** (`hydrateLayout` / `hydrateBlocks`): unknown scope kinds are
rejected; blocks without an id or type are dropped; `w` is clamped to 1–12, `x` so the
block fits, `y ≥ 0`, `h ≥ 1`; duplicate ids are renamed (`a`, `a-1`, …) until unique; a
non-object `config` becomes `{}`; unknown keys are kept for forward compatibility. A block
whose type isn't registered (e.g. from a disabled extension) renders a placeholder and
keeps its config.

**Lifecycle:** duplicating an entry copies its own layout; permanently deleting an entry
deletes it (trashing keeps it); deleting a *type* keeps the type's layout, so undoing the
delete or re-creating the type brings the page back.

**Dashboards (M7).** Home shows `dashboard-home` or, until customized, the built-in default
(`layouts/defaults.ts`); an empty Home isn't stored. An extra dashboard's name, icon and
order live in `world.json`; its widgets live here. It may be stored *empty* (emptied on
purpose). A `dashboard-<id>` file whose id isn't in the list (it synced ahead of world.json,
or an older version rewrote the list) is still shown, and is written into the list the next
time it's edited — never on its own, so a dashboard deleted on another device can't come
back by itself. Deleting a dashboard removes its list entry and its file; Undo restores both.

Block config notes (all optional; widgets fall back to sensible defaults and ignore values
of the wrong shape):
- `properties` (Details): `{ "sections": ["basic", "__other", …] | null, "exclude": […], "columns": 1 | 2, "layout": "auto" | "grid" | "rows" }`.
  `sections` picks sections (`__other` = fields in no section); otherwise `exclude` shows
  every other section, so sections added later in Type Studio still appear. A block whose
  subset is empty hides itself.
- `key-facts`: `{ "fields": [fieldId, …] }` (up to 6). `quote`: `{ "field", "attribution": bool }`.
- `stat-block`: `{ "fields": […], "max": number, "showEmpty": bool }`.
- `image-spotlight`: `{ "source": "auto" | "portrait" | "banner" | "gallery" | "field:<id>", "index", "aspect", "caption": bool }`.
- `single-field`: `{ "field" }`. `heading`: `{ "text" ({name} = entry name), "subtitle", "style": "heading" | "centered" | "divider" }`.
- `relationship-web`: `{ "max", "labels": bool }`. `roster`: `{ "field", "columns": ["<typeId>.<fieldId>" | "__status" | "__summary", …] }`.
- `shared-connections`: `{ "limit", "includeDirect": bool }`. `note-backlinks`: `{ "limit" }`.
- `embedded-note`: `{ "source": "linked" | "file", "file", "height": "short" | "medium" | "tall" | "full" }`.
- `unused-data`: no config; shows `values._orphaned` and hides itself when empty.
- Dashboard "build your own" widgets share a query: `{ "type": "<typeId>" | "__any", "statuses": [], "tags": [],
  "only": "all" | "favorites" | "pinned" | "with-image" | "this-month", "whereField": "<fieldId>" | "__none",
  "whereOp": "is" | "is-not" | "contains" | "empty" | "not-empty" | "gt" | "lt", "whereValue": "…",
  "sort": "updated" | "created" | "name" | "progress" | "random" | "field:<id>", "dir": "auto" | "asc" | "desc" }`.
  Changing `type` clears what depended on the old type (field filter, field, columns, field sort/grouping).
  - `entry-list`: + `{ "style": "list" | "cards" | "table" | "portraits", "limit", "columns": ["<fieldId>" | "__status" | "__progress", …] }`.
  - `entry-stat`: + `{ "label", "measure": "count" | "progress" | "filled" | "sum" | "avg" | "min" | "max", "field", "compare": bool, "icon", "color" }`.
  - `entry-chart`: + `{ "groupBy": "status" | "type" | "tag" | "field:<id>", "style": "bars" | "donut", "max", "hideEmpty": bool }`.
- `featured-entry`: `{ "entityId", "image": "auto" | "portrait" | "banner" | "none", "summary": bool }`.
- `links`: `{ "links": [ { "id", "kind": "entry" | "note" | "url" | "page", "target", "label"? } ] }` — web
  links open only for http(s), mailto and obsidian addresses.
- `spotlight`: `{ "types": [], "prefer": "forgotten" | "any" | "images" }`; `random-quote`: `{ "types": [], "source": "auto" | "description" }`;
  `image-wall`: `{ "types": [], "source": "portraits" | "all", "order": "recent" | "shuffle" | "name", "limit" }`.
- `world-attention`: `{ "checks": ["no-summary", "no-portrait", "missing-images", "unused-data", "no-connections", "stale"], "types": [] }`.
- `recent`: `{ "mode": "edited" | "created", "limit" }`; `recent-connections`: `{ "limit" }`; `world-progress`: `{ "types": [], "hideEmpty": bool }`.

## 8. Saved database views *(M8)* — `worlds/<id>/views/<typeId>.json`

One bucket file per type (format `worldsmith/view-bucket`, the same envelope as other
bucket stores) holding that type's saved views:

```jsonc
{ "v": 1, "id": "v-…", "typeId": "character", "name": "Villains", "icon": "skull" | null,
  "kind": "cards" | "gallery" | "table" | "list" | "board" | "progress",
  "match": "all" | "any",
  "conditions": [ { "id": "c1", "field": "storyRole", "op": "is", "value": "Antagonist" } ],
  "sorts": [ { "field": "__name", "dir": "asc" } ],          // first wins, next breaks ties
  "groupBy": "importance" | null,
  "collapsed": ["Minor"],                                      // folded group keys
  "columns": [ { "id": "__name", "width": 240 }, { "id": "age" } ] | null,   // table; null = card fields
  "card": { "fields": ["storyRole"] | null, "image": "portrait" | "banner" | "none", "size": "s" | "m" | "l" },
  "board": { "field": "__status" },                            // what a board's columns are
  "showArchived": false, "order": 0, "createdAt": 0, "updatedAt": 0, "rev": 3 }
```

- **Fields and built-ins.** `field`, sort fields, columns and `groupBy` are a field id or a
  built-in property every entry has: `__name`, `__status`, `__tags`, `__image` (portrait),
  `__favorite`, `__progress` (development), `__connections`, `__created`, `__updated`.
- **Operators:** `is`, `is-not`, `contains`, `empty`, `not-empty`, `gt`, `lt`. Choice fields
  compare option labels (case-insensitive); dates accept `2026`, `2026-05`, `2026-05-01` or
  `30d` (the last 30 days); numbers compare numerically.
- **The default view** has the fixed id `all-<typeId>` and isn't written until it's first
  changed, so a fresh type has a view without a file. It starts from the device's old
  (pre-M8) layout and sort. The last view of a type can't be deleted.
- **Forward-compatible.** Unknown keys are kept at every level (the view, conditions, sorts,
  columns, `card`, `board`); a layout or operator this version doesn't know is kept as
  written — the layout is drawn as cards, the filter is shown as one it can't use and matches
  nothing — and `v` is never lowered, so an older device saving the file doesn't undo a
  newer one's views. Malformed rows are dropped, never the whole view.
- **Media views** (0.8.1) are stored the same way under the pseudo type `__media`
  (`views/__media.json`, default id `all-__media`, "All images"). Their conditions use
  `__usage` (`used` / `unused` / `missing`), `__role` (portrait, banner, symbol, gallery,
  field, world-banner), `__type` (an entry type id), `__folder` and `__ext`; several values of
  one field match any of them, different fields must all match. Sorts: `name`, `folder`,
  `uses`, `newest`, `size`; `groupBy`: `folder`, `role`, `type`, `usage`; kinds `cards`,
  `gallery` (the wall) and `table`. Dashboards never list them as entry sources.
- Dashboards' *Entry list* widget can show a saved view (`config.view` = the view id); a
  deleted view shows a notice there with a way back to the widget's own filters.

## 9. Chronology *(field type M1, calendars 0.10)*

```jsonc
// ChronoDate
{ "calendar": "c81d…",                // 0.10; absent on older dates = the main calendar
  "era": "ac" | "AE" | null,          // an era id, or (older dates) free era text
  "year": 312,                         // within the era when one is set, else absolute
  "month": 3 | null,                   // 1-based month number
  "festival": "midwinter" | null,      // 0.10: a day outside the months (instead of month)
  "day": 12 | null,
  "precision": "year" | "month" | "day" | "era",
  "approx": false, "label": "Late in the Third Age" | null }
```

Older dates load unchanged. Era text that matches an era of the main calendar (by id, name
or abbreviation) counts within that era; text that matches none is shown as written next to
the year. Without a calendar dates are formatted exactly as before. Calendars are in §15.

## 10. Plugin settings — `.obsidian/plugins/worldsmith/data.json`

Device/vault preferences only:

```jsonc
{ "settingsVersion": 2,          // 1 → 2: default folder ".worldsmith" became "_worldsmith"
  "dataFolder": "_worldsmith",
  "notesFolder": "Worldsmith",
  "appearance": { "density": "comfortable", "fontMode": "theme",
                  "displayFont": "", "bodyFont": "", "maxWidth": 1180,
                  "fullWidth": false, "animations": true, "cardImage": "portrait",
                  "tooltips": true,                               // hover labels over Worldsmith (0.8.1)
                  "detailsLayout": "grid" | "rows",               // default for every type
                  "detailsLayoutByType": { "<worldId>:character": "rows" },
                  "detailsLayoutByEntry": { "<entityId>": "grid" } },  // page beats type beats default
  "database": { "viewKind": { "character": "cards" },
                "sort": { "character": { "by": "__updated", "dir": "desc" } } },
  "sidebarCollapsed": { "<worldId>:<groupId>": true },   // "<worldId>:__dashboards" for the Dashboards section
  "showDashboards": true,        // the Dashboards section in the sidebar (Settings → Sidebar)
  "weekStart": 1,                // 0 Sunday, 1 Monday (calendars and "this week")
  "media": { "folder": "Worldsmith/Images",     // where added images are copied
             "useAttachmentFolder": false },    // or follow Obsidian's attachment setting
  "debug": false }
```

## 11. Backups — `_worldsmith/backups/<worldId>/`

**Since 0.20** a backup is a world archive (§11b) named `<ISO time>-<kind>.worldsmith.zip`, with
`manifest.purpose = { kind: "auto" | "manual" | "before-restore" | "before-migration" }` and
`manifest.fingerprint` (SHA-256 over the data and note file hashes; an automatic backup whose
fingerprint equals the newest backup's is skipped). Automatic backups leave images and other
attachments out unless `settings.backups.autoImages`; they're listed in `excluded` as
`not-chosen`. Written as `….partial`, read back and verified, then renamed. Listed in
`index.json`: `{ format: "worldsmith/backup-index", v: 1, worldId, entries: [{ file,
createdAt, kind, size, sha256, verified: "ok"|"failed"|"unchecked", verifiedAt, problem?,
worldName, counts, images, missing, excluded, fingerprint }] }`, rebuilt from the files
(verified `unchecked`) if missing. Retention (`services/backup/retention.ts`): newest
`keepAuto` automatic, `keepManual` manual, 5 safety; never the one just made or the newest
verified one. Settings: `backups: { auto: true, intervalMinutes: 60, keepAuto: 10,
keepManual: 20, autoImages: false }`.

**Restore journal** — `<data>/restores/<id>.json`: `{ format: "worldsmith/restore-journal", v: 1,
id, worldId, worldName, phase: "staging"|"swapping"|"swapped", startedAt, backupFile,
safetyFile, worldDir, stagingDir, replacedDir, created: [{ path, sha256 }] }`. Staging and the
replaced folder live beside it (`staging-<id>/`, `before-<id>/`).

**Character arcs (0.23)** — `WritingProject.arcs?: Record<entityId, { start: string; end: string }>`,
optional; cleaned on load (text only, no empty entries, no `__proto__`). Set with
`WritingService.setArc`, which returns its own undo.

**Writing progress (0.24)** — on `WritingProject`, all optional: `dailyGoal: number | null`,
`deadline: "YYYY-MM-DD" | null`, `days: { "YYYY-MM-DD": netWords }` (local days; zero days
dropped), `sprints: [{ start, minutes, words }]` (last 100). Cleaned on load.

**Scene snapshots (0.25)** — `<world>/writing/snapshots/<sceneId>/<createdAt>-<kind>.json`:
`{ format: "worldsmith/snapshot", v: 1, id, sceneId, projectId, createdAt, kind: "manual" | "auto" |
"before-restore", name, text, words }`. Retention: manual kept; newest 20 auto and 10
before-restore per scene. Included in exports and manual backups, skipped by automatic backups.
**Revision passes (0.25)** — `WritingProject.passes?: [{ id, name, createdAt, done: sceneId[] }]`
(max 50; cleaned on load). Board memory gains `pass` (show scenes not done in it).

**Compile (0.26)** — `WritingProject.author?: string`, `WritingProject.compile?: { target,
titlePage, chapterStyle, sceneTitles, separator, language }` (last choices; strings and booleans
only). Output files go to the exports folder; nothing else is stored.

**0.28 (combined design)** — `WritingProject` gains, all optional: `genre`, `series`, `tagline`,
`weeklyGoal`, `monthlyGoal`, `sessions: [{ start, end, words, sceneId }]` (last 200, recorded by
the writing service; a 15-minute pause starts a new one), `marks: [{ id, sceneId, quote, note,
createdAt }]`, `research: [{ id, kind: note|image|link|source|entry|board, title, path?, url?,
citation?, entityId?, images?, scenes, createdAt }]`; `RevisionPass.checklist: [{ id, text, done }]`;
`CharacterArc` gains `wants, needs, flaw, internal, external, arc, points: { sceneId: −1…1 },
turning: { sceneId: text }`; `compile` keeps `order, exclude, dedication, epigraph, epigraphBy,
acknowledgements, about`. All cleaned on load.

**Compile style (0.28.2)** — `WritingProject.compile.style`: a JSON string of `BookStyle`
`{ preset, paper, ink, accent, body, headings, size, leading, margins, page, dropCap, indent,
ornaments }`, cleaned by `cleanStyle` when read.

**World features (0.29)** — `World.features?: { writing?, maps?, calendars?, timeline?, trees?,
graph?, tasks?, dashboards?, media?: boolean }` (absent = on; cleaned by `cleanFeatures`).

**Deleted worlds (0.20.1)** — `<data>/trash/worlds/<worldId>/`: the world's folder as it was,
plus `deleted.json` `{ format: "worldsmith/deleted-world", v: 1, worldId, name, deletedAt,
entries, icon, backupFile }`. The world is removed from `manifest.json` and a
`before-delete` backup (retention class: safety) is made first. *Put back* renames the folder
into `worlds/` and re-adds it to the manifest; *Delete for good* removes the folder (and, if
asked, `backups/<worldId>/`). Notes and images in the vault are never touched.

**Older backups (before 0.20):**

A single JSON bundle of a world (`world`, `schemas`, `entities`, later `edges`, `tasks`,
`layouts`). Created automatically before storage migrations and on demand; the same format
is the **project export** format. The newest N (default 10) are kept.

**World files (0.9, import only since 0.19).** The older single-JSON world export. Since 0.19 *Export*
writes a world archive (§11b); these files can still be imported (*Import an older world file*). Format:
(`{ format: "worldsmith/backup", v: 1, createdAt, worldId, reason: "export", files }`, `files`
keyed by path inside the world folder) into the vault. Importing never overwrites: a
`worldId` already in the manifest — or whose folder exists without being listed — is added as
a copy (a new `worldId` written into every `worldId` field and `world.json`'s `id`, the name
with “ (copy)”). `worldId` must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`, `world.json`'s `id`
must equal it, and file paths with `..`, `.`, empty parts, `\` or a leading `/` are skipped.

## 11b. World archives — `<name>.worldsmith.zip` *(0.19)*

A plain ZIP (no ZIP64; UTF-8 names; DEFLATE through the platform's `CompressionStream`, stored
when that doesn't shrink an entry or for already-compressed formats):

```
manifest.json      { format: "worldsmith/archive", v: 1, app: "0.19.0", createdAt,
                     world: { id, name },
                     schema: { storage: STORAGE_VERSION, records: RECORD_VERSIONS },
                     counts: { entries, types, relations, tasks, maps, calendars, projects,
                               scenes, layouts, views, dashboards, notes, images, attachments },
                     files:   [{ path, size, sha256, kind: "data"|"note"|"media"|"attachment" }],
                     notes:   [{ vaultPath, role: "native"|"adopted"|"extra"|"scene",
                                 entityIds, sceneIds, links: [{ link, target }] }],
                     excluded:[{ vaultPath, reason: "not-chosen"|"remote"|"unsupported", usedBy }],
                     missing: [{ vaultPath, reason: "missing", usedBy }] }
README.txt         the same in plain words
world/<path>       every *.json of the world folder, exactly as on disk
                   (note-migrations/ is left out: those copies belong to the old vault)
vault/<vault path> notes, images, attachments, byte for byte
```

`notes[].links` are the links inside an included note that pointed at another included file
when it was exported (`link` as written, `target` the vault path it resolved to), so an import
can re-point exactly those links when a target had to land under another name.

**Reading** (`inspectArchive`, used by Verify and by every import) refuses: unreadable or
non-ZIP files; unsafe names (absolute, drive letters, `\`, `.`/`..`/empty segments, control
characters, characters Windows can't store); duplicate names, also differing only in case;
encrypted entries or unknown methods; more than 60,000 entries, 1 GB in one entry, 2 GB in all,
or an entry inflating over 200× (and over 1 MB) — checked before and while inflating; a CRC or
size mismatch; a missing or damaged manifest; an archive or data version newer than this
Worldsmith; an invalid world id; a listed file that's absent or whose SHA-256 differs; a file
in the ZIP that the manifest doesn't list; `world/` files that aren't valid JSON; vault paths
in hidden folders, inside the data folder, or with a file type outside the allowed list (`md`,
images, audio, video, `pdf`, `txt`, `csv`, `canvas`, `json`); notes that aren't in the archive.

**Importing** (`planPlacements`): a free vault path takes the file; an identical image or
attachment already there (same SHA-256) is reused; anything else lands beside it as
`name (imported).ext` (`(copy)` for a copy, then `… 2`, `… 3`). Notes are never reused. Moved
paths are applied to the world's data by `remapPaths` (only strings exactly equal to a moved
path change) and to links in imported notes by `rewriteLinks` (only links that no longer
resolve to their target). A world whose id is already listed, or whose folder exists, is
imported as a copy (`copyBundle`: new id in every `worldId`, “(copy)” name; native notes'
`worldsmith-world` rewritten).

**Import journal** — `<data>/imports/<id>.json`:
`{ format: "worldsmith/import-journal", v: 1, id, status: "writing"|"committed", startedAt,
archiveName, worldId, worldName, worldDir, created: [{ path, sha256 }] }`. Written before the
first write and kept up to date; removed when the import is checked. A `writing` journal found
later is an interrupted import: undoing it trashes the files in `created` whose SHA-256 still
matches (changed ones are kept) and removes the world folder if the world isn't listed.

## 12. Record migration registry

| Kind | v1 introduced | Notes |
|---|---|---|
| manifest | 0.1.0 | storageVersion 1 |
| world | 0.1.0 | |
| schema | 0.1.0 | |
| entity | 0.1.0 | |
| view | 0.8.0 | saved database views (§8) |

## 13. Type files *(0.9)*

A type file shares entity types between worlds (no entries):

```json
{
  "format": "worldsmith/types", "v": 1, "exportedAt": 1760000000000, "from": "The Ashen Crown",
  "types": [ { "schema": { "id": "character", "singular": "Character", "...": "…" },
               "layout": [ { "id": "hero-0", "type": "hero", "x": 0, "y": 0, "w": 12, "h": 1, "config": {} } ] } ],
  "relationTypes": [ { "id": "friendship", "label": "Friendship", "...": "…" } ]
}
```

`schema` is an EntitySchema without `v`, `origin`, timestamps, `rev` and `archived`; `layout`
is the page layout the type's pages use (its standard one included). Type and relation ids
must be plain (as world ids). On import a type whose id exists is skipped or added as a copy
(new id, “(imported)” names, references between the file's own types remapped); relationship
kinds the world lacks are added, existing ones are never changed.

## 14. Exported notes and spreadsheets *(0.9)*

**Markdown notes** start with frontmatter Worldsmith uses to recognise its own notes:

```yaml
---
worldsmith-id: "<entityId>"
worldsmith-hash: "<8 hex digits: FNV-1a of the note without this line, \n line ends>"
worldsmith-world: "<worldId>"
worldsmith-type: "Character"
status: "In development"
aliases: ["The Ash Knight"]
tags: ["knight"]
age: 23
homeland: "[[Worldsmith/Exports/Notes/Locations/Velmor|Velmor]]"
---
```

then `# Name`, the portrait, the summary as a quote, `## Section` with long fields, and the
gallery. A later export updates a note only when its id and world match **and** its hash
still matches (it wasn't edited); any other note is never touched.

**CSV** files are UTF-8 with a BOM and CRLF lines. Columns: `Name`, `Also known as`, `Tags`,
`Status`, `Summary (description)`, then one per visible field under its label — or
`Label (id)` when the label is shared, matches a built-in column, or reads like another
field's id. Several items are joined with `; ` (a single item containing a comma ends with
`;`); links are entry names; dates use the field's own text (`12 M3 312 BE Third Age`), which
reads back exactly; cells starting with `= + - @` (not numbers) get a leading `'`.

## 15. Layout presets and calendars *(0.10)*

### Layout preset — `worlds/<id>/presets/<presetId>.json`

A one-record bucket (`"format": "worldsmith/preset-bucket"`):

```jsonc
{ "v": 1, "id": "…", "name": "Hero sheet", "icon": "layout-template",
  "description": "Portrait first",
  "blocks": [ BlockInstance, … ],       // same shape as a page layout (§7)
  "fromType": "character" | null,       // the type it was made from; others get it adapted
  "createdAt": …, "updatedAt": …, "rev": 1 }
```

Names are unique per world. Unknown keys are kept.

### Calendar — `worlds/<id>/calendars/<calendarId>.json`

A one-record bucket (`"format": "worldsmith/calendar-bucket"`):

```jsonc
{ "v": 1, "id": "c81d…", "name": "Twelve moons", "description": "",
  "months": [ { "id": "m1", "name": "Frostmoon", "short": "Frost", "days": 30 }, … ],
  "weekdays": [ "Moonday", … ], "weekdayOffset": 0,
  "festivals": [ { "id": "midwinter", "name": "Midwinter", "after": 12, "days": 1,
                   "every": 1, "from": 0 } ],        // after = months before it; every 4 = leap day
  "eras": [ { "id": "ac", "name": "After the Crowning", "abbr": "AC", "start": 0,
              "direction": "up", "firstYear": 0, "color": "blue" },
            { "id": "bc", "name": "Before the Crowning", "abbr": "BC", "start": -1,
              "direction": "down", "firstYear": 1 } ],
  "style": "day-month-year" | "month-day-year" | "year-month-day" | "numeric" | "custom",
  "pattern": { "day": "the {day-th} of {month}, {year} {era}",   // 0.11.1: used when style is "custom"
               "month": "", "year": "" } | null,  // "" = worked out from "day"; kept when switching style
  "showWeekday": false,
  "offset": 0,                          // where its year 0 is on the main calendar's line
  "createdAt": …, "updatedAt": …, "rev": 4 }
```

Pattern parts: `{weekday}`, `{day}`, `{day-th}` (14th), `{day-words}` (fourteenth), `{month}`,
`{month-short}`, `{month-number}`, `{year}`, `{year-roman}` (CCCXII), `{era}` (short form),
`{era-name}`. Anything else is written as typed. Parts with nothing to show (no weekday, no
era) vanish with the commas and spaces around them; festival days fill `{month}` (or are
written out in all-number formats); years before 0 with no eras still say "BE". Dates are
stored the same way whatever the style, so changing how they're written never changes them.

All calendars share one line of absolute years (the main calendar's count). An era counting
up names absolute year `start` as its year `firstYear`; one counting down names `start` as
`firstYear` and counts up into the past. Deleting a calendar never changes dates: ones that
named it are read on the main calendar's line, and Undo brings it back.


## 16. Family trees, relationship graphs and maps *(0.11)*

Each is a one-record bucket in its own folder, named by id. Unknown keys are kept, values are
clamped when read, and new worlds get **Maps**, **Family trees** and **Relationship graph** in
the Tools group of the sidebar (added once to older worlds, after Timeline).

Two relationship kinds are added to every world when first needed: `parent-of` (*Parent &
child*, from the parent to the child; Children / Parents) and `marriage` (*Marriage*;
Spouses). The Character type gains three relation fields over them: `parents` (reverse
`parent-of`), `children` (forward `parent-of`) and `spouses` (`marriage`).

### Tree — `worlds/<id>/trees/<treeId>.json` (`"format": "worldsmith/tree-bucket"`)

```jsonc
{ "v": 1, "id": "…", "name": "House Varr", "description": "", "icon": "network",
  "kind": "family" | "hierarchy",
  "rootId": "<entityId>" | null,        // the person it's drawn around, or the top of a hierarchy
  "typeId": "nation" | null,            // hierarchy without a root: every top-level entry of a type
  "up": 2, "down": 2,                   // generations / levels shown
  "direction": "down" | "up" | "right",
  "card": "portrait" | "compact" | "name",
  "colorBy": "type" | "status" | "generation" | "none",
  "lines": "curved" | "square" | "straight",
  "background": "plain" | "dots" | "grid" | "parchment",
  "show": { "photos": true, "dates": true, "type": false, "partners": true,
            "siblings": true, "status": false },
  "parentKinds": ["parent-of"],         // connection kinds read as parent → child
  "partnerKinds": ["marriage", "romance"],
  "collapsed": ["<entityId>"],          // hierarchy branches folded shut
  "createdAt": …, "updatedAt": …, "rev": 3 }
```

Trees hold no family data of their own: parents and partners are ordinary connections, and
hierarchies follow each entry's `parentId`.

### Relationship graph view — `worlds/<id>/graphs/<graphId>.json` (`"format": "worldsmith/graph-bucket"`)

```jsonc
{ "v": 1, "id": "…", "name": "Around Mara", "description": "", "icon": "share-2",
  "types": [], "kinds": [], "tags": [], // empty = everything
  "focusId": "<entityId>" | null, "depth": 2,   // 1–4 steps from the focus
  "hideIsolated": true, "showSecret": false, "showParents": false,
  "labels": "always" | "hover" | "never", "edgeLabels": false,
  "colorBy": "type" | "status" | "none", "sizeByLinks": true, "photos": true,
  "spacing": 1,                         // 0.5–2
  "background": "plain" | "dots" | "grid" | "parchment",
  "pinned": { "<entityId>": [x, y] },   // entries placed by hand
  "pinOnDrag": false,                   // 0.12: dragging a dot pins it (old files read as false)
  "createdAt": …, "updatedAt": …, "rev": 2 }
```

### Map — `worlds/<id>/maps/<mapId>.json` (`"format": "worldsmith/map-bucket"`)

```jsonc
{ "v": 1, "id": "…", "name": "The Reach", "description": "", "icon": "map",
  "image": ImageRef | null,             // a vault image; null = a blank backdrop
  "aspect": 1.5,                        // width ÷ height, measured from the image (0.1–10)
  "backdrop": "parchment" | "plain" | "night" | "sea",
  "entityId": "<entityId>" | null,      // the entry this map shows
  "pins":    [ { "id": "…", "x": 0.42, "y": 0.31,          // 0–1 across and down the map
                 "entityId": "…" | null, "label": "", "note": "", "layerId": null,
                 "color": "red" | null, "icon": "castle" | null, "size": "s"|"m"|"l"|null,
                 "mapId": "<mapId>" | null } ],           // opens a map inside this one
  "regions": [ { "id": "…", "points": [[x, y], …], "opacity": 0.25,
                 "style": "solid"|"dashed"|"dotted", …same item keys } ],
  "paths":   [ { "id": "…", "points": [[x, y], …], "style": "dashed", "width": 3,
                 "arrow": false, …same item keys } ],
  "layers":  [ { "id": "…", "name": "Trade routes", "visible": true, "color": null } ],
  "scale": { "width": 1200, "unit": "leagues" } | null,  // the map's full width in units
  "grid": { "show": false, "kind": "square" | "hex", "cells": 20, "opacity": 0.25 },
  "labels": "always" | "zoom" | "hover",
  "pinSize": "s" | "m" | "l",
  "compass": false,
  "createdAt": …, "updatedAt": …, "rev": 12 }
```

Nothing that can't be read is thrown away: a pin without a position goes to the middle,
areas and routes with too few corners are kept (just not drawn), unreadable corners are kept
under the item's `pointsAsFound` and an unreadable scale under `scaleAsFound`. Deleting a
layer keeps its items (they lose the layer). A map's image is a media reference, so renaming
or moving the file updates the map, and a missing file is never cleared.

## 17. Writing Studio *(WS2, WS3, WS4)*

A writing project is a folder of ordinary Markdown notes. The notes hold only the text; every
other fact about the book lives in the two files below. Worldsmith never writes into the notes
(no front matter, no rewrites): it creates a note only for a new scene (or a copy or split of
one, always at a free path), and changes a note's text only on **split** (after the second half
is safely in a new note) and **merge** (appending; the second note is left as it was), both
through Obsidian's atomic `vault.process`.

### Project — `worlds/<id>/writing/projects/<projectId>.json` (`"format": "worldsmith/writing-project-bucket"`)

```jsonc
{ "v": 1, "id": "…", "name": "The Ember Oath",
  "kind": "novel" | "novella" | "short-story" | "anthology" | "script",
  "folder": "Writing/The Ember Oath",          // vault folder of the notes; follows renames
  "description": "",
  "statuses": [ { "id": "firstDraft", "label": "First draft", "color": "yellow", "done": false }, … ],
  "defaultStatus": "idea",
  "threads": [ { "id": "…", "label": "The oath", "color": "red", "description": "" } ],
  // WS4 (0.16.0); defaults for older records, which are not rewritten for them:
  "retiredStatuses": [ { "id": "outlined", "label": "Outlined", "color": "purple", "done": false } ],
                                  // taken off the list; scenes keep the id (shown as "No status")
  "retiredThreads": [ … ],        // the same for plot threads; scenes keep their links
  "beats": [ { "id": "…", "label": "Midpoint", "description": "…", "group": "Act two",
               "position": 50 | null,          // percent through the book, 0–100
               "sceneIds": ["<sceneId>", …],
               "source": "save-the-cat" | "own:<templateId>" | "custom" } ],
                                  // beats of every structure ever shown; only `source == structure` show
  "structure": "save-the-cat" | "three-act" | "heros-journey" | "seven-point" | "kishotenketsu"
             | "own:<templateId>" | "custom" | null,
  "wordTarget": 90000 | null,
  "archivedAt": null,                           // archived = hidden in the studio, nothing else
  "order": 0,                                   // place in the project list
  "createdAt": …, "updatedAt": …, "rev": 3 }
```

New projects get the statuses Idea, Outlined, First draft, Revised, Final draft and Complete.
A status's `id` never changes when it is renamed (new ones get a slug of their name, unique
among every status the project ever had, retired ones included), so scenes keep theirs.
`retiredStatuses` never holds an id that is on `statuses` (the hydrator drops such a copy).

### Parts, chapters and scenes — `worlds/<id>/writing/manuscript/<projectId>.json` (`"format": "worldsmith/manuscript-bucket"`)

All items of one project share one file, so a drag-reorder is one write.

```jsonc
{ "v": 1, "id": "…", "projectId": "…",
  "kind": "part" | "chapter" | "scene",
  "parentId": "…" | null,         // null = top level; parts hold chapters/scenes, chapters hold scenes
  "order": 2,                      // among siblings; manuscript order is a depth-first walk
  "title": "Arrival",              // the record's own; renaming never renames the note
  "synopsis": "", "purpose": "", "color": "blue" | null,
  "notes": "",                     // WS3: the writer's own notes about the item (inspector › Notes);
                                   // kept here only, never written into the note; "" when absent
  "collapsed": false,              // binder state of a part or chapter
  "notePath": "Writing/The Ember Oath/Arrival.md" | null,   // scenes only
  "status": "firstDraft",
  "pov": "<entityId>" | null, "cast": ["<entityId>", …], "location": "<entityId>" | null,
  "date": ChronoDate | null,       // §9, in the world's calendars: the in-story date (WS4: Timeline)
  "time": "21:30" | null,          // WS4: in-story time of day, "HH:MM" (24 h); only with a date
  "threads": ["<threadId>", …], "wordTarget": 2500 | null,
  "trashedAt": null,               // in Worldsmith's trash; what's inside a trashed item is hidden with it
  "createdAt": …, "updatedAt": …, "rev": 7 }
```

A scene merged into the one before it keeps its record in the trash with `"mergedInto": "<id>"`.
Unknown keys are kept on both records. Note paths follow renames and moves live (vault
events); a note that is gone (or was renamed while Obsidian was closed) is reported as missing
and can be re-matched by its file name, never by touching notes. Word counts are not stored:
they're counted on the device from the notes and cached in memory by modified time.

### Templates of your own — `worlds/<id>/writing/templates/<templateId>.json` (`"format": "worldsmith/writing-template-bucket"`) *(WS4)*

```jsonc
{ "v": 1, "id": "…", "name": "My mystery shape", "description": "Made from “The Ember Oath”: 24 scenes, 15 beats.",
  "outline": [ { "kind": "part" | "chapter" | "scene", "title": "Arrival", "synopsis": "…",
                 "children": [ … ] } ],            // titles and synopses only, never note text
  "beats": [ { "label": "…", "description": "…", "group": "…", "position": 50 | null } ],
  "statuses": [ SceneStatus, … ], "defaultStatus": "idea" | null,   // new projects from it start with this
  "threads": [ PlotThread, … ],
  "trashedAt": null,               // deleted from the list (Undo clears it); projects made from it don't change
  "createdAt": …, "updatedAt": …, "rev": 0 }
```

Built-in structures (Three-act, Save the Cat, Hero's Journey, Seven-point, Kishōtenketsu) are
code (`src/services/writing/structures.ts`), not data. Unknown keys are kept on templates too;
bad outline nodes are skipped on load, and a node its parent can’t hold (a part inside a chapter, say) is skipped, with what it holds, when a project is made from it.

**On this device only (WS3)**, not in the world's data: where each scene's cursor and scroll
were (`worldsmith-writing-places`, the 400 most recent scenes) and each project's side pane
(`worldsmith-writing-split`: what it shows, which scene, its width, the inspector tab) and,
since WS4, each project's Story board (`worldsmith-writing-board`: the board used last and the
plot-thread filter), kept
with Obsidian's per-vault local storage. Losing them only means a scene opens at the top.
The writing look (surface, page width, line height, text size, font, typewriter, dim) is a
plugin setting, `settings.writing`, in the plugin's own `data.json`.

## 18. Native notes *(0.17)*

An entry may have a native note: an ordinary Markdown note in the vault that is the home of its
values. All of it is optional. An entry without `nativeNote` is stored exactly as before.

### On the entry — `nativeNote`

```jsonc
"nativeNote": {
  "path": "Worldsmith/Characters/Auron Vale.md",  // also the entry's linkedNote
  "templateId": "…",                              // optional per-entry template; absent = the type's
  "base": {                                       // what both sides last agreed, per key
    "p:age": "23",                                // a property's canonical text
    "f:biography": "1k3x9ab",                     // hash of a section's text
    "v:connections": "0q8…", "w:connections": "…", // a view part: exact hash, and with links as one token
    "k:p:age": "Age",                             // the property key last written (a renamed field moves it)
    "h:biography": "Biography"                    // the managed heading's label last written
  },
  "status": "ok" | "missing" | "conflict",
  "conflicts": [ { "key": "p:age", "label": "Age", "note": "30", "ws": "24", "at": 1792… } ],
  "detached": ["infocard"],                       // view parts kept as the person edited them
  "mtime": 1792…, "fileHash": "…",                // start-up skip
  "createdAt": 1792…
}
```

`values`, `description`, `aliases`, `tags` and `status` keep the last agreed values (they are
the cache of the note), so everything that reads entries is unchanged.

### On a field — `noteKey`

`FieldDefinition.noteKey?: string` is the property name in the note. The default is the
field's label. Keys are unique per type, never one of Worldsmith's own keys (a clash gets a
number). Nothing sets `noteKey` yet, so keys follow the label. Each note remembers the key it
last wrote (`base["k:p:<fieldId>"]`). When a field is renamed, only the key on that property's
line changes, so an edit made in the note under the old name is still compared and kept. If the
new name is already a property of the note's own, nothing is renamed.

A note is the entry's only while its `worldsmith-id` is the entry's id and its
`worldsmith-world` (when set) is the entry's world. A note with no id counts only while it is
exactly what Worldsmith last saw (`fileHash`). A copied world keeps its entries' ids, so a note
of another world is never linked or migrated into this one. A note that goes missing stays
missing (Relink, or the note coming back with its id, ends it). A different note made at its old
path is never written.

### The note

```markdown
---
worldsmith-id: <entityId>          # identity; found again by this after a move
worldsmith-world: <worldId>
worldsmith-type: character
cssclasses:                        # merged with the person's own classes
  - ws-note
  - ws-tpl-character-dossier
aliases:
  - The Ash Knight
tags:
  - night-guard
Status: Draft
Age: 23                            # short fields: number, yes/no, date (bare), list, text
Occupation: Knight of the Night Guard
---

%% ws-start view:banner %%
![[Art/Banners/ashen.svg|ws-banner]]
%% ws-end banner %%

%% ws-start view:title — kept up to date by Worldsmith; write anywhere outside these markers %%
*Character · Draft*

# Auron Vale
%% ws-end title %%

%% ws-start field:ws-summary %%
> The summary, as a quote (editable).

%% ws-end ws-summary %%

%% ws-start field:biography %%
## Biography

Long text, editable here.
%% ws-end biography %%

Anything outside the markers is the person's, never touched.

%% ws-start view:footer %%
[Open in Worldsmith](obsidian://worldsmith?world=<worldId>&entry=<entityId>)
%% ws-end footer %%
```

- **Regions**: `%% ws-start <view|field>:<id> [note] %%` … `%% ws-end <id> %%`, each marker on
  its own line. `field` regions are editable (a field's heading and text, or `ws-summary`).
  `view` regions are generated (banner, title, infocard, facts, the type's fact groups,
  connections, children, gallery, separators, headings, footer). Markers inside code fences
  don't count. Broken, nested or duplicate regions are never written.
- Empty fields are not written as properties. Adding the key in Obsidian fills the field, and
  clearing its value empties it. A key deleted while it had a value is written back.
- Line endings (LF or CRLF) and a BOM are kept.

### Note templates — `worlds/<id>/note-templates/<templateId>.json` (one record per file)

```jsonc
{ "v": 1, "id": "…", "name": "My Character Dossier", "icon": "user-round", "description": "",
  "sections": [ { "id": "banner", "kind": "banner" }, { "id": "facts", "kind": "facts", "title": "At a glance",
                  "fields": ["age", "occupation"], "fold": "none" | "open" | "closed", "hidden": false },
                { "id": "biography", "kind": "field", "fields": ["biography"] }, … ],
  "appearance": { "style": "dossier" | "chronicle" | "fieldguide" | "atlas" | "plain",
                  "accent": "bronze" | "crimson" | "verdigris" | "violet" | "azure" | "theme",
                  "titleFont": "codex" | "theme", "portrait": "right" | "left" | "none",
                  "density": "detailed" | "compact", "headings": "ornament" | "rule" | "plain",
                  "hideProperties": true },
  "createdAt": 0, "updatedAt": 0, "rev": 0 }
```

The six built-ins (`character-dossier`, `location-atlas`, `historical-chronicle`,
`creature-bestiary`, `faction-dossier`, `custom-entity`) are not stored. `world.json` gains
`noteTemplates: { byType: { <typeId>: <templateId> } }`. A template file for sharing is
`{ "format": "worldsmith/note-template", "v": 1, "template": { … } }`. Its id is kept only
when it is a plain, unused id.

### Migrations — `worlds/<id>/note-migrations/<migrationId>.json`

`{ format: "worldsmith/note-migration", v: 1, id, createdAt, scope: { kind: "entry" | "type" | "world", id?, label }, backupPath, entries: [ { id, name, action: "create" | "link", path, noteBefore, noteAfterHash, before, after } ] }`.
`before` and `after` hold the entry's `values`, `description`, `aliases`, `tags`, `status`,
`linkedNote` and `moreNotes`. The file is the safety copy, deleted on Confirm, on Undo or
after 30 days. It is left out of world files.

### Backups and world files

Backups (§11) gain `notes?: [ { path, content } ]`, the world's native notes. Paths must be
plain vault-relative `.md` paths (no `..`, no hidden folders). Restoring never overwrites a
different note: the backup's version is written as `<name> (restored).md` (or `(copy)`), and
entries follow it. Type files (§13) gain `types[].note`: `{ builtIn: "<id>" }` or
`{ template: { name, icon, description, sections, appearance } }`.

### Settings — `nativeNotes`

`{ renameWithEntry: true, snippet: "ask" | "on" | "off", snippetName: "worldsmith-notes", readingExtras: true }`.
The snippet is `<configDir>/snippets/<snippetName>.css`. Its first line carries
`ws-hash:<hash of the rest>`, and a file without a matching hash is never written.
