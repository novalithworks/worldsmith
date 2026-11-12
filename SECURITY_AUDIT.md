# Worldsmith security, privacy & code-safety audit (Milestone 5)

Audited version: 0.20.1 → fixes in **0.20.2**. Date: 17 October 2026. Method: reading the
source, targeted searches across `src/`, unit tests, browser tests against an in-memory stand-in
for Obsidian (`harness/`). **Not** done here: testing inside real Obsidian (done separately by the author),
mobile devices, `npm audit` (no internet access during the audit), the full TypeScript check against
the real `obsidian` type package (not available during the audit).

**Result: CONDITIONAL PASS.** No known critical or high-severity problem remains; specific
lower-severity items and verification gaps are listed below. This describes this review only;
it does not establish that Worldsmith is completely secure or ready for release.

## 1. Areas reviewed

Plugin start-up and unload; vault reads/writes/deletes/renames; native-note sync; adopted
notes; entity, Type Studio and Layout Studio editing; note templates and their CSS; dashboards
and widgets; relations; maps and media (including URL image import); Writing Studio; CSV, type
file, Markdown-notes and world-archive import/export; older JSON world files; backups, restore,
deleted worlds; migrations; settings; the build (`esbuild.config.mjs`), `package.json`, the
bundled output and the embedded font.

## 2. Findings

| ID | Sev. | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| S1 | **P1** | URL field rendered any stored value as `<a href>` and its Open button called `window.open(value)` unchecked: `javascript:`, `file:`, `data:` values (possible from imported worlds, CSV, synced note Properties) became clickable. | `src/fields/ui/textual.ts` (`urlUI`) | **Fixed**: both use `safeUrl` (http, https, mailto, obsidian only); unsafe values show as plain text; `rel="noopener noreferrer"`. Tests: `security.test.ts`, `harness/security.mjs`. |
| S2 | P2 | Re-export privacy: a note picked in a *file* field (e.g. a crafted world pointing at `Private/Diary.md` in the importer's vault) was always included in a later export, shown only as a count. Same for pictures embedded in included notes. | `worldArchive.plan()`, export dialog | **Fixed**: such notes are "Other notes linked to entries" (optional, listed); the dialog names every always-included and embedded file. Tests: `harness/security.mjs`. |
| S3 | P2 | A note-template id was written raw into a CSS comment (`/* tpl:<id> */`); a crafted id from an imported world could close the comment and add rules (incl. `url()` → a network request when notes render). | `services/notes/appearanceCss.ts` | **Fixed**: `safeTplId`. Regression test fails without the fix. |
| S4 | P2 | Four Writing Studio parent-chain loops had no cycle guard; a crafted outline (A inside B inside A) could hang the UI. | `ui/writing/{screens,plot,table,kanban}.ts` | **Fixed**: `chainUp`/`chapterOf` in `model.ts` (seen-set + depth 64). Regression test fails without the fix. |
| S5 | P3 | Imported JSON could carry `"__proto__"` keys (kept by `JSON.parse`) or extreme nesting; harmless today but a latent prototype-pollution path. | archives, older world files, type files | **Fixed**: `core/util/safeJson.ts` refuses them before anything is written. |
| S6 | P3 | No lockfile; `obsidian` dev dependency pinned to `latest`; `npm audit` not run. | `package.json` | **Open** (needs internet): pin `obsidian`, commit `package-lock.json`, run `npm audit`. All dependencies are dev-only; none is bundled. |
| S7 | P3 | `obsidian://` links stay openable from URL fields; with URI-handling plugins they can trigger actions, as in ordinary notes. | `core/util/urls.ts` | Accepted (parity with Obsidian), documented in PRIVACY.md. |
| S8 | P3 | Web images inside imported Markdown load when Obsidian renders the note (tracking-pixel risk). | Obsidian's renderer | Accepted (Obsidian behaviour), documented. |
| S9 | P3 | Older JSON world files may place a restored native note (`.md` only) inside Worldsmith's data folder. | `backupNotes.safeNotePath` | Open, harmless (Markdown only, no overwrite). |
| S10 | P3 | The in-page editor and the File Explorer drag reader use non-public Obsidian internals. | `ui/editor/EmbeddedEditor.ts`, `ui/dnd/vaultDrag.ts` | Accepted with fallbacks; compatibility risk, not a security hole. |

Licensing (separate from security): the project declares MIT but has **no LICENSE file**; the
embedded Cormorant Garamond font is under the SIL Open Font License 1.1, whose text must be
distributed with it. See THIRD_PARTY_NOTICES.md. Both need adding before release.

### Checked and found safe (false positives)

- No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function`
  anywhere; all DOM is built with element APIs; all Markdown goes through Obsidian's
  `MarkdownRenderer` (which sanitises HTML).
- Images load only from vault files (`getResourcePath`); a web address stored as an image never
  loads by itself.
- Template CSS is generated from fixed choices only; colours and fonts can't inject values.
- `moveDataFolder` deletes its destination only when empty; the Markdown-notes export rewrites
  only notes it wrote and that are unedited; Undo of a created note trashes it only if unchanged.
- World archives (0.19) and the older JSON importer refuse absolute paths, `..`, backslashes,
  hidden folders; archives also refuse duplicate (incl. case-only) names, encrypted or unknown
  methods, oversize/over-ratio entries (checked before and while inflating), CRC/SHA-256
  mismatches, unlisted files, newer versions, non-allowed file types and writes into the data
  folder; nothing is overwritten; failures roll back only files the import created and that are
  unchanged.
- Type and field ids from imports are validated (`SAFE_ID`, `FIELD_ID_RE`; `__proto__` fails both).
- Entity breadcrumbs, family trees and tree pages already guard against loops.
- Backups: written as `.partial`, read back, verified, then renamed; retention never deletes the
  newest verified backup; backup deletion and world deletion are separate operations and neither
  touches notes.
- Plugin unload: the backup timer and all `register*` listeners are cleared; the database is
  flushed; pending native-note syncs that are dropped are reconciled at the next start (the
  entry's data is already saved, and sync compares against the last agreed state).

### Found later (0.26)

- The ZIP reader didn't cross-check each file's local header against the central directory, so
  damage confined to a local header (e.g. its copy of the file name) went unreported by Verify.
  Contents were still checked by CRC-32 and SHA-256, so no wrong data could be imported, but
  the reader now refuses mismatched headers (`readZipEntry`), with a unit test.

### Found during verification

- **Regression introduced by fix S4, caught and fixed before release:** importing the new
  `chapterOf` helper into `kanban.ts`, `plot.ts` and `table.ts`, which already had a local
  function of the same name, made those functions call themselves (stack overflow), so the
  Writing Studio status board, plot grid and scene table didn't draw. `harness/ws4.mjs` caught
  it; the import is now aliased (`chapterNode`), and `harness/security.mjs` checks that all three
  views draw (shown to fail with the clash restored).
- **Flawed test fixed:** the unit test that crafts a ZIP-slip archive patched the file name
  using text positions in binary data, which shifted when the archive's timestamp bytes weren't
  valid text, so it sometimes built a different (merely damaged) archive. The reader still
  refused it, but the test now patches bytes directly and checks both headers were changed.
- **Pre-existing flaky test (not security):** `harness/polish0112.mjs` "Filter opens its panel and
  nothing moves" fails intermittently by a few pixels, also on unchanged 0.20.1 code (2 of 3
  runs). To fix separately.

## 3. Network inventory

| Code path | Why | Automatic? | Needs user action | Sends | Offline | Necessary |
| --- | --- | --- | --- | --- | --- | --- |
| `MediaService.importUrl` (`requestUrl`), reached from the image picker's web-address box and from dropping a browser image link (`fromTransfer`) | Add an image from the web | No | Yes (paste or drop) | An HTTP(S) GET for that one address (the site sees the request, IP and user agent); no vault data | Fails with a message; everything else works | Optional feature; local alternative: drop an image file |

Nothing else: no `fetch`, `XMLHttpRequest`, WebSocket, `sendBeacon`, analytics, telemetry,
error reporting, update checks, remote scripts, stylesheets or fonts. Verified by
`security.test.ts` (fails if any other network call appears in `src/`) and by
`harness/security.mjs` (records every request during a session: none).

## 4. Tests

- Unit: `npx tsx tests/run.ts` — 273 tests including 9 in `tests/security.test.ts` (unsafe URL
  schemes incl. obfuscated, CSS injection, `__proto__`/nesting, crafted archive data, old-importer
  paths, outline loops, and three code scans: network calls, HTML/eval, `window.open` without
  `safeUrl`). Earlier suites cover ZIP-slip, bombs, tampering, failed writes, rollback, backups.
- Browser (mocked Obsidian, real Chromium): `harness/security.mjs` (16 checks) plus the full
  harness: 25 scripts, 1,630 checks, 0 failures in the final run (each script run separately).
- Not executed: real Obsidian, mobile, `npm audit`, typecheck with real Obsidian types,
  code-coverage measurement (no coverage tool installed).
