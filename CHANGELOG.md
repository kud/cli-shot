# Changelog

All notable changes to this project are documented here.

---

## 0.1.2 — 2026-08-02

### Fixes

- Fixed a Linux-only bug where a command that failed to spawn was captured as a _successful_ screenshot — one containing node-pty's own "execvp(3) failed" text rendered as if it were the app's real output. cli-shot now recognises that failure and reports an error instead of quietly shipping a PNG of it. Only surfaced on Linux CI; macOS fails at a different point in the pty lifecycle and was never affected. ([6babd1c](https://github.com/kud/cli-shot/commit/6babd1c805711edb731bfae98d14f6e47013aaa6), [c6fbb94](https://github.com/kud/cli-shot/commit/c6fbb94da352a6f68f4580f6d790dd5ba709fc20))

---

## 0.1.1 — 2026-08-02

### Highlights

- Screenshots that used to take minutes now take seconds: capture used to wait for the pty's byte stream to fall silent before declaring a screen "settled" — but an Ink TUI never stops emitting cursor moves and repaints, so every single capture ran out the clock on the full 15s timeout. It now settles by watching the rendered grid hold still instead, which ends the wait the instant the picture stops changing. On a six-screen run this took capture time from 182s down to 26s. ([36980e4](https://github.com/kud/cli-shot/commit/36980e4b0b433a368e68fdddfca464965fd2d199))
- Multiple screens now shoot concurrently (capped to your core count) rather than one at a time, and the "has it settled" check samples more finely — together these account for most of the remaining speed-up on multi-screen runs, taking that same six-screen run down to ~15s. ([303d33b](https://github.com/kud/cli-shot/commit/303d33b01ae43dc32a0426865e0c0c2efe286ab4))
- cli-shot now defaults to a Nerd Font (JetBrainsMono Nerd Font Mono). TUIs draw their icons from the Nerd Font private-use area, and without it every icon rendered as an empty tofu box — reading as a bug in the app being screenshotted rather than a missing font. ([36980e4](https://github.com/kud/cli-shot/commit/36980e4b0b433a368e68fdddfca464965fd2d199))

<details>
<summary>Internal (2 commits)</summary>

- Unified the default terminal size/settle-window values between the library entry point and the CLI binary, which had silently drifted apart; added MDX documentation.

</details>

---

## 0.1.0 — 2026-08-02

### Highlights

- Initial release of `@kud/cli-shot`: point it at any interactive CLI and it drives the pty, feeds the output through a headless terminal emulator, and freezes the result to an image — built around the same `--mock` / `--screen` / `--screen list` contract used for testing, so a CLI's own test screens double as its screenshot targets. ([6557a4b](https://github.com/kud/cli-shot/commit/6557a4b07d2beafe23046f3f63e48223b277e009))
- Shipped as a proper binary (`cli-shot -- <command>`) rather than just a library, so screenshotting a CLI no longer needs a bespoke driver script — everything after `--` is simply the command being captured, keeping its flags out of cli-shot's own namespace. ([fe59f8a](https://github.com/kud/cli-shot/commit/fe59f8aaafaddd1c4db584c068592c679a64ec37))

### Fixes

- Failures during capture used to surface as a bare, misleading `posix_spawnp failed` (or nothing at all, later reported as "freeze: No input"). Both are now diagnosed properly: a spawn failure names the actual missing helper and, where relevant, the `chmod`/`approve-scripts` fix; a command that runs but exits without drawing anything is now rejected up front instead of silently producing a blank screenshot. ([40ecb44](https://github.com/kud/cli-shot/commit/40ecb44ec32dc1e1cb3ca516c411c507cb619aff), [058da6a](https://github.com/kud/cli-shot/commit/058da6a30491d57c46534554a254c1a941d08aca))

<details>
<summary>Internal (2 commits)</summary>

- Added test coverage (the package had shipped with none, leaving CI red) and MDX documentation.

</details>

---
