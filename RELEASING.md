# Releasing Worldsmith

> The public repository holds what the plugin is built from. The test suites (`tests/`,
> `harness/`) and release tooling (`scripts/`) live in the private source repository; they are
> left out of the public archive (`.gitattributes` export-ignore) because Obsidian's review lints
> every code file in the public repository.

Two editions come from this one codebase:

| | Free | Pro |
|---|---|---|
| Plugin id / name | `worldsmith` / Worldsmith | `worldsmith-pro` / Worldsmith Pro |
| Build | `npm run build` | `npm run build:pro` (on Windows: `set WS_EDITION=pro && node esbuild.config.mjs production`) |
| Manifest | `manifest.json` | `manifest-pro.json` (copy it in as `manifest.json`) |
| Where | GitHub release + Obsidian community directory | Buy Me a Coffee download (zip of a `worldsmith-pro` folder + PRO-INSTALL.txt + LICENSE) |

## One repository

Everything lives in one **public** GitHub repository (Pro's source included; the LICENSE
forbids building or sharing Pro for others). Only the **free** edition's files are ever
attached to GitHub releases; the Pro zip is only sold on Buy Me a Coffee.

## Making a release

1. Bump the version in `manifest.json`, `manifest-pro.json` and `package.json`, and add it to
   `versions.json` (version → `minAppVersion`).
2. Run the tests: `npx tsx tests/run.ts` and `npm run harness` (all must pass).
3. Run **`npm run release`**. It builds both editions, checks each one is the right edition,
   and writes:
   - `release/github/`: `main.js`, `manifest.json`, `styles.css` (the free edition)
   - `release/worldsmith-pro-<version>.zip` (Pro, with PRO-INSTALL.txt and LICENSE)
   It stops if the versions disagree or a build is the wrong edition, so Pro can't reach GitHub.
4. Commit and push the code.
5. On GitHub: **Releases → Draft a new release**, tag exactly the version (e.g. `0.30.9`, no "v"),
   give it a title, and **Publish** (no files needed). The `Release` workflow
   (`.github/workflows/release.yml`) then checks the tag matches `manifest.json`, builds the free
   edition, attests the files (provenance) and attaches `main.js`, `manifest.json` and
   `styles.css` to the release. Watch it under the repository's **Actions** tab.
6. On Buy Me a Coffee: replace the file on the Worldsmith Pro product with the new Pro zip, and
   post a short "what's new" so buyers know to download it.

## Submitting to the Obsidian community directory (first time only)

1. Sign in to Obsidian's community site with an Obsidian account and open the developer
   dashboard.
2. Submit the plugin with the GitHub repository's link. The automated review checks the
   manifest, the README and the code against Obsidian's rules.
3. Choose the **"Optional payments"** label (some features are paid), and keep the README's
   "Worldsmith Pro" section: Obsidian's policy requires saying clearly that payment is needed for
   full access.
4. Later releases: just publish a new GitHub release; the directory picks it up.

## Selling Pro (Buy Me a Coffee)

1. `npm run release` makes `release/worldsmith-pro-<version>.zip` (the `worldsmith-pro` folder,
   PRO-INSTALL.txt and LICENSE).
2. On https://buymeacoffee.com/novalith, add it as a paid digital product (Shop / Extras) with
   the zip as the file buyers receive. Never attach it to a GitHub release.
3. Updates: replace the file on the same product, and post a short note so buyers download it.

## Checks already done (0.30.1)

- Manifest: id and name without "Obsidian", description under 250 characters ending with a
  period, `isDesktopOnly: false` (no Node.js or Electron modules are loaded; the desktop PDF
  renderer is optional and has a fallback).
- No `innerHTML`, no `fetch` or network requests, no regex lookbehind (older iOS), no `<style>`
  or `<link>` elements created, no hard-coded `.obsidian` paths, no console logging, no sample
  code, command ids without the plugin id.
