import { afterEach, beforeEach, test, expect } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { toCast } from "./cast.js"
import { buildPlayer } from "./web.js"

let out: string

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), "cli-shot-web-"))
  for (const screen of ["queue", "log"]) {
    writeFileSync(
      join(out, `${screen}.cast`),
      toCast({ width: 40, height: 6 }, [[0, "o", `${screen}\r\n`]]),
    )
  }
})
afterEach(() => rmSync(out, { recursive: true, force: true }))

test("writes a page, its assets and a vercel.json next to the casts", () => {
  buildPlayer({ out })

  for (const file of [
    "index.html",
    "vercel.json",
    "assets/player.js",
    "assets/chrome.css",
    "assets/xterm.mjs",
    "assets/xterm.css",
    "assets/xterm.LICENSE",
    "assets/fonts/SymbolsNerdFontMono-Regular.woff2",
    "assets/fonts/LICENSE",
  ]) {
    expect(existsSync(join(out, file)), file).toBe(true)
  }
})

test("one window per cast, in name order by default, each pointing at its file", () => {
  buildPlayer({ out })
  const html = readFileSync(join(out, "index.html"), "utf8")

  const casts = [...html.matchAll(/data-cast="([^"]+)"/g)].map((match) => match[1])
  expect(casts).toEqual(["log.cast", "queue.cast"])
  expect(html).not.toMatch(/\{\{\w+\}\}/)
})

test("screens can be chosen and ordered", () => {
  buildPlayer({ out, screens: ["queue"] })
  const html = readFileSync(join(out, "index.html"), "utf8")

  expect([...html.matchAll(/data-cast="([^"]+)"/g)].map((m) => m[1])).toEqual([
    "queue.cast",
  ])
})

test("the title is escaped, and a base path becomes <base href>", () => {
  buildPlayer({ out, title: "<harbour> & $& co", base: "/projects/harbour/demo/" })
  const html = readFileSync(join(out, "index.html"), "utf8")

  expect(html).toContain("<title>&lt;harbour&gt; &amp; $&amp; co</title>")
  expect(html).toContain('<base href="/projects/harbour/demo/" />')
})

test("without a base path the page uses relative URLs only", () => {
  buildPlayer({ out })
  const html = readFileSync(join(out, "index.html"), "utf8")

  expect(html).not.toContain("<base")
  expect(html).not.toMatch(/(?:href|src)="\//)
})

test("vercel.json deploys the folder as static files", () => {
  buildPlayer({ out })
  const config = JSON.parse(readFileSync(join(out, "vercel.json"), "utf8"))

  expect(config).toMatchObject({ framework: null, buildCommand: null })
})

test("a folder with no recordings is refused", () => {
  const empty = mkdtempSync(join(tmpdir(), "cli-shot-web-empty-"))
  try {
    expect(() => buildPlayer({ out: empty })).toThrow(/no \.cast files/)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})
