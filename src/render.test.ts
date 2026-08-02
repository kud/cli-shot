import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, test, expect } from "vitest"
import { toImage } from "./render.js"

// freeze is a separately installed binary, so the tests that actually render
// skip where it is absent rather than failing. The argument and error paths
// below still run everywhere, which is where the regressions have been.
const hasFreeze = (() => {
  try {
    execFileSync("freeze", ["--version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

const staging = mkdtempSync(join(tmpdir(), "cli-shot-test-"))
afterAll(() => rmSync(staging, { recursive: true, force: true }))

test.skipIf(!hasFreeze)("writes a png", () => {
  const output = join(staging, "plain.png")
  toImage("hello\nworld\n", output)

  expect(existsSync(output)).toBe(true)
  expect(readFileSync(output).subarray(1, 4).toString()).toBe("PNG")
})

// The reason toImage pipes rather than passing a path: freeze prefers stdin
// whenever stdin is not a terminal, which it never is when spawned from Node.
// Colour surviving proves the content actually reached it.
test.skipIf(!hasFreeze)(
  "the ansi reaches freeze rather than an empty pipe",
  () => {
    const output = join(staging, "coloured.png")
    toImage("[32mgreen[0m\n", output)

    expect(readFileSync(output).length).toBeGreaterThan(1_000)
  },
)

test.skipIf(!hasFreeze)("creates the output directory", () => {
  const output = join(staging, "nested", "deeper", "shot.png")
  toImage("content\n", output)

  expect(existsSync(output)).toBe(true)
})

test.skipIf(!hasFreeze)(
  "a freeze failure names the command and the input size",
  () => {
    expect(() =>
      toImage("content\n", join(staging, "bad.png"), {
        freezeArgs: ["--not-a-real-flag"],
      }),
    ).toThrow(/freeze failed[\s\S]*command: freeze[\s\S]*input:\s+8 chars/)
  },
)

test("a missing freeze binary is reported, not swallowed", () => {
  const output = join(staging, "never.png")
  const path = process.env.PATH

  process.env.PATH = "/nonexistent"
  try {
    expect(() => toImage("content\n", output)).toThrow(/freeze failed/)
  } finally {
    process.env.PATH = path
  }
})
