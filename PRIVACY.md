# Worldsmith and your privacy

Worldsmith runs entirely inside Obsidian, on your device. This page says what it stores, what it
reads, and when (rarely) it uses the internet. It describes Worldsmith 0.30.6 (free and Pro
editions alike) as it was checked in November 2026.

## The short version

- **No accounts, no sign-in, no telemetry, no analytics, no tracking, no ads, and no AI.** Nothing
  you write is sent to any AI service or used to train anything.
- **Worldsmith never sends your notes, entries, manuscripts, images, file names or anything about
  your device anywhere.**
- **It uses the internet in one situation only:** when *you* ask it to add an image from a web
  address (by pasting the address in the image picker, or dropping an image link from a browser).
  Then it downloads that one image into your vault. Nothing about your vault is sent; the website
  sees an ordinary download request (like a browser would make).
- Everything else works offline. Compiling a book to PDF happens on your device too.
- The **"Get Worldsmith Pro"** button only opens the shop page in your browser; Worldsmith itself
  sends nothing. There is no licence check: Pro never contacts anyone either.
- **Your work is yours.** The worlds, notes and books you make belong to you (see the LICENSE).

## Where your data is

Everything Worldsmith keeps is inside your Obsidian vault:

| What | Where |
| --- | --- |
| Your worlds (entries, types, connections, layouts, maps, calendars, tasks, Writing Studio plans) | `_worldsmith/worlds/<world>/` — plain JSON files |
| Backups | `_worldsmith/backups/<world>/` — `.worldsmith.zip` files you can open with any ZIP tool |
| Deleted worlds (until you delete them for good) | `_worldsmith/trash/worlds/` |
| Damaged files Worldsmith couldn't read (kept, never deleted) | `_worldsmith/quarantine/` |
| Records that let an interrupted import or restore be undone | `_worldsmith/imports/`, `_worldsmith/restores/` (removed when the operation finishes) |
| Native notes, and notes you create from Worldsmith | ordinary Markdown notes in the folders you choose (by default `Worldsmith/…`) |
| Images you add | `Worldsmith/Images/` (or Obsidian's attachment folder, if you choose) |
| Exports | `Worldsmith/Exports/` (or a file you save from the export dialog) |
| A CSS snippet so native notes look right with Worldsmith off | `.obsidian/snippets/worldsmith-notes.css` (only if you allow it) |
| Settings | Obsidian's usual plugin settings file for Worldsmith |

The `_worldsmith` folder name can be changed in Settings.

## What Worldsmith reads and changes

- It reads and writes its own files above.
- It reads notes that are linked to your entries (native notes, notes you adopted or linked,
  Writing Studio scenes) and the images your world uses.
- It **writes into a note** only when that note is a native note (its synced Properties and marked
  sections), a Writing Studio scene you're editing, or a note you edit yourself through
  Worldsmith's editor. Notes you adopt are never written to by Worldsmith on its own.
- It **never deletes your notes or images** as part of normal work. Undo after creating something
  removes it only if it is still unchanged. Deleting an entry, a world or a backup never deletes
  your notes.
- Other notes in your vault are only looked at when you choose them (for example in a note
  picker) or when searching for a moved note's new location.

## Imports, exports and backups

- **Exports** contain the world and the files it uses. Notes you linked or adopted, other linked
  notes and Writing Studio scenes are each a choice in the export dialog, and every file that
  goes along is listed there by name. Notes that aren't linked to the world are never included.
- **Importing** someone else's world never overwrites anything: files with the same name are
  saved beside yours. Archives are checked before anything is written; damaged or crafted
  archives (unsafe file names, hidden folders, unexpected file types, oversized or tampered
  contents) are refused. Nothing in an archive is ever run as a program.
- **Backups** stay in your vault. Worldsmith doesn't upload them anywhere.

## What Worldsmith can't control

Your vault is yours, and other software may copy it: Obsidian Sync, iCloud, OneDrive, Dropbox,
Git, other plugins, or your computer's backup. Those can move Worldsmith's files (including
backups) off your device according to how *you* set them up. Worldsmith neither starts nor
stops them.

Notes are shown with Obsidian's own Markdown renderer. If a note contains a web image
(`![](https://…)`), Obsidian loads it when the note is shown, exactly as in your normal notes.
This includes notes inside a world you imported from someone else.

Links you put in a URL field open in your browser when you click them. Only `http`, `https`,
`mailto` and `obsidian` links can be opened; anything else (for example `javascript:` or `file:`)
is shown as text and never opened.

## If you disable or uninstall Worldsmith

Nothing is deleted. Your notes stay ordinary Markdown notes; native notes keep their Properties
and text, and keep their look if you allowed the CSS snippet. The `_worldsmith` folder stays,
with your worlds and backups, until you delete it yourself. Turning Worldsmith back on picks up
where you left off.
