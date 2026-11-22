import { afterEach, beforeEach, describe, test, expect } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { drivenScreen, parseCast, shootAll } from "./index.js"

// Everything after `--` is the caller's and wins; cli-shot fills in only what
// is absent. Appending a second --screen made the app read the caller's while
// the filename came from cli-shot's, which wrote a files.png holding the Sync
// screen — exit 0, no warning.
test("finds a screen named in the driven command", () => {
  expect(drivenScreen(["pcloud", "--screen", "sync"])).toBe("sync")
})

test("no screen named means cli-shot chooses", () => {
  expect(drivenScreen(["pcloud", "--mock"])).toBeUndefined()
})

test("a trailing --screen with no value is not mistaken for one", () => {
  expect(drivenScreen(["pcloud", "--screen"])).toBeUndefined()
})

// The recorder end to end, against the invented TUI in examples/: discovery,
// --mock and --screen are the same path the PNG takes, only the output differs.
describe("--format cast", () => {
  const fixture = fileURLToPath(new URL("../examples/harbour.mjs", import.meta.url))
  let out: string

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), "cli-shot-cast-"))
  })
  afterEach(() => rmSync(out, { recursive: true, force: true }))

  test("records every discovered screen as an asciicast v2 file", async () => {
    const written = await shootAll({
      command: process.execPath,
      args: [fixture],
      out,
      formats: ["cast"],
      cols: 90,
      rows: 20,
    })

    expect(written.map((path) => basename(path)).sort()).toEqual([
      "log.cast",
      "queue.cast",
    ])

    const { header, events } = parseCast(readFileSync(join(out, "queue.cast"), "utf8"))
    expect(header).toMatchObject({ version: 2, width: 90, height: 20, title: "queue" })
    expect(events.length).toBeGreaterThan(1)
    expect(events.every(([, code]) => code === "o")).toBe(true)

    const times = events.map(([time]) => time)
    expect(times).toEqual([...times].sort((a, b) => a - b))

    // The recording runs until the screen settled, so it reaches the final frame.
    expect(events.map(([, , data]) => data).join("")).toContain("loaded in 1m04s")
  })

  test("a screen named in the driven command records only that one", async () => {
    const written = await shootAll({
      command: process.execPath,
      args: [fixture, "--screen", "log"],
      out,
      formats: ["cast"],
    })

    expect(written.map((path) => basename(path))).toEqual(["log.cast"])
  })
})
