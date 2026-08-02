#!/usr/bin/env node
import { Command } from "commander"
import { listScreens } from "./screens.js"
import { shootAll, shootScreen, DEFAULT_FONT } from "./index.js"

// Everything after `--` is the CLI being driven, split off before commander
// sees it. Without that split a driven flag like --mock is claimed by cli-shot,
// and the two flag namespaces collide on whichever names they happen to share.
const separator = process.argv.indexOf("--")
const driven = separator === -1 ? [] : process.argv.slice(separator + 1)
const own = separator === -1 ? process.argv : process.argv.slice(0, separator)

const program = new Command()

program
  .name("cli-shot")
  .description(
    "Screenshot an interactive CLI, one image per screen.\n\n" +
      "The command to drive follows `--`:\n" +
      "  cli-shot --out assets/screenshots -- pcloud",
  )
  .requiredOption("-o, --out <dir>", "directory to write PNGs into")
  .option("-s, --screen <name>", "shoot one screen instead of every screen")
  .option("--list", "print the screens the command offers, and stop")
  .option("--cols <n>", "terminal columns", "110")
  .option("--rows <n>", "terminal rows", "32")
  .option("--settle <ms>", "how long the screen must hold still", "350")
  .option("--keys <sequence>", "keystrokes to send once the screen has drawn")
  .option(
    "--font <family>",
    "font to render with; needs Nerd Font coverage for TUI icons",
    DEFAULT_FONT,
  )
  .option("--jobs <n>", "screens to shoot at once; defaults to core count")
  .option("--no-mock", "drive real data instead of fixtures")
  .parse(own)

const options = program.opts()

if (driven.length === 0) {
  console.error(
    "No command to drive. Put it after `--`, e.g.\n  cli-shot --out shots -- pcloud",
  )
  process.exit(1)
}

const [command, ...args] = driven

const shoot = {
  command,
  args,
  out: options.out,
  mock: options.mock,
  cols: Number(options.cols),
  rows: Number(options.rows),
  settle: Number(options.settle),
  keys: options.keys,
  font: options.font,
  concurrency: options.jobs ? Number(options.jobs) : undefined,
}

if (options.list) {
  console.log(listScreens(command, args).join("\n"))
  process.exit(0)
}

const written = options.screen
  ? [await shootScreen(options.screen, shoot)]
  : await shootAll(shoot)

for (const path of written) console.log(path)
