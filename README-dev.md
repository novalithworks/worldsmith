# Worldsmith

A structured, visual worldbuilding studio that lives inside Obsidian.

Characters, places, creatures, powers, faiths and histories are **database records**, not
Markdown notes. Every type is defined by a schema you can extend or replace, and any record
can optionally link to a regular note for free-form writing.

> **Status: 0.30.0 — Worldsmith Free and Worldsmith Pro.**
> Types, relations, tasks, media, customizable pages, dashboards, database views, Layout
> Studio, import/export, fictional calendars, a timeline, a world health check, family trees,
> a relationship graph, maps, the Writing Studio, native notes, adopting the notes you already
> have, moving a whole world between vaults, and verified backups with safe restore all work
> today. See the [roadmap](ARCHITECTURE.md#12-roadmap).

## Editions

**Worldsmith is free.** It includes entries and types, connections, tasks, dashboards, page
layouts, native notes, the media library, backups, import and export.

**Worldsmith Pro is paid** (a one-time purchase, sold separately; no account or licence key). It
adds the **Writing Studio, Maps, Timeline, Trees, Graph and Calendars.** In the free edition these
parts are visible on the Features page but can't be switched on. Your worlds are the same in
both: install Pro and everything you made carries straight over (Pro is a separate plugin,
"Worldsmith Pro"; it switches the free copy off if both are on).

Worldsmith makes no network requests. The only link out is the "Get Worldsmith Pro" button, which
opens the shop in your browser.

## What works now

- **Features** *(0.29)* — switch the Writing Studio, maps, calendars, timeline, trees, the
  relationship web, tasks, dashboards and the media library on or off per world; off hides a part
  everywhere and deletes nothing.
- **Compile** *(0.26, WS7)* — the whole book as Word, EPUB, Markdown, plain text or a web page,
  or printed to PDF, with a title page, chapter headings and scene breaks.
- **Writing progress** *(0.24, WS6)* — words written each day (net), a daily goal and a finish
  date, streaks, a 30-day chart and what's needed each day on the project's Overview; a today
  counter and timed sprints in the manuscript. *(0.25)* Scene snapshots (also one a day
  automatically), compare and restore without losing anything, and revision passes.
- **Scenes and the world** *(0.22, WS5)* — each scene's point of view, cast and place are your
  real entries (suggested from the scene's text); filter boards by character or place; entry pages
  list the scenes they appear in; dated scenes show on the Timeline. *(0.23)* An **Arcs** tab follows
  one character through a book; links to entries can be inserted while writing.
- **First steps** *(0.21)* — the welcome screen offers three ways in (a new world, your existing
  notes, or an archive); new worlds get an optional seven-step guide on Home that ticks itself off;
  **Help** explains how everything fits together, offline.
- **Backups & recovery** *(0.20)* — automatic and manual backups, each checked after saving;
  history with verify, restore (as a new world, or in place with a preview and a safety backup
  first), copy and delete; recovery after a crash. See [Backups & recovery](#backups--recovery-020).
- **Complete world archives** *(0.19)* — export a world as one `.worldsmith.zip` with its data,
  notes, images and attachments, verified after saving; import it into any vault (even an empty
  one, from the welcome screen) without overwriting anything; verify an archive without
  importing. See [Moving a world to another vault](#moving-a-world-to-another-vault-019).
- **Bring your own notes** *(0.18)* — drag notes (or a whole folder) from the file explorer
  onto a type's page, or use **Add existing note**: each becomes an entry whose note stays
  exactly as it is, where it is. Every entry with a note gets a **Page | Note** switch, the
  Note side being Obsidian's own editor, and the Embedded note widget can edit the note right
  on the page. A deleted note stays linked and reconnects when it comes back.
- **Native Obsidian notes** *(0.17, opt-in)* — an entry can live in an ordinary note: its
  short facts are the note's Properties and its long writing the note's sections, edited in
  Obsidian or Worldsmith, either way. Your own text in the note is never touched. Six note
  designs (and your own, in **Layout Studio → Native note**) look the same in Reading view and
  Live Preview, light and dark, and with an optional CSS snippet even with the plugin off.
  Existing worlds move across per entry, type or world, with a dry run, a backup and Undo.
- **Writing Studio** — under Tasks in the sidebar: writing projects from a template or from a
  folder of notes you already have (nothing is moved or changed), a Contents list of parts,
  chapters and scenes you can drag to reorder, scene status and synopsis, split and merge
  that never lose text, and an overview with a Contents page. Scenes stay ordinary notes.
- **Write in the studio** — a scene opens on the Manuscript page in Obsidian's own editor
  (Live Preview, your hotkeys, spellcheck, autosave), with a small toolbar, focus and
  typewriter modes, words written this session, a choice of page (Paper, Theme, Dark), width,
  line height and font, a side pane (inspector with the scene's Notes, another scene, or the
  note to read), and each scene's place remembered on this device.
- **Plan the story** — a Story board with five views of the book: a corkboard of index cards
  by chapter, an outline with synopses, a kanban by status, a timeline in story time (your
  world's calendars, a lane per plot thread) and a sortable table. Drag cards with a mouse or
  a finger, or use the keyboard and menus; the manuscript follows, with Undo. Plot threads
  with colours on every card and a filter for one thread; a Plot tab with Three-act, Save the
  Cat, Hero's Journey, Seven-point and Kishōtenketsu beats (they never touch your chapters);
  your own statuses; and your own templates.
- **Worlds** — a polished first-run flow; create or import a world; switch between worlds.
- **17 built-in types** — Characters, Locations, Creatures, Species, Magic systems,
  Abilities, Artifacts, Technology, Factions, Nations, Cultures, Religions, Deities,
  Languages, Historical events, Eras and Lore — each with sections, fields and default
  development tasks.
- **Custom types** — *Create entity type…* adds a new database (Bloodlines, Curses,
  Dimensions…) that behaves exactly like the built-ins.
- **Type Studio** — shape any type without code: add, rename, reorder (drag, or Alt+↑/↓)
  and configure fields; choose from 20 field kinds; edit choices with colors and usage
  counts; organise sections; pick what cards and subtitles show (with a live preview);
  edit the default development checklist; rename, recolor, regroup, duplicate, archive or
  delete types. Every edit is validated first and can be undone (Ctrl/Cmd+Z).
- **Your data survives schema changes** — changing a field's kind converts what it can
  (e.g. choices ↔ text, numbers ↔ text) and shows a preview first. Values that don't fit,
  and values of deleted fields, are kept as *Unused data* on each entry, where you can
  restore them (re-creating the field if needed), copy them, or discard them.
- **Relations** — link entries through relation fields (Species, Homeland, Mentors,
  Members…). Pick from an inline search, or create the entry right there. Every link is one
  connection that shows on **both** entries: set Kael's mentor to Auron and Auron lists
  Kael under Students. 45 built-in kinds of connection; make your own under
  **Studio → Relationships**, each with its own wording for either side and optional custom
  properties (Trust, Oath sworn…).
- **Connections** — every entry lists all its connections, grouped by kind, including the
  ones made from the other side (backlinks). Add any kind of connection without a field.
- **Connection pages** — open any connection for its status, strength, secret flag,
  start/end dates, a one-line summary shown on both entries, Markdown notes and custom
  properties. Swap its direction or change its kind without losing any of that.
- **Rollups** — fields that calculate from linked entries: member counts, sums, averages,
  smallest/largest, earliest/latest dates, or a list of names or values. They update by
  themselves and work on cards and tables too.
- **Tasks home** — a page under *Home* in the sidebar (with a badge for what's due this
  week). Stat tiles roll up open, due-this-week, overdue, done-this-month (compared with
  last month) and how developed the world is — each tile configurable (status, due window,
  types, priority, period, ring). A month / week / agenda **calendar** with real-world due
  dates: drag a task to another day to reschedule, click a day to add one. Plus due soon,
  overdue, all tasks (tabs, filters, sort, group), a board, progress by type, needs
  attention, recently done, a chart and a notes scratchpad.
- **Customize** — rearrange the Tasks home by dragging, resize widgets from their right
  edge, change each widget's settings, add widgets from a drawer, or reset. The layout is
  saved with your world, so it syncs.
- **Entry checklists** — every entry has a checklist from its type's default tasks
  (existing entries got theirs automatically). Quick-add, tick off, set priority, due date,
  repeat (daily → yearly) and notes. Development progress counts tasks and key fields
  (choose in the Tasks page's ⋯ menu).
- **Images** — a thumbnail browser for your vault's images (search, folders, what's used
  where), plus upload, paste, drag-and-drop and "download from a link". Images from outside
  the vault are copied into a folder you choose.
- **Portraits, banners & framing** — click or drag on an image to choose what stays in view,
  zoom in, and see live previews of every place it appears. Banners have heights from
  compact to tall and can be repositioned right on the page.
- **Galleries** — grid, masonry or filmstrip; drag to reorder, captions, a full-screen
  viewer, "use as portrait/banner". Gallery and image fields work the same way.
- **Media library** — every image the world uses and where. Moving or renaming images in
  Obsidian is followed automatically; images moved while Worldsmith was off are found by
  name and relinked in one click.
- **Nesting fields** — "Parent entry" and "Nested entries" field kinds show and edit the
  hierarchy inline.
- **Schema shortcuts on entity pages** — add a field to a section, open a section in Type
  Studio, or use a field's ⋯ menu to edit, tuck away, hide or delete it.
- **Clean details** — a tidy two-column grid with a column divider and one quiet "Empty"
  for blanks, or a list with labels beside values. Pick per page, per type, or for
  everything.
- **Customizable entry pages** — click the layout button on any entry (or ⋯ → *Customize
  this page…*, or the command) to rearrange, resize, add and remove widgets. Change the
  layout for **every page of a type** or for **only this entry**; Undo (Ctrl/Cmd+Z) and Reset
  are always one click away. Type Studio → **Page layout** shows each type's layout and
  which entries have their own.
- **New widgets** — *Showcase:* Key facts, Quote, Stat block, Image spotlight, Single field,
  Heading & divider. *Connections:* Relationship web, Roster table, Shared connections, Note
  backlinks. *Writing:* Embedded note. Every widget has settings (gear in Customize) and an
  optional custom title.
- **Home, your hub** — the world's banner, a row of numbers, the contents, recent work, a
  daily spotlight, a line from the archives, what's due and what needs attention. Customize
  it like any page (layout button on the banner).
- **Dashboards** — make more pages like Home for parts of your world (Cast, Politics,
  Session prep, or blank) under *Dashboards* in the sidebar. Build your own widgets: lists of
  any entries (filtered by type, status, tag or a field) as lists, cards, tables or portrait
  walls; big numbers (counts, totals, averages, percentages); bar and donut charts; a
  featured entry; and your own links. The sidebar section can be turned off in settings.
- **Entity pages** built from blocks: hero (banner with drag-to-reposition, arched portrait,
  inline name, breadcrumb, status, development ring), summary, properties with
  progressive disclosure, development progress with "next up" suggestions, names & tags,
  linked note (create / link / preview / change / unlink), nested entries, gallery.
- **Inline editing everywhere** with debounced autosave, validation that never overwrites
  good data with bad input, and a quiet save indicator.
- **Media library** — every image the world uses, with saved views like a database: a wall,
  cards or a table; filter by in use / not used yet / missing, what it's used as, entry type,
  folder or file type; sort and group; repair missing images.
- **Relationships studio** — every kind of connection with a picture of how it reads from
  each side, what it usually connects, its own details and where it's used.
- **Database views** — every type's database has saved views as tabs, each with its own
  layout (cards, gallery, table, list, board or progress), filters ("all" or "any" of them,
  on any field or on status, tags, portrait, favourites, development, connections and
  dates), sorting by several keys, grouping, and the columns or card fields it shows. Edit
  cells right in the table, resize columns, drag cards between board columns, and put any
  view on Home or a dashboard. The **Progress** layout shows how developed each entry is,
  its next open tasks (tick them off there) and which key details are still missing.
- **New types from a starting point** — Vehicles & ships, Spells & rituals, Plants & herbs,
  Quests, Prophecies, Houses & bloodlines, Curses & diseases, Currencies & goods, Titles &
  ranks or Holidays & festivals, each with fields, sections and a checklist — or blank.
  Copy a field to another type; duplicating a type keeps its page layout.
- **Layout Studio** — try ready-made page layouts (Profile, Encyclopedia, Visual, One column)
  or another type's layout on one of your own entries, as a live preview on a wide window or a
  phone, then use it with Undo; see and reset the pages that have a layout of their own.
- **Import & export** — move a whole world to another vault (importing never overwrites a
  world; it adds a copy), share types as a file, import a spreadsheet (columns matched to
  fields, a preview of what will happen, Undo), export any type or view as CSV, and write
  entries out as Markdown notes with properties and links (notes you've edited are never
  written over).
- **Calendars** — your world's own months, weeks, festivals, leap days and eras, written
  the way you choose (“12 Frostmoon 312 AC”), or in a format of your own (“the 14th of
  Seedfall, 312 AC”); date fields pick from them, and several
  calendars can be lined up with each other.
- **Timeline** — every dated entry in lanes by type, with era bands, zoom, type and tag
  filters, and a list view for phones; a Timeline widget for dashboards and entry pages.
- **World health** — a score plus checks for broken images and notes, broken connections,
  dates that disagree, missing details, duplicates and loose ends, each with a fix that never
  deletes anything (with Undo).
- **Trees** — family trees drawn around anyone, with partners, siblings and as many
  generations as you like; add parents, children and partners right on the tree or from the
  Parents, Children and Spouses boxes. Hierarchies (a kingdom and its provinces) too, with
  folding and drag to move. Each tree opens as the whole page.
- **Relationship graph** — every entry and connection as a web you can drag, centre on one
  entry, filter by type from a dropdown and save as views; each kind of connection has its
  own colour. Opens as the whole page; pinning dragged dots is optional.
- **Maps** — from any image or blank parchment: pins linked to entries, areas, routes, layers,
  measuring, Set scale from two points, maps inside maps, a compass, a grid and a scale,
  with Undo for everything. A map is the whole page; Ctrl + hover a pin to read its entry.
- **Family tree, Connection map and Map widgets** for entry pages and dashboards.
- **Your own layout presets**, **banners on every page** (Tasks, dashboards, type pages) and
  **several notes per entry**.
- **Dashboard** — world banner, a book-style table of contents, quick create, recent work,
  favorites and pinned entries.
- **Search** — names, aliases, tags and field content, as a quick switcher and a full page.
- **Safety** — trash with undo, impact warnings before permanent delete, atomic writes,
  automatic recovery from interrupted writes, quarantine of damaged files, backups and
  restore.
- **Theme-native** — all colors and fonts come from your Obsidian theme; all CSS is scoped.
  Works in split panes and on phones.

## Install (manual)

1. Build (see below) or use a release: you need `main.js`, `manifest.json`, `styles.css`.
2. Copy them into `<your vault>/.obsidian/plugins/worldsmith/`.
3. Enable **Worldsmith** in **Settings → Community plugins**.
4. Click the globe in the ribbon, or run **Open Worldsmith** from the command palette.

## Moving a world to another vault *(0.19)*

**Export.** Open **Import & export** and press **Export…** on the *Whole world* card. You see
what the world holds, and choose which of your own notes go along: notes you linked or
adopted as an entry's note, other notes linked to entries, and Writing Studio scene notes
(all on unless you switch them off). Worldsmith's own data, native notes, and every image or
file the world uses always go along; a picture embedded in one of your notes travels with
that note. Notes that aren't linked to the world are never included. Press **Export**: your
latest changes are saved first, the archive is written to `Worldsmith/Exports/<world>
<date>.worldsmith.zip` (a new file each time), then read back and checked. You only see
"Exported and verified" when every file's checksum matched.

**What's inside.** A `.worldsmith.zip` is an ordinary ZIP file you can open with any ZIP tool:
`manifest.json` lists every file with its SHA-256 checksum, the world's id and the versions
that made it; `README.txt` says the same in plain words; `world/` holds the world's data files
(entries, types, connections, tasks, layouts, views, dashboards, maps with their pins and
layers, calendars, the Writing Studio, note templates); `vault/` holds the notes, images and
attachments at the paths they had in your vault, byte for byte.

**What can be missing.** If an image or note the world uses isn't in your vault, the export
still runs, names the file and who uses it, and records it in the archive. Images given as web
addresses aren't downloaded. Files you chose to leave out are listed as left out.

**Import into another vault.** In the new vault, Worldsmith's welcome screen has **Import a
world** (in a vault that already has a world, use *Import & export → Import a world*). Choose
the archive from the vault or from your device. Worldsmith checks it first and shows a
preview: what's inside, what was missing when it was exported, and which files will land
beside a file of the same name. Then **Import**. The world is added as a new world; your
other worlds and notes aren't changed.

**Conflicts.** Importing never writes over a file. If a different file already has the same
name, the imported one is saved beside it ("Ava (imported).md"), and only the world's
references to that file are changed. An identical image that's already there is used as it
is. If the same world is already in the vault, it can only be added as a separate copy
("… (copy)"), with its own notes, so two worlds never share a note. Replacing a world isn't
done by importing: to return a world to an earlier state, use *Settings → Data & backups*.

**Verify.** *Verify an archive* checks that an archive is complete and undamaged (every file
present, every checksum right, a version this Worldsmith understands) without importing or
changing anything.

**If something goes wrong.** An import that fails takes back everything it wrote and says so;
your vault is as it was. If Obsidian closes in the middle of an import, the *Whole world* card
shows "An import didn't finish" next time, with **Undo that import**, which removes only the
files that import created and you haven't changed since. An export that can't save your latest
changes, or can't read a file, stops and says why; it never writes a half or out-of-date
archive.

**Archives and backups.** An archive is for moving or keeping a world somewhere else.
Automatic recovery backups (Settings → Data & backups) stay inside this vault and are used to
roll a world back.

**Versions.** Archives carry their format version (now 1) and the data versions of the world.
A newer Worldsmith reads older archives; an archive from a newer Worldsmith than yours is
refused with "Update Worldsmith to import it" rather than imported wrongly.

**Limits.** Archives are built in memory, so very large worlds (several gigabytes of images)
may be slow or too large for a phone; a single archive holds at most 65,535 files and 4 GB.
Worldsmith's settings (folders, look) belong to each vault and aren't in the archive. All of
this happens on your device; nothing is uploaded anywhere.

## Deleting a world *(0.20.1)*

Click the world's name at the top of the sidebar and choose **Delete this world…**. Type the
world's name to confirm. Worldsmith makes a backup of it first, then moves it to **Deleted
worlds** and opens your next world. Your notes and images stay in your vault. To bring it back,
open the world menu → **Deleted worlds** (or *Restore a deleted world* on the welcome screen)
and choose **Put back**. **Delete for good** removes it permanently; its backups are kept
unless you tick *Also delete its backups*, and a kept backup can still be imported as a world.

## The Writing Studio, in short

- **Looks like** the combined design chosen in the WS1 prototypes *(0.28)*.
- **Write:** projects with parts, chapters and scenes; each scene is its own note, written in
  Obsidian's editor on a paper page (Manuscript), with focus and typewriter modes.
- **Plan:** the Story board (cards, outline, status board, timeline, table), plot threads and
  story structures (Plot), your own templates and statuses.
- **Your world in your story:** each scene's point of view, cast and place are entries of your
  world; boards filter by character or place; entries list the scenes they're in; the Arcs tab
  follows one character through a book; insert links to entries while you write.
- **Progress:** words per day (net), a daily goal and finish date, streaks, a 30-day chart,
  sprints.
- **Revise:** snapshots (also one a day automatically), compare, restore without loss, revision
  passes with checklists, marked passages (the Revision tab).
- **Research:** notes, images, links, sources, entries and image boards for each book.
- **Character arcs:** a hope-to-despair curve, wants, needs, flaw, conflicts, turning points.
- **Compile:** Word, EPUB, Markdown, plain text, a web page, or PDF through the print dialog.
- **Phones and keyboards:** every studio view fits a phone; touch screens get larger tap
  targets; every control has a name for screen readers.

## Backups & recovery *(0.20)*

Open it from *Settings → Worldsmith → Open Backups & recovery*, the *Import & export* page,
or the command palette (**Open Backups & recovery**).

**Automatic backups** are on from the start: while Obsidian is open, a backup of the open world
is made every hour (you can choose every 15 or 30 minutes, every 4 hours, or once a day), and
skipped when nothing changed. They hold the world's data and all its notes; images are left out
to save disk space unless you switch **Images in automatic backups** on. **Back up now** makes a
manual backup, which always includes images. Before a restore, Worldsmith makes a safety backup
of the world as it is.

**Every backup is checked.** It is written, read back and compared file by file before it
appears as *Verified*. **Verify** checks one again at any time. If a backup can't be written
(for example the disk is full), you're told, nothing half-made is left behind, and older
backups stay.

**How many are kept.** The newest 10 automatic and 20 manual backups (you can change both), and
the newest 5 safety backups. The oldest are deleted only after a new backup has passed its
check, and the newest checked backup is never deleted. The page shows how much space they use.

**Where they are.** In `<data folder>/backups/<world>/` inside your vault, so Obsidian Sync or
any backup tool you use copies them too. Each backup is a world archive (`.worldsmith.zip`):
**Save a copy to Exports** puts one where you can move it anywhere, and it can be imported into
any vault. **Delete** removes a backup (after asking); it never touches the world.

**Restoring.** *Restore…* offers two ways:
- **Restore as a new world** — the safest. The backup becomes a separate world beside yours.
- **Replace the current world** — the world goes back to that moment. First you see what will
  change (entries that come back, go back, or won't be there; notes and images that come back),
  and tick that you understand. A safety backup is made first. Notes you edited since keep your
  version, and the backup's version is saved beside them as "… (from backup <date>)"; native
  notes you edited keep your writing. Images that changed since stay as they are. If anything
  fails, the world is put back as it was.

**After a crash.** If Obsidian closes during a restore, Worldsmith puts the world's folder back
when it next starts, if needed, and the page offers to finish tidying up (or, if the restore
had got far, to keep it or go back). Interrupted imports can be undone there too. Files
Worldsmith couldn't read are set aside, never deleted, and listed on the page.

**Older backups** (from before 0.20) are listed separately; they hold data and native notes only.
They can be restored as a new world, or over the world with a safety backup made first.

**Limits.** Backups are made while Obsidian is open. Free disk space can't be measured in
advance; a full disk is reported when it happens. Very large worlds take more memory to back up,
especially on phones. Worldsmith's settings are per vault and aren't in backups.

## Where your data lives

Worlds are stored as human-readable JSON in your vault, by default in `_worldsmith/`.
One file per entity; identities are permanent UUIDs, so renaming never breaks anything.
Please don't edit these files by hand while Obsidian is open.

**Native notes** *(0.17)* are ordinary Markdown notes, by default in `Worldsmith/<Type>/`.
Worldsmith only changes the Properties it owns and the parts between its
`%% ws-start … %%` / `%% ws-end … %%` markers. The optional snippet is
`.obsidian/snippets/worldsmith-notes.css`.

**Obsidian Sync:** the folder name has no leading dot, so Sync picks it up. Make sure
**Settings → Sync → Other file types** is enabled, because Worldsmith stores `.json` files.
iCloud, Syncthing, Dropbox and git work as-is.

**Upgrading from 0.1.x:** an existing `.worldsmith/` folder is moved to `_worldsmith/`
automatically on first start (nothing is deleted; if the move can't complete, Worldsmith
keeps using the old folder and tells you). You can choose any other folder in
**Settings → Worldsmith → Data folder** — *Move here* moves your data, *Use existing*
switches to a folder that already holds Worldsmith data.

## Development

```bash
npm install
npm run dev        # watch build → main.js + styles.css
npm run build      # type-check + production bundle
npm test           # headless tests (storage, migrations, services, schemas, layout)
npm run harness    # browser UI checks + screenshots (needs Playwright + a Lucide checkout)
```

The harness needs icons: `node harness/icons.mjs /path/to/lucide/icons` once (clone
`lucide-icons/lucide`). Screenshots land in `harness/out/shots/`.

Before changing anything structural, read **[ARCHITECTURE.md](ARCHITECTURE.md)** (layers,
registries, storage, layout engine) and **[DATA_MODEL.md](DATA_MODEL.md)** (every persisted
shape). Changes are tracked in **[CHANGELOG.md](CHANGELOG.md)**.

## Extending Worldsmith

Other plugins can reach `app.plugins.plugins.worldsmith.api`:

```ts
const ws = app.plugins.plugins.worldsmith.api;
ws.registerBlock({ id: 'my-block', name: 'My block', … , render(ctx) { … } });
ws.registerFieldType({ id: 'dice', … });
ws.registerEntityType(template);
```

Worldsmith registers its own built-in fields, blocks, types and pages through the same API.

## Privacy

See [PRIVACY.md](PRIVACY.md) for exactly what Worldsmith stores, reads and (once, on request) downloads, and [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for the latest audit.

Fully local. No network requests, no telemetry.
