# Worldsmith

**A worldbuilding studio inside Obsidian.** Keep your characters, places, factions, creatures,
magic and lore as structured entries, connect them to each other, and see your world come
together on dashboards and pages you design yourself. Everything stays in your vault, as files
you own.

## What you get (free)

- **Entries for everything in your world**: characters, locations, factions, creatures, species,
  magic systems, artifacts, religions, languages, events and more, each with fields that fit
  (portraits, banners, stats, lists, dates, links). Make your own types too.
- **Connections**: parents and children, allies and rivals, members, rulers, locations.
  Connections work both ways and show on every page they touch.
- **Pages and dashboards you design**: drag widgets into place for each type of entry, or build
  dashboards for a whole region, a faction or a plot.
- **Native notes**: every entry can be an ordinary Markdown note in your vault, and your existing
  notes can become entries.
- **Tasks**: to-dos on entries, with due dates and a page to plan them.
- **A media library** for every image in the world, with missing ones found.
- **Backups and recovery**: verified backups every hour, restoring safely, and deleted worlds you
  can bring back.
- **Import and export**: move whole worlds between vaults as one archive file.
- **Features**: switch parts of Worldsmith on or off for each world, so it only shows what you use.
- A **Modern Codex** design (or your theme's look), light and dark, on desktop and phone.

## Worldsmith Pro

**Payment is required for the full version.** Worldsmith Pro is the official, ready-to-install
build of the full edition, sold on [Buy Me a Coffee](https://buymeacoffee.com/novalith) (a
one-time purchase, no account or licence key). It adds:

- **The Writing Studio**: write your book in Obsidian, with chapters and scenes, a corkboard,
  outline and kanban, plot threads and story structures, character arcs, goals and writing
  sessions, revision passes and snapshots, a research library, and compile to Word, PDF, EPUB,
  Markdown or a web page, styled the way you like.
- **Maps** with pins for places, people and events.
- **Timeline** of events and dated entries, on lanes you choose.
- **Trees** of families and lineages.
- **Graph** of how your entries are connected.
- **Calendars** of your world's own: months, weekdays and eras.

Buying Pro gets you the official build, new versions as they come out, and support. In the free
edition these parts appear on the Features page but can't be switched on. Your worlds are the
same in both editions: install Pro and everything you made carries straight over.

### The source is public

All of Worldsmith's source code, Pro included, is in this repository, so you can read exactly
what it does with your vault. The [license](LICENSE) lets you read it, use Worldsmith and change
it for yourself, but **not** build Worldsmith Pro for anyone else, share Pro builds, or unlock
the free edition for others. If Worldsmith is useful to you, buying Pro is what keeps it going.

## Install

Worldsmith needs **Obsidian 1.13 or newer** (desktop or mobile).

**From Obsidian:** Settings › Community plugins › Browse › search for "Worldsmith" › Install ›
Enable. Then open Worldsmith from the globe icon in the left ribbon.

**By hand:** download `main.js`, `manifest.json` and `styles.css` from the latest release into
`<your vault>/.obsidian/plugins/worldsmith/`, then enable Worldsmith under Community plugins.

**Worldsmith Pro:** follow `PRO-INSTALL.txt` in the download (it installs as its own plugin,
"Worldsmith Pro", and switches the free copy off).

## Privacy

Worldsmith collects nothing: no accounts, telemetry, analytics, tracking or AI. It uses the
internet in one situation only: when **you** add an image from a web address, it downloads that
one image into your vault (nothing about your vault is sent). Your worlds are kept in your vault
(in a `_worldsmith` folder you can move) and in ordinary notes. The "Get Worldsmith Pro"
button opens the shop in your browser. See [PRIVACY.md](PRIVACY.md).

## Help

Open Worldsmith and choose **Help & getting started** from the world menu (click the world's name
at the top of the sidebar). New worlds also get a short getting-started guide on their Home page.

## License

Worldsmith is **source-available**, not open source: you can use it (including for work you
sell), read all the code, change it for your own use and suggest improvements, but you may not
redistribute it, publish forks, or build or share Worldsmith Pro. See [LICENSE](LICENSE).
Copyright © 2026 Novalith.

## Credits

Worldsmith bundles the Cormorant Garamond typeface (SIL Open Font License 1.1, see
[fonts/OFL.txt](fonts/OFL.txt)) and pdf-lib (MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

For developers: how Worldsmith is built and tested is in [README-dev.md](README-dev.md),
[ARCHITECTURE.md](ARCHITECTURE.md) and [DATA_MODEL.md](DATA_MODEL.md).
