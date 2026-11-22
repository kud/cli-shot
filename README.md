<div align="center">

# 📸 cli-shot

<img src="https://img.shields.io/npm/v/@kud/cli-shot?style=flat-square" alt="npm version" />
<img src="https://img.shields.io/badge/licence-MIT-blue?style=flat-square" alt="MIT licence" />
<img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="Node >=20" />

**Automatic screenshots and recordings of interactive CLIs — pty capture, terminal emulation, PNG, asciicast or a web player out.**

[Website](https://kud.io/projects/cli-shot) ·
[Documentation](https://kud.io/projects/cli-shot/docs) ·
[npm](https://www.npmjs.com/package/@kud/cli-shot)

</div>

Point it at a CLI. It asks which screens the CLI has, opens each one, and writes
an image per screen. No per-project script, no keystroke tables, no hand-cropped
window captures that go stale the next time the UI moves.

## Features

- **Screens discovered, not hardcoded** — asks the CLI via `--screen list`, so a tab you add shows up in the next run without touching this package
- **Real terminal emulation** — the pty stream is resolved to the grid a user would see, rather than every redraw concatenated
- **Fixtures by default** — `--mock` is on unless you opt out, because a screenshot outlives the moment it was taken
- **Deterministic and headless** — fixed size, fixed data, no window manager, runnable in CI
- **Scriptable last mile** — `--keys` reaches state a screen name can't address
- **Recordings too** — `--format cast` writes asciicast v2, and `--format web` a static replay page ready for Vercel

## Install

```sh
npm install --global @kud/cli-shot
brew install charmbracelet/tap/freeze   # the renderer
```

## Usage

```sh
cli-shot --out assets/screenshots -- pcloud
```

Everything after `--` is the command being driven, so its own flags stay clear
of cli-shot's.

cli-shot adds `--mock` and `--screen` to that command, but only where you
haven't. Anything you pass wins:

```sh
cli-shot --out shots -- pcloud --screen sync    # shoots Sync, writes sync.png
cli-shot --out shots --only sync -- pcloud      # the same thing, said from here
```

Naming a screen yourself is already an answer to "which one", so cli-shot skips
the discovery loop and takes the filename from your value.

```sh
cli-shot --out shots --only sync -- pcloud        # one screen
cli-shot --out shots --list -- pcloud             # what screens exist
cli-shot --out shots --keys $'jjj\r' -- pcloud    # drive deeper first
cli-shot --out shots --no-mock -- pcloud          # real data (careful)
```

| flag                |                                                   |
| ------------------- | ------------------------------------------------- |
| `-o, --out <dir>`   | directory to write into                           |
| `--format <list>`   | `png`, `cast` and/or `web`, comma-separated       |
| `--only <screen>`   | shoot one screen instead of every screen          |
| `--list`            | print the screens the command offers, and stop    |
| `--cols` / `--rows` | terminal size (default 110×32)                    |
| `--settle <ms>`     | how long the screen must hold still (default 350) |
| `--jobs <n>`        | screens shot at once; defaults to the core count  |
| `--keys <sequence>` | keystrokes sent once the screen has drawn         |
| `--font <family>`   | font to render with; defaults to a Nerd Font      |
| `--title <text>`    | page title for `--format web`                     |
| `--base <path>`     | `<base href>` for the web page, see below         |
| `--no-mock`         | drive real data instead of fixtures               |

## Recordings and the web player

The same capture that becomes a PNG can be kept as a recording. The pty
stream is written as it arrived, timed, up to the moment the screen settled —
so a cast always ends on the frame its PNG shows.

```sh
cli-shot --out demo --format cast -- pcloud       # demo/<screen>.cast
cli-shot --out demo --format png,cast -- pcloud   # both, from one capture
cli-shot --out demo --format web -- pcloud        # casts + a replay page
```

`.cast` files are [asciicast v2](https://docs.asciinema.org/manual/asciicast/v2/),
so `asciinema play demo/sync.cast` and any asciicast player read them.

`--format web` writes the casts plus a static page that replays them, one
window per screen, into the same folder:

```
demo/
├── index.html
├── vercel.json
├── <screen>.cast
└── assets/   player.js · chrome.css · xterm.js · Symbols Nerd Font
```

The folder deploys as it stands — `vercel deploy demo` — with no build step.
The page replays through xterm.js, the browser build of the emulator that
resolved the capture, and bundles the Symbols Nerd Font so icons draw as they
do in a real terminal. Each recording sits in a dark macOS-style window,
whatever the page's light or dark mode (pin one with `?theme=light` or
`?theme=dark`). A window shows its final frame first, plays once when it
scrolls into view (never on its own under `prefers-reduced-motion`), and has
play/pause, restart and 1×/2× speed controls. On a narrow screen the terminal is scaled down
rather than re-wrapped, so a phone sees the same layout, smaller. Replay only:
nothing on the page accepts input.

The look lives in one file, `assets/chrome.css` (`player/chrome.css` in this
repository): page, window frame and the terminal palette, all as CSS custom
properties that the player reads.

When a site serves the page under another path — a rewrite from
`kud.io/projects/<name>/demo` to the deployment, say — pass that path so the
page's relative URLs resolve against it:

```sh
cli-shot --out demo --format web --base /projects/pcloud/demo/ -- pcloud
```

To try it locally, from a clone:

```sh
npm install && npm run build
npm run example:web                 # drives examples/harbour.mjs, an invented TUI
npx serve examples/web              # or any static server
```

`examples/casts/` holds recordings of the same fixture, made with
`npm run example:casts`.

## The contract

A CLI is shootable when it implements three things:

|                   |                                                        |
| ----------------- | ------------------------------------------------------ |
| `--mock`          | swap **every** data source to fixtures, all or nothing |
| `--screen <name>` | open directly on that screen                           |
| `--screen list`   | print the screen names, one per line                   |

`--screen list` is what keeps this package generic: cli-shot asks rather than
knowing. Add a tab to your app and it appears in the next run's output without
this package being touched — and a tab nobody ever captured stops being
invisible.

Mock data is the default, deliberately. A folder listing says more about someone
than they usually intend, and a screenshot outlives the moment it was taken.

## How it works

```
node-pty  →  @xterm/headless  →  serialize  →  freeze  →  png
    └──────────────  timed stream  ──────────────────→  cast  →  web page
```

The middle step is the one that isn't obvious. A pty hands back **every redraw
in order**, not a picture of the screen — write that straight out and you render
the whole animation concatenated, with the alternate-screen escape on top. So
the stream is fed through a real terminal emulator, which resolves cursor moves,
clears and repaints into the grid a user would actually be looking at. Only that
grid is serialised.

## Limits

**Terminal graphics protocols don't survive.** Inline images (iTerm2, sixel) are
escape sequences carrying base64 payloads; no ANSI renderer can rasterise them.
A CLI drawing thumbnails needs a real terminal and a window capture for those
screens.

**Compound state needs `--keys`.** `--screen` addresses which screen; scroll
position, an open dialog or a filtered view are beyond what a name can carry.

## Related

- [@kud/cli-testing](https://github.com/kud/cli-testing) — the test-side sibling.
  Same app contract, no dependency between them.

## Licence

MIT © Erwann Mest

---

📚 **Full documentation → [cli-shot/docs](https://kud.io/projects/cli-shot/docs)**
