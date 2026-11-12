# Worldsmith — Architecture

This document is the map of the codebase. Read it before adding a feature; it tells you
where things live, which layer owns what, and which extension point to use so you never
have to edit ten unrelated files.

See also: [DATA_MODEL.md](DATA_MODEL.md) for every persisted shape and the on-disk format,
and [CHANGELOG.md](CHANGELOG.md) for what each milestone added.

---

## 1. Guiding decisions

| Decision | Choice | Why |
|---|---|---|
| Source of truth | Structured JSON in a vault folder (default `_worldsmith/`) | Records are database rows, not notes. Markdown notes are optional attachments. |
| Identity | UUID v4 for entities, stable slug IDs for schemas/fields | Renames never break references; filenames are never identity. |
| Entity types | **Data**, not code. Built-in types are *seeded* into each world as ordinary schema files | Custom types are first-class because built-ins are literally the same thing. |
| Relations | A separate **edge store**; relation fields are *views* over edges | Reciprocity is free (one edge, two directions); no two-sided sync bugs. |
| Tasks | Internal objects in their own store, instantiated from schema task templates | Global roll-ups and per-type checklists without Markdown. |
| Layouts | 12-column grid of block instances, resolved entity → type → global | One engine for entity pages *and* dashboards. |
| UI framework | Plain TypeScript + Obsidian DOM helpers, on a tiny `UIComponent` built on Obsidian's `Component` | No framework runtime, Obsidian-native lifecycle/cleanup, fine-grained updates. Blocks render into a bare element, so a block could use any framework later. |
| Mobile | No Node/Electron APIs; storage via `DataAdapter` | `isDesktopOnly: false`. |

---

## 2. Layers

```
┌───────────────────────────────────────────────────────────────┐
│ UI            ui/views (shell, pages)   ui/components   blocks │  renders + dispatches intents
├───────────────────────────────────────────────────────────────┤
│ State         state/  (Router/navigation, SaveStatus)          │  UI-only state, no persistence
├───────────────────────────────────────────────────────────────┤
│ Services      services/  WorldService EntityService            │  business rules, validation,
│               SchemaService (later: Relation, Task, Layout,    │  cross-repository operations
│               Media, Search, Compute)                          │
├───────────────────────────────────────────────────────────────┤
│ Repositories  data/repositories  + data/indexes                │  in-memory canonical state,
│                                                                │  change events, indexes
├───────────────────────────────────────────────────────────────┤
│ Storage       data/storage  (BucketStore, AtomicJsonFile,      │  files, atomic writes,
│               WriteQueue, StorageAdapter) + data/migrations    │  migrations, backups
└───────────────────────────────────────────────────────────────┘
        core/  — types, Registry<T>, EventBus, utilities (used by every layer)
```

Rules:

1. **Downward dependencies only.** UI may call services and read repositories/indexes;
   services call repositories; repositories call storage. Storage never imports UI.
2. **No business logic in DOM code.** A component asks `EntityService.setFieldValue(...)`;
   it never mutates a record or decides validity itself.
3. **Repositories are the in-memory source of truth.** Reads are synchronous from memory;
   writes mark records dirty and the `BucketStore` flushes them (debounced). The UI never
   waits on disk for an edit.
4. **Everything changes through events.** Repositories emit typed events on the
   `EventBus`; indexes and UI subscribe. A field edit patches exactly the DOM that shows
   that value — no page re-render.

### Composition root

`src/app/WorldsmithApp.ts` constructs every registry, the storage stack, repositories and
services, in that order, and owns their lifecycle. `main.ts` only creates the app, registers
the view/commands/settings tab, and disposes on unload. The app object also exposes the
extension API (`app.api`, see §6).

---

## 3. Folder structure

```
src/
  main.ts                       Plugin lifecycle only
  app/
    WorldsmithApp.ts            Composition root + lifecycle
    api.ts                      Public extension API surface (registerBlock, …)
    constants.ts                View type IDs, folder names, versions
  core/
    types/                      Pure models (entity, schema, field, world, layout, task,
                                relation, chrono, ids). No runtime code.
    registry/Registry.ts        Generic keyed registry with change notifications
    events/EventBus.ts          Typed pub/sub, Disposable-returning
    util/                       ids, clone, strings, async helpers, disposables
  data/
    storage/
      StorageAdapter.ts         Minimal FS interface (read/write/list/remove/rename/…)
      ObsidianStorageAdapter.ts Implementation over app.vault.adapter (works on hidden paths)
      WriteQueue.ts             Per-path serialization + global concurrency cap
      AtomicJsonFile.ts         tmp-write → verify → swap; recovery from .tmp/.bak
      BucketStore.ts            Generic collection store: records grouped into bucket files,
                                dirty tracking, debounced flush
      paths.ts                  Every on-disk path in one place
    migrations/                 MigrationRunner + numbered migrations
    repositories/               WorldRepository, SchemaRepository, EntityRepository (…)
    indexes/                    EntityIndex (byType, byParent, favorites, recency)
    backup/                     BackupService (snapshot a world to backups/)
  fields/
    FieldTypeRegistry.ts        Registry of field type definitions
    types/                      One file per field type (definition + display + editor)
  schemas/
    dsl.ts                      Small builder for authoring built-in schemas in code
    builtin/                    17 built-in type templates (character.ts, location.ts, …)
  blocks/
    BlockRegistry.ts            Registry of block definitions
    <block>/                    One folder per block (hero, properties, description, …)
  layouts/
    engine/                     Pure layout math: grid ops (compact, move, resize, insert)
                                and the guillotine tree used for rendering
    renderer/                   LayoutRenderer: tree → DOM, block lifecycle
    defaults/                   Default layouts per built-in type + dashboard
  services/                     WorldService, EntityService, SchemaService, (…)
  state/                        Router (route stack), SaveStatus
  ui/
    components/                 Buttons, icons, chips, inputs, menus, modals, empty states
    views/
      WorldsmithView.ts         The single ItemView that hosts the app shell
      shell/                    Shell, Sidebar, Topbar
      routes/                   RouteRegistry + one page per route (dashboard, database,
                                entity, onboarding, …)
  settings/                     Plugin settings model + Obsidian settings tab
  styles/                       Scoped CSS modules, bundled into styles.css
tests/                          Headless tests (storage, migrations, services, schemas, layout)
harness/                        Browser harness: Obsidian shim + Playwright UI checks (dev only)
```

Changes vs. the original sketch: UI lives under `ui/` so the non-UI layers are visibly
separate; `entities/<type>/` folders were folded into `schemas/builtin/` because built-in
types are data templates, not code modules (a type that needs bespoke behaviour registers a
block or field type instead of getting its own code path).

---

## 4. Storage architecture

### 4.1 Location

All world data lives under a vault folder, default **`_worldsmith/`**, accessed through
`app.vault.adapter` (`DataAdapter`) on desktop and mobile. The name deliberately has no
leading dot so Obsidian Sync includes it (Sync's "Other file types" must be on for
`.json`). JSON files don't appear in search or graph; `LinkedNoteService` ignores vault
events inside the data folder.

The folder is configurable in settings. `WorldsmithApp.changeDataFolder()` shuts the
session down, moves the folder (`moveDataFolder`: adapter rename, or a verified copy that
keeps the original if rename isn't possible; never into a non-empty folder), relocates the
`Database` and restarts. On first start, `migrateLegacyFolder()` moves a 0.1.x
`.worldsmith/` to `_worldsmith/` the same way; if that fails the old folder keeps being
used and the setting is updated to point at it.

`data.json` (Obsidian's `loadData/saveData`) holds only **device/vault preferences**:
data folder, appearance, last route. World content never goes there.

### 4.2 Layout on disk

```
_worldsmith/
  manifest.json                      storage format version, worlds list, active world
  worlds/<worldId>/
    world.json                       world metadata + world-level config (statuses, sidebar)
    schemas/<typeId>.json            one file per entity type (seeded built-ins + custom)
    entities/<aa>/<entityId>.json    one file per entity (aa = first 2 hex chars of the id)
    relations/<shard>.json           connections (edges), sharded by hash(from)
    relation-types/<typeId>.json     one file per kind of connection (seeded + custom)
    tasks/<shard>.json               dev tasks, sharded by hash(entityId)    (Milestone 4)
    layouts/<layoutId>.json          type/entity/dashboard layouts           (Milestone 6)
    views/<typeId>.json              saved database views                    (Milestone 8)
  backups/<worldId>/<timestamp>.json full-world snapshots
  quarantine/                        unreadable files moved aside, never deleted
```

### 4.3 BucketStore — one store implementation for every collection

A `BucketStore<T>` holds a collection in memory and persists it as *bucket files*. The only
thing that differs per collection is the **bucket function**:

| Collection | Bucket key | Files at 5,000 entities | Why |
|---|---|---|---|
| entities | the entity id (1 record/file) | 5,000 | richest & most edited; sync conflicts stay per-entity; human-readable |
| relations | `hash(from) % 256` | ≤256 | tens of thousands of tiny edges |
| relation types | the type id (1 record/file) | ~50 | edited rarely; per-file sync conflicts |
| tasks | `hash(entityId) % 256` | ≤256 | thousands of tiny records |

Mutations update memory immediately, mark the bucket dirty, and schedule a debounced flush
(idle 750 ms, forced after 5 s of continuous edits). A flush writes only dirty buckets
through the `WriteQueue`. `flushNow()` is called on plugin unload and on the workspace
`quit` event.

If entity load time ever becomes a problem, switching entities to hash-sharding is a
bucket-function change plus a migration — repositories don't change.

### 4.4 Atomic writes and corruption resistance

`AtomicJsonFile.write(path, value)`:

1. Serialize (2-space JSON, stable key order for the envelope).
2. Write `path.tmp`, read it back and compare (catches truncated writes).
3. Optionally rotate the existing file to `path.bak` (singletons: manifest, world, schemas).
4. Remove `path`, rename `path.tmp` → `path`.

`AtomicJsonFile.read(path)` recovers in order: `path` → `path.tmp` → `path.bak`. A file that
cannot be parsed is **copied to `quarantine/`** and reported with a Notice — never deleted,
never silently overwritten.

Every file carries an envelope: `{ "format": "worldsmith/<kind>", "v": <recordVersion>, … }`
so files are self-describing and individually migratable.

### 4.5 Migrations

Two levels, both in `data/migrations/`:

- **Storage migrations** (`manifest.storageVersion`): change folder layout or file
  envelopes. Run once at startup by `MigrationRunner`, *after* an automatic backup. Each
  migration is `{ id, from, to, description, run(ctx) }`, applied in order; the manifest
  version is bumped after each success, so an interrupted upgrade resumes safely.
- **Record migrations** (`v` inside each record): pure functions upgrading one record shape
  to the next, applied lazily on load. An upgraded record is marked dirty so it is rewritten
  in the new shape.

Schema evolution by the *user* (renaming a field, changing its type) is not a migration —
`SchemaService` handles it by coercing values through the field type's `coerce()`.

### 4.6 External changes

Writes inside the data folder from another device (sync) are not vault events. Milestone 1
ships a **Reload world from disk** command. A later milestone adds mtime polling on window
focus with per-record `rev` comparison (see risk R2).

---

## 5. Registries (the extension points)

All registries are instances of `core/registry/Registry<T>`: `register(def) → Disposable`,
`get(id)`, `all()`, `onChange(cb)`. Registering is the *only* step needed to add a new kind
of thing.

| Registry | Holds | Adding one means… |
|---|---|---|
| `FieldTypeRegistry` | `FieldTypeDefinition` — default value, validate, coerce, toText (search/display), compare (sort), isEmpty, renderDisplay, createEditor | one file in `fields/types/` + one line in its index |
| `EntityTypeRegistry` | built-in/extension **type templates** (schemas in code) used to seed worlds | one file in `schemas/builtin/` |
| `BlockRegistry` | `BlockDefinition` — contexts (entity/dashboard), default size, declarative config fields, `render(ctx)` | one folder in `blocks/` |
| `ViewRegistry` | database view types (cards, table, gallery, list, kanban) | one file in `ui/views/database/views/` |
| `RelationshipTypeRegistry` | relationship type templates (mentorship, family, membership…) | data, seeded like schemas (M3) |
| `RouteRegistry` | app pages (dashboard, database, entity, search, trash; later tasks, studios…) | one file in `ui/views/routes/` |

**Templates vs. live schemas.** `EntityTypeRegistry` holds *templates*. A world's actual
types are the files in `worlds/<id>/schemas/`, owned by `SchemaRepository`. Creating a
world copies the built-in templates in (recording `origin: {templateId, templateVersion}`),
after which they are ordinary, fully editable data. Later, "template updated" offers can be
computed from `origin`.

**Declarative configuration everywhere.** Block settings and field-type configuration are
described *as field definitions*, so the same field editors render a block's settings
panel, a field's config panel in Type Studio, and an entity's properties. One UI system,
three uses.

---

## 6. Extension API

`WorldsmithApp.api` (exposed as `plugin.api`) is the surface for future Worldsmith
add-ons and for our own modules:

```ts
api.registerFieldType(def)     api.registerBlock(def)     api.registerEntityType(template)
api.registerView(def)          api.registerRoute(def)     api.events.on(…)
api.entities / api.schemas     (read access to services)
```

Every `register*` returns a `Disposable`; Worldsmith's own built-ins are registered through
the same calls in `app/registerBuiltins.ts`, which keeps the API honest.

---

## 6a. Schema editing (Milestone 2)

Every structural change to a type goes through **`SchemaEditService`**
(`session.schemaEdits`) — Type Studio, entity-page shortcuts and, later, import all use it.

1. **Clone → mutate → validate → save.** `validateSchema()` (pure, `services/schema/`)
   checks names, field ids, duplicates, ranges, choices, section references and display
   references. Any error throws `SchemaValidationError` and nothing is written.
2. **Field ids are immutable.** Renaming changes the label; values keep their key.
3. **Nothing is destroyed.** Deleting a field, or changing its kind when a value can't be
   converted, moves the value to the entity's `values._orphaned` with a readable copy, a
   kind-neutral copy (choice labels instead of ids) and — for deletes — the field's
   definition and section. `restoreOrphan`, `recreateField` (re-adds the field and
   restores every entry), `discardOrphan`/`putOrphan` (undoable discard) work on it; the
   **Unused data** block shows it on entity pages and hides itself when empty.
4. **Kind changes are previewed** (`previewTypeChange`: how many values convert, examples
   of those that won't) and convert through each kind's `coerce()`. Converting to a
   choice kind builds choices from the distinct existing values.
5. **Undo.** Each edit pushes an entry with the schema before, the sidebar before (when
   touched) and the exact prior `values` of every entity it rewrote; `undo()` puts all of
   it back. 50 steps, per session.

Field kinds describe their own settings (`configFields`, `supportsPlaceholder`,
`hasOptions`, `studioNote`) on `FieldTypeLogic`, and the field settings dialog renders
those settings with the kinds' own editors — a new field kind brings its settings UI for
free.

Type Studio itself is a route (`type-studio`, params `typeId`, `tab`, `section`) under
`ui/views/routes/typeStudio/`. Shared building blocks (inline text, toggles, swatches,
confirm-delete, undo notices) live in `common.ts`; `ui/schemaActions.ts` exposes the
shortcuts used outside the studio.

## 6b. Relations (Milestone 3)

**One connection = one edge.** `RelationEdge { type, from, to, status, strength, secret,
start, end, description, notes, props }` lives in the edge store; nothing about a
connection is stored on either entity. A relation field is a *view* over edges:

| Field config | Shows |
|---|---|
| `direction: 'forward'` | edges of `relationType` where this entry is `from` |
| `direction: 'reverse'` | edges where this entry is `to` |
| symmetric type | edges where this entry is either end |

…filtered by `targetTypes` and with trashed entries hidden. So Kael's *Mentors* field
(reverse) and Auron's *Students* field (forward) read the same edge, and reciprocity can't
drift. `RelationService` (`session.relations`) owns it all:

- `link(entity, field, target)` resolves direction, refuses duplicates/self-links/wrong
  types, and for single-link fields (`max: 1`) replaces the current link, returning what
  it replaced so the UI can offer Undo. `connect(from, type, to)` is the field-less form.
- `unlink` / `restore` / `swap` / `changeType` / `updateEdge`; every removal returns the
  removed edges for Undo.
- An in-memory `entityId → edgeIds` index makes "connections of X" O(degree).
- **Lifecycle:** trashing an entry keeps its edges (hidden on the other side); restoring
  shows them again; permanent delete removes them (`entity:deleted` subscription).
  Duplicating an entry copies its connections with their details.
- **Relationship types** (`relation-types/<id>.json`) are seeded from a
  `RelationTypeTemplate` registry (`api.registerRelationType`). They carry the wording for
  each side (`forwardLabel` / `reverseLabel`), hints for pickers (`sourceTypes`,
  `targetTypes`) and custom property definitions (`fields`, stored in `edge.props`). On
  open, `ensureSeeded` installs every built-in when a world has none (first open after
  upgrading) and creates any type a relation field references but the world lacks.
  Deleting a type is refused while connections or fields use it.

**Derived values.** `FieldValues` (`session.values.get(entity, field)`) is the single read
path for field values: stored values for ordinary kinds, `LinkedEntry[]` for relation /
parent / children, and computed rollups (`count`, `list`, `unique`, `sum`, `avg`, `min`,
`max`, `earliest`, `latest` over a link field, recursion-limited). Cards, tables, sorting,
subtitles, completeness and the properties block all read through it, so a rollup or a
linked species shows the same everywhere.

**UI.** Field kinds that need the live app get an optional `host` (`{ ws, session,
navigate }`) in their editor context; without it (previews, dialogs) they show a read-only
summary. `EntityPicker` is an inline search popover with "Create …" rows. The
`connections` block lists every connection grouped by label and, by default, leaves out
what the page's relation fields already show. Connection pages are the `relation` route;
**Studio → Relationships** is the `relationships` route.

## 6c. Tasks (Milestone 4)

**Store.** `DevTask` records live in `tasks/<shard>.json`, sharded by the owning entry so a
checklist is one file. Due dates are real-world calendar days as `YYYY-MM-DD` strings
(`core/util/dates.ts` does all date math on local days, never on timestamps, so a task
never drifts a day across time zones). Fictional calendars stay in M10.

**`TaskService`** (`session.tasks`) owns them: create/update/status/move/remove (removals
return the tasks for Undo), ordering, `instantiate(entity)` from `schema.defaultTasks`,
`syncTemplates(typeId)` (adds only missing `templateId`s), repeat scheduling on completion,
and lifecycle subscriptions (entry deleted → its tasks go; type changed → `typeId`
follows; trashed → hidden by `visible()`). `EntityService` reaches it through hooks
(`afterCreate`, `afterDuplicate`, `taskStats`) so the services don't import each other.
`progress(entity)` blends tasks and key fields per `world.progress.mode`.

**Rollups.** `services/taskStats.ts` is a pure engine: a `StatTile` (metric + filters on
status, due window, types, priority, period, compare) evaluates against
`{ tasks, entities, progress, weekStart }`. The stats block, its settings dialog preview and
the tests all use it.

**Tasks home.** The `tasks` route is a page of blocks on the `tasks` surface (stats,
calendar, task list, board, due soon, overdue, recently done, progress by type, needs
attention, focus entries, chart, notes). Its layout is `world.pages.tasks`, so it syncs with
the world; absent means `TASKS_LAYOUT`.

**Layout editor.** `layouts/editor/LayoutEditor.ts` is the first piece of M6, written
generic: it renders any `BlockInstance[]` on the 12-column grid, and in customize mode
adds per-widget chrome (drag handle with drop marker — dropping on a side splits the row —,
settings, layout menu, remove) and a right-edge resize grip. All geometry goes through the
pure functions in `layouts/engine/grid.ts`. Blocks get `ctx.editing` and
`ctx.setConfig()` so they can offer their own edit affordances (stat tiles do).
`BlockSettingsModal` edits any block's `configFields`. M6 reuses this for entity and type
layouts.

**UI pieces.** `Popover` (anchored, outside-click/Escape), `datePicker` (month grid,
quick picks, keyboard), `TaskModal` / `NewTaskModal`, `taskUi.ts` (row, checkbox, due chip,
menus), and the `checklist` entity block.

## 6d. Media (Milestone 5)

**Two halves.** `session.media` (`MediaRefs`) is the world-facing half: an in-memory index of
every reference to a vault file (portraits, banners, emblems, galleries, media fields, the
world banner), invalidated by entity/schema/world events. It answers "where is this used",
finds references whose file is gone, suggests same-named candidates, and rewrites
references on `rename` (file or folder prefix) and `relink`. It never drops a reference.
`ws.media` (`MediaService`) is the vault-facing half: it subscribes to vault `rename`, lists
images, and imports files from outside the vault (`import`, `importUrl` via `requestUrl`,
`fromTransfer` for drops and pastes — OS files are copied in, Obsidian file-explorer drags
and `[[links]]` resolve to existing files, browser image links are downloaded).

**Field kinds opt in** with `media: { shape: 'ref' | 'refs', images }` on `FieldTypeLogic`,
so plugin field types get rename-tracking and library listing for free.

**Framing.** `refStyle(ref)` turns focal point + zoom + fit into `object-position`,
`transform: scale()` and `transform-origin`, and `vaultImage()` applies it everywhere an
image is shown (avatars, hero, cards, galleries, fields), so one adjustment shows the same in
every frame.

**UI** (`ui/media/`): `ImageBrowser` (thumbnail grid; search, folder, sort, used/unused;
upload, link, paste, drop; single or multi-select; keyboard grid navigation), `ImageAdjust`
(focal point by click/drag/arrows with the frame's crop outlined on the image, zoom, fit,
banner height, live previews per frame; Cancel restores), `Lightbox`, `renderGallery`
(shared by the Gallery block and Gallery fields: grid/masonry/filmstrip, tile shapes,
reorder by drag or Alt+←/→, captions, Undo), `imageDropTarget` / `imagePasteTarget`, and
`EntityMediaActions` (portrait/banner menus shared by the hero, gallery and entry menus).
The `media` route is the library and repair page.

## 6e. Page layouts and widgets (Milestone 6)

**Storage and resolution.** `session.layouts` (`LayoutService`) stores one `LayoutDoc` per
customized type (`type-<typeId>`) or entry (`entity-<id>`) in its own BucketStore file.
`forEntity(entity, schema)` resolves entry → type → `defaultLayoutFor(schema)` and returns
copies plus the source (`entry` / `type` / `default`). `save` validates (`hydrateBlocks`),
clamps (`normalize`) and packs (`compact`) before writing and bumps `rev`; saving an empty
layout removes it. `reset` returns the removed doc so every UI can offer Undo via
`restore`. It listens for permanent entry deletion; duplication copies the entry's layout
(`WorldSession.afterDuplicate`). Events: `layout:saved`, `layout:deleted`.

**Customize mode** lives in `EntityPage` (`ui/views/routes/entityPage.ts`). Every entry
page — viewing or editing — renders through the generic `LayoutEditor`. Customize adds an
edit bar (scope switch *All {Type}* / *Only {entry}*, Undo, Reset, Done) and the widget
drawer. Edits save immediately to the chosen scope; the first change in *Only {entry}*
creates the entry's own layout. Undo is a per-page stack (60 steps); every step remembers
which layout it belongs to, and the stack is cleared when that layout changes elsewhere.
The page never redraws from inside an editor callback (the editor is still mid-commit);
`LayoutEditor` ignores late calls after it is unloaded, and a settings dialog that outlives
its editor forwards only `config`/`title` to the live one. Entry points: the hero's layout
button, the ⋯ menu, the *Customize this page* command (all dispatch `CUSTOMIZE_EVENT` on
the page), and Type Studio → *Page layout* (`?edit=type`, a one-shot parameter).
Ctrl/Cmd+Z and Escape apply only to the visible page in the active pane.

**Widgets** are ordinary `BlockDefinition`s with a `category` (Basics, Showcase,
Connections, Writing) that groups the drawer, `configFields` (static, or a function of the
session and the page's schema) edited by `BlockSettingsModal`, and `singleton` for
one-per-page widgets. Showcase (`blocks/entity/feature.ts`): Key facts, Quote, Stat block,
Image spotlight, Single field, Heading. Connections (`network.ts`): Relationship web (SVG
lines + HTML nodes, hostile/secret/ended styles, chips on narrow panes), Roster (sortable
table over a relation/children field), Shared connections (second-degree). Writing
(`notes.ts`): Note backlinks (`metadataCache.resolvedLinks`/`unresolvedLinks`, name and
aliases) and Embedded note (`MarkdownRenderer`, re-renders on vault changes). A title the
user sets on a widget always wins over the widget's live title.

## 6f. Home and dashboards (Milestone 7)

**Pages.** The `dashboard` route renders Home (`params.id` absent) or an extra dashboard
(`params.id`). `DashboardPage` (`ui/views/routes/dashboardPage.ts`) mirrors the entry page's
Customize mode — edit bar (Undo, Reset for Home, Done), widget drawer, Ctrl/Cmd+Z and
Escape for the visible page only — with one scope. Home's banner widget carries the
Customize button (`CUSTOMIZE_DASHBOARD_EVENT`); without a banner a small toolbar does.

**Data.** `session.dashboards` (`DashboardService`) keeps names, icons, colours and order in
`world.json`; widgets go through `LayoutService` (`dashboard-<id>`). `create` writes the
widgets first and marks the dashboard `seeded`, so a device that receives the list before
the widgets waits for them instead of inviting edits that would overwrite them. `list()`
also shows dashboards known only from their widgets file and `adopt()`s them on first edit.
Removal returns everything Undo needs. Reset-undo (`ui/layoutUndo.ts`) refuses to overwrite
a layout that was changed again after the reset.

**Widgets** (`blocks/dashboard/`): `builders.ts` — Entry list, Number, Chart, Entry card,
Links; `discover.ts` — Spotlight, From the archives, Image wall, New connections, Search
box, Development by type, Needs attention; `dashboard.ts` — World banner, Contents, Quick
create, Recent work, Favorites; plus the Tasks widgets (also allowed on dashboards). The
builders share one query model (`services/entryQuery.ts`: `queryFromConfig`, `runQuery`,
`groupEntries`, `measure`, `queryFields`, `resetDependents`), which is pure apart from
reading the session and unit-tested. Settings rows can depend on earlier choices: the
dialog passes the current config to `configFields` and rebuilds rows only when they change;
`onSettingChange` lets a widget clear settings the change made meaningless.

**Performance.** `watchWorld` debounces repaints (≈0.2 s after a burst) and skips widgets
that aren't visible (a background tab), repainting them when they're shown again
(IntersectionObserver). Counts and charts don't sort. A row of three or more small tiles
(`ws-layout-row--tiles`) wraps two-up on phones.

**Sidebar.** A "Dashboard"/"Dashboards" section under Home and Tasks (plural from two
dashboards), with a + button and a context menu; `settings.showDashboards` hides it.

## 6g. Database views (Milestone 8)

**Data.** `session.views` (`ViewService`) keeps saved views in a `views` bucket store (one
file per type, `views/<typeId>.json`). A type always has at least one view: the synthetic
default `all-<typeId>` is returned until it is first changed and then stored under that fixed
id, so two devices editing their defaults converge on one record. `remove` refuses the last
view and returns what Undo needs. Every change bumps `rev` and emits `view:saved` /
`view:deleted`. `hydrateView` keeps whatever a newer version wrote (see DATA_MODEL §8).

**Query.** `services/viewQuery.ts` is pure apart from reading the session and unit-tested:
`matchCondition` / `runView` (conditions with all/any; a search keeps relevance order unless
the view sorts), `sortByView` (several keys, blanks last in either direction, ties by name),
`groupView` (boards list every option, empty ones too), `brokenConditions` (removed fields and
filters from a newer version), `missingKeyFields` (what the Progress layout lists), plus the
property lists the panels offer (`filterableFields`, `groupableProps`, `boardProps`,
`opsFor`, `valueChoices`).

**Page.** `ui/database/DatabasePage.ts` (mounted by the `database` route) draws tabs, the
toolbar, filter chips and the results. Panels (`ui/database/controls.ts`) edit a copy of the
view and report each change; they keep keyboard focus across their own re-renders and follow
their toolbar button when it is redrawn. Layouts: cards, gallery, table (one table across
groups so columns line up; header click sorts, right-click for column actions, drag the edge
to resize — the first resize freezes every column into a fixed layout; click, Enter or F2 on a
cell opens that field's own editor in a popover), list, board (HTML5 drag between columns or a
"Move to" menu; works for status and single-choice fields) and progress
(`ui/database/progress.ts`: development ring, task counts, next open tasks with tick-off,
missing key details; least developed first when the view has no sort).

**Live updates.** Entity changes of the type, the type's connections (only when the view
shows or uses connection-derived values) and its tasks repaint after 120 ms. While a cell
editor is open, repaints wait and catch up when it closes. Changes to the open view from
elsewhere close any open panel (it holds a stale copy) and redraw. Long lists draw 80 at a
time as you scroll (IntersectionObserver with a margin), and a repaint keeps as many drawn as
before; groups show 60 with "Show all". Everything the page registers — debounces, observers,
popovers — is torn down when the page closes, and late callbacks (an Undo notice, a search
debounce) are ignored once it has.

**Sharing.** A view's tab menu → *Show on a dashboard* adds an Entry list widget bound to the
view (`config.view`); the widget follows the view's filters, sort and columns and links back
to it.

## 6h. Polish round (0.8.1)

- **Property picker** (`ui/components/propertyPicker.ts`): a searchable, sectioned list in a
  popover for Group by, board columns, Add filter / sort, task grouping and media pickers;
  arrow keys and Enter; a second click on its button closes it. Popovers know their nested
  children (a picker over a filter panel), follow a re-drawn anchor (`setAnchor`) and close
  when their anchor disappears.
- **Tooltips**: Obsidian shows a tooltip for every `aria-label`, so containers are named with
  `nameRegion` (a visually hidden label + `aria-labelledby`) and cards rely on their visible
  text. The *Hover tooltips* setting hides tooltips while the pointer is over Worldsmith
  (`ui/components/tooltips.ts`: one capture `pointerover` per window marks `<body>`).
- **Block heights**: `BlockInstance.height` (px) from the bottom-edge handle in Customize;
  the renderer fixes the frame's height and scrolls the body (plain widgets get an inner
  `.ws-block__scroll`, so edit controls on the frame's edges aren't clipped).
- **Media library** (`ui/media/MediaLibrary.ts`): saved views on `ViewService` under
  `__media` (DATA_MODEL §8), wall/cards/table, chip filters, groups, lazy batches.
- **All tasks** (`blocks/tasks/taskTable.ts`): quick views, grouping (entry by default, soonest
  due first), a few tasks per group, a page of groups at a time; the head with the search box
  is built once so typing and input methods aren't interrupted by repaints.
- **Motion** (`styles/motion.css`): transform/opacity/colour transitions only; lift shadows
  fade in on a pseudo-element; no hover lifts on touch; off with *Animations* or reduced motion.

## 6i. Studios (Milestone 9)

- **Starting points for new types** (`schemas/starters.ts`, `ui/components/NewTypeModal.ts`):
  ten ready-made types (Vehicles & ships, Spells & rituals, Plants & herbs, Quests, Prophecies,
  Houses & bloodlines, Curses & diseases, Currencies & goods, Titles & ranks, Holidays &
  festivals) written in the schema DSL. `SchemaService.createFromTemplate` installs one as a
  *custom* type (`origin: null`) under the user's name, leaving out link fields whose
  relationship kind the world doesn't have. Plurals come from `pluralOf`.
- **Copy a field** (`SchemaEditService.copyFieldTo`): an undoable edit of the target type —
  new id, numbered label on a clash, never required, placed in the section of the same name.
- **Layout Studio** (`ui/views/routes/layoutStudioPage.ts`, `layouts/presets.ts`): presets
  (Standard, Profile, Encyclopedia, Visual, One column) are built per type from its own fields
  (a stat block only with numbers, key facts only with card fields), and every preset shows
  every section exactly once, so switching never hides data. The preview is the real
  `LayoutRenderer` on a real entry, in an `inert` frame scaled from a fixed page width (desktop
  1040 px, phone 390 px), with its own child `Component` released on every repaint.
  *Standard* removes the type layout instead of saving a copy. `adaptLayout` fits another
  type's layout: section/field references are filtered to the target's, a Details widget left
  with none shows every section once, single-field cards for missing fields are dropped.
  `matchingPreset` recognises a saved layout as a preset (ignoring block ids). Replacing a
  hand-made layout asks first.
- **Import & export** (`services/transfer/`, `ui/transfer/`), one page under Studio:
  - *World files* are the backup bundle format (`BackupService.bundle`). Import goes through
    `WorldService.importBundle`: a world that's already here, or whose folder exists unlisted,
    is added as a copy (`copyBundle`: new id in every `worldId`, name + “(copy)”); ids must be
    plain (`SAFE_ID`), and bundle paths can't leave the world folder.
  - *Type files* (`typePack.ts`, DATA_MODEL §13): schemas + effective page layouts + the
    relationship kinds their links use. Every type is built and validated before anything is
    written; clashes become copies (“(imported)”, new id, references remapped); the result has
    an `undo` that removes types still without entries and the relationship kinds it added.
  - *Spreadsheets* (`csv.ts`, `csvImport.ts`, `csvExport.ts`, `cells.ts`): a tolerant parser
    (BOM, quotes, CRLF, `,` `;` tab, unclosed-quote warning), Windows-1252/UTF-16 decoding,
    column auto-mapping (exported built-in headers first, then labels, then ids, then
    synonyms; ambiguous fields export as “Label (id)”). Planning is pure; running returns an
    undo (trash created entries, restore the first snapshot of updated ones, remove links and
    unused new choices). Blank cells never clear values; on update a cell equal to the current
    value's exported text changes nothing (so dates, images and links round-trip). Rows may
    link to each other. Formula-looking cells are written with a leading apostrophe.
  - *Markdown notes* (`notesExport.ts`): YAML frontmatter (`worldsmith-id`, `-world`,
    `-hash`, then properties as JSON values), summary, long fields by section, gallery.
    `writeNotes` settles every path first (so wikilinks match), updates only notes it wrote
    whose hash still matches (edited notes are left alone), and gives a numbered name when
    another note has the name.
  - Exports go to `<notes folder>/Exports` with `writeNewFile`, which never replaces a file.

## 6j. Calendars, timeline and world health (Milestone 10, part 1)

- **Calendar engine** (`core/calendar/engine.ts`, types in `core/types/calendar.ts`, DATA_MODEL
  §15): pure functions over a module-level *active registry* (`setActiveCalendars(list, main)`),
  which `CalendarService` publishes on every change and resets on dispose, so field formatting,
  sorting and parsing (`core/types/chrono.ts`) need no session handle. Every date sits on one
  line of absolute years (the main calendar's count); other calendars are placed on it by
  `offset`. `chronoPosition` gives a sortable number (year + day-of-year fraction, festivals
  included); `formatChrono` / `parseChrono` follow the calendar's date style, eras and
  weekdays. Older dates have no `calendar` key: when their era text matches one of the main
  calendar's eras the year counts within it, otherwise the text is kept as a label. With no
  calendar (or the plain one) dates format exactly as before 0.10.
- **CalendarService** (`services/CalendarService.ts`, `session.calendars`): four templates
  (Twelve moons with AC/BC eras that keep old numbers, Earth-like, Thirteen moons, Just years
  and eras), create/duplicate/update (returns before/after for Undo), make main, remove
  (returns the doc for Undo; dates that used it fall back to the main calendar's line),
  `usage(id)`.
- **Calendar editor** (`ui/views/routes/calendarsPage.ts`, route `calendars`, under Studio):
  start screen with template cards; per calendar a year-at-a-glance grid, months, week,
  festival days, eras (with a ribbon), how dates are written (live examples) and offset.
  Every change is saved at once and can be undone. The date field (`fields/ui/chrono.ts`)
  gains day / month-or-festival / year / era selects and a month-grid picker when a calendar
  exists; without one it is the old year + era editor.
- **Timeline** (`services/timeline.ts`, `ui/timeline/render.ts`, route `timeline`, under
  Tools): `spanFields` guesses each type's start and end date fields from ids and labels
  (birth/death, start/end, founded/dissolved…), overridable in `world.timeline.spans`.
  `collectTimeline` returns items, era bands (main-calendar eras and entries of band types),
  undated count and range. The axis view has a ruler in calendar words, an Eras row, one lane
  per type, rows packed so labels never overlap, Ctrl+wheel and button zoom, Fit. The list
  view (default on phones) groups by era. Filters (types, tags) are saved on the world. The
  **Timeline** widget works on dashboards and on entry pages (the entry, its connections and
  children).
- **World health** (`services/health.ts`, route `health`, under Tools): ten checks (missing
  images, missing notes, broken connections, dates that disagree, missing key details,
  possible duplicates, not connected, empty types, unused data, unused images) with weights
  for a 0–100 score. Running the checks never writes. Every fix is undoable and never
  deletes: swap dates, restore a trashed entry, unlink a missing note, hide an empty type,
  otherwise a link to the place to fix it. Findings can be ignored (`world.health.ignored`).
  The **World health** widget shows the score and the top problems.
- **Also in 0.10**: custom layout presets (`services/PresetService.ts`, `presets/<id>.json`)
  made, renamed, duplicated and deleted in Layout Studio; banners on Tasks, dashboards and
  type databases (`world.pageBanners`, tracked as `page-banner` media uses so renames
  follow); several linked notes per entry (`moreNotes`); the Layout Studio fixes (no
  flicker or jump on choosing a preset, a full-width desktop preview, a working phone
  preview), the auto-sizing scratchpad widget, values no longer cut off, and a tidier Type
  Studio settings tab.

## 6k. Family trees, relationship graph and maps (Milestone 10, part 2)

- **Visual documents** (`core/types/visual.ts`, DATA_MODEL §16): `TreeDoc`, `GraphDoc` and
  `MapDoc`, one file each in `trees/`, `graphs/`, `maps/`, each a `BucketStore` bucket keyed by
  id. `VisualDocs<T>` (`services/VisualDocs.ts`; `session.trees`, `.graphs`, `.maps`) gives
  list/get/create (unique names)/duplicate/update (returns before/after for Undo)/remove (returns
  the doc)/restore, and emits `doc:saved` / `doc:deleted` with `{ kind, id }`. Hydrate keeps
  unknown keys; unreadable map points and scales are kept as `pointsAsFound` / `scaleAsFound`.
- **Shared canvas** (`ui/components/panzoom.ts`, `ui/visual/common.ts`): pan, wheel and pinch
  zoom, fit and reveal, with `--ws-k` / `--ws-ik` CSS variables so labels keep their size. With
  `scrollPage` (widgets) the wheel and single-finger touch scroll the page instead.
- **Trees** (`services/trees.ts`, `ui/trees/render.ts`, route `trees`, under Tools): `familyLinks`
  reads parent and partner edges (kinds per tree, default `parent-of`, `marriage`/`romance`);
  `layoutFamily` places generations up and down from the root, partners side by side, siblings
  optional, repeats marked (cycle-safe, depth-limited); `layoutHierarchy` follows `parentId`
  with folding. Cards add relatives (existing or new entry) through `relations.connect`, all
  undoable. Character schema gains Parents / Children / Spouses relation fields.
- **Relationship graph** (`services/graph.ts`, `ui/graph/render.ts`, route `graph`, params
  `id`, `focus`): `buildGraph` filters by types, kinds, tags, focus + depth, secrets, isolated
  and inside-of links, capped for very large worlds; `ForceSim` is a small force layout (spacing
  scales it); pinned positions are saved on the doc. `kindColor` gives each relationship kind a
  colour (its own, a fixed default for built-in kinds, else a hash into the palette). The page
  starts on an unsaved “Whole world” draft and saves a view on the first change.
- **Maps** (`services/maps.ts`, `ui/maps/render.ts`, route `maps`, params `id`, `focus`):
  positions are 0–1 fractions of the paper (`MAP_W` = 2000 units wide, height from `aspect`,
  measured from the image). Pins are HTML (teardrop, portrait or icon), areas and routes SVG.
  Modes select / pin / region / path / measure; drawing by clicks, finished by double-click,
  the first point or Enter. Page history keeps up to 80 versions for Ctrl/Cmd+Z (cleared when the
  map changes from elsewhere); notice Undos patch only what they removed. `mapsOf(entity)` finds
  the maps an entry is on (its own maps first), `mapProblems` the items linked to missing or
  trashed entries. Map images are `MediaRole 'map'` uses (`map:<id>`) so renames follow.
- **Widgets** (`blocks/visual.ts`): `family-tree`, `connection-map`, `map`, for entries
  (around the entry) and dashboards (a chosen doc), height small/medium/large.
- **Health**: an eleventh check, `map-links`. **Entry menu**: See connections, Family tree, Show on
  map. Pages that re-render on a timer stop when their view is closed (fixes stale titles).

## 6l. Polish round (0.11.1)

- **Type Studio**: the Display, Fields and Checklist tabs use the settings cards of 0.10
  (`studioCard` in `typeStudio/common.ts`): Display has *Under the name* and *On cards and in
  tables* with a line showing how they read on a real entry, beside a preview card; Fields
  opens with an overview card (counts, Add field / Add section) and section headers with a
  tinted icon and a summary line; Checklist has a *Starting checklist* card and an
  *existing entries* card that says whether they're up to date.
- **Calendars page**: a showcase band (a date in the calendar's words and what it's made of),
  a jump bar, studio-style cards, months with weekday initials and day numbers, a months
  ribbon, festival sentences, style cards.
- **Your own date format** (`core/calendar/pattern.ts`): `style: 'custom'` with
  `Calendar.pattern`. `patternsOf` works out the month-only and year-only patterns by
  dropping day (then month) parts with the words attached to them; `fillPattern` fills a
  pattern and tidies around empty parts. `formatChronoIn(cal, d)` formats with an unsaved
  calendar (live previews). `parseChrono` reads custom formats back: weekday names anywhere,
  names between dots, dashes and brackets, ordinal suffixes and words, Roman years, the
  pattern's own words, and number order from the pattern. The builder (token chips that
  insert at the cursor, ideas in the calendar's own words, warnings, month/year overrides)
  keeps the cursor across re-renders and defers re-renders until a click completes.

## 6m. Polish round (0.12)

- **Timeline**: a showcase band (the span of time shown in the calendar's words, and what's on
  it), pill type chips, lanes with a tinted type mark, a ruler in the display font with minor
  marks and lines down the lanes, bars and points in the type's colour, and a hover card (name,
  dates in the calendar's words, length, summary from the description; era bands carry
  `description`). On the Timeline page the mouse wheel zooms around the pointer
  (`renderTimelineAxis(…, { wheelZoom })`, steps batched per frame; Shift or a sideways swipe
  still scrolls); widgets keep Ctrl/Cmd+wheel so their page scrolls. The list is cards by year
  under each era; widgets keep the compact list.
- **No jolt on toolbar panels**: a `Popover` used to sit at its place in the flow (below the
  pane) until the next frame, and the picker's `scrollIntoView` of the selected row scrolled
  the pane (`.view-content`) to it, then back. Popovers are now placed when created, rows are
  revealed with `revealInList` (scrolls only the list), focus uses `preventScroll`, and
  `.ws-visually-hidden` labels are pinned to their container's corner.
- **Field settings and Add field** use the settings cards (`studioCard`, `formRow`): About,
  Links / Summary, Choices (with a count), the kind's own settings, On the page, Behaviour,
  Default value; Add field has Name, Kind and Where it goes.
- **Tasks calendar**: `monthGridDays` gives whole weeks (a short last row left lines hanging);
  the grid draws one outer frame and cells only the lines between them; today is a frame laid
  over the lines; on phones days are a centred number over a row of dots.

## 6n. Maps, Trees and the graph as pages (0.12)

- **Home pages and full views** (`ui/visual/common.ts`): `visualHome` (start cards on top, a
  grid of `docCard`s below), `docCard` / `docMenu` (Open, Rename, Duplicate, extras, Delete;
  right-click or ⋯), and `fullView`: the page element gets `ws-page--full` (the shell page
  stops scrolling) and the canvas host fills it, with floating bars for the way home, the
  inline name (`setName` updates it in place; a blank name reverts), actions and a sub-bar.
  Each page rebuilds its frame only when a signature changes (maps: id, icon, entry; trees:
  id, kind, icon; graph: an open counter and icon), so popovers survive saves and renames.
- **Wheel**: `panZoom` zooms on the wheel, pans on Shift+wheel or a pixel-mode trackpad swipe
  (sideways or fractional deltas); `scrollPage` (widgets) keeps plain wheel for the page.
- **Peek** (`ui/visual/peek.ts`): `hoverPeek(host, …, selector, resolve)` delegates
  pointerover/out on the host and listens for Control/Meta; the card (`.ws-peek`) shows the
  entry, card facts, the item's own note and the linked note rendered with
  `MarkdownRenderer` under its own `Component`.
- **Set scale**: map mode `'scale'` reuses the ruler's points; after two it calls
  `onScalePoints(a, b, anchor)`, and the popover removes the anchor on close.
  `scaleFromPoints(a, b, aspect, distance, unit)` (services/maps.ts) gives the full width,
  measuring by the map's shape. A capture-phase `contextmenu` on the viewport calls
  `onCancelTool` (not after a touch pointerdown).
- **Family fields** (`services/familyFields.ts`): `ensureFamilyFields` runs once per world
  (`world.familyFields`; new worlds start `true`) on character types (and types from the
  character template) with no Parent & child field, adding Parents / Children / Spouses
  before Family (or atop Relationships, or a section of their own) with unique ids.
- **Graph**: `GraphDoc.pinOnDrag` (default false); a drop pins only with it, or if the dot was
  pinned. Thumbnails (`graphThumb`) settle once per shape and are cached.

## 6o. Banners everywhere (0.12.2)

- `ui/media/bannerTools.ts`: `showBannerMenu` (Change, Reposition, Adjust, height presets,
  View full size, Remove) and `repositionBanner(frame, ref, onSave, register)` (drag, arrows,
  Done/Enter, Escape restores), used by page banners and the world banner; entry banners keep
  their own (same items).
- `services/pageBanners.ts`: banner keys (`page:<route>` for the Tools pages, `TOOL_PAGES`)
  and `bannerPage` for "where it's used". `mountToolBanner(ctx, header, page)` puts one above a
  Tools page's header (`.ws-db-header` or `.ws-studio-head`).
- The peek card is 440px and scrolls as a whole (`overscroll-behavior: contain`); notes up to
  8,000 characters. The image viewer hides Obsidian's close button wherever it sits.

## 6p. The note window (0.12.3)

- `ui/visual/peek.ts`: `hoverPeek` keeps one unpinned preview plus any number of pinned
  `PeekWindow`s (`position: fixed` inside the `.worldsmith` root, raised by z-index on use).
  Head drag moves, the grip resizes (min 300×220, size remembered for the session), both pin.
  Ctrl + hover on an entry that is already pinned brings that window forward.
- The body scrolls vertically only (`overflow-x: hidden`, media `max-width: 100%`, `pre` and
  tables scroll inside themselves). Notes up to 60,000 characters.
- Editing: a textarea over the note body; `splitNote` keeps front matter. Saves are debounced
  (700 ms) and on blur, and are skipped with a "keep mine / use theirs" choice if the file
  changed since it was read. Saves run one at a time. A vault `modify` listener refreshes the
  reading view; `rename` follows the note; `delete` with unsaved text offers "Save as a new
  note". A window with unsaved text stays open until the person chooses; when its page goes
  away (`destroy`), the text is kept as `<note> (unsaved edits).md` instead.
- Several linked notes: a note menu (`LinkedNoteService.notes`) switches which one shows.
- The image viewer hides every `.modal-close-button` in its container and sits below the
  window controls on frameless Windows/Linux windows.

## 6q. The note's own editor in the window (0.12.4)

- `peek.ts`: when the workspace has `getLeafPopover` / `openPopover` (Obsidian's pop-over
  leaf, used by Hover Editor and ATLAS VTT; not public API, so checked for), the window body is
  that leaf, opened in source mode with `active: false`, and the previously active leaf is put
  back. Switching notes calls `leaf.openFile`; closing detaches it (Obsidian saves). Without it,
  the 0.12.3 reading view + pencil editor is the fallback.
- `moveTo` corrects for a containing block: `.worldsmith` has `container-type`, so
  `position: fixed` is measured from the pane, not the screen (the old jump on drag).
- Resize strips on every edge and corner (`.ws-peek__edge--n|e|s|w|ne|se|sw|nw`).
- `Lightbox.windowBarBottom(doc)` measures the window controls (`.titlebar-button-container`,
  `.titlebar`, `navigator.windowControlsOverlay`, else the top-right tab row) on Windows/Linux
  and sets `--ws-lightbox-top` on the modal.

## 6r. Tested in real Obsidian (0.12.5)

- Obsidian 1.14 has no `getLeafPopover`; the editor is a `WorkspaceSplit` of the window's own
  (`getRoot`/`getContainer` → `rootSplit`) with `createLeafInParent(split, 0)`, as Hover Editor
  does. It isn't part of the saved layout. `getLeafPopover` is still tried first.
- Windows live in `body > .worldsmith.ws-peek-layer` (fixed, full screen, no pointer events
  except on windows), so the pane's overflow can't clip them.
- Obsidian 1.14 modals have a `.modal-header-button` close: hidden in the lightbox.
- Checked by driving real Obsidian 1.14.4 on Linux (xvfb, `--remote-debugging-port`, Playwright
  `connectOverCDP`): editor opens, typing saves with front matter kept, move, resize, note menu,
  close, one X in the viewer.

## 6s. Modern Codex design (0.13.0)

- **Switching designs.** `src/ui/look.ts` puts body classes on every document Worldsmith draws
  in (main window, pop-out windows): `ws-look-codex` / `ws-look-classic`, `ws-palette-bronze` /
  `ws-palette-theme`, and `ws-font-codex`. Settings: `appearance.look`, `appearance.palette`,
  `appearance.fontMode` (`codex` | `theme` | `custom`; settings v3 turns the old default
  `theme` into `codex` once).
- **Classic is the earlier look.** All visual rules of the new design live in
  `styles/codex.css` under `body.ws-look-codex`; nothing else in the stylesheets changed their
  look. Behavior changes (trail, menus, dialogs, sidebar) apply to both designs.
- **Colors.** `styles/palette.css` doesn't restyle components: it redefines the Obsidian theme
  variables (`--background-primary`, `--text-normal`, `--interactive-accent`, `--color-*`…)
  inside `.worldsmith-view`, `.worldsmith` and `.worldsmith-modal`, so every existing rule
  picks up bronze. Obsidian's own chrome and native menus keep the theme. The image viewer and
  the floating note layer are excluded.
- **Title font.** Cormorant Garamond (OFL), Latin, variable weight, embedded in
  `styles/codex-font.css` as `Worldsmith Codex`. `--ws-title-scale` enlarges titles set in it.
- **Trail.** `WorldsmithView.ws_paintTrail()` builds World / type / ancestors before the page
  title; it is hidden on narrow panes.
- **Sub-menus.** `subMenu()` in `ui/actions.ts` uses `MenuItem.setSubmenu()` (not in the
  public typings) and falls back to a separator plus flat items.
- **Phones.** Under codex, `.ws-popover` and `.ws-picker` become bottom sheets on narrow panes.

## 6t. Writing Studio, part one (0.14.0, WS2)

The design and the plan for all of it (WS1 to WS8) were agreed with the owner first; the
look is the "combined" design: Author's Studio's layout in Literary Atelier's dress.

- **Data**: projects and manuscript items (parts, chapters, scenes) are Worldsmith records in
  two new collections, `writing/projects/` and `writing/manuscript/` (DATA_MODEL §17), not
  entities, so scenes don't crowd the sidebar, search or World health. Scene text stays in
  the user's own `.md` notes, which the service never deletes, renames, overwrites or gives
  front matter.
- **Service**: `session.writing` (`src/services/writing/WritingService.ts`). Every change
  returns a `WritingUndo` that restores only the fields it changed, onto the current
  records. Note access goes through `ManuscriptVault` (`vault.ts`), which has no delete,
  rename or plain overwrite; split and merge use `vault.process` and refuse on any race.
  Renames are followed live (listeners start on layout ready); offline renames are re-matched
  by file name inside the project folder. `ManuscriptIndex` counts words lazily, cached by
  mtime and size, re-counting one note shortly after typing stops.
- **UI**: the `writing` route (`project`, `view`, `item` params), `src/ui/writing/*`, styles
  in `src/styles/writing.css` (`ws-wr-`). The studio is a CSS container, so its layouts
  follow its own width (beside an open note it switches to the narrow layout). Drag and drop
  has keyboard and "Move to…" alternatives for touch.
- **Not yet** (later milestones): the editor inside the studio (WS3, done in 0.15.0), story boards (WS4),
  links to characters and places (WS5), goals and snapshots (WS6), compile (WS7).

## 6u. Writing Studio, part two: the editor in the studio (0.15.0, WS3)

- **`EmbeddedEditor`** (`src/ui/editor/EmbeddedEditor.ts`) is the one place that puts
  Obsidian's own `MarkdownView` inside a Worldsmith page. The note window (`peek.ts`) and the
  manuscript use it. Two ways in: Obsidian's pop-over leaf (the note window, as in 0.12.4),
  or a private `WorkspaceSplit` of our own, appended to the page, with one leaf from
  `workspace.createLeafInParent(split, 0)`. Neither is public API, so `canEmbed()` checks for
  them and the page falls back to a message with **Open in a tab** (never a textarea). Every
  internal touched is listed in the file's header: the split's and the leaf's `getRoot` /
  `getContainer` (see below), `leaf.setViewState` wrapped so a link followed inside opens
  beside the studio (`onNavigate`), `leaf.detach` wrapped so Ctrl/Cmd+W closes the studio's
  tab, `workspace.pushUndoHistory` skipped while our leaf closes (so "Reopen closed tab"
  brings back the studio, not a hidden editor), and `workspace.setActiveLeaf` held for a
  moment while a leaf opens. The hold is **counted** per workspace: the page and the side
  pane open at the same time, and an uncounted hold put a stand-in back as the workspace's
  own `setActiveLeaf` (found in real Obsidian: no pane could become active afterwards).
- **Hotkeys and focus (spiked in Obsidian 1.9.14).** Obsidian's editor commands and hotkeys
  (Ctrl/Cmd+B, Find, Undo, and every plugin command on "the active editor") act on
  `workspace.activeLeaf`. Three findings: (1) `setActiveLeaf` ignores a leaf whose
  `getRoot()` isn't one of the workspace's own splits (`isAttached`), and our leaf's root is
  the private split, so the leaf (and the split) answer `getRoot()` / `getContainer()` with
  `workspace.rootSplit`. (2) Every leaf's container sets itself active on `pointerdown`
  (capture) and `focusin` (bubbling), so the Worldsmith tab around the editor takes the active
  state back right after ours; `activate()` runs on `focusin` and again on the next tick.
  (3) A toolbar press keeps the cursor in the text (`mousedown` prevented) but still makes the
  Worldsmith tab active, so `activate()` also runs on every `keydown` in the window's capture
  phase (first in line, before Obsidian's hotkeys) when the cursor is in our editor; the
  toolbar re-activates after each click too. Clicking anywhere else in the Worldsmith pane
  gives it the active state back on its own. With this, Ctrl+B bolds and Ctrl+F opens
  Obsidian's find bar inside the studio page.
- **Same note in two places.** A normal tab of the same note and the studio's leaf are two
  `MarkdownView`s of one file; Obsidian keeps them in step in memory, in both directions, and
  autosaves either. Split and merge first call `EmbeddedEditor.saveOpen(paths)` (each open
  view's `save()`), so what was typed a moment ago is part of the text they read.
- **Manuscript page** (`manuscript.ts`, `scenePane.ts`): a scene with its note shows a
  `ScenePane`; chapters and parts keep the WS2 details. Switching scenes calls `openFile` on
  the same leaf (no remount). CodeMirror's `.cm-scroller` is the desk and `.cm-sizer` the
  sheet of paper (`writing-editor.css`); the page heading is injected as the sizer's first
  child (non-editable); the inline title, properties and backlinks are hidden. Live word
  counts come from `editor-change`; "Saved" is shown only when `cachedRead` of the note equals
  the editor's text (checked on `modify` and 2.6 s after the last keystroke).
- **Toolbar** (`toolbar.ts`, `src/ui/editor/format.ts`): Editor API only (`replaceRange`,
  `replaceSelection`, selections), so changes go through the editor's undo and autosave.
  Formatting helpers are pure and unit-tested over a string editor.
- **Look** (`look.ts`, `settingsPanel.ts`): `settings.writing` (surface, page width in
  characters, line height, size, font, typewriter, dim) as CSS variables on the manuscript;
  the Theme surface reads the theme's real colours from the body (the bronze palette
  redefines them inside `.worldsmith`). The same settings are in Settings › Worldsmith ›
  Writing Studio and in a popover from the studio's top bar.
- **Device memory** (`device.ts`): cursor and scroll per scene (400 most recent) and the
  split per project, in `app.saveLocalStorage` (per vault, this device). A place is only
  saved while the editor is on screen and showing that scene.
- **Side pane**: inspector (Scene and Notes tabs), another scene in a second
  `EmbeddedEditor`, or the scene's note in reading view; resizable (pointer, keyboard,
  double-click resets). On a narrow pane it becomes a sheet; its editor is kept open while
  folded away (closing and reopening a leaf on every resize churned and, in Obsidian 1.9,
  logged a CodeMirror history error).
- **Widths**: every studio page follows Appearance › Maximum page width and Full width; the
  text's own width is the page-width setting.
- **Not yet**: story boards (WS4, done in 0.16.0), world links in the inspector (WS5), goals (WS6).

## 6v. Story planning: boards, plot threads and structures (0.16.0, WS4)

- **Tabs.** A project now has four tabs: Overview, Manuscript, **Story board** and **Plot**
  (`writingPage.ts`). The Story board tab opens the board used last for that project
  (device memory, `DeviceMemory.board`, key `worldsmith-writing-board`, with the plot-thread
  filter). Routes: `view` is `corkboard`, `outline`, `kanban`, `timeline`, `table` or `plot`.
- **One screen, five panes** (`board.ts`): `BoardScreen` draws the head, the switcher, the
  plot-thread filter and New scene, then one `BoardPane` (`corkboard.ts`, `outline.ts`,
  `kanban.ts`, `timeline.ts`, `table.ts`). Panes get a `BoardCtx` (studio, live project,
  thread filter, scroller, open, menu, scene numbers) and redraw in place on manuscript
  events, never while a drag runs (`dragging` in `drag.ts`; the redraw waits for it).
  The arithmetic is pure and unit-tested (`boards.ts`): corkboard groups, the drop index,
  kanban columns, the timeline model, table sort and filter, time parsing.
- **Cards** (`cards.ts`): one index card for every board (`full`, `compact`, `mini`) with
  title, synopsis, status, words, plot-thread colours (strip and dots) and the in-story date.
  `bindCards` gives every board the same keys: click selects, double-click or Enter opens,
  the … button, right-click, the Menu key or Shift+F10 open the scene menu (`itemMenu`, so
  Move to…, Move up/down, status, plot threads and In-story date… are always one tap away),
  Alt+↑/↓ is `moveStep`, arrow keys move the focus.
- **Dragging** (`drag.ts`, `pointerDrag`): pointer events, not HTML5 drag and drop, so it
  works with a finger and a pen. Mouse: starts after 5 px. Touch: hold 360 ms, then move (a
  quick swipe scrolls); a non-passive `touchmove` stops the page scrolling while dragging. A
  fixed ghost follows the pointer, the scrollers auto-scroll near their edges, Esc cancels,
  the click after a drag is swallowed, and inputs, buttons, links and `[data-nodrag]` never
  start one (so the outline's synopsis cell edits on click). Every reorder goes through
  `WritingService.move` with an Undo notice; the corkboard and the outline reuse the
  Contents' `binderModel` / `dropTarget` rules.
- **Corkboard**: a column per chapter (empty ones too, to drop into), runs of loose scenes and
  part headings in manuscript order. Cards are drawn 120 at a time; an IntersectionObserver
  on a sentinel draws the next batch (`CORK_BATCH`), and a redraw keeps at least as many as
  before so the scroll stays put.
- **Outline**: parts › chapters › scenes, indented and collapsible (the same collapsed state
  as the Contents), with synopsis, plot threads, status and words. Synopsis edits in place
  (Enter saves, Esc cancels; the outline waits to redraw while editing); status and threads
  from their cells. Drag is off while a plot-thread filter hides rows (a drop between hidden
  rows would be ambiguous); the keyboard and menu still work.
- **Kanban**: columns by status, in the list's order, plus "No status" for scenes whose status
  was taken off the list (only while there are any; it isn't a drop target). Dragging to
  another column calls `setStatus`; Alt+←/→ does the same. **Decision: the kanban never
  reorders.** Cards stay in reading order inside a column; dragging within a column changes
  nothing. A status column is not a place in the book, and a second, kanban-only order would
  be a hidden field that disagrees with the manuscript. Columns draw 100 cards, then Show more.
- **Timeline**: a column per distinct in-story moment (date, then time), a lane per plot
  thread (a scene in two threads shows in both; "No thread" when needed), and a tray of
  undated scenes. Dates are `ChronoDate`s of the world's calendars (positions from
  `chronoPosition`, labels from `formatChrono`); the date dialog (`WhenModal`) reuses the
  calendar field's editor plus an optional time ("21:30", "9pm"). Drop on a column to give
  that date, on the tray to clear it. The small number on a card is its place in the book.
- **Table**: order, scene, chapter, status, plot threads, date, words. Click a header to sort
  (again to reverse; undated scenes stay last either way), search title, synopsis and chapter,
  filter by status. Title and synopsis edit in place; status and threads from menus, the date
  from its dialog. 150 rows, then Show more.
- **Plot threads**: per project (name, colour, description), many-to-many with scenes
  (`ManuscriptItem.threads`). Edited in `ThreadsModal`, toggled from the scene menu, the
  inspector's chips and the board cells. The board's filter shows one thread on every pane.
  The Plot tab shows the threads across the chapters (a pill per scene, "last in Ch N").
- **Structures** (`structures.ts`): Three-act, Save the Cat, Hero's Journey, Seven-point and
  Kishōtenketsu, as beats (`StoryBeat`: label, description, group, position, linked scenes).
  Choosing one on Plot (`useStructure`) adds its beats the first time; beats of another
  structure stay in the project (hidden) with their links, and come back when it is chosen
  again. **A structure never creates, deletes, moves or renames chapters or scenes.** The only
  thing that adds anything is the explicit "Add empty chapters for these beats"
  (`planChapters`, after a confirmation): new empty chapters without notes at the end, and
  Undo moves them to the trash.
- **Your own templates**: `saveTemplate` copies a project's outline (kinds, titles,
  synopses, never note text), the shown structure's beats, the statuses and the threads into
  the `writingTemplates` collection; New project lists them under "Your templates"
  (`template: 'own:<id>'`). Deleting one sets `trashedAt` (Undo clears it); projects made
  from it don't change.
- **Custom statuses** (`StatusesModal`, `setStatuses`, `reassignStatus`): rename, recolour,
  reorder, mark done, choose the default, add, take off. The id never changes on rename, so
  every scene keeps its status. A status taken off the list goes to `retiredStatuses`; its
  scenes keep the value (shown as "No status", with what it was) unless the writer chooses a
  status to move them to. One Undo puts back the list and the scenes (records undo with
  `keys: ['status']`, so a status changed since is left alone). The same `editList` keeps
  removed plot threads in `retiredThreads`.
- **Styles**: `src/styles/writing-boards.css`, scoped under `.worldsmith` with the `ws-wr-`
  prefix, theme and studio tokens only, Codex and Classic (Codex adds a pin to full cards and
  paper cards), container queries at 760 px and 640 px, every board usable at 400 px.
- **0.16.1: one surface, resuming, the settings panel.**
  - The surface's variables (`--ws-wr-p-*`, the redefined Obsidian colours and Worldsmith's
    tokens) now apply to the whole writing area while a scene is on the page:
    `.ws-wr-ms.is-writing > .ws-wr-ms__main / .ws-wr-side / .ws-wr-resizer`, as well as each
    `.ws-wr-page`. The desk is the surface (`--ws-wr-p-desk = --ws-wr-p-bg`), and `.cm-sizer`
    is a transparent, centred column with no border or shadow. For the Theme surface the
    manuscript paints the theme's own colours onto the main area and the side pane as well
    (`paintSurface`).
  - "Continue writing" and "Scene details" go through `continueWriting` / `sceneDetails`
    (`actions.ts`). Each sets a one-shot intent that the next Manuscript page takes on mount:
    write (focus the editor) or details (inspector open, as a sheet on narrow panes). Neither
    opens a note tab.
  - `Popover.position()` keeps panels inside the pane and the window, whichever is smaller.
    A panel taller than the room scrolls inside (`.is-capped`), and the phone bottom sheet
    takes the pane's bounds (`--ws-sheet-l/r/b`) instead of the window's.

- **Not yet**: world links in the inspector (WS5), goals (WS6). The optional Overview warning
  about structure (e.g. "no midpoint yet") was left out.

## 6w. Native Obsidian notes (0.17.0)

An entry may have a **native note**: an ordinary Markdown note that is the home of its values.
Short fields are front-matter Properties, long-text fields and the summary are sections of
the body, and everything else (title, card, facts, connections, gallery, footer) is generated
read-only *view* parts. Entries without `nativeNote` take none of these paths.

- **Files.** Pure logic in `src/services/notes/`: `format.ts` (regions, front matter line by
  line, hashes), `properties.ts` (field ↔ property kinds and keys), `sync.ts` (the three-way
  planner), `render.ts` (region and property specs for an entry and template),
  `templates.ts` (built-ins, section normalising, `sectionsFromLayout`), `appearanceCss.ts`
  (template look → CSS, snippet text and ownership), `migration.ts` (dry-run planner, section
  adoption, undo rules). Services: `NativeNoteService` (event wiring, queue, create, link,
  rename, start-up), `NoteTemplateService` (per-world store `note-templates/`),
  `NoteMigrationService` (run, record, confirm, undo). UI in `src/ui/notes/`: `noteActions`
  (entry menu, pickers, status), `conflicts` (decision dialog, snapshot Undo), `noteStudio`
  (Layout Studio tab), `migrationModal`, `noteStyles` (injected styles and the snippet),
  `notesUi` (protocol handler `obsidian://worldsmith`, post-processor). Note CSS is
  `src/notes-css/native-note.css`, loaded as text (esbuild `.css` text loader) so the same
  rules go into a `<style>` and into the snippet. UI CSS is `src/styles/notes.css`.
- **Decision (a fork from the plan): the entity keeps the agreed values.** The plan had a
  separate `nativeNote.cache`. Instead, `entity.values` / `description` / `aliases` / `tags` /
  `status` keep the last values both sides agreed. Every existing reader (pages, views,
  search, exports, formulas) is therefore unchanged. `nativeNote.base` holds what was agreed,
  per key: `p:<fieldId>` (canonical property text), `f:<regionId>` (hash of a section's
  text), `v:<regionId>` and `w:<regionId>` (exact hash of a view part, and a hash with every
  wikilink reduced to one token, so links Obsidian rewrites on rename are not edits),
  `k:p:<fieldId>` (the property key last written: a renamed field renames only that key) and
  `h:<regionId>` (the managed heading's label last written). A field section's Worldsmith side
  is hashed as written and read back (`wsHashOf`). Writing closes a code block left open and
  escapes marker-like lines with a backslash, and reading takes the backslash off again. Only
  the managed heading (managed level, current or last-written label) is dropped on reading.
  The parser follows CommonMark fences: a closer uses the same character, is at least as long
  and has no info string. A fence opened inside a region ends at that region's own end marker.
- **Identity and restore safety (0.17.0 review).** `run()` and `start()` accept a file only when
  its `worldsmith-id` is the entry's and its `worldsmith-world` is absent or the open world's,
  or when it has no id and still has the last-seen `fileHash`. Anything else marks the entry
  `missing`, and `run()` skips missing entries. Deleting a note frees its path in `byPath`. A
  note of a missing entry that reappears with the right id is followed (`rematch`). A
  never-agreed view part (empty base) that differs beyond moved links is a decision, not an
  overwrite. `WorldsmithApp.restoreBackup` pauses native notes, waits for running reconciles,
  restores, then `WorldService.reload({ discard: true })` drops the old session's unsaved state
  (`WorldStores.discard()`) instead of flushing it over the restored files. `reset()` clears
  timers, `expected`, `renameAgain` and releases the waiters of cleared jobs. A `disposed` flag
  and a session check stop a reconcile still running. The `expected` hash of Worldsmith's own
  write is used once, so an undo back to it is an edit.
- **Reconcile.** `planReconcile(input)` is pure: per value `decide(note, ws, base)`. One side
  moved, so it wins. Both moved differently, so it is a conflict and nothing is written for
  it. Never agreed, so an empty side takes the other. View parts are rewritten only while
  unedited. A hand-edited part becomes a decision (keep it, which makes it *detached*, or
  restore it with the edit copied below). A part whose markers were deleted is reported as
  `removed` and never re-added. Broken, nested or duplicate markers and front matter that
  won't parse mean that part (or the whole note) is never written. Code fences are ignored.
  Front-matter keys are edited line by line, so other keys and comments keep their bytes.
  Empty fields are not written.
- **Queue and loop guard.** A debounce per entry (400 ms after a Worldsmith change, 600 ms
  after a note change), at most 4 in parallel. The note's values are pulled first, then
  planned again from the same text and the same base. Writes go through `vault.process` and
  abort if the note changed since it was read (rescheduled). The loop guard is idempotency
  (a second plan writes nothing) plus the expected hash of each write. `nativeNote` is only
  saved when it changes (conflicts keep their time), and neighbours are re-rendered only when
  an entry's name, note path, trash state or parent changes.
- **Renames.** Renaming an entry renames its note (`fileManager.renameFile`, setting
  `renameWithEntry`); a second rename during the first is followed afterwards. Any note rename
  starts a 1.5 s quiet window (and a rename Worldsmith makes holds the queue until it
  finishes), because Obsidian rewrites links in other notes from positions it read earlier:
  writing those notes at the same time could garble them. A note moved while Worldsmith was
  off is found again at start-up by `worldsmith-id` (within the same `worldsmith-world`).
- **Start-up** skips a note whose mtime, `fileHash` and in-memory plan are unchanged (nothing
  is read). 5,000 notes were measured during development.
- **Templates.** Six built-ins are virtual and read-only. "Customize" makes a copy.
  Assignment: `world.noteTemplates.byType`, overridden per entry by `nativeNote.templateId`. A
  look change is CSS only (`.ws-note.ws-tpl-<id>` rules) and writes no note. A section change
  is *structural* and re-plans the notes that use the template. Existing regions are never
  reordered.
- **Styling.** Everything is scoped under `.ws-note` (the note's `cssclasses`). Reading view
  gets the full layout (floating card). **Live Preview** is styled too: the Properties panel as
  a compact grid with Worldsmith's identity keys hidden, faint small `.cm-comment` markers,
  the banner `img[alt='ws-banner']`, headings and kicker, and callouts rendered as blocks
  (`.cm-embed-block.cm-callout`). The info card is an in-flow grid in Live Preview, because
  Obsidian lays out the editor line by line. Editing and selection are untouched, and Source
  mode stays plain. Dark is the default, with `.theme-light` overrides. Fonts fall back to the
  theme's.
- **CSS snippet.** `NoteStyles` writes `<configDir>/snippets/worldsmith-notes.css` (the Codex
  font, the note CSS and every template's rules, about 100 KB) and turns it on through
  Obsidian's `customCss`, after asking once (setting `nativeNotes.snippet`: ask, on or off).
  Ownership: the first line is `/* Worldsmith notes snippet · … ws-hash:<hash of the body>`.
  If the header is missing or the hash doesn't match (someone else's file, or edited by hand),
  the file is never written, and the next free name `worldsmith-notes-2…` is used instead
  (`snippetOwnership`, `pickSnippetName`). Template blocks of other worlds already in the
  snippet are kept. Turning the setting off turns the snippet off and leaves the file alone.
  Verified in real Obsidian: plugin off with the snippet on shows the full design (both
  modes, both themes); plugin and snippet off shows plain, readable Markdown.
- **Migration.** Opt-in per entry, type or world. `planMigration` (pure) decides create, link
  (the entry's linked note, or the single note whose `worldsmith-id`/`worldsmith` names it)
  or skip, with numbered names on clashes and no path used twice. A run makes a world backup,
  then a record in `note-migrations/<id>.json` with each linked note's exact text and each
  entry's values before and after. Undo restores a note only if its hash is still what the
  run left (new notes go to the trash), and a value only if it is still what the run left.
  Confirm, or 30 days (checked when a world loads), deletes the record. `findAdoptions` turns
  a linked note's own `## <Label>` section into the field's region by adding marker lines
  only, and only when the field is empty or holds the same text.
- **Backups and world files** carry `notes: [{path, content}]` (the open world's native
  notes) via `Database.notesProvider`. `restoreBundle` plans notes first (`planNoteRestore`):
  missing notes are written, identical ones are left, and different ones keep their text with
  the backup's version written beside them as `(restored)` (`(copy)` for a world imported as
  a copy, whose `worldsmith-world` is rewritten). Entries are remapped to those paths before
  the world files are written. Migration records are left out of world files. Type packs
  carry each type's note template.
- **Tests.** `tests/notes.test.ts`, `tests/noteMigration.test.ts`, `tests/backupNotes.test.ts`
  (parser and writer, mapping, planner, loop guard, snippet ownership, templates, migration,
  restore). `harness/notes.mjs` covers create, sync both ways, user text kept, the Native
  note tab (look changes write nothing), dry run, run and Undo, phone width and zero console
  errors.


## 6x. Adopted notes, the Note tab and the editable note widget (0.18.0)

**Adoption** turns notes the person already has into entries without touching them.
`services/notes/adoption.ts` is pure: `noteClaims` lists every path an entry holds,
`planAdoption` decides create or skip per note, `applyAdoption` creates entries through a
small host (create, link main note, undo). `ui/notes/adoptModal.ts` is the dialog; its Undo
deletes a new entry permanently when nothing was done with it (`rev ≤ 1`, no children, no
connections) and moves it to the trash otherwise. `ui/dnd/vaultDrag.ts` reads a drag from
the file explorer (Obsidian's `dragManager`, read defensively, then the public
`obsidian://open` links and wikilinks in the drag's text); folders give their notes,
subfolders included. `DatabasePage.listenForNotes` is the drop target; it ignores drags the
page itself handled (`defaultPrevented`) and board card drags.

**`NotePane`** (`ui/notes/notePane.ts`) shows one note in a page through `EmbeddedEditor`
(the same internal-API editor as the Writing Studio). `show(path)` with the same path again
does nothing, so the editor is never rebuilt while someone types; a new path calls
`setFile`. Without the editor (`EmbeddedEditor.canEmbed` false, or opening fails) or when
`readOnly` (Customize), it renders the note with `MarkdownRenderer` and "Open in a tab". A
missing note gets a card (Find it again via `LinkedNoteService.findAgain`, Choose, Unlink)
that looks again whenever a note is created or renamed.

**Entry page**: `params.view === 'note'` shows the `NotePane` instead of the layout; the
Page | Note switch appears whenever the entry has a main note and the page isn't being
customized. Entering Customize returns to Page. The **Embedded note widget** keeps one
`NotePane` for its life when `config.editable` is on, and stops repainting on the note's own
`modify` events. `LayoutEditor.mount(host, blocks, editing)` starts directly in Customize so
widgets are drawn once.

**Linked notes on delete**: `LinkedNoteService` no longer clears a deleted note's path; the
path is the identity until the person relinks or unlinks. `isMissing`, `findAgain` and
`relink` support the missing card.


## 6y. Complete world archives (0.19.0)

**Formats and safety are pure** (`core/util/zip.ts`, `services/transfer/archive.ts`; tested
headless): a dependency-free ZIP writer and a defensive reader (names, duplicates, methods,
size and ratio limits before and while inflating, CRC-32), SHA-256 via Web Crypto, the
manifest, `inspectArchive` (every check an import needs, writing nothing), `planPlacements`
(never overwrite; reuse identical images; notes never shared), `remapPaths`, `rewriteLinks`.
DATA_MODEL §11b is the format.

**`WorldArchiveService`** (`services/transfer/worldArchive.ts`, `ws.archives`) does the vault
work. `plan()` lists what the open world uses: native notes, each entry's main note when it
isn't native ("adopted"), extra notes, scene notes, every `MediaRefs` usage (trashed entries
included, since their data travels), and files embedded in those notes (they follow their
note's inclusion); missing and remote files are listed with who uses them. `export()` calls
`Database.flushAllStrict()` (new: `flushAll` never throws, so it checks `hasPendingWrites()`
afterwards and throws), reads the world folder's files as on disk (a read failure or invalid
JSON stops the export), reads vault files with `readBinary`, records links between included
files, zips, writes with `createBinary` at a free name, then reads the file back and runs
`inspectArchive`, comparing every checksum; a file that doesn't verify is trashed and the
export fails. `import()` inspects, saves pending changes strictly, decides new world or copy,
writes a journal, writes the world folder (not yet in the manifest, so invisible) and reads it
back, creates vault files only where nothing exists (`create`/`createBinary`, which fail
rather than overwrite) recording each in the journal, re-points links that now resolve
elsewhere, re-reads every created file against its hash, lists the world in the manifest,
opens it (`switchWorld`) and runs `verifyImported` (entries, connections, notes, images, map
pins, scenes, layouts/views/templates/calendars/tasks). Any failure before listing runs
`rollback` (trash created files whose hash is unchanged, remove the unlisted world folder).
`interrupted()`/`undoInterrupted()` find and undo journals left by a crash.

**UI** (`ui/transfer/archiveModals.ts`): `ExportArchiveModal`, `ImportArchiveModal`,
`VerifyArchiveModal`, `interruptedCard`. Each shows progress and reports success only after
the service verified. The *Whole world* card and the welcome screen open them; pickers read
binary (`chooseFile(…, binary)`). The older JSON world file stays importable. Old JSON export
now also uses `flushAllStrict` and stops on an unreadable file.


## 6z. Backups & recovery (0.20.0)

**`BackupManager`** (`services/backup/BackupManager.ts`, `ws.backups`) reuses the 0.19 archive
code: `WorldArchiveService.build()` (now split from `export()`, with `includeMedia` and a
`purpose`) and `verifyBytes()`. Every operation runs through one lock (`exclusive`), so backups,
verifies, deletes and restores never overlap; index writes are queued separately because the
page may list while a backup is written.

- **create(kind)**: build (strict save first), skip an automatic one whose fingerprint equals
  the newest backup's, write `.partial` with `adapter.writeBinary`, read back, verify, rename,
  list in `index.json`, then prune by `planRetention`. Failures map to plain words
  (`writeProblem`: out of space, read-only) and leave `status.lastError` for the page; nothing
  partial stays and nothing older is pruned.
- **tick()** (every minute via `registerInterval`): due when `intervalMinutes` passed since the
  newest automatic or manual backup and the last attempt; a failing streak is shown once.
- **verify / remove / exportCopy / restoreAsNew** (the 0.19 import, as a copy if needed).
- **previewReplace / replace**: inspect, verified safety backup (`before-restore`), journal,
  stage the data in `restores/staging-<id>/` and read it back, hold native notes and save
  strictly, rename the world folder to `restores/before-<id>/` and the staging folder into
  place, create missing notes and images (never overwrite; a changed note gets the backup's
  version beside it, a changed image is kept), reload with `discard`, `verifyImported`. Any
  failure → `revert` (created files trashed if unchanged, folders swapped back) and reload.
- **recoverEarly()** (before `worlds.init`): a journal whose world folder is missing gets it
  back from `before-<id>` (always safe); `staging` journals are cleaned. Other cases wait for
  the person (`undoInterruptedRestore` / `keepInterruptedRestore`).
- **restoreLegacy / restoreLegacyAsNew** for pre-0.20 JSON backups, with a safety backup first.

**UI**: `ui/backups/backupsPage.ts` (route `backups`): alerts (interrupted restores and imports,
quarantined files), status and settings card, history rows (verify, restore, copy, delete),
older backups, and the restore dialog (two choices, preview with confirmation tick, progress,
checks). Settings and Import & export link to it; command *Open Backups & recovery*; *Back up
the current world* makes a verified manual backup.

**Deleting worlds (0.20.1)**: `services/WorldTrash.ts` (`ws.worldTrash`): `deleteOpenWorld()`
makes a verified `before-delete` backup, holds native notes, saves strictly, shuts the world
down, renames its folder into `<data>/trash/worlds/`, writes `deleted.json`, drops it from the
manifest (next world active) and re-inits. `list()`, `restore()` (refuses an id already
present), `deleteForever({ backups })`. UI: `ui/components/worldDelete.ts`
(`DeleteWorldModal` with type-the-name confirmation, `DeletedWorldsModal` with inline
"delete for good"), the world menu in `Sidebar.ts`, and a link on the welcome screen. Test:
`harness/worlds.mjs`.

## 6aa. First steps: welcome paths, guide, Help (0.21.0)

`onboardingPage.ts` offers three paths (`form('new' | 'notes')`, import). The world form's guide
tick box adds the new world's id to `settings.guide.worlds` (`ui/guide/guide.ts` `setGuide`, which
emits `guide:changed` so Home redraws if it opened first). `renderGuide` (Home only, not in
Customize) computes seven steps from the session every time (`guideSteps`: entries, edges, notes,
adopted notes, layouts/schema revisions, maps/projects/calendars, backups), so there's no progress
to store; it repaints on entity/edge/backup events. `helpPage.ts` (route `help`, `needsWorld:
false`) holds the glossary and topics; `WorldsmithView` now lets `needsWorld: false` routes show
during onboarding. `notesUi.ts` adds *Open this note's entry in Worldsmith* and a file-menu item.
The empty type page adds *Add existing note*. Test: `harness/onboarding.mjs`.

## 6ab. Writing Studio WS5, part one: scenes and the world (0.22.0)

`services/writing/world.ts` (pure): `sceneLinks`, `sceneHas`, `appearancesOf`, `withCast`,
`findMentions` (whole-word, Unicode, ≥3 letters, names taken literally), `datedScenes`. Scenes
already had `pov`, `cast`, `location` (entry ids) since WS2; no data change. UI:
`ui/writing/worldLinks.ts` (`entityChip`, `entityPreview` on a `Popover`, `renderWorldSection` in
the inspector, which reads the scene note with `cachedRead` for mentions), board filter extended to
`SceneFilter { thread, who }` (`boards.ts` `inThread` accepts it; `device.ts` remembers `who`;
`board.ts` adds the Everyone button), table `pov`/`location` columns, card point-of-view marker,
`ui/writing/appearsIn.ts` (under an entry's layout when not customizing), Timeline page
"Scenes in story time" with `settings.timelineScenes`. `writingPage.ts` refreshes on entity
name/trash/media/alias changes that touch the open project. Tests: `tests/writingWorld.test.ts`,
`harness/ws5.mjs`.

**WS5 part two (0.23.0)**: `ui/writing/arcs.ts` (`ArcsScreen`, view `arcs`; people from
`arcPeople`, notes via `WritingService.setArc`, `WritingProject.arcs`); `toolbar.ts`
`insertLinkAt` (the link picker now lists entries without notes; `NoNoteModal` creates the
native note or writes the name), shared with the command `insert-entry-link`
(`editorCheckCallback`); `ui/timeline/render.ts` `renderTimelineAxis({ scenes })` draws an
`AxisScene` lane (the span widens to include them); the Timeline page passes dated scenes in
Timeline mode and lists them in List mode. Test: `harness/ws5b.mjs`.

**WS6 part one (0.24.0)**: `services/writing/progress.ts` (pure: day keys, `addWords`, `streaks`,
`lastDays`, `neededPerDay`, `projectedFinish`). `services/writing/session.ts` (moved from the UI;
the UI path re-exports it). `WritingService.recordWords` runs on every recount from the
`ManuscriptIndex` (so it counts writing anywhere), takes the change in `sessionDelta` since the
last record and batches it into today's `days` entry every 3 s (`flushProgress`), which every
save path calls first (`WorldsmithApp.flush`/`dispose`, `WorldService.shutdown`,
`Database.beforeFlush` for strict saves). `setGoals`, `logSprint`, `wordsToday`. UI:
`ui/writing/progressUi.ts` (`renderProgress` on the Overview, `renderTodayBadge` in the
manuscript status bar, self-unsubscribing), `ui/writing/sprint.ts` (one sprint, in memory),
daily goal and finish date in `ProjectDetailsModal`. Test: `harness/ws6.mjs`.

**WS6 part two (0.25.0)**: `core/util/diff.ts` (pure LCS line diff, common ends trimmed, refuses
absurd sizes). `services/writing/snapshots.ts` (`SnapshotService`, `ws.snapshots`: list, read,
take, `autoDaily` — called by `scenePane` before opening a scene and on vault `modify` of a
scene note — restore with a before-restore snapshot and an undo, remove; `planSnapshotPrune`).
Automatic backups skip `writing/snapshots/` (`WorldArchiveService.build` with
`includeMedia: false`). Passes: `WritingService.addPass/renamePass/removePass/setPassDone`
(undo via `restoreProject`), `SceneFilter.passDone`, `board.ts` pass button. UI:
`ui/writing/revision.ts` (inspector Snapshots and Revision passes, `CompareModal`,
`SnapshotsModal`, Overview `renderPassesOverview`). Test: `harness/ws6b.mjs`.

**WS7 (0.26.0)**: `services/writing/compile.ts` (pure): `cleanObsidian`, `parseInline`
(bold/italic runs), `sceneBlocks`, `buildDocument` (tree → blocks, chapter numbering across
parts, separators), writers `toMarkdown`, `toText`, `toHtml` (+`BOOK_CSS`), `toDocx`
(WordprocessingML: content types, rels, document, styles, core props) and `toEpub` (EPUB 3 with
nav and NCX, `mimetype` first and stored, one XHTML per chapter), both through
`core/util/zip.ts`. `ui/writing/compileModal.ts`: format cards, options, remembered in the
project, files via `vault.create`/`createBinary` at a free name in Exports; PDF through a hidden
iframe and `print()`. Test: `harness/ws7.mjs` (XML parts parsed with `DOMParser`).

**WS8 (0.27.0)**: no new systems. Touch-only tap areas in `styles/writing.css` under
`@media (pointer: coarse)`; roving tab stop and arrow keys in `compileModal.ts` and `arcs.ts`;
reduced-motion rules; Help topic and README. `harness/ws8.mjs` guards speed (400 scenes),
accessible names (pages and dialogs), keyboard, phone fit and touch sizes, and Help coverage.

**Combined design (0.28.0)**: `styles/writing-atelier.css` (loaded last) holds the design.
New screens: `goalsPage.ts` (Goals / Goals & stats), `revisionPage.ts`, `researchPage.ts`,
`compilePage.ts` (shares `compileTo`/`compileDocument`/`savedOptions` with `compileModal.ts`),
`settingsPage.ts` (shares `renderWritingControls` with the popover). `arcs.ts` draws the curve
(SVG, Catmull-Rom) and the six fields; `worldLinks.worldFields` splits point of view, location
and cast; the inspector's World tab is in `inspector.ts`. `compile.ts` gains `exclude`, time
order and front/back matter blocks. `WritingService` records sessions in `flushProgress` and adds
`setPassChecklist`, `addMark/removeMark`, `addResearch/updateResearch/removeResearch`. Command
`mark-passage`. Tests: `harness/design.mjs`, `tests/design.test.ts`.

**World features (0.29.0)**: `core/features.ts` (FEATURES with routes and blocks, `featureOn`,
`featureOfRoute`, `featureOfBlock`, `cleanFeatures`). `ws.features.isOn/set` (WorldsmithApp).
Gates: `WorldsmithView.ws_renderPage` (a switched-off route renders `renderFeatureOff`; every page
redraws on a `features` change), `Sidebar` (items and the dashboards group), `BlockRegistry.hidden`
(+ `LayoutRenderer` skips hidden blocks, the drawer doesn't offer them), `commands.ts`
(`COMMAND_FEATURE` + `gated` wrap commands as they register), entity page "Appears in" and the
timeline's `storyScenes`. Page: `ui/features/featuresPage.ts`, `styles/features.css`.

## 7. UI architecture

### 7.1 One host view, an internal router

A single `ItemView` (`worldsmith-app`) hosts the **Shell** (sidebar + top bar + content).
The current page is a `Route` (`{ name: 'entity', params: { id } }`). The route is the
view's state (`getState/setState`), so:

- Obsidian restores open Worldsmith panes after restart;
- **Open in new pane** = a new leaf with a route;
- setting `result.history = true` in `setState` puts route changes in Obsidian's own
  back/forward history.

Pages are registered in the `RouteRegistry` (`{ name, title, icon, render(ctx) }`).

### 7.2 Components

`ui/components/UIComponent` extends Obsidian's `Component`, so every child, DOM listener,
event subscription and timer registered through it is released automatically when its
parent unloads. Patterns:

- `mount(parentEl)` builds DOM once; `update(...)` patches it.
- Subscriptions are scoped: an entity page listens to `entity:updated` filtered by its id
  and changed keys; a field display re-renders only when *its* field changes.
- Field editors debounce input locally and call the service; the store debounce handles
  disk.

### 7.3 Responsive shell

The shell observes **its own width** (`ResizeObserver`), not the window, because a pane can
be narrow on a wide screen. It sets `data-ws-size="wide|medium|narrow"`; the sidebar becomes
an overlay drawer at `narrow`, grids reflow, cards clamp.

### 7.4 Styling

- Every class is prefixed; the root element carries `.worldsmith`, modals carry
  `.worldsmith-modal`, and all rules are scoped under those roots. No rules target `body`,
  `.workspace`, `.markdown-*` or other Obsidian/global selectors.
- Design tokens are CSS custom properties **derived from Obsidian variables**
  (`--ws-accent: var(--interactive-accent)`, `--ws-surface: var(--background-primary)`, …),
  so any theme — including the Atelier setup — drives Worldsmith's colors.
- Typography: display text uses `--ws-font-display`, which defaults to the theme's heading
  font and can be overridden by the user's chosen font family name (no font files shipped).
- User appearance settings are applied as custom properties on the root via
  `setCssProps`, never inline styles per element.

---

## 8. Layout / block engine

### 8.1 Model

```ts
LayoutDoc { id, scope, columns: 12, blocks: BlockInstance[] }
BlockInstance { id, type, x, y, w, h, config, title?, collapsed?, hidden?, locked? }
```

`x,w` are columns (0–11, 1–12); `y,h` are row units. This is the standard dashboard
grid model, and it is what the M6 drag/resize editor manipulates.

**Rendering is not a CSS grid.** Content-sized grid rows leave gaps whenever a tall block
(properties) sits beside short ones (progress, linked note). Instead the renderer turns
the placements into a *guillotine tree* (`layouts/engine/tree.ts`):

1. If the blocks split into ≥2 column ranges no block crosses → a `row` of columns.
2. Otherwise cut horizontally, taking the **largest** top strip that is still a single
   block or column-splittable — so blocks stacked in the same column stay grouped.
3. Arrangements that can't be cut (pinwheels) fall back to a real CSS grid node.

Rows render as wrapping flexbox (`flex: <span> 1 0` with a span-based min-width), stacks as
flex columns. Result: every block is exactly as tall as its content, there are no holes,
and narrow panes wrap columns naturally (the narrowest stacks in reading order).

### 8.2 Resolution

`LayoutService.forEntity(entity, schema)` → the entry's own layout → the type layout → the
built-in default for the type (see §6e). Dashboards use the same doc shape with scope
`dashboard` (see §6f).

### 8.3 Engine (pure functions, `layouts/engine/`)

`normalize` (clamp to grid), `collides`, `compact` (vertical gravity, like
react-grid-layout), `move`, `resize`, `insert` (first free slot), plus `buildLayoutTree`
and `readingOrder`. Pure and unit-tested; the DOM editor (M6) only translates pointer
gestures into these calls.

### 8.4 Renderer

`LayoutRenderer` (`layouts/renderer/`) renders the tree and owns each block's lifecycle.
Every block gets its own child `Component` and a `BlockRenderContext` (`ws`, `session`,
`entity`/`schema` on entity pages, merged `config`, `el`, `component`, `navigate`,
`setTitle`). Blocks subscribe to exactly the events they need (`watchEntity` filters by
entity id and changed keys) and patch their own DOM; the page never re-renders for a field
edit. An unregistered block type renders a small "unknown block" placeholder and keeps its
settings, so a missing extension can't break a page.

---


## 9. Data flow example — editing a field

```
User types in "Age" editor
  → FieldEditor (local 300 ms debounce)
  → EntityService.setFieldValue(id, 'age', 23)     validates via FieldTypeRegistry
  → EntityRepository.update(id, patch)             memory updated, rev++, updatedAt
      → EventBus 'entity:updated' {id, keys:['values.age']}
          → EntityIndex updates (only if indexed keys changed)
          → PropertiesBlock patches the single 'age' display
          → Hero subtitle patches if 'age' is a subtitle field
      → BucketStore marks bucket dirty → debounced flush → AtomicJsonFile
  → SaveStatus: pending → saving → saved (top bar indicator)
```

---

## 10. Performance strategy

- Load everything once at startup into memory (5,000 entities × ~2 KB ≈ 10 MB — fine), in
  parallel batches of 32 reads; the shell renders a skeleton until the world is ready.
- Indexes are updated incrementally from events: `byType`, `byParent`, `favorites`,
  `pinned`, `recent`. Database views read `byType` sets, never scan all entities.
- Search keeps a precomputed lowercase haystack per entity (name, aliases, tags,
  description, text-like field values). Linear scan of 5,000 strings is a few
  milliseconds; an inverted index can replace it behind `SearchService` if needed.
- Database views render incrementally (virtualization planned for M8 tables).
- Disk: debounced writes of dirty buckets only.

---

## 11. Architectural risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Obsidian Sync does not sync dot-folders.** | Default folder is `_worldsmith/` (0.2.0); older `.worldsmith/` folders are migrated automatically. Users must enable Sync's "Other file types". |
| R2 | Concurrent edits from two devices to the same file. | Per-entity files keep conflicts small; records carry `rev` + `updatedAt`; reload command now, focus-time change detection later. |
| R3 | Startup time with thousands of entity files on mobile. | Parallel batched reads + skeleton; bucket function can switch to sharding via a migration. |
| R4 | `onunload` is synchronous; a pending debounced write could be lost on abrupt quit. | `flushNow()` on unload and in the workspace `quit` task list; debounce max-wait 5 s bounds exposure. |
| R5 | Built-in schemas are copied into worlds, so improving a built-in later doesn't auto-apply. | `origin.templateVersion` enables a "template updates available" merge UI. This is the price of custom types being truly first-class. |
| R6 | Vanilla DOM means more UI code than a framework. | `UIComponent` + shared components keep it small; block contract is framework-agnostic. |
| R7 | Linked notes moved/renamed outside Worldsmith. | Listen to vault `rename`/`delete` events and update/clear `linkedNote.path`. |
| R8 | Field type changes on existing data. | `coerce()` per field type; values that can't convert are kept under `values._orphaned` rather than dropped. |

---

## 12. Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M0 Architecture | This document, data model, scaffolding | ✅ |
| M1 Foundation | Storage, migrations, repositories, registries, 17 built-in schemas, shell, sidebar, onboarding, database view, entity page with core field editing + autosave, create/delete/trash, linked notes, commands | ✅ (see CHANGELOG) |
| M2 Field engine | Schema editing service (validated, undoable, never destroys data), unused-data handling, Type Studio (fields, sections, choices, display, checklist, type settings), entity-page schema shortcuts | ✅ (0.2.0) |
| M3 Relations | Edge store, relation fields + chips, reciprocity, backlinks (Connections), relationship records, relationship types studio, delete cleanup, rollups, parent/children fields | ✅ (0.3.0) |
| M4 Tasks | Task store, per-type templates, entity checklist, customizable Tasks home (stat rollups, calendar with real-world due dates, lists, board, chart), progress roll-ups, generic layout editor | ✅ (0.4.0) |
| M5 Media | Image browser (upload, paste, drop, links), portraits, banners and gallery images with focal point, zoom and height, galleries (layouts, reorder, captions, viewer), rename tracking, media library with missing-image repair | ✅ (0.5.0) |
| M6 Layout engine | Customize entry pages for a whole type or one entry, with undo; widget settings; 11 new widgets (showcase, connections, writing); Type Studio → Page layout | ✅ (0.6.0) |
| M7 Dashboards | Customizable Home, extra dashboards with templates and a sidebar section, 12 new dashboard widgets (lists, numbers, charts, entry card, links, spotlight, archives, image wall, new connections, search, development, needs attention) | ✅ (0.7.0) |
| M8 Database views | Saved views as tabs; cards, gallery, table, list, board and progress layouts; filters (all/any, built-in properties), multi-key sort, grouping, columns and card fields, resizable columns, inline cell editing, drag between board columns, views on dashboards | ✅ (0.8.0) |
| M9 Studios | New-type starting points, copy fields, Layout Studio (presets, live preview, copy a layout, pages with their own layout), Import & export (world files, type files, CSV import/export, Markdown notes) | ✅ (0.9.0) |
| M10 Advanced, part 1 | Calendars (editor, templates, eras, festivals, date picker), timeline page and widget, world health check and widget, custom layout presets, page banners, several linked notes | ✅ (0.10.0) |
| M10 Advanced, part 2 | Family and hierarchy trees, relationship graph, maps, three widgets, map health check | ✅ (0.11.0) |
| WS1 Writing Studio design | Audit, plan, two concepts and a combined design, agreed with the owner | ✅ |
| WS2 Writing Studio: projects and navigation | Sidebar item, studio home, projects (templates, import a folder, archive), parts, chapters and scenes (reorder, move, rename, duplicate, split, merge, trash) | ✅ (0.14.0) |
| WS3 Writing Studio: write in the studio | Obsidian's editor on the manuscript page, toolbar, focus and typewriter modes, session words, writing surface and fonts, side pane (inspector, another scene, the note), scene Notes, cursor and scroll memory, fallback | ✅ (0.15.0) |
| WS4 Writing Studio: story planning | Story board (corkboard, outline, kanban, timeline, table), drag with mouse, pen or finger plus keyboard and menu alternatives, plot threads, in-story dates and times, structures and beats, templates of your own, custom statuses | ✅ (0.16.0) |
| Notes 1 Bring your own notes | Adopt existing notes by drag and drop or Add existing note (never written to), Page \| Note on entry pages with Obsidian's editor, editable Embedded note widget, deleted notes stay linked and reconnect, Find it again, failed note saves shown (§6x) | ✅ (0.18.0) |
| Backups & recovery | Verified archive backups (automatic, manual, safety), retention that never drops the last good one, history page with verify/restore/copy/delete, restore as new or in place (preview, safety backup, staged swap, notes never overwritten, revert on failure), crash recovery at startup (§6z) | ✅ (0.20.0) |
| World archives | Complete `.worldsmith.zip` export with notes, images and attachments, verified after saving; staged import with journal, rollback, crash recovery and post-import checks; Verify archive; import from the welcome screen; strict save before export (§6y) | ✅ (0.19.0) |
| Notes 2–4 | Optional Property mapping and a Type Studio Notes card; cleaner native notes (markers hidden in Live Preview, lean notes, connections as link Properties); adopted notes in backups and world files | proposed |
| WS5 part one | Point of view, cast, place from the world; mentions; previews; board filter and columns; Appears in; scenes in story time (§6ab) | ✅ (0.22.0) |
| WS5 part two | Character arcs per book; insert links to entries while writing; scenes lane on the timeline axis | ✅ (0.23.0) |
| WS6 part one | Daily history (net), daily goal and finish date, streaks, Progress on the Overview, today counter, sprints | ✅ (0.24.0) |
| WS6 part two | Scene snapshots (manual and daily automatic), compare, restore without loss, revision passes | ✅ (0.25.0) |
| WS7 | Compile: Word, EPUB, Markdown, text, web page, PDF via print (no library) | ✅ (0.26.0) |
| WS8 | Polish: measured speed at 400 scenes, screen-reader names, keyboard, touch targets, reduced motion, documentation | ✅ (0.27.0) |

Milestone 1 already includes the block registry and layout renderer, so entity pages and
the dashboard are built on the final engine from day one; M6 adds the editor on top.

---

## 13. Testing

| Layer | How | Command |
|---|---|---|
| Storage, migrations, repositories, services, schemas, layout math | Headless tests on node:fs with an adapter that mimics Obsidian's rename semantics | `npm test` |
| Type safety | `src/` is checked **without** Node types, so accidental Node APIs (which would break mobile) fail the build; tests have their own tsconfig | `npm run typecheck` |
| Real UI | `harness/` bundles the actual UI code against a small Obsidian API shim and an in-memory vault, then Playwright drives it: screenshots in two themes and three widths, plus interaction checks (inline editing, validation, rename, status menu, persistence to disk, search, empty states, trash, responsive drawer, Type Studio: add field, choices, kind change + undo, keyboard reorder, delete → unused data → restore; relations: link via picker, create from picker, reciprocity, remove + undo, Connections, connection page edits, relationship types, shard files on disk; tasks: sidebar badge, stat rollups, calendar drag-to-reschedule, create from a day, task dialog, customize add/resize/remove/reset with persistence, checklist add + complete, task shard files; media: browser search/pick, adjust focal point + zoom + cancel, upload, download from a link, drop on the portrait, banner height + remove/undo, gallery multi-add, reorder, caption, viewer, use as banner, remove/undo, rename following, missing-image relink, gallery fields, world banner, persistence; page layouts: customize for a type and for one entry, undo, reset + undo, Type Studio tab, every widget with real data, phone width without sideways scrolling) and zero-console-error assertion | `npm run harness` |
| Dashboards | `harness/dashboards.mjs`: Home's default widgets and numbers, Customize/undo/reset/empty Home, search box, new dashboard from each template, sidebar singular/plural, settings toggle, list settings with dependent rows, table sorting, rename, move, delete + undo, deleted elsewhere, synced-before-widgets, emptied dashboards, safe links, stable spotlight, phone and light theme | part of `npm run harness` |
| Database views | `harness/views.mjs`: tabs and the six layouts, filters (any/all, built-ins, chips, clear, changes from elsewhere), sort and header sort, grouping and folding, columns, resizing, inline cell editing by mouse and keyboard (repaints wait for the editor), status cells, board drag and "Move to", choice-field boards, gallery options, progress (summary, rows, tick off next task, add task, grouped averages, least-developed order), tab menu by mouse and keyboard, rename/duplicate/delete/undo, views on dashboards (follows the view, opens it, deleted view, pick entries instead, settings picker), search, file on disk, phone widths, 2,000+ entries | part of `npm run harness` |
| Polish round | `harness/polish.mjs`: Group by picker (sections, no free-text lists, search, Enter, toggle), Add filter over its panel, no container tooltips, the Hover tooltips setting, Contents rows and click targets, widget heights (click, drag, keyboard, fit content, scrolling inside), banner framing at the page's width, image fit switching back, All tasks (views, groups, show more, fold, search, due grouping, tick off), stat detail lines, media views (layouts, starting points, not used yet, filters, chips, panel anchoring, missing-only, phone), Relationships (search, Linked, the picture, editing words and name), Type Studio list | part of `npm run harness` |
| Studios | `harness/studios.mjs`: new type from a starter and blank (name, colour, required name), copy a field, Layout Studio (presets, inert live preview, use + undo, phone preview, copy from another type with valid sections, Standard, confirm before replacing, pages with their own layout + undo + reset all, type without entries, link from Type Studio), duplicate keeps the layout, export a type, world export (never overwrites) and import as a copy, type file export/import (copy, skip), CSV import (auto-mapping, preview, update without clearing, undo), view CSV export, Markdown notes (counts, user notes untouched, edited notes kept, updates), phone widths | part of `npm run harness` |
| Calendars, timeline, health | `harness/m10.mjs`: the ten fixes (Layout Studio flicker, jump, full-width and phone previews, custom presets, page banners, scratchpad height, several notes, values not cut off, Type Studio settings), calendars (templates, months, festivals, eras, styles, main, duplicate, delete + undo), the date picker, timeline (axis, list, filters, zoom, opening entries, widget on an entry), world health (score, each fix + undo, ignore), widgets, phone widths, zero console errors | part of `npm run harness` |
| Trees, graph, maps | `harness/m10b.mjs`: family trees (draw, add relatives, undo, customize, hierarchy fold), the graph (filters, focus and depth, spotlight, saved views, pins, legend, customize), maps (gallery, pins, areas, routes, layers, measure, sub-maps, undo/redo, notice undo after a later change, customize), the three widgets, entry-menu shortcuts, the map health check, phone widths, icons, zero console errors | part of `npm run harness` |
| 0.11.1 polish | `harness/fixes0111.mjs`: Type Studio Display / Fields / Checklist cards (add and remove fields, add items, catch up existing entries), the calendars page (showcase, cards, glance, ribbon, jump bar), your own date format (start from the style in use, ideas, typing, token chips at the cursor, warnings, month/year overrides, switching back and forth, dates elsewhere), phone widths, icons, zero console errors | part of `npm run harness` |
| 0.12 polish | `harness/polish0112.mjs`: timeline showcase, lane icons, hover cards, wheel zoom around the pointer (and not in widgets), list cards; toolbar panels on Media, databases and Tasks open without moving anything (desktop, scrolled, phone); field settings and Add field cards, rows, choices, switches, relation rows, phone; calendar grid columns, borders, today and whole weeks for a year of months; phone widths, icons, zero console errors | part of `npm run harness` |
| 0.12 Maps, Trees, graph | `harness/visual012.mjs`: maps home (start cards first, no suggestions, long names, right-click and delete + undo), a map as the page (fills the pane, tools, wheel zoom, trackpad swipe pans, Ctrl + hover peek, right-click cancels a tool, Set scale with Backspace, ⋯ menu), Trees home, title, thumbnails, full view, wheel, peek, family fields, graph home, Types dropdown, a fresh view saved without closing Customize, name updates and blank-name revert, dragging without pinning, phone widths, icons, zero console errors | part of `npm run harness` |
| 0.12.2 fixes | `harness/fixes0122.mjs`: banners on all eight Tools pages (add, show, full menu), none over an open map, the full menu on Tasks, type pages, dashboards and Home, Tall height, Reposition (Done keeps, Escape restores), View full size, Remove + Undo, one close button in the viewer (Media page too), phone widths, icons, zero console errors; `visual012.mjs` also checks the larger, scrollable peek reaching the end of a long note | part of `npm run harness` |
| 0.12.3 note window | `harness/peek0123.mjs`: the whole note without front matter, no sideways scroll (wide image, table, long word), scrolling to the end, closing when unpinned, pin, drag, resize, the note menu, editing saves and keeps front matter, conflict without overwrite, closing or switching while it asks keeps the text, everything typed is kept, rename follows, delete keeps the text as a new note, back to reading, an open entry comes forward, close, unpinned closes on leave, leaving the map, the viewer below Windows' buttons with one close button, phone widths, icons, zero console errors | part of `npm run harness` |
| 0.12.4 note editor | `harness/peek0124.mjs`: the note's own editor in the window (no pencil, no second title bar), scrolls down only, typing saves, writing keeps it open, focus stays on the page, dragging follows the pointer with the pane offset like Obsidian's, resizing from the left, top and corner, the note menu switches the editor, X closes it and its editor, the same window on Trees and the graph, leaving closes editors, phone widths, icons, zero console errors; `peek0123.mjs` now checks the fallback (no pop-over editor) and the viewer below a title bar | part of `npm run harness` |
| Writing Studio | `harness/writing.mjs`: open from the sidebar, project from a template, import a folder (notes byte for byte unchanged), drag reorder, Move to, Move up/down and Alt+↑/↓, rename, split, merge, trash and restore, missing note, open note, archive and rename a project, home's continue spread, the switcher, a narrow pane, 400px, zero console errors | part of `npm run harness` |
| Writing in the studio | `harness/writing.mjs` (WS3 part, with `H.fakeEditors()`, a stand-in editor with Obsidian's autosave): the scene on the page with its heading and no inline title, typing → Saving → Saved and the note on disk, live words and session words, every toolbar button (bold on/off, headings, scene break), focus mode and Esc, typewriter, the settings popover (width, Dark surface), Maximum width and Full width on the manuscript and overview, inspector Notes kept out of the note, another scene and the note beside, resizing, the split remembered, switching scenes in one editor with the cursor kept, a chapter's details, the fallback with Open in a tab, 400px. Real Obsidian (CDP rig, scripts outside the repo): typing saves, the same note in a normal tab over several rounds, Ctrl+B / Ctrl+F, switching and closing right after typing, a 50,000-word note, focus, typewriter and dimming, splits, phone width, cursor and scroll after a plugin reload, the fallback, widths, links and Ctrl+W | part of `npm run harness` |
| Story planning | `tests/ws4.test.ts` (statuses kept on rename and removal, reassign with undo, threads, dates and times, structures keep hidden beats, plan chapters undo to the trash, own templates round-trip, hydrator defaults and unknown keys, board arithmetic) and `harness/ws4.mjs`: the four tabs and five boards, corkboard mouse and finger drag (reorder, into another chapter, into an empty chapter) checked in the manuscript order with Undo, Esc cancels, a swipe scrolls, Alt+↑/↓, arrow keys and the scene menu; outline drag re-parents, synopsis and status in place, collapse; kanban drag changes the status and never the order, Alt+←/→; timeline drop on a date and on the tray, the date dialog with a time; table sort, search, status filter, inline title, threads; statuses (rename, remove keeps values, move scenes, Undo) and threads dialogs; the thread filter on every board; Plot (structures, link a beat, switching keeps links, plan chapters + Undo); save a template and start a project from it, delete + Undo; 320 scenes drawn in batches; 400 px on every board; Classic look; notes untouched; icons; zero console errors. Real Obsidian (CDP rig, script outside the repo): the same drags, keys and Undo on a throwaway project, every board at 400 px, icons, The Ember Oath unchanged | part of `npm run harness` |
| 0.16.1 fixes | `harness/fix0161.mjs`: Continue writing (card and quick action) opens the scene in the studio's editor with the cursor on the page and opens no note tab; Scene details opens the inspector (as a sheet on a narrower pane); one colour for the bar, toolbar row, page and side pane on Paper, Dark and Theme, the Classic look and focus mode, with no sheet edge or shadow and the column centred; contrast of the breadcrumb and toolbar icons on the surface; the writing settings panel inside the window and the pane at six widths, from focus mode and in a narrow pane at the window's edge, with nothing clipped; 400px; zero console errors. Real Obsidian: the same on a throwaway project, dark theme with Paper | part of `npm run harness` |
| 0.18 adopted notes | `tests/adoption.test.ts` (claims by path and Worldsmith id, trashed holders, other worlds, data folder, duplicates, undo) and `harness/adopt.mjs` (`H.setDrag` stands in for Obsidian's drag state): drop a note and a folder on a type page (outline, dialog, names, skip reasons), the note byte for byte unchanged, the type layout's editable widget, the Note tab and the widget editing the note, one editor kept while typing, Customize read-only and the note untouched, moving the widget, board drags ignored, renames followed, a deleted note kept and reconnected, Find it again and relink, Undo removes new entries, the fallback, native notes on the Note tab, phone widths, icons, zero console errors | part of `npm run harness` |
| 0.21 first steps | `harness/onboarding.mjs` (welcome paths, Help without and with a world, world form and guide, guide ticks from real data, a step's button opening the feature, reload, hide and bring back, notes path to Characters with Add existing note and the note untouched, existing world not given the guide, skipped guide, phone) | part of `npm run harness` |
| 0.20.2 security | `tests/security.test.ts` (unsafe URL schemes, template-id CSS injection, `__proto__`/nesting, crafted archive data, old-importer paths, outline loops; code scans for network calls, HTML/eval and unchecked `window.open`) and `harness/security.mjs` (URL field on the page and in displays, file-field notes optional and named in the export, crafted template id, looped outline, zero network requests in a session) | part of `npm run harness` |
| 0.20 backups | `tests/backups.test.ts` (retention incl. the last verified backup, limits, out-of-space wording, settings clamping) and `harness/backups.mjs` (54 checks: page, Back up now, schedule due/skipped/made/off, retention on disk, failed and out-of-space writes with no partial files and the page warning, Verify on a damaged file, delete, copy to Exports, restore as new, replace with preview/confirmation/safety backup/edited note kept with the backup's beside/deleted image back/later entry gone, sync after restore, failure halfway put back, crash mid-swap fixed at startup, crash after swap with both choices, quarantined files, older JSON backups with a safety backup, index rebuilt, a 450-entry world, phone) | part of `npm run harness` |
| 0.19 world archives | `tests/archive.test.ts` (CRC, unsafe names and ZIP-slip, case duplicates, damage, truncation, bombs and limits, tamper/unlisted/absent files, newer versions, placements, remapping, link rewriting) and `harness/archive.mjs` (fixture world → Export dialog → Python zipfile check → empty vault B → welcome-screen import → contents, connections, SHA-256 of every file, layouts, sync both ways, reload, second import as a copy with link re-pointing, corrupted archive via Verify and Import, write failure mid-import undone, crash journal undone, failed save stops export, privacy, phone width, a 440-entry world) | part of `npm run harness` |
| Edge cases | `harness/edge.mjs`: odd or corrupt widget settings, unknown widgets, deleted fields, trashed entries, layouts changed elsewhere, first edit of an entry layout from a settings dialog, clearing settings, custom titles, drawer search, undo back to the type layout, emptying a layout, phone customize | part of `npm run harness` |

The shim deliberately throws on things real Obsidian would reject (e.g. empty class
tokens), so the harness catches those regressions too. It is development tooling only and
never ships in `main.js`.
