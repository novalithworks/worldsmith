# Third-party notices

Worldsmith's bundled plugin (`main.js`, `styles.css`) contains no third-party JavaScript: it
loads only Obsidian itself at runtime. The development tools in `package.json` (TypeScript,
esbuild, tsx, Playwright, the Obsidian type definitions) are used to build and test Worldsmith
and are not shipped with it.

## Bundled font

`styles.css` embeds a Latin subset of **Cormorant Garamond** (weights 300–700), designed by
Christian Thalmann (Catharsis Fonts), used for titles in the Modern Codex look.

- Licence: **SIL Open Font License, Version 1.1** (https://openfontlicense.org).
- Copyright notice to carry: the one in the font project's own `OFL.txt` (the Cormorant
  project, https://github.com/CatharsisFonts/Cormorant).

The font's licence (copyright line and the full SIL Open Font License 1.1) is in `fonts/OFL.txt`,
and a notice is kept in the built `styles.css`.

## Icons

Worldsmith uses Obsidian's built-in icon set (Lucide) through Obsidian's API; it doesn't bundle
icons. (The test harness builds a local icon file for its stand-in; that file is not shipped.)


## pdf-lib 1.17.1 (bundled, 0.29.3)

MIT License. Copyright (c) 2019 Andrew Dillon. Used to write PDF files when compiling a book.
Includes pako (MIT; zlib port, (C) 2014-2017 Vitaly Puzrin and Andrei Tupitcin) and
@pdf-lib/standard-fonts (MIT; Adobe's standard 14 font metrics, used under their terms).
