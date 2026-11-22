#!/usr/bin/env node
// A pretend TUI that implements the cli-shot contract, so the recorder and the
// web player have something to drive without depending on a real tool. Every
// name and number below is invented.
//
//   node examples/harbour.mjs --screen list
//   node examples/harbour.mjs --mock --screen queue

const args = process.argv.slice(2)
const at = args.indexOf("--screen")
const screen = at === -1 ? "queue" : args[at + 1]

const SCREENS = ["queue", "log"]

if (screen === "list") {
  console.log(SCREENS.join("\n"))
  process.exit(0)
}
if (!SCREENS.includes(screen)) {
  console.error(`harbour: no screen called ${screen}`)
  process.exit(2)
}

const esc = (code) => `\u001b[${code}`
const colour = (n, text) => `${esc(`${n}m`)}${text}${esc("0m")}`
const dim = (text) => colour(2, text)
const bold = (text) => colour(1, text)
const at_ = (row, col) => esc(`${row};${col}H`)

// Nerd Font private-use glyphs, the reason the player bundles a symbols font.
const ICON = {
  ship: "",
  branch: "",
  check: "",
  clock: "",
  node: "",
  box: "",
  warn: "",
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const CARGO = [
  { name: "lantern-api", branch: "main", size: "12.4 MB", took: "38s" },
  { name: "kelp-worker", branch: "main", size: "8.1 MB", took: "21s" },
  { name: "buoy-web", branch: "release/3.2", size: "24.9 MB", took: "1m04s" },
  { name: "gull-cron", branch: "main", size: "2.3 MB", took: "9s" },
]

const LOG = [
  ["09:41:02", 36, "info", "berth 3 assigned to lantern-api"],
  ["09:41:05", 36, "info", "manifest signed (4 crates, 47.7 MB)"],
  ["09:41:19", 33, "warn", "kelp-worker image is 3 weeks old"],
  ["09:41:31", 36, "info", "buoy-web passed customs"],
  ["09:41:48", 32, "done", "all cargo loaded, departing on the 09:45 tide"],
]

const write = (text) => process.stdout.write(text)

const frame = (title) => {
  write(esc("?1049h") + esc("?25l") + esc("2J") + at_(1, 1))
  write(
    `${colour(44, colour(97, ` ${ICON.ship}  harbour `))}${colour(100, ` ${title} `)}\n\n`,
  )
}

const drawQueue = (tick, done) => {
  frame("queue")
  write(dim("  CRATE             BRANCH             SIZE       STATUS\n"))
  CARGO.forEach((crate, i) => {
    const finished = done || tick > (i + 1) * 3
    const status = finished
      ? colour(32, `${ICON.check} loaded in ${crate.took}`)
      : colour(33, `${SPINNER[tick % SPINNER.length]} loading`)
    write(
      `  ${colour(32, ICON.node)} ${bold(crate.name.padEnd(15))} ` +
        `${colour(35, ICON.branch)} ${crate.branch.padEnd(16)} ` +
        `${crate.size.padStart(8)}   ${status}\n`,
    )
  })
  const loaded = done ? CARGO.length : Math.min(CARGO.length, Math.floor(tick / 3))
  write(
    `\n  ${dim(`${ICON.box} ${loaded}/${CARGO.length} crates`)}   ` +
      `${dim(`${ICON.clock} tide in 4 min`)}\n`,
  )
}

const drawLog = (tick, done) => {
  frame("log")
  const shown = done ? LOG.length : Math.min(LOG.length, tick)
  for (const [time, tone, level, text] of LOG.slice(0, shown)) {
    const icon = level === "warn" ? ICON.warn : level === "done" ? ICON.check : "•"
    write(`  ${dim(time)}  ${colour(tone, `${icon} ${level.padEnd(4)}`)}  ${text}\n`)
  }
}

const draw = screen === "queue" ? drawQueue : drawLog
const FRAMES = 16
let tick = 0
const timer = setInterval(() => {
  tick += 1
  draw(tick, tick >= FRAMES)
  if (tick >= FRAMES) clearInterval(timer)
}, 70)

// A TUI stays up until it is told to leave; cli-shot stops it once the screen
// has settled.
setInterval(() => {}, 1 << 30)
process.on("SIGTERM", () => process.exit(0))
process.on("SIGHUP", () => process.exit(0))
