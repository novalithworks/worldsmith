# Changelog

## 0.30.11 — Release build fixed

- The GitHub release build installs cleanly: `@codemirror/state` and `@codemirror/view` are pinned
  to 6.5.0 and 6.38.6, the versions Obsidian 1.13's API package requires.
- Includes everything in 0.30.10.

## 0.30.10 — The review can read the whole repository

- Obsidian's review lints every code file in the repository with type-aware checks, and stops
  with a "fatal error" on any file outside a TypeScript project. The public repository now holds
  what the plugin is built from (the source, the build configuration, the manifests and the
  docs); the test suites and release tooling stay in the private source repository. The build
  configuration is part of the TypeScript project.
- CSS: no duplicate properties in the note pop-up's buttons; the unresolved-link underline uses
  the `text-decoration` shorthand.
- The settings recorder no longer aliases `this`.
- The `obsidian` types are pinned to 1.13.

## 0.30.9 — Obsidian's review, all clear

- **Needs Obsidian 1.13 or newer.** Settings use Obsidian's new declarative settings: every
  Worldsmith setting now appears in Obsidian's settings search.
- **Code:** the unnecessary type assertions are gone (117), the last cross-window type check is
  fixed, the deprecated `activeLeaf` is replaced, and an unused import removed.
- **Styles, with no `!important`, `:has`, `display: contents`, CSS columns, `text-indent` or
  `all`:** galleries, the media library's wall and the research board lay out as masonry grids
  (each item spans its own height); a few classes Worldsmith keeps up to date replace `:has`;
  phone sheets are placed by the stylesheet alone; inline sizes Obsidian sets are replaced by
  Worldsmith's own. Looks are unchanged.
- **Native notes:** the info card says when it has a portrait (`[!ws-infobox|portrait]`), the
  connections table is `[!ws-links|table]`, and the kicker and aliases around the name are
  classed spans. Worldsmith updates existing notes the next time it writes them.
- **Releases are built on GitHub:** publishing a release runs a workflow that checks the tag
  matches the manifest, builds the free edition, attests the files (provenance) and attaches them.

## 0.30.8 — Obsidian's CSS review

- **Fewer `!important`:** 23 removed from Worldsmith's own styles (replaced by more specific
  selectors). Kept where they must win: the hidden utility and screen-reader labels, reduce
  motion, tooltips off, overrides of inline positions and of Obsidian's own inline styles, and
  the native-note styles (they also ship as the snippet used when Worldsmith is off).
- **No `all: unset`:** the two resets are explicit properties.
- **Faster pages:** the page container no longer uses `:has` (full-screen and Layout Studio
  pages are marked with a class when drawn). The remaining `:has` selectors are scoped to small
  parts of a page, or are in native notes, where they depend on the note's content.
- The "partially supported" notes (display: contents, multi-column, text-decoration, text-indent)
  are left: they all work in Obsidian's browser engine.

## 0.30.7 — Obsidian's code review

Fixes from the community directory's automated review:

- **Errors:** styles are set through `setCssStyles` (16 places); every lint exception says why.
- **Warnings:** timers and animation frames on `window` (pop-out windows); command names without
  "Worldsmith" (Obsidian shows it already); deleted backups and import leftovers go through
  `FileManager.trashFile` (your deletion setting); async button and event handlers started
  explicitly; Obsidian's `createEl`/`createFragment` helpers and cross-window `instanceOf`; typed
  values instead of `any`; `dispose`/`navigate` declared as plain functions; deliberate
  control-character patterns documented; no informational logging; `globalThis` removed;
  escaped byte-order marks; `@codemirror/state` and `@codemirror/view` listed as dependencies.
- **Recommendations:** unused imports and code removed; deprecated slider tooltips removed.
- Not yet: the "unnecessary type assertion" warnings (no behaviour change; need Obsidian's
  type definitions to check safely) and the newer settings API (optional).

## 0.30.6 — Public source, one-step releases

- **All of Worldsmith's source is public**, Pro included; Worldsmith Pro is the official
  ready-made build with updates and support, sold on Buy Me a Coffee. The README says so (and that
  payment is required for the full version); the LICENSE already forbids building or sharing Pro
  for others.
- **`npm run release`** builds both editions, checks each is the right one (each build now carries
  its edition's name, "Worldsmith Free edition" / "Worldsmith Pro edition", fixed when it's made),
  and writes the free files for the GitHub release and the Pro zip for Buy Me a Coffee. It stops
  on mismatched versions or a wrong edition, so Pro can't reach a public release.
- RELEASING.md describes the one-repository setup.

## 0.30.5 — Cleaner notes, theme defaults, import and export checked

- **Native notes read cleanly while editing:** Worldsmith's section markers (`%% ws-start … %%`)
  are hidden in Live Preview and Source mode (they stay in the file, and the cursor steps over
  them). Reading view already hid them.
- **Worldsmith follows your Obsidian theme by default**, at full width: the theme's colours and
  fonts for new installs. Bronze and the book serif are still in Appearance; existing choices are
  kept.
- The **"Group by"** heading (and the other picker titles) use the text colour in the Codex look.
- **Import & export:** Native notes now spans the page below both columns (it sat after a gap);
  the "Backups & recovery" link reads inside its sentence. Spreadsheet import and export checked
  end to end (Excel-style files with accents, quoted commas, lists and links; Undo); they work.
- Tests: `harness/transfer0305.mjs`.

## 0.30.4 — Novalith

- The author and copyright holder is now **Novalith** (LICENSE, both manifests, package.json,
  README).

## 0.30.3 — Where to get Pro

- "Get Worldsmith Pro" opens **https://buymeacoffee.com/novalith**, also the manifests' `fundingUrl` (shown by Obsidian
  as a support link) and in the README.
- RELEASING.md and PRO-INSTALL.txt describe selling Pro on Buy Me a Coffee.

## 0.30.2 — License and author

- **LICENSE:** the Worldsmith Source-Available License, copyright 2026 Novalith (use, read,
  change for yourself and contribute; no redistribution, forks or Pro builds; your work is yours;
  third-party parts keep their own licenses).
- Author **Novalith** in both editions' manifests; a License section in the README.

## 0.30.1 — Ready for the community directory

- **Works on older iPhones and iPads:** two text patterns used a feature (regex lookbehind) that
  iOS before 16.4 can't read, which would have stopped Worldsmith loading there. Rewritten.
- **Native notes' base look is now in `styles.css`**, and the note templates' rules use a
  constructed style sheet: Worldsmith no longer adds `<style>` elements (Obsidian's review rules).
- **Release files:** a user-facing README (with the Worldsmith Pro section the directory's
  policy asks for), `RELEASING.md` (GitHub release, directory submission, selling Pro),
  `PRO-INSTALL.txt` (for Pro buyers), and the bundled font's licence (`fonts/OFL.txt`, and a
  notice kept in `styles.css`).

## 0.30.0 — Worldsmith Free and Worldsmith Pro

- **Two editions from one codebase**, chosen when building (`npm run build` = Free,
  `npm run build:pro` = Pro). No licence keys.
- **Free** (plugin id `worldsmith`, for the community directory): the Writing Studio, Maps,
  Timeline, Trees, Graph and Calendars are switched off and can't be switched on. They show on
  the Features page with a **Pro** badge and "Comes with Worldsmith Pro"; opening one shows a Pro
  page with **Get Worldsmith Pro**; their sidebar links and commands are hidden; the getting-
  started guide skips them. Any data a world already has for them is kept. A Worldsmith Pro
  banner on the Features page and a line in Settings say what Pro adds.
- **Pro** (plugin id `worldsmith-pro`, name "Worldsmith Pro"): everything. A separate plugin, so
  directory updates of Free can't replace it. On its first start it brings the free edition's
  settings along; if both are on, Pro switches the free copy off (and the free copy stays idle
  beside Pro). Worlds live in the vault, so both editions use the same ones.
- **"Relationship graph" is now "Graph"** (sidebar, page, command, widgets, Help); existing
  worlds' sidebar labels follow unless renamed by hand.
- Tests: `harness/editions.mjs`.

## 0.29.3 — PDF as a file

- **Compile → PDF now makes a PDF file** in the vault's exports folder, like Word and EPUB, and
  opens it in Obsidian; no print dialog (Windows' dialog had no "Save as PDF"). A notice offers
  *Show in folder* to find it on disk.
- On the desktop the PDF is drawn by Obsidian's own renderer, so it matches the preview exactly
  (the studio's fonts, paper colour, decorative first letter). Elsewhere, or if that isn't
  available, Worldsmith writes the PDF itself: the same colours, sizes, margins, page size,
  chapter openings, ornaments and page numbers, in the PDF format's own Times (or Helvetica for a
  sans style). Letters those fonts lack (e.g. Chinese) are left out in that case.
- New dependency: pdf-lib 1.17.1 (MIT), bundled.
- Tests: `tests/pdf.test.ts`; ws7 checks the PDF file.

## 0.29.2 — Features where you can always find it

- **Features** now sits at the foot of the sidebar, right above Settings, in every world however
  its sidebar has been arranged (it could be missing from a world whose Tools section was changed).
- A command: **Open Features (choose what this world uses)**.

## 0.29.1 — Start-up made resilient

- Fixes "Failed to load plugin" reports after 0.29.0. Commands of switchable parts are now
  registered through a small wrapper instead of temporarily replacing the plugin's own
  `addCommand` (0.29.0's riskiest start-up change).
- **Start-up can't fail as a whole any more:** each step (commands, note commands, the settings
  tab, the ribbon icon) runs on its own; one that fails is named in a notice and the rest still
  load. If even the core can't start, a notice says why instead of a silent failure.
- Tests: `harness/startup.mjs` runs the plugin's real start-up (as Obsidian does), including a
  step failing on purpose.

## 0.29.0 — World features: choose what your world uses

- **Features** (in Tools, the world menu, and Worldsmith's settings): switch whole parts of
  Worldsmith on or off for this world: the Writing Studio, Maps, Calendars, Timeline, Family
  trees, the Relationship web, Tasks, Dashboards and the Media library. Each card shows what the
  part holds ("3 maps", "12 tasks") and what's kept while it's off.
- A part that's off **disappears everywhere**: its sidebar link, its pages (opening one shows
  "Maps are turned off" with *Turn Maps on*), its commands in the palette, and its widgets on
  entries and dashboards (their settings are kept). With the Writing Studio off, entries lose
  "Appears in" and the timeline its scenes.
- **Nothing is deleted.** Every switch has Undo, and *Turn everything on* resets the lot. The
  switches are saved with the world, so they travel with exports and backups. Entries,
  connections, notes and Home are always on.
- A Help topic, "Choosing what your world uses".
- Tests: `harness/features.mjs` (31 checks) and `tests/features.test.ts` (3).

## 0.28.2 — Fixes from testing: covers, Home, compile styles, editor borders

- **Cover titles** always fit inside the cover (sized to it, wrapped inside it), however long.
- **Home** in a book's top bar, before Overview, always in view; the tab row fits better on
  medium-width windows.
- **Compile:** the format is a grid of tiles; the preview's pages fill the space (two large pages,
  type and margins to scale) and text never runs off a page.
- **Compile styles (new):** export the book looking as it does in the Writing Studio, or start from
  *Classic manuscript*, *Plain* or *Dark*, then change the page, text and accent colours, the text
  and heading fonts, the size, line spacing, margins, page size (A5, 6 × 9, A4, Letter), and the
  decorative first letter, paragraph indents and ornaments. Shown live in the preview; remembered
  with the book. **PDF** keeps the paper colour on every page, edge to edge, with margins on each
  page; **web pages and EPUB** carry the studio's title face; **Word** gets the fonts, colours,
  page colour (Word shows it; printing it needs Word's "Print background colors"), size and
  margins, and chapter openings as a kicker, title and ornament.
- **Note editors** (the map popup, the Note tab, note panes) no longer show a border while you
  type.
- Tests: `harness/fixes0282.mjs` (19 checks); unit tests for styles.

## 0.28.1 — The rest of the combined design

- **Focus mode bar:** in focus mode, a slim bar at the foot of the page: the sprint's time left
  (or *Sprint* to start one), a line toward the goal, and the words of this sprint or today.
- **Corkboard: Group and Colour.** *Group: Chapter / Status / Point of view / Plot thread* and
  *Colour: Plot thread / Status / Point of view* (on Kanban too). Cards reorder by drag only when
  grouped by chapter; the board says so otherwise. Each character keeps one colour everywhere.
- **Side panel: Outline and Research.** Beside the page: the book's scenes with their summaries
  (click to open one), and the book's research (click to open).
- Test: `harness/design2.mjs` (15 checks).

## 0.28.0 — The Writing Studio's combined design

The Writing Studio now looks like the combined design chosen in the WS1 prototypes (Literary
Atelier's dress on Author's Studio's layout). The editor's page is unchanged.

- **Top bar:** the book's cover, title in italic and kind · status in bronze; small-capital tabs
  (Overview, Manuscript, Story board, Plot, Character arcs, Goals, Revision, Research, Compile);
  today's words against the daily goal, sprint, focus mode and settings.
- **Home:** greeting with today's goal and streak, "Where you left off", six tiles, Upcoming
  goals, quick actions; new covers. **Overview:** genre and series, tagline, five numbers with
  the estimated finish, Draft progress, Plot threads, Main cast.
- **Story board:** a cork panel, pinned and ruled index cards with the thread's colour, point of
  view and place chips; Outline with a point-of-view column; small Kanban cards.
- **Manuscript:** the inspector in the design's order (summary; point of view and status;
  location; when; purpose; characters present; plot threads…), and a new **World tab** with the
  profile of each person or place in the scene; links to Revision notes and Research.
- **New: Goals** (tab, and Goals & stats for all books): rings for today, week, month, streak and
  book; the week against the goal; when the book will be finished; an activity grid; **writing
  sessions recorded automatically**; weekly and monthly goals.
- **New: Revision** (tab): passes with **checklists**, **marked passages** (select text in a scene
  and run *Mark passage for revision*), snapshots and compare; rename or remove passes.
- **New: Research** (tab): notes, images, links, sources, world entries and image boards for the
  book; nothing is copied; opens beside the manuscript; only safe links open.
- **New: Compile page:** include or leave out parts and chapters, story or **in-world time order**,
  **dedication, epigraph, acknowledgements, about the author**, ⁂ as a scene break, and a live
  preview of the first pages. (The Compile dialog stays in the project menu.)
- **New: deeper character arcs:** a hope-to-despair curve through their scenes (set points and
  name turning points from each point's menu), wants, needs, flaw, internal and external
  conflict, arc, and a turning-points list. Older start/end notes are kept.
- **New: a Writing Studio settings page** (from the settings popover: *All writing settings…*).
- Projects gain genre, series, a tagline, weekly and monthly goals; the library shows the
  deadline, the world and the series.
- Tests: `tests/design.test.ts` (2), `harness/design.mjs` (33 checks), and the older studio tests
  moved to the new places (Arcs, Goals, Revision and Compile checks rewritten, with new checks for
  checklists, marked passages, the curve, the Include tree and the live preview).

## 0.27.0 — Writing Studio WS8: polish (the Writing Studio is complete)

- **Measured with a 400-scene book:** every studio view opens in about 30–160 ms in the test
  browser, and a change redraws a board in about 20–60 ms. (Opening Outline while a scene is
  saved redraws it in ~160 ms; noted, not changed.)
- **Screen readers:** a scan of 15 pages (every studio view, entry pages, Help, Backups, Timeline,
  Home) and the studio's dialogs found every one of ~1,400 controls already named, no images
  without a description and no duplicate ids; it's now a test.
- **Keyboard:** the Compile formats are one Tab stop and the arrow keys move between them; the
  Arcs people list moves with the arrow keys.
- **Touch screens:** small buttons (the studio's header and row menus, breadcrumbs, table sort,
  chips and their ×, property menus, task and checklist boxes) get a comfortable tap area on
  touch screens only; the desktop look is unchanged. Every studio view fits a phone.
- **Reduced motion:** progress bars don't animate for people who asked their system for less.
- **Documentation:** Help's Writing Studio section and the README now cover all of it: who and
  where, arcs, progress, snapshots and passes, compile.
- Test: `harness/ws8.mjs` (speed, names, keyboard, phones, Help).

## 0.26.0 — Writing Studio WS7: compile

- **Compile…** (on the project's Overview, and in the project menu) turns the whole book, in
  reading order, into one file: **Word** (.docx), **EPUB**, **Markdown**, **plain text** or a
  formatted **web page**, saved in Exports as a new file each time. **PDF** opens the system
  print dialog on the formatted book (choose "Save as PDF"; desktop).
- Options: title and author, a title page, chapter headings (*Chapter One: Title*, *Chapter
  One*, the title, or none), scene titles or a scene break (* * *, #, a blank line), and the
  book's language. Parts become part pages; chapters start on a new page in Word, EPUB and PDF.
- Obsidian-only things are cleaned: front matter, comments, embeds and images are left out;
  links become their words; callouts become quotations. Bold and italics are kept.
- Choices and the author are remembered per project.
- Word and EPUB are written by Worldsmith itself (they're ZIP files of XML, made with its own
  ZIP writer), so no library was added; both were checked part by part with strict XML parsers.
- **Archives are checked more strictly:** each file's local header must now match the archive's
  directory (name, method, checksum, sizes). The full test run found a damaged archive that
  Verify passed because the damage hit a header copy the reader skipped; the file contents were
  intact, but Verify now reports it.
- Tests: `tests/compile.test.ts` (5), one more ZIP test, and `harness/ws7.mjs` (22 checks).

## 0.25.0 — Writing Studio WS6, part two: snapshots and revision passes

- **Scene snapshots** (in the scene's inspector): **Take snapshot…** saves the scene's text with
  a name. One is also taken automatically each day, when you first open the scene in the
  studio (before you change it) or, for a scene edited elsewhere, at the first save of the day.
  Snapshots you take are kept; the last 20 automatic ones per scene are kept.
- **Compare:** a snapshot beside the scene as it is now, line by line (what's only in the
  snapshot in red, only now in green); stacked on a phone.
- **Restore:** puts a snapshot's text back. Your current text is saved as a snapshot first
  ("Before restoring …"), and Undo brings it back, so nothing is ever lost.
- **Revision passes** ("Tighten dialogue", "Continuity"): add them on the project's Overview,
  tick scenes done in each scene's inspector, see progress per pass, and filter any board to
  **To do in …** a pass. Rename, remove and Undo.
- Snapshots are kept with the world, so exports and manual backups carry them; automatic
  backups leave them out to stay small (the Backups page says so).
- Hover tooltips no longer pop up over whole sections (Progress, Getting started, Appears in…).
- Tests: `tests/snapshots.test.ts` (4) and `harness/ws6b.mjs` (21 checks).

## 0.24.0 — Writing Studio WS6, part one: progress

- **Daily history:** the words you write each day are counted per project, wherever you write
  them (in the studio or in an ordinary note tab). Counting is net, like Scrivener: deleting
  counts down. Text moved by split and merge doesn't count, and a restart doesn't count anything
  twice. Kept with the world's data (so it's in backups and archives).
- **Daily goal and Finish by** in *Details and word goal…* (both optional).
- **Streaks:** days in a row you met your daily goal (or wrote anything, without one). Today
  doesn't break it before you've written.
- **Progress on the Overview:** today against your goal (with a ring), your streak and best,
  this week, words needed each day to finish on time (with a word goal and a finish date) or
  your projected finish at the recent pace, a 30-day chart with the goal line, and recent sprints.
- **Today counter in the manuscript** (with the streak), and **Sprint**: 15, 25 or 45 minutes,
  counting the words written during it; logged when it ends (sprints shorter than a minute
  aren't).
- Words counted in the last seconds are saved before every save, backup, export and quit.
- The button and icon helpers accept one class, several, or a list (two bugs of this kind were
  caught by the tests while building this).
- Tests: `tests/progress.test.ts` (4) and `harness/ws6.mjs` (23 checks).

## 0.23.0 — Writing Studio WS5, part two: arcs and links

- **Arcs** (a new tab in each project): the people of the book's scenes, most present first. For
  the one chosen: a strip of the whole book showing the scenes they're in (point of view
  darker; click a mark to open the scene), **Where they start** and **Where they end** notes
  (saved when you leave the field, with Undo; each book has its own), and their scenes in reading
  order with chapter, purpose or synopsis, opening in the manuscript.
- **Links while writing:** the toolbar's link button now also offers entries that have no note
  yet ("no note yet"). Choosing one asks: *Create its note and link it* (makes its native note) or
  *Just the name*. New command **Insert link to a world entry** does the same in any note.
- **Scenes on the timeline itself:** in Timeline mode, dated scenes are a **Scenes** lane on the
  axis (hover for date, book and point of view; click to open). List mode keeps *Scenes in story
  time*. The Scenes toggle covers both.
- Projects keep an optional `arcs` field (older projects are unchanged; unsafe or empty arcs are
  dropped when loading).
- Tests: 3 more unit tests and `harness/ws5b.mjs` (22 checks).

## 0.22.0 — Writing Studio WS5, part one: scenes and the world

- **Who and where, in the scene inspector.** Choose a scene's point of view, who's in it and
  where it happens from your world's entries. Choosing a point of view adds them to the scene
  too. Every change has Undo. Scenes store only the entries' ids, so names and pictures always
  come from the entries themselves.
- **Mentioned in this scene:** names (and aliases) of your entries found in the scene's text are
  suggested; one click adds a person to the scene, or sets a place as where it happens. Nothing
  is added on its own.
- **Names open the entry:** clicking a name shows a preview (picture, type, summary) with *Open
  page* (in a new tab, so your writing stays open) and *Open note*.
- **Boards:** corkboard cards show whose point of view it is; a new **Everyone** filter (beside
  the plot-thread filter, on every board view) shows the scenes of one character or place; the
  table has **Point of view** and **Where** columns (sortable, searchable).
- **Appears in** on entry pages: the scenes an entry is in, by project in reading order, with its
  role in each; click to open the scene. Only shown on entries that are in a scene.
- **Scenes in story time** on the Timeline page: scenes with an in-story date, in story order,
  with their time, book and point of view; a **Scenes** toggle hides them (remembered).
- A deleted entry shows as **Missing entry** on its scenes, with a × to remove it; restoring the
  entry from the trash brings the link back. The studio refreshes when an entry it shows is
  renamed, deleted or restored.
- Tests: `tests/writingWorld.test.ts` (5) and `harness/ws5.mjs` (30 checks).

## 0.21.0 — First steps

- **Welcome screen: three ways in.** *Create a world*, *Use my existing notes* (creates the world,
  then opens Characters, where notes are dragged in or added with *Add existing note*), and
  *Import a Worldsmith world*; plus *How Worldsmith works*. All are real buttons (keyboard and
  screen readers).
- **Getting-started guide** on a new world's Home: seven optional first steps (first entry, a
  connection, an entry's own note, bringing in a note, Type/Layout Studio, a creative tool,
  backups and export), each with buttons to the real feature. Steps tick themselves off from
  what's in the world (nothing to save or lose), can be done in any order, and the guide can be
  hidden any time. The world form has a tick box to skip it. **Existing worlds don't get it**;
  anyone can switch it on from Help.
- **Help** (world menu → *Help & getting started*, the command *Open Worldsmith help*, or the
  welcome screen, even before a world exists): what the words mean (world, entry, type, native
  note, adopted note, Properties, freeform writing, connection, wikilink) and short sections on
  every area, each with buttons to the feature. Offline.
- **From a note to its entry:** *Open this note's entry in Worldsmith* (command) and *Open
  "…" in Worldsmith* in a note's file menu, for native, adopted and other linked notes.
- **Empty type pages** explain both ways to start and offer *Add existing note* beside *Create*.
  The empty backup history explains what backups are for.
- Pages that work without a world (welcome, Help) can show before the first world exists.
- Tests: `harness/onboarding.mjs` (40 checks: new user, existing notes, returning, hidden and
  restored guide, Help with and without a world, existing worlds left alone, keyboard, phone).

## 0.20.2 — Security, privacy & code-safety audit

- **Links in URL fields are checked.** Only web (`http`, `https`), `mailto` and `obsidian` links
  become clickable or open; anything else (`javascript:`, `file:`, `data:` …), for example from an
  imported world or a CSV, is shown as plain grey text and can't be opened.
- **Exports never include a private note unseen.** A note picked in a file field is now one of
  "Other notes linked to entries" (a choice in the dialog), and the export dialog names every
  image, file and embedded picture that goes along.
- **Crafted note templates can't add styles** (template ids are reduced to safe characters).
- **A looped Writing Studio outline can't freeze Obsidian** (guarded walks up the outline).
- **Imported data with `__proto__` keys or extreme nesting is refused** (archives, older world
  files, type files) before anything is written.
- New: `PRIVACY.md` (plain-language privacy), `SECURITY_AUDIT.md` (findings, network inventory,
  tests), `THIRD_PARTY_NOTICES.md`.
- Tests: `tests/security.test.ts` (9, including code scans that fail on any new network call,
  `innerHTML`/`eval`, or unchecked `window.open`) and `harness/security.mjs` (16 checks,
  including that a whole session makes no network request and that the Writing Studio table,
  status board and plot grid draw). A name clash introduced while adding the outline guard
  (it stopped those three views drawing) was caught by the tests and fixed before release.

## 0.20.1 — Deleting worlds

- **Delete this world…** in the world menu (click the world's name at the top of the sidebar).
  The dialog says what happens and asks you to type the world's name. A backup of the world is
  made first ("Before deleting", kept with its other backups), then the world moves to
  **Deleted worlds** and the next world opens (or the welcome screen, if it was the last one).
  Notes and images in your vault are never touched.
- **Deleted worlds** (in the world menu when there are any, and on the welcome screen): **Put
  back** restores a world exactly as it was; **Delete for good** asks again and can also delete
  its backups (they're kept unless you tick the box).
- Tests: `harness/worlds.mjs` (28 checks).

## 0.20.0 — Backups & recovery

- **Backups & recovery page** (from Settings, Import & export, or the command palette): when the
  last backup was made, automatic backup settings in plain words, where backups are kept and the
  space they use, the history, and anything that needs attention.
- **Automatic backups**, on by default: every hour while Obsidian is open (15 minutes to once a
  day), skipped when nothing changed. They hold the world's data and all its notes; images only
  if you choose. **Back up now** makes a manual backup with images.
- **Every backup is verified** before it's listed: written under a temporary name, read back,
  every file compared, then named. A failed write (a full disk is named as such) leaves nothing
  half-made and keeps every older backup. Old backups are pruned only after a new one passed,
  and the newest verified backup is never pruned. **Verify** re-checks any backup.
- **Restore as a new world**, or **replace the current world** after a preview of what changes
  and a confirmation: a verified safety backup comes first, the data is staged and checked, the
  world's folder is swapped in one step, notes you edited since keep your version (the backup's
  goes beside it), missing notes and images come back, and the world is reopened and checked.
  Any failure puts the world back as it was.
- **After a crash**: a restore cut short is put back at startup when the world's folder is
  missing, and otherwise offered on the page (go back, or keep). Damaged files set aside are
  listed with what to do.
- **Save a copy** of any backup to Exports (it's a world archive), and **delete** backups with a
  confirmation; the world is never touched.
- Older JSON backups are listed separately and can be restored as a new world, or over the
  world with a safety backup first. *Back up the current world* (command) now makes a verified
  backup.
- Tests: `tests/backups.test.ts` (5) and `harness/backups.mjs` (54 checks).

## 0.19.0 — Complete world import & export

- **World archives.** *Import & export → Export…* writes one `.worldsmith.zip` with everything
  the world needs in another vault: its data (entries, types, connections, tasks, layouts,
  views, dashboards, maps with pins and layers, calendars, the Writing Studio, note templates),
  its native notes, every image and file it uses, and, as you choose, your linked and adopted
  notes, other linked notes and Writing Studio scene notes (pictures embedded in a note go with
  it). Unrelated notes are never included. Missing files are named with who uses them, and
  recorded. The archive is read back and every checksum compared before "Exported and
  verified" appears. It's an ordinary ZIP with a `manifest.json` and a plain `README.txt`.
- **Import a world**, from *Import & export* or from the welcome screen of an empty vault. The
  archive is checked first and previewed (contents, missing files, files that will land beside
  same-named ones). Importing never writes over anything: a different file with the same name
  makes the imported one land beside it, and only references to it change (links in imported
  notes included); identical images are reused; the same world again becomes a separate copy
  with its own notes. The world is written out of sight, every file is read back, and only then
  is it listed, opened and checked (entries, connections, notes, images, map pins, scenes,
  layouts…). A failure undoes exactly what the import wrote; an import cut short by closing
  Obsidian can be undone from the *Whole world* card.
- **Verify an archive** checks one without importing or changing anything.
- **Saving before export is now checked.** A save that fails used to look like success, so an
  export could contain older data; now the export stops and says so. A file that can't be read
  stops an export instead of being skipped (also for the older JSON world export).
- Older `.json` world files still import (*Import an older world file*).
- Tests: `tests/archive.test.ts` (8) and `harness/archive.mjs` (86 checks, two vaults).

## 0.18.0 — Bring your own notes

- **Adopt existing notes.** Drag one note, several, or a folder from Obsidian's file explorer
  onto a type's page (Characters, Locations…), or use the new **Add existing note** button
  beside "New character". A short dialog lists each note with an editable entry name, and
  says why a note is skipped (already the note of an entry, not a Markdown note, inside
  Worldsmith's data folder, a note of another world). **Add** makes one entry per note, with
  the note as its main note, exactly where it is: nothing is moved, copied, renamed or
  written into it. **Undo** takes the new entries away again. Adding one note opens its entry
  on the Note tab.
- **Page | Note on every entry with a note.** The entry page gains a switch above it. **Note**
  shows the whole note in Obsidian's own editor (Live Preview, your hotkeys, links, images,
  Obsidian's saving), with a button to open it in a tab. Native notes open there too. If an
  Obsidian version can't place its editor in the page, the note is shown read-only with
  "Open in a tab", never in a substitute editor.
- **The Embedded note widget can edit in place.** Its settings gain "Edit the note right
  here". The adopt dialog can add such a widget to the type's page layout, so every entry
  shows its note on the page. It moves, resizes, takes a title and folds like any widget;
  while customizing it shows the note read-only.
- **A deleted note no longer disconnects its entry.** The entry keeps the link and shows
  "… is missing", and the note reconnects by itself when it comes back (Obsidian's trash,
  sync, a backup). The missing card offers **Find it again** (a note naming the entry, or one
  with the same name elsewhere), **Choose a note…** and **Unlink**.
- **Failed native-note saves and renames are shown** in a notice instead of only in the
  developer console. Nothing is retried in a way that could overwrite newer text.
- Customize mode now opens in one step (the page used to draw once as normal, then again in
  Customize), so widgets never open and close at once.
- Tests: unit tests for the adoption planner, and `harness/adopt.mjs` (43 checks: dropping a
  note and a folder, the note byte for byte unchanged, typing in the Note tab and the widget,
  customizing, renames, deletion and reconnection, Find it again, the fallback, phone width).

## 0.17.3 — Note popover and template picker, properly aligned

- **Note popover:** every row is left-aligned on the same edge (icon column, then title and
  line below), with Obsidian's own button styling fully reset, so rows no longer float in the
  middle. The header shows the folder on one line and "Template · updated" on the next.
- **Choose a note template:** every card has the same thumbnail frame and height, the title
  and badge sit in one row under it, descriptions stop at three lines, and the type's default
  template is marked with a "Type default" badge. The chosen card has an accent border and a
  tick, "Make your own" fills the rest of the last row, and the Use button always looks like
  the main action. Checked in the default theme (dark and light) and Codex, at 1000px and
  400px.

## 0.17.2 — Note popover, template picker, no flash

- **The Note button opens the designed popover**: the note's name, sync status, folder and
  template, with Open, Change template, Sync status and history, Link a different note,
  Other notes and Stop using. Entries without a native note get the same popover with the
  0.17.1 choices (Create native note, with a template, Turn a linked note into it, Open or
  Link a note).
- **Choose a note template is now a card grid** with a preview of each template, a "Use for:
  Only this entry / All <Type>" switch, Preview first, and Undo after applying.
- **No more flash in Layout Studio → Native note**: switching templates updates the page in
  place instead of rebuilding it.

## 0.17.1 — Native notes from the Note button

- **The Note button now leads to native notes.** In 0.17.0 the button on an entry page
  opened or created a plain linked note, as before, and showed the native-note menu only for
  entries that already had a native note. So in a world made before 0.17 none of the new
  features showed up there; they were only in the ⋯ menu. Now the button (its tooltip is
  "Note") always opens a small menu:
  - **Create native note** (first and bold), or **Create native note with a template…**;
  - **Turn “<your note>” into the native note…** when the entry has a linked note. You see
    a dry run first, a backup is made, every word of the note stays, its matching sections
    become the entry's sections, and you can undo;
  - **Open linked note** (and your other linked notes), and **Link existing note…**.
- **New notes are native notes.** A note made from the Note button (or the note widget's
  Create note) is a native note. To make plain linked notes instead, turn off **Settings →
  Native notes → New notes are native notes**. The native options stay in the same menu.
- **Command palette:** "Worldsmith: Create native note for this entry" and "Worldsmith: Open
  the native note of this entry".
- **A one-time notice** after updating says where to find native notes.
- An entry's own linked note can now be turned into its native note even when an old key
  in the note names an entry that doesn't exist in this world.

## 0.17.0 — Native Obsidian notes

Your entries can now live in ordinary Obsidian notes. This is opt-in: an entry without a
native note works exactly as before.

- **One home for every value.** Once an entry has a native note, its short facts (age, dates,
  choices, lists, yes/no) are the note's **Properties**, and its long writing (summary,
  biography and the other text fields) is the note's own **sections**. Edit them in
  Obsidian or in Worldsmith, whichever you like. The other side follows a moment later, and
  that works in both directions.
- **Your own writing is safe.** Worldsmith only ever changes the parts it marked (small,
  faint `%% ws-start … %%` lines) and the Properties it owns. Everything else in the note
  stays exactly as you wrote it, to the byte. Nothing is overwritten without asking. If both
  sides changed the same value, you choose what to keep, with Undo. If you edit one of
  Worldsmith's generated parts by hand, you can keep your edit (it is then left alone) or
  restore Worldsmith's version (your text is copied below it). A part whose markers you
  delete is never put back on its own.
- **Make a native note** from an entry's note button or its menu (**Native note → Create
  native note**), link a note you already have (**Link existing note…**), or turn the
  entry's linked note into its native note. The same menu opens the note, shows its sync
  status, changes its template and stops using it, all with Undo. An entry's note is renamed
  when the entry is, and the entry follows when you move or rename the note in Obsidian.
- **Six note designs.** Character Dossier, Location Atlas, Historical Chronicle, Creature
  Bestiary, Faction Dossier and Custom Entity: a banner, a portrait card beside the name,
  the key facts, the summary as a quote, the long writing, grouped connections and an
  **Open in Worldsmith** link at the foot. They look good in light and dark, in narrow panes
  and on a phone.
- **Just as pretty while you edit.** Live Preview shows the banner, portrait card, facts,
  headings, callouts and connections much as Reading view does. Worldsmith's markers are
  small and faint, and editing, selecting and typing inside any part works as usual. Source
  mode stays plain.
- **Pretty without the plugin, too.** When you make your first native notes, Worldsmith
  asks once whether to save their look as an Obsidian CSS snippet
  (`.obsidian/snippets/worldsmith-notes.css`). With the snippet on, the notes keep their full
  design even with Worldsmith switched off. With both off, they are still clean, readable
  Markdown. Worldsmith only ever rewrites its own snippet file: if a file of that name is
  yours, or you edited it, it writes a new name instead. You can switch it off under Settings
  → Native notes, or in Obsidian's Appearance → CSS snippets.
- **Layout Studio → Native note.** Each type has a **Worldsmith page | Native note** switch.
  Pick a note template and see it live on one of your own entries (wide or phone), use it for
  the type, or customise a copy: reorder, hide, add and remove sections, choose which fields
  a card or facts panel shows, and change the look (accent colour, style, title font,
  portrait side, density, headings, folding Properties away in Reading view). **Start from my
  Worldsmith page** makes a template from the type's page layout. Changing the look rewrites
  no note. Changing sections rewrites only Worldsmith's parts. Templates can be exported and
  imported as small `.json` files.
- **Bring an existing world across when you are ready.** For one entry, one type or the
  whole world, a **dry run** first shows exactly what would happen: new notes, existing notes
  that will be linked, name clashes (your note is left alone and the new one gets a numbered
  name) and anything skipped (archived, in the trash, or claimed by several notes). If a
  linked note already has a section titled like one of the entry's fields, that section
  becomes the field's section where it is: only marker lines are added. Before anything is
  written, a backup of the world is made and every touched note is copied. **Undo** puts it
  all back (new notes go to the trash, linked notes get their exact earlier text) but never
  throws away an edit you made since. **Confirm** (in Import & export) removes the safety
  copy. Otherwise it is removed after 30 days.
- **Backups and world files include your notes and templates.** Restoring never overwrites
  a note. A missing note is written back, an identical one is left alone, and if yours changed
  since, it is kept and the backup's version is saved beside it as "(restored)". Importing a
  world as a copy gives it "(copy)" notes of its own. Type files carry their note template.
- **Everything stays on your device.** No network, no telemetry. Notes work with Obsidian
  Sync or any other sync.
- **Known limits.** Connections, images, maps and layouts show in the note but are changed in
  Worldsmith. Properties are flat, and Obsidian gives each property name one type across the
  whole vault. Renaming a note doesn't rename its entry. Existing parts of a note keep their
  place when a template's order changes, and an empty long field gets its section once it has
  text. If you edit only a link inside one of Worldsmith's parts, it may be rewritten.
- **Safety fixes from review.** Restoring a backup can no longer be undone by a sync that was
  still waiting. Two worlds (a world and its copy) never share a note. Linking a note again
  never overwrites hand edits in Worldsmith's parts: you are asked first. Your own first heading
  in a section is kept. Two trailing spaces (a Markdown line break) survive. A code block left
  open in a long field, or a line that looks like a marker, can't break the note. Renaming a
  field renames its property in the note and keeps an edit you made there. A new, unrelated
  note made where a deleted note was is left alone. Undoing in the editor back to what
  Worldsmith last wrote now counts as an edit.

## 0.16.2 — Banners on entry pages in Modern Codex

- **Entry pages can have banners again in the Modern Codex look.** An entry without a banner
  shows its **Banner** button again, and its menu offers **Add banner…**. Codex used to hide
  that button on every entry, so there was no way to add a banner. Once a banner is set, it
  runs across the top of the entry's header, above the portrait and name, with rounded
  corners. Its own menu changes or removes it. Banners fit in light and dark themes and at
  phone width. The Classic look is unchanged.

## 0.16.1 — Writing Studio fixes

- **"Continue writing" opens the scene in the studio.** On the studio home's "Where you left
  off" card and in Quick actions, it now opens the scene on the Manuscript page, in the
  studio's own editor, with the cursor ready. It no longer opens the note in a normal
  Obsidian tab. **Scene details** opens the same scene with the inspector beside it.
- **The writing settings panel always fits.** It stays inside the window and the pane at
  every width, phone included, from the top bar and from focus mode. Theme, Paper and Dark now
  share the panel's full width, so none of them is cut off. If the window is too short, the
  panel scrolls instead of running off the edge.
- **One colour for the page.** With Paper, Dark or Theme, the whole writing area (the bar
  with the scene's place in the book, the toolbar, the page and the side pane) is now the
  surface colour, edge to edge, as in the original design. There is no darker desk and no
  card edge or shadow any more. The text stays a centred column at the width you chose, with
  the same colours and fonts as before. Focus mode is one colour too. The bar's text and the
  toolbar's icons use the surface's own ink, so they read clearly on Paper in a dark theme.

## 0.16.0 — Writing Studio, part three: plan the story

- **Two new tabs in every project: Story board and Plot.** Your notes are never changed by
  anything here. Everything you plan is kept in Worldsmith.
- **Corkboard.** Every scene as an index card (title, synopsis, status, words and the colours
  of its plot threads), in a column for each chapter. Drag a card to reorder it, or into
  another chapter, even an empty one, and the manuscript follows. Undo is in the message
  that appears. Very long books load as you scroll.
- **Outline.** Parts, chapters and scenes as an indented list you can fold, with the
  synopsis, plot threads, status and words beside each one. Drag a row to reorder it or put it
  in another chapter. Click a synopsis to edit it right there (Enter saves, Esc cancels), and
  click a status to change it.
- **Kanban.** A column for each status. Drag a card to another column to change its status.
  The cards inside a column always stay in reading order, so the kanban never changes the
  order of your book.
- **Timeline.** Give a scene an in-story date (and a time, if you like) in your world's own
  calendars, and see your scenes in story time, with a lane for each plot thread. Scenes
  without a date wait in a tray below: drag one onto a date, or drop a card back on the tray
  to clear its date. The small number on each card is its place in the book.
- **Table.** Every scene in a sortable table (click a column; click again to reverse). You
  can search, show one status, and change the title, synopsis, status, plot threads and date
  right in the table.
- **Plot threads.** Give each project its own threads, each with a name, a colour and a line
  about it. A scene can be in several threads. You'll see their colours on every board. Use
  "All plot threads" at the top of the board to show just one thread.
- **Plot tab.** Choose a structure: Three-act, Save the Cat, Hero's Journey, Seven-point or
  Kishōtenketsu. You'll see its beats, and you can link scenes to each beat, rename beats,
  describe them or add your own. Choosing a structure never changes your chapters or scenes. If
  you want them, "Add empty chapters for these beats" adds new, empty chapters at the end (and
  Undo removes them again). The Plot tab also shows each thread across your chapters.
- **Your own templates.** Save a project's shape (its parts, chapters, scene titles and
  synopses, beats, statuses and plot threads, but never your text) and start new projects
  from it under "Your templates".
- **Your own statuses.** Rename, recolour, reorder and add statuses, choose which count as
  done and which new scenes start with. Removing a status never changes a scene: scenes keep
  it, shown as "No status", unless you choose another status to move them to. Undo puts it
  all back, and you can bring a removed status back later.
- **No drag needed.** Every drag has a keyboard and menu way too: Alt+↑/↓ moves a scene, Alt+←/→
  changes its status on the kanban, and the … button or right-click opens the scene's menu
  (Move to…, Move up/down, status, plot threads, In-story date…). On a phone, press and hold
  a card, then drag; a quick swipe just scrolls.
- **Looks right everywhere**: the Codex and Classic looks, light and dark, Maximum width and
  Full width, and a phone-sized pane.

## 0.15.0 — Writing Studio, part two: write in the studio

- **Write right in the Manuscript.** Choose a scene and it opens on the page, ready to type.
  It is Obsidian's own editor, so everything you're used to still works: Live Preview, your
  hotkeys (Ctrl/Cmd+B, Find, Undo…), spellcheck, and Obsidian saves as you type. The note
  is the same note: open it in a normal tab too and both stay in step.
- **A clean page.** The scene's name sits at the top like a chapter heading; the note's
  file name and properties stay out of the way. Chapters and parts still open their details.
  **Open note** is still there when you want the note in a normal tab.
- **A small toolbar** above the page: heading, bold, italic, list, quote, link (to a note or
  an entry), a scene break (* * *), focus mode, typewriter mode and the layout menu.
- **Focus mode** fills the pane with just the page. Press Esc to come back.
- **Typewriter mode** keeps the line you're writing in the middle, and can fade the other
  paragraphs.
- **Words written this session** show quietly at the bottom of the page, and the word count
  follows your typing. "Saved" only shows once the note really is saved.
- **Choose your page**: Paper (the default), your Theme's colours, or Dark; the width of the
  text, the line height, the text size and the font (a book serif, your theme's font, or one
  you name). Find them under the sliders button at the top of the studio, or in
  Settings › Worldsmith › Writing Studio.
- **Side by side.** Next to the page you can keep the inspector, another scene to write in,
  or the scene's note to read. Drag the divider to resize it. The studio remembers your
  layout for each project, on this device.
- **The inspector** has a Scene tab (status, synopsis, words and target, the note, split,
  merge and move) and a **Notes** tab for your own notes about the scene. Those notes are
  kept in Worldsmith and never written into the scene's note.
- **Picks up where you left off.** Each scene remembers where your cursor and scroll were,
  on this device.
- **If your Obsidian can't do this**, the page says so calmly and opens the scene in a
  normal tab instead. Your text is never put anywhere else.
- **Every Writing Studio page follows** Settings › Worldsmith › Maximum page width, and Full
  width when it's on.

## 0.14.0 — Writing Studio, part one: projects, chapters and scenes

- **Writing Studio** has its own place in the sidebar, right under Tasks. It opens a writing
  space in the Atelier look: an italic running head, small-caps tabs and pages on warm paper.
- **Writing projects**: novels, novellas, short stories, anthologies and scripts. Start one
  from a template (Blank, Three-act novel, Chapters, Short story, Anthology), or **import a
  folder of notes you already have**. Import never moves, renames or changes a note; each
  subfolder can become a chapter, and numbers like "01" are left out of scene names.
- **Your words stay in your notes.** Every scene is an ordinary Markdown note in your vault.
  Worldsmith keeps the order, status, synopsis and word target in its own data, and never
  writes into your notes. If you rename or move a note in Obsidian, the studio follows it.
- **Home** greets you, opens the last scene you worked on as an open book with its first
  lines, and shows every project with its words and goal.
- **Projects** lists them all, with filters by kind, archived projects, rename and archive.
- **Overview** shows the cover, the numbers, a Contents page on paper (parts, chapters and
  every scene) and your draft progress by status.
- **Manuscript**: a Contents list with Roman-numbered chapters. Drag scenes and chapters to
  reorder them, or use Move up/down, Alt+↑/↓ or **Move to…** (which also works on a phone).
  Rename, duplicate, collapse, set a status, write a synopsis, **split** a scene at a paragraph
  or **merge** it with the next. Split and merge never lose text: the original note is only
  trimmed after the new one is safely written, and a merged scene's note is left untouched.
- **Open note** opens a scene's note beside the studio. A note that went missing shows a clear
  message with **Find it again** and **Choose a note**.
- **Trash**: removing a scene keeps its note where it is. Restore brings it back.
- Works on phones: the Contents list slides in as a sheet.

## 0.13.1 — Page headers line up

- **Every page header lines up the same way.** The arch now starts level with the page's
  title on every page, and the description runs the full width (under the buttons too), so a
  longer description no longer pushes the arch out of line.

## 0.13.0 — Modern Codex: a new look

- **A new design.** Names and titles are set in a book serif, labels in small spaced capitals,
  and every page opens with the same running head: an arched mark, the title, a short line
  about the page and a fine rule underneath. The arch is the signature shape: portraits, page
  marks, empty pages and the marker beside the page you're on.
- **Bronze colors**: charcoal and bronze in dark mode, parchment and bronze in light mode.
  Settings › Worldsmith › Colors switches to **Match my Obsidian theme**.
- **The old design is still there**: Settings › Worldsmith › Design › **Classic**.
- **Fonts**: titles use the bundled book serif by default; your theme's fonts or your own are
  still one setting away.
- **You always know where you are**: the top bar shows the path, e.g. *The Ashen Crown /
  Characters / Auron Vale*, and each step is a link.
  On medium-width panes the places in between drop out so the page's own name always fits.
- **One Create button** (the + in the sidebar); the second "New" in the top bar is gone.
- **The sidebar can be resized** by dragging its edge (double-click resets it), and it stays
  hidden if you hid it.
- **World menu**: *Rename & edit this world…* is now there, not only on the Home banner.
- **Entry pages** read like a title page. The Banner button moved onto the banner itself and
  into the ⋯ menu. Empty fields show as a quiet line to write on.
- **The entry menu is grouped**: Organize, Connections, Images and Linked notes open as
  sub-menus, with Move to trash at the bottom.
- **Type pages** name their views (Cards, Gallery, Table, List, Board, Development) on wide
  panes. The "Progress" view is now called "Development", like the block on entry pages.
- **Safer delete dialogs**: Enter no longer deletes; the dialog starts on Cancel, and delete
  buttons are solid red.
- **Phones**: pop-ups open as sheets from the bottom of the screen, with bigger tap targets.
- Map pins: *More icons* opens the searchable icon picker instead of a long list.
- Fixes: the task calendar's **Week** view showed one stack instead of seven days; the task
  list's tools picked up the Timeline's spacing; pickers opened inside a dialog could appear
  unstyled. "Colour" and "color" are now spelled one way (color).

## 0.12.5 — The note window, tested in real Obsidian

- The **Ctrl + hover** window now really opens the note in Obsidian's own editor (the way
  Hover Editor does it): click and type, no pencil. 0.12.4 relied on a part of Obsidian that
  doesn't exist in current versions, so it fell back to the old pencil view.
- The window floats over the whole app instead of being cut off at the edge of the
  Worldsmith pane.
- The **image viewer** hides the close button newer Obsidian adds to every window, so there is
  one X.

## 0.12.4 — Type straight into the note window

- The **Ctrl + hover** window now holds the note itself, in Obsidian's own editor: click and
  type, no pencil and no separate text box. It saves the way Obsidian always does. Works the
  same on Maps, Trees and the Relationship graph.
- **Moving it no longer jumps**: the window follows the pointer exactly (it used to leap up by
  the height of the tab bar).
- **Resize from any edge or corner**, not just the bottom-right.
- The **image viewer** measures where the window's own buttons are and starts below them, so
  its close button is never next to Windows' close button.

## 0.12.3 — A note window you can move, pin, resize and edit

- **Ctrl + hover** on a map pin, tree card or graph node now opens a proper note window. It
  reads top to bottom and scrolls down only (wide images and tables shrink to fit; nothing
  makes the page wider).
- **Pin** it to keep it open, **drag** its title bar to move it, and **resize** it from the
  bottom-right corner (it remembers the size). Several pinned windows can stay open at once.
- **Edit the note** in the window (the pencil). Changes save as you type; the note's
  properties are kept, and if the note was changed somewhere else meanwhile you choose which
  version to keep. A note renamed while you write keeps your text; one deleted while you
  write offers to keep your text as a new note. Nothing you type is lost when you close.
- Entries with **several notes** get a small menu in the window to pick which one to read.
- The full-screen **image viewer** starts below the window buttons on Windows and Linux and
  hides every close button but its own.

## 0.12.2 — Banners everywhere, a clearer peek, one close button

- **Banners on every Tools page**: Search, Timeline, World health, Maps, Trees, the
  Relationship graph, Media and Trash. Maps, Trees and the graph show theirs on the home page
  (an open map, tree or graph is still the whole page). Search has a proper header now.
- **The same Banner menu everywhere**: Tasks, dashboards, type pages, Home and the Tools pages
  get what entry banners have: Change, **Reposition** (drag the image; Done, or Escape to
  put it back), Adjust height & framing, **Compact / Standard / Tall height**, **View full
  size** and Remove (with Undo).
- **Ctrl + hover** cards are larger and scroll, so you can read the whole note (very long
  notes end with a nudge to open them).
- The full-screen **image viewer** shows only its own close button.

## 0.12.1 — Map tools no longer cover the line under the title

- Inside a map, the line under the title (things to look at, the scale) now starts to the
  right of the tools column instead of sliding underneath it.

## 0.12.0 — Maps, Trees and the graph as whole pages, and a polish round

### Maps
- The Maps page keeps its two ways to start (from an image, or blank) on top, with your maps
  as cards below. "These look like maps" is gone, and long names stay inside their card.
- **A map is the whole page**: the canvas fills the pane, with a slim floating bar for the way
  back, the name (click to rename) and a ⋯ menu, tools down the left, Layers and Customize on
  the right.
- **Set scale** (S): click two points you know the distance between, type it, and the whole
  map's scale is worked out. Backspace takes back a point; Undo is offered.
- **Ctrl + hover** (⌘ on a Mac) over a pin, area or route shows its entry: picture, type,
  description, a few facts, the pin's own note and the start of the linked note.
- **Right-click puts a tool down** and goes back to Select (long presses on touch screens
  don't).
- **Delete a map** by right-clicking its card, or from the ⋯ menu inside it. Undo is offered.

### Trees (was "Family trees")
- Renamed **Trees**, since hierarchies live here too (a name you changed yourself is kept).
- A home page in the same style: start a family tree or a hierarchy, and your trees as cards
  with a little picture of each. Trees open as the whole page; titles are no longer cut off.
- **Parents, Children and Spouses** boxes are added once to character types in worlds made
  before 0.11, right before Family, so trees can be filled in from character pages. A type
  that already has a Parent & child field is left as it is.

### Relationship graph
- A home page in the same style (the whole world, or start from one entry; saved views with
  a picture of each), and the graph opens as the whole page, like Obsidian's own.
- Dragging a dot no longer pins it: it settles back in. **Pin entries you move** in Customize
  turns pinning back on; dots already pinned stay where you put them.
- Types to show are a **dropdown** ("All types ▾", "Types: 3 of 8") instead of a row of chips.

### Everywhere
- The **mouse wheel zooms** maps, trees, the graph and the timeline; Shift + wheel or a
  trackpad swipe moves around. At the timeline's zoom limits the page scrolls again.
- A refreshed **Timeline**: a banner with the span of history, pill filters, lanes with type
  marks, a clearer ruler, coloured bars and points, hover cards, and list cards by era.
- **No more jolt** when opening Filter, Name, Group and other toolbar panels.
- **Field settings and Add field** are restyled as settings cards.
- The **calendar widget**'s grid lines line up, with whole weeks and a tidy today marker.
- Customize panels start with an **About** box for a description.

## 0.11.1 — Type Studio and Calendars, refreshed

### Write dates your own way (Studio → Calendars → How dates are written)
- A fifth choice, **Your own**: type a format like *the {day-th} of {month}, {year} {era}* and
  every date in the world is written that way: “the 14th of Seedfall, 312 AC”.
- Click a part to drop it in where the cursor is: weekday, day, **14th**, **fourteenth**,
  month, short month, month number, year, **year in Roman numerals**, era, era name. Each
  chip shows what it looks like in your calendar.
- **Ideas to start from**, shown in your calendar's own words, a live preview as you type,
  and gentle warnings when a format has no year, day or era.
- Month-only and year-only dates are worked out for you (“Seedfall, 312 AC”), or write
  your own. Festival days, dates with no weekday or no era all come out tidy.
- Spreadsheets exported and imported in your format read back correctly. Switching to a built-in style keeps
  your format for later. Nothing about the dates themselves changes.

### A refreshed Calendars page
- A showcase at the top with a date in your calendar's words and what the calendar is made
  of, and a bar to jump to any part of the page.
- Every part is a card in the same style as Type Studio's settings. Year at a glance shows
  weekday initials and day numbers; Months has a ribbon of the whole year with festivals in
  place; festivals say when they fall in plain words; date styles are picture cards.

### Type Studio
- **Display**, **Fields** and **Checklist** now match the Settings tab. Display shows how the
  line under the name and the card facts read on a real entry. Fields opens with an overview
  (how many fields, sections, which count toward progress) and clearer section headers.
  Checklist says whether your existing entries are up to date, with one click to catch up.

## 0.11.0 — Family trees, the relationship graph and maps (Milestone 10, part 2)

### Family trees (Tools → Family trees)
- Draw a **family tree around anyone**: parents, grandparents and further back above, children
  and grandchildren below, with partners side by side and brothers and sisters alongside.
  Half-siblings, second marriages, cousin marriages and loops are drawn without getting lost.
- Build it **from the tree itself**: hover a card to add a parent, child, partner or sibling
  (pick an existing entry or make a new one), or right-click to remove a family link. Every
  change has Undo, and the links are ordinary connections you can see on the entry.
- Characters have new **Parents**, **Children** and **Spouses** fields, backed by two new kinds
  of connection, *Parent & child* and *Marriage*.
- **Hierarchies** too: a kingdom and its provinces, an order and its ranks, anything nested
  inside something else. Fold branches shut, drag an entry onto another to move it inside.
- Customize everything: grow down, up or sideways; portrait, compact or name-only cards; colour
  by type, status or generation; curved, square or straight lines; a plain, dotted, grid or
  parchment background; which details each card shows; how many generations; and which kinds
  of connection count as parents and partners.

### Relationship graph (Tools → Relationship graph)
- **Everything and how it's connected**, as a living web you can drag around. Entries settle by
  themselves; drag one to pin it in place.
- **Centre on one entry** and choose how many steps away to show, or filter by type (Alt-click
  for just that type), by kind of connection and by tag. Save as many views as you like
  (“Around Mara”, “The courts”).
- Click an entry for a **spotlight** of its connections in plain words (“Mentor of…”), with
  Open and Centre here. Right-click for more.
- Each kind of connection has **its own colour** (marriages pink, rivalries orange…), with a
  legend you can click to filter.
- Customize: names always, on hover or never; colour by type or status; spacing from snug to
  airy; background; pictures on the dots; bigger dots for well-connected entries; connection
  names; unconnected entries; secret connections; and what's inside what.

### Maps (Tools → Maps)
- Make a map **from any image** in your vault (Worldsmith suggests ones named like maps) or
  start on **blank parchment**, sea, night sky or plain paper.
- Drop **pins** and say what's there (link an entry, or just name it), draw **areas**
  (kingdoms, forests, seas) and **routes** (roads, rivers, journeys) with a click per corner.
  Drag anything to move it, drag corners to reshape.
- Pins can open **a map inside a map**: click the city on the kingdom map to open the city map,
  then go back up.
- **Layers** you can show, hide, rename and colour (“Trade routes”, “Before the war”).
- **Measure** distances and areas once you set the scale (“the map is 1,200 leagues across”).
- Undo and Redo (Ctrl/Cmd+Z) for every change, keyboard shortcuts for every tool (V, P, A, R, M),
  and a find menu to jump to anything on the map.
- Customize: colours, icons, sizes, line styles, arrows, notes on every item; the map's shape
  and backdrop; a compass rose; a square or hex grid; when names show (always, up close, on
  hover); pin size; a scale bar; and which entry the map shows.
- Map images are tracked in the Media library, so renaming or moving the file keeps the map.

### Everywhere else
- Three **new widgets** for entry pages and dashboards: *Family tree*, *Connection map* and
  *Map* (on an entry, the map it's on, zoomed to its pin, with “Also on…” links). Each comes in
  three heights.
- The **entry menu** (⋯) gains *See connections*, *Family tree* and *Show on map*.
- **World health** has an eleventh check: map pins and areas linked to entries that are gone or
  in the trash, with fixes to restore the entry or open the map.
- Fixed: after switching between trees, timelines or health pages quickly, the page title could
  show the previous page's name.

## 0.10.0 — Calendars, timeline and world health (Milestone 10, part 1)

### Calendars (Studio → Calendars)
- Give your world **its own calendar**: start from *Twelve moons*, *Earth-like* (with a leap
  day), *Thirteen moons* or *Just years and eras*, then rename everything. Dates you already
  wrote stay exactly as they are.
- **Months** with their own lengths and short names, a **week** with your own day names,
  **days outside the months** (festivals, holy days, leap days every few years) and **eras**
  that count up or back (“312 AC”, “40 BC”), each with a colour.
- Choose **how dates are written** (“12 Frostmoon 312”, “Frostmoon 12, 312”, “312, Frostmoon
  12” or “12/11/312”), optionally with the weekday. A **year at a glance** shows every month.
- Several calendars per world: one is the main one, the others are lined up with it, so a
  date in the elven reckoning sits in the right place on the timeline.
- **Date fields use the calendar**: pick the day, month (or festival) and era, or choose the
  day from a small month grid. Spreadsheets export and import dates in the calendar's words.
- Removing a calendar never changes a date (Undo brings it back). Moving a month moves the
  dates in it too, and a month that dates use can't be removed.

### Timeline (Tools → Timeline)
- Every dated entry on one line, in **lanes by type**: single dates are points, entries with
  an end (lives, wars, reigns) are bars. **Eras** (your Era entries and the calendar's eras)
  are bands across the top.
- Zoom (buttons or Ctrl/Cmd + scroll), fit everything, filter by **type** and **tag** (saved
  with the world), or switch to a **list** in order, grouped by era — the list is what phones
  show. Click anything to open it.
- Start and end dates are found by their names (Start/End, Birth/Death, Founded…).
- A **Timeline widget** for dashboards, and for entry pages, where it shows that entry and
  everything connected to it.

### World health (Tools → World health)
- A **health score** and ten checks: missing images, missing notes, broken connections, dates
  that disagree (a death before a birth), missing key details, possible duplicates, entries
  with no connections, empty types, unused data and unused images.
- Each finding has a **fix** that never deletes anything — swap the dates, restore an entry
  from the trash, unlink a missing note, relink images, hide an empty type — with Undo, or a
  link to where it's fixed. Anything can be **ignored** (and brought back).
- A **World health widget** for Home and dashboards.

### Fixes and improvements
- **Layout Studio**: picking a layout no longer flickers or makes the page jump; the desktop
  preview fills the frame (and follows *Full width*); the phone preview now lays out like a
  real phone.
- **Your own layout presets** in Layout Studio: save the layout you're previewing under a
  name, icon and description, use it on any type, and rename, update, duplicate or delete it
  (with Undo).
- **Banners on the Tasks page, dashboards and type pages**, with the same choices as entry
  banners (change, reposition, height, remove with Undo).
- **Several notes per entry**: link or create as many notes as you like; the Notes widget
  lists them all with a preview, one is the main note, and renames are followed.
- The Tasks **notes** widget grows with its text and can no longer be dragged off the page.
- Choice chips no longer cut off letters like “g” and “y”.
- **Type Studio → Settings** is laid out in tidy cards with aligned rows.

## 0.9.0 — Studios (Milestone 9)

### New types
- **Start from** ten ready-made types — Vehicles & ships, Spells & rituals, Plants & herbs,
  Quests & plot threads, Prophecies, Houses & bloodlines, Curses & diseases, Currencies &
  goods, Titles & ranks, Holidays & festivals — each with fields, sections, cards and a
  checklist, or a blank type. The dialog shows what each comes with, and suggests a plural
  (“Hero” → “Heroes”).
- **Copy a field to another type** from a field's ⋯ menu in Type Studio (with Undo).
- **Duplicate** keeps the type's page layout; **Export type…** saves it as a file.

### Layout Studio (Studio → Layout Studio)
- Ready-made layouts for any type: **Standard**, **Profile** (a portrait column), **Encyclopedia**
  (one long article with a fact column), **Visual** (pictures first) and **One column** —
  built from the type's own fields, and every one shows every section.
- A **live preview** on one of your entries (the fullest one first), as a wide window or a
  phone. Nothing changes until **Use this layout**, which has Undo; replacing a layout you
  arranged yourself asks first.
- **Copy another type's layout**: widgets that name its sections or fields switch to this
  type's.
- **Pages with a layout of their own**, each with *Use the type layout*, or all at once.
- Type Studio → Page layout links here (*Presets & preview*).

### Import & export (Studio → Import & export, or Settings)
- **World files**: export a whole world into your vault (`Worldsmith/Exports`), and import one
  from your vault or your device. A world that's already here is added as a separate copy —
  your world is never overwritten.
- **Type files**: export the types you choose and import them into another world; a type with
  the same name is added as a copy or skipped. Undo removes what was added.
- **Spreadsheets (CSV)**: import rows as entries — columns are matched to fields by name, you
  see what will happen first (new, updated, skipped, problems), choose whether matching names
  are skipped, updated or added again, and can undo. Empty cells never clear anything; rows can
  link to each other and to existing entries; new choices can be added. Files from Excel on
  Windows (non-UTF-8) and semicolon-separated files work.
- **Export as CSV** from any type, or from a view's tab menu (its entries, in its order) —
  ready to edit and import again without losing dates, links or images.
- **Markdown notes**: write entries out as notes with properties, summary, sections, images
  and [[links]] between them. Writing again updates them — but a note you've edited, or a note
  of your own with the same name, is never touched.

### Fixes
- Type Studio and Relationships now stack properly on narrow panes and phones.

## 0.8.1 — Polish

### Fixes
- **Group by** no longer opens a menu taller than the screen: a compact panel with sections,
  search and arrow keys. Free-text lists (Nicknames, Scars…) aren't offered any more. *Add a
  filter* and *Add a sort* use the same panel.
- The **"Worldsmith navigation"** label (and labels over cards and whole areas) no longer
  pops up wherever you point. New **Settings → Hover tooltips** turns hover labels off.
- **Banner framing**: the adjust dialog now frames the image at the banner's real width, so
  what you set is what the page shows.
- **Gallery framing**: switching from *Show whole image* back to *Fill the frame* works again
  (it used to stay stuck), and *Reset* resets it too.
- **Contents**: the whole row is the link, so hovering and clicking land where you point.

### New and redesigned
- **Contents** on Home: a row per type with its icon, count and how developed it is.
- **Taller widgets**: drag a widget's bottom edge while customizing (double-click to fit its
  content again; ⋯ → Taller / Shorter / Fit content).
- **All tasks**: quick views (Up next, Overdue, This week, No date, Done, All), grouped by entry
  with each entry's progress, a few tasks per group with *Show more*, search, type filter,
  grouping by entry, type, due date, priority, status or category.
- **Media**: saved views as tabs — Wall, Cards or Table, sizes, filters, sorting, grouping —
  with ready-made starting points (Portraits, Banners, Galleries, Not used yet, Missing, By
  folder). *Not used yet* shows vault images no entry uses.
- **Relationships**: searchable list (All / Linked / Yours), and each kind shows a picture of
  how it reads from both sides with real examples, then what it connects, its own details and
  where it's used. **Type Studio** matches it.
- **Number tiles**: hide the small detail line ("1 type", "+3 this month") for a whole Stats
  row, a single tile, or a Number widget.
- **Smoother motion**: cards lift, pictures drift closer, buttons press, sidebar icons lean in,
  pages and panels ease in — lighter on your machine than before, no hover effects on touch
  screens, and off with *Animations* or your system's reduced-motion setting.

## 0.8.0 — Database views (Milestone 8)

### Saved views
- Every type's database now has **views** as tabs above the list: *All characters* to start,
  then as many as you like (**+ View**). Each remembers its layout, filters, sorting,
  grouping and fields, and syncs with your vault.
- Double-click a tab to rename it; its menu (the arrow, right-click, or ↓ on the keyboard)
  can duplicate, move, delete (with Undo) or **show it on a dashboard**.

### Six layouts
- **Cards**, **Gallery** (big portraits), **Table**, **List**, **Board** and **Progress**.
- **Table:** click a heading to sort, right-click it to move, hide, filter or group by that
  column; drag a heading's edge to resize. Click a cell (or focus it and press Enter) to
  edit it right there — the field's own editor, saved as you type.
- **Board:** a column per status, or per option of any single-choice field (Importance,
  Story role…). Drag cards between columns, or use a card's ⋯ → *Move to*. **+** creates
  an entry straight into a column.
- **Progress:** how developed each entry is, how many of its tasks are done, the next open
  tasks (tick them off right there or open them), and which key details are still missing —
  least developed first. A summary across the view shows the average, tasks done, anything
  overdue and how many are complete. Group it (by Importance, say) for an average per group.

### Filters, sorting, grouping, fields
- **Filter** on any field or on status, tags, portrait, favourites, development,
  connections, created and last-edited dates — matching **all** or **any** of them. Active
  filters show as chips you can click or remove.
- **Sort** by several things (the next breaks ties); empty values always go last.
- **Group** by status, tags, or a choice, yes/no, list or linked-entry field (Species, Homeland…), and fold groups away.
- **Columns / Fields** chooses what each card or row shows, in what order, and card image
  and size.

### Dashboards
- An *Entry list* widget can show any saved view and follows it as the view changes; its
  title links to the view.

### Fixes and polish
- Long databases draw as you scroll and keep their place when something changes.
- Menus and panels open from the keyboard and keep focus as you change them.

## 0.7.0 — Home and dashboards (Milestone 7)

### Home is now your hub
- A new default Home: the world banner, a row of numbers (entries, characters, places, how
  developed the world is), the contents, recent work, a **daily spotlight** on an entry you
  haven't touched in a while, a line **from the archives**, what's due soon and what needs
  attention.
- **Customize Home** with the layout button on its banner — drag, resize, settings, Undo
  (Ctrl/Cmd+Z), Reset and Done, just like entry pages.

### Dashboards
- Make more pages like Home: **New dashboard** (the + beside *Dashboards* in the sidebar, or
  the command) with a name, icon, colour and a starting point — **Blank**, **Cast**,
  **Politics**, **Session prep** or a **copy of Home**. Templates only use types your world has.
- They're listed in the sidebar under **Dashboard** (one) or **Dashboards** (more).
  Right-click one to rename, recolour, duplicate, move or delete it (with Undo).
- Don't need them? **Settings → Sidebar → Dashboards** hides the section; your dashboards
  are kept.

### New widgets
- **Build your own:** *Entry list* (any entries — by type, status, tags, favourites, or a
  condition on a field like "Influence is National" — as a list, cards, a sortable table or a
  portrait wall), *Number* (how many, total, average, smallest/largest, % filled in, or how
  developed), *Chart* (bars or a donut by status, type, tag or any choice field), *Entry card*
  (one entry, large), *Links* (entries, notes, Worldsmith pages and websites).
- **Overview:** *Search box*, *Development by type*, *Needs attention* (missing summaries and
  portraits, broken images, unused data, unconnected or long-untouched entries).
- **Activity:** *Recent work* now shows recently created too; *New connections*.
- **Discovery:** *Spotlight*, *From the archives*, *Image wall*.
- **Tasks:** the Tasks page's widgets can go on any dashboard.
- Widget settings now adapt as you choose: pick a type and its fields appear; change the
  type and settings that belonged to the old one are cleared.

### Fixes and polish
- Number tiles sit two-up on phones instead of one long column.
- Undoing a layout reset no longer overwrites changes made after the reset.
- Background tabs don't recalculate their widgets while you type elsewhere.

## 0.6.0 — Customizable pages (Milestone 6)

### Customize any entry page
- **Open Customize** with the new layout button beside an entry's name, from the ⋯ menu
  (*Customize this page…*), or with the command *Customize this page’s layout*.
- **Choose who it applies to** in the bar at the top:
  - **All Characters** (or any type) — every page of the type changes together.
  - **Only Auron** — this entry gets a layout of its own; the others keep the type's.
- Drag widgets by their handle, drag the right edge to resize, use ⋯ for *Move up/down,
  Wider, Narrower, Full width*, the gear for **settings**, × to remove. Add widgets from
  the panel on the right — grouped into Basics, Showcase, Connections and Writing, with
  search.
- **Undo** (button or Ctrl/Cmd+Z) steps back through every change; **Reset** returns a type
  to Worldsmith's default, or an entry to its type's layout — with Undo on the notice.
  **Done** or Escape finishes. Everything saves as you go.
- Layouts are saved with your world (one small file per customized type or entry), so they
  sync. Duplicating an entry copies its layout; new fields and sections still appear on
  every page automatically.

### Type Studio → Page layout
- A miniature of the type's page, a button to edit it on any of your entries, *Reset to
  default*, and the list of entries with a layout of their own (open them, or switch them
  back to the type's layout).

### New widgets
- **Showcase** — *Key facts* (up to six fields as large tiles), *Quote* (a text field as a
  pull quote), *Stat block* (numbers, percentages and ratings as bars), *Image spotlight*
  (portrait, banner, a gallery image or an image field, shown large), *Single field* (one
  field in its own card, editable), *Heading & divider* (`{name}` becomes the entry's name).
- **Connections** — *Relationship web* (this entry in the middle, its connections around
  it; rivalries in red, secret ones dashed; turns into chips on narrow screens), *Roster
  table* (members, students… as a sortable table with the columns you choose), *Shared
  connections* (who's two steps away, and through whom), *Note backlinks* (notes in your
  vault that link to this entry or its linked note, with excerpts).
- **Writing** — *Embedded note*: the linked note (or any note) rendered right on the page,
  with a height you choose and *Show all*.
- **Details** settings: choose which sections a Details widget shows (including *Other*),
  its layout and columns.
- A title you give any widget now stays, instead of being replaced by its own (e.g.
  "Connections · 8").

### Fixes and polish
- On phones, the entry name no longer leaves a large gap below it, and wide tables scroll
  inside their card instead of pushing the page sideways.
- Clearing a widget setting sticks (e.g. a heading with no text) instead of the default
  coming back.
- Deleting a type keeps its page layout, so undoing the delete brings the page back.

## 0.5.3 — Tidy grid, and a layout for every page

### Details panel
- **Tidy grid is the default again**, refined: two even columns in every section, a
  hairline **divider between the columns** that fades in and out around full-width
  fields, small uppercase labels, dimmer labels on empty fields so filled facts stand
  out, and the label of the field you're editing lights up in your accent colour.
- **Choose the layout where you want it** with the new switch on the Details panel:
  - **This page** — e.g. only Auron uses the list layout.
  - **All of a type** — e.g. every Character uses the grid.
  - **Default for every type** — also in Settings → Appearance → *Details layout*.
  A page's choice beats its type's, and a type's beats the default. *Follow …* items in
  the menu undo a choice; the reset button in Settings clears them all.
- The list layout (label beside value) from 0.5.1 is still there for anyone who prefers it.

## 0.5.2 — Fix

- **"Fewer fields" works again.** In the new list layout, collapsing a section's extra
  fields left them open. They now hide again (in both list and grid layouts).

## 0.5.1 — Cleaner details and tables

### Details panel
- **New list layout** (the default): every field is one line — its label on the left, the
  value beside it — with faint dividers, so a page reads like a tidy fact sheet.
- **One empty state**: blank fields simply say "Empty". The specific hint ("Choose…",
  "Type and press Enter", "Link nation…") appears when you hover or click the field.
- **One alignment line**: text, choices, links and list items now all start at the same
  edge.
- Each section shows a slim progress bar with its count right beside the title.
- Prefer labels above values? The Details block's settings (Customize) offer *Grid —
  label above each value*, which now uses the same two columns in every section.

### Database tables
- Column headings line up with their columns in every theme (some themes centred them).
- The Name column takes the spare width; the other columns size to their content.

### Smaller fixes
- The full-screen image viewer has a darker backdrop.
- On phones, the image picker folds its folder and sort menus into one *Filter* button.
- The gallery's picker title is simply "Add images to the gallery".
- Rows of content inside buttons (the Development block's "Next up", sidebar items, Type
  Studio lists…) stay left-aligned in themes that centre button contents.

## 0.5.0 — Milestone 5: Media

### Choosing images
- **New image browser** everywhere you pick an image: a grid of thumbnails with search,
  a folder filter, sorting, and tabs for *Used in this world* / *Not used yet*. Each image
  shows where it's already used. The current image is highlighted. Arrow keys move
  through the grid.
- **Add images from outside your vault**: *Upload*, paste (Ctrl/Cmd+V), drag files in from
  your computer, or *From link* to download an image from the web. They're copied into
  *Worldsmith/Images* (change it in Settings → Images, or use Obsidian's attachment folder).
- **Drag and drop** onto an entry's portrait, its header (banner), a gallery, an image
  field or the world banner. Files dragged from Obsidian's file explorer are used where
  they are.

### Portraits & banners
- **Adjust framing**: click or drag on the image to choose what stays in view, zoom up to
  400%, switch between filling the frame and showing the whole image, and see live
  previews of the entry page, card and list views. The frame's crop is outlined on the
  image. *Cancel* puts everything back.
- **Banners**: height presets plus a slider (100–480 px), framing, and *Reposition*
  directly on the page — now in both directions, with arrow keys too.
- Removing a portrait or banner can be undone. *View full size* opens the viewer.
- The entry ⋯ menu (and right-click on cards) has *Add/Change portrait…* and
  *Add/Change banner…*.
- The world banner on Home gets the same tools: change, adjust height and framing, remove,
  or drop an image on it.

### Galleries
- Rebuilt **Gallery** block: grid, masonry or filmstrip layouts; square, landscape,
  portrait or original tile shapes; fill or show whole images; optional limit with "+N".
- Add several images at once, drag tiles to reorder (or Alt+←/→), Delete to remove (with
  Undo), captions, *Adjust framing*, *Use as portrait*, *Use as banner*.
- **Viewer**: full-screen, ←/→ to move, edit captions in place, open in Obsidian.
- **Gallery** and **Image** fields (e.g. Locations → Maps) use the same tools.

### Media library
- New **Media** page under Tools: every image the world uses, filtered by portraits,
  banners, galleries or fields, with the entries using each one.
- **Renames are followed**: move or rename an image (or a folder of them) in Obsidian and
  every portrait, banner, gallery and field follows, keeping its framing.
- **Missing images** are never removed from your entries. The Media page flags them, finds
  files with the same name elsewhere in your vault, and relinks them in one click — or
  pick a replacement yourself. *Replace everywhere…* swaps an image across the world.
- New commands: *Open media library*, *Find missing images*.

## 0.4.0 — Milestone 4: Tasks

### Tasks home
- New **Tasks** page right under *Home* in the sidebar. The sidebar badge counts open
  tasks due within a week (overdue included).
- **Stat tiles** — Open, Due this week, Overdue, Done this month (vs last month) and World
  developed. Click a tile's gear in Customize to change what it counts: status, due
  window, types, minimum priority, period, comparison, colour, icon, progress ring. Add as
  many as you like.
- **Calendar** with real-world dates — Month, Week and Agenda views; drag a task onto
  another day to reschedule; click a day to add a task due then; "+N more" opens the day;
  colour by type, status or priority; choose Monday or Sunday weeks.
- **Widgets** — All tasks (status tabs, filter, sort, group), Board (columns by status,
  drag between them), Due soon, Overdue, Recently completed, Progress by type, Needs attention,
  Focus entries, Chart (per week, by type, by status) and Notes.

### Customize
- **Customize** turns on editing: drag widgets to rearrange (drop on a side to put two
  side by side), drag the right edge to resize, use the ⋯ menu (move, wider, narrower,
  full width), open a widget's settings, remove it, or add one from the *Add a widget*
  drawer. *Reset layout* restores the default. The layout is saved in the world, so it
  syncs between devices.

### Tasks
- Every entry gets a **Checklist** block from its type's default tasks. Entries created
  before 0.4 get theirs automatically the first time the world opens.
- Quick-add, tick off (with Undo for deletions), and open any task for details: status
  (Open, In progress, Blocked, Done), priority, due date with a picker and quick picks
  (Today, Tomorrow, Next week), repeat (daily, weekly, monthly, yearly — completing it
  schedules the next), category, optional, notes, and moving it to another entry.
- Tasks without an entry are fine too (*New task* on the Tasks page, or the
  *New task* command).
- **Type Studio → Checklist** can add newly added default tasks to existing entries.

### Development progress
- Progress rings and bars now count tasks **and** key fields by default. Choose *Tasks and
  key fields*, *Only tasks* or *Only key fields* (and whether optional tasks count) in the
  Tasks page's ⋯ menu.

### Under the hood
- Tasks are stored in `tasks/<shard>.json` inside the world folder, grouped by entry.
- A generic layout editor (the start of Milestone 6) powers Customize.
- New commands: *Open Tasks*, *New task…*.

## 0.3.0 — Milestone 3: Relations

### Linking entries
- **Relation fields work.** Species, Homeland, Affiliations, Mentors, Members, Capital,
  Deities… across all 17 built-in types (~80 fields) now link to real entries.
- **Inline picker** — click *Link…*, type to search, ↑/↓ and Enter to pick, or choose
  *Create “…”* to make the entry on the spot.
- **Both sides, always.** A link is one connection read from both ends: add Auron to the
  Night Guard's *Members* and his *Affiliations* show the Night Guard.
- Single-link fields (Species, Homeland…) replace their link when you pick another, with
  Undo. Removing a link offers Undo too.
- Linked chips show portraits, open on click (Ctrl/Cmd-click for a new tab) and have a
  menu with *Connection details*. Secret connections are dashed; ended ones faded.
- **Parent entry** and **Nested entries** field kinds edit the hierarchy inline.

### Connections
- New **Connections** block on every entry page: all connections grouped by kind,
  including ones made from the other entry (backlinks). It leaves out what the fields above
  already show — *Show all* lists everything.
- **Add connection** (block header, or the entry's ⋯ menu) connects any two entries with
  any kind of relationship, no field needed.

### Connection pages
- Every connection has its own page: both entries and how each lists the other, plus
  status, strength, secret, began/ended dates, a one-line summary (shown on both entries),
  Markdown notes and the relationship's custom properties.
- *Swap direction*, *Change relationship* and *Remove* (with Undo) keep all details.

### Relationships (Studio)
- New **Studio → Relationships** page with 45 built-in kinds of connection in eight
  categories. Rename how each side reads ("Students" / "Mentors"), make one go both ways,
  set which kinds of entries it usually connects, and add custom properties.
- Create your own relationships; delete ones nothing uses.

### Rollups
- **Rollup** fields summarise linked entries: count, list, unique values, sum, average,
  smallest, largest, earliest or latest date. They update live and appear on cards,
  tables and subtitles.

### Type Studio
- Relation fields: choose what they link to, one or many, which relationship, and which
  side they show. New relation fields get their own relationship automatically.
- Rollup fields: choose the linked entries, the calculation and the field.
- Field rows describe links ("Links to Characters · appears as Mentors").

### Also
- Linked fields count toward development (a linked Species counts as filled) and can be
  used in subtitles, cards and table columns.
- Deleting an entry permanently also removes its connections; the warning says how many.
  Trashing keeps them. Duplicating an entry copies its connections.
- Deleting a relation field keeps its connections (they stay under Connections).
- Existing worlds get the built-in relationships automatically on first open.
- Extension API 0.2.0: `registerRelationType(template)`.

## 0.2.1 — Card fixes

- **Fixed:** the status dot on database cards ("Idea", "Draft"…) had its halo cut off.
- **Fixed:** in vaults with certain themes, CSS snippets or other plugins, database cards
  could lose their frame (the card collapsed to a thin box with its content spilling
  out). Cards now pin their own size, spacing, border and background so outside CSS
  can't collapse them.
- **New command:** *Diagnose display problems (style report)* lists every rule from your
  theme, snippets and other plugins that styles Worldsmith, plus how the card actually
  rendered, with a Copy button — useful when something looks different in one vault.

## 0.2.0 — Milestone 2: Field engine & Type Studio

### Data folder (Obsidian Sync)
- The default data folder is now **`_worldsmith/`** (no leading dot), so Obsidian Sync
  includes it. Enable **Sync → Other file types** so the `.json` files sync.
- An existing `.worldsmith/` folder is moved automatically on first start. The move is
  non-destructive (rename, or verified copy that keeps the original) and never writes into
  a non-empty folder; if it can't complete, the old folder stays in use.
- **Settings → Data folder** can now *Move here* (moves your data and switches) or *Use
  existing* (switches to a folder that already has Worldsmith data), live, without reload.
- Settings are versioned (`settingsVersion: 2`).

### Type Studio
- New **Type Studio** page (sidebar → Studio, the *Edit type* button on every database,
  the entity ⋯ menu, or the *Open Type Studio* command). New types open in it.
- **Fields:** section cards and field rows; inline rename; drag-and-drop, Alt+↑/↓ or menu
  to reorder and move between sections; add fields from a grouped gallery of field kinds.
- **Field settings:** name, kind, description, kind-specific settings (min/max/unit,
  rating size…) rendered by the kind itself, width, placeholder, required / counts toward
  development / tuck under "More fields" / hidden, default value, copyable field ID.
- **Choices editor:** add with Enter, rename inline, recolor, drag to reorder, usage
  count per choice, delete with "replace with…" for entries that use it.
- **Changing a field's kind** shows how many values convert (with examples of those that
  won't) before applying. Choices ↔ text, numbers ↔ text and more convert automatically;
  converting to a choice kind builds the choices from existing values.
- **Sections:** add, rename, change icon, reorder, start collapsed, delete (fields move to
  another section — no data changes).
- **Display:** choose subtitle and card fields with a live card preview of a real entry.
- **Checklist:** edit the default development tasks per type (title, category, priority,
  optional, order).
- **Type settings:** names, description, icon, color, sidebar group, nesting rules,
  duplicate, archive, delete (only when the type has no entries).
- **Undo** for every schema edit (button, Ctrl/Cmd+Z, and Undo in notices).

### Your data survives schema changes
- Schema edits are validated before saving; invalid edits are rejected with a readable
  message and nothing is written.
- Values of deleted fields, and values that can't convert to a new kind, are kept on each
  entry as **Unused data**. A new *Unused data* block on entity pages lets you restore them
  (re-creating a deleted field — same ID, settings and section — restores every entry at
  once), copy them, or discard them (with undo). The block hides itself when empty.

### Entity pages
- Section headers offer *Add a field here* and *Edit in Type Studio* on hover.
- Each field has a ⋯ menu (also on right-click): edit field, open in Type Studio, clear
  value, tuck under More fields, hide on every entry, delete field.
- "Next up" lists required fields first, marked *Required*.
- Sections added in Type Studio now always appear on character pages.

### Fixes
- Toggles, segmented controls and field editors render correctly inside dialogs.
- Escape closes dialogs even while typing in the "add choice" box.

## 0.1.1 — Fix blank Worldsmith pane

- **Fixed:** opening Worldsmith showed an empty tab. Two causes, both in the host view:
  - `getIcon()`/`getDisplayText()` used fields that weren't assigned yet when Obsidian's
    view base constructor calls them, so view creation threw.
  - A `titleEl` field on the view overwrote Obsidian's own `ItemView.titleEl` with `null`,
    so the tab-header refresh during opening threw.
- View state now lives in ES-private `#fields`, which can never collide with Obsidian
  internals; collision-prone fields on modals were renamed too.
- Error boundary: if drawing a page ever fails, the pane shows the error and a stack trace
  with a **Try again** button instead of going blank.
- Storage start is idempotent and triggered by opening a view, so the UI can't wait on a
  start that never happened; the shell initialises its children even if Obsidian loads the
  view after `onOpen`.
- The browser harness now mimics these Obsidian behaviours (early metadata calls, internal
  header elements, header refresh on open, `onOpen` before `load`); it reproduces the 0.1.0
  bug and passes on 0.1.1.

## 0.1.0 — Milestone 0 + 1: Architecture & foundation

### Architecture
- Layered design (storage → repositories → services → UI) with a composition root;
  `main.ts` handles lifecycle only.
- Generic `Registry<T>` behind every extension point: field types, blocks, entity type
  templates, routes. Built-ins register through the public `WorldsmithAPI`.
- Typed `EventBus` with exact change keys (`name`, `values.age`…) for fine-grained UI updates.
- ARCHITECTURE.md and DATA_MODEL.md.

### Storage
- JSON in a vault data folder (default `.worldsmith/`) via `DataAdapter` (mobile-safe).
- `BucketStore`: one store implementation for every collection; per-entity files; debounced,
  coalesced writes (200 rapid edits → ≤ 4 writes in tests).
- Atomic writes (tmp → verify → swap), recovery from interrupted writes, `.bak` rotation for
  singletons, quarantine for unreadable files (never deleted).
- Storage migration runner (backup first, resumable) and record-level migrations with
  normalization of missing/invalid data.
- Multiple worlds in the manifest; world backups, restore and import.

### Data & services
- UUID identities; 17 built-in type schemas with sections, fields, display fields,
  hierarchy rules and default development tasks.
- Custom entity types, first-class (built-ins are seeded as ordinary schema data).
- 26 field types (logic + editors); relation/rollup/formula types declared for Milestone 3.
- Entity lifecycle: create with defaults, validated field writes, favorite, pin, archive,
  trash/restore, duplicate, permanent delete with child re-parenting.
- Incremental `EntityIndex` and `SearchService` (names, aliases, tags, content).
- Linked notes that follow renames/deletes in the vault.

### UI
- App shell in a single `ItemView`: routed pages joined to Obsidian's back/forward history,
  restorable panes, open in new tab/split.
- Sidebar with world switcher, live counts, collapsible groups, hide/reorder.
- First-run onboarding and import.
- Layout engine (grid model + guillotine renderer) and block registry; entity pages and the
  dashboard are block layouts.
- Blocks: hero, summary, properties, development, names & tags, linked note, nested entries,
  gallery, world banner, contents, recent, favorites, quick create.
- Database page: cards / table / list, search, sort, filter, incremental rendering.
- Search page, quick switcher, trash page; context menus; undoable trash notices.
- Settings: appearance (density, fonts, width, motion, card image), linked-note folder, data
  folder, backups/restore, reload from disk.
- Scoped, theme-derived CSS; responsive to pane width (wide / medium / narrow drawer).

### Testing
- 28 headless tests; browser harness with an Obsidian shim and Playwright UI checks across
  two themes and three widths.
