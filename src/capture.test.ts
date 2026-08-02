import { test, expect } from "vitest"
import { capture } from "./capture.js"

const node = process.execPath
const sh = "/bin/sh"

test("returns what the command drew", async () => {
  const ansi = await capture(node, ["-e", "process.stdout.write('hello pty')"])

  expect(ansi).toContain("hello pty")
})

// The emulator exists to collapse redraws. A command that overwrites its own
// line must serialise as the final state, not as both states concatenated —
// otherwise a spinner renders as every frame it ever drew.
test("a redrawn line serialises once, at its final value", async () => {
  const ansi = await capture(node, [
    "-e",
    "process.stdout.write('loading\\rdone   ')",
  ])

  expect(ansi).toContain("done")
  expect(ansi).not.toContain("loading")
})

test("keeps colour", async () => {
  const ansi = await capture(node, [
    "-e",
    "process.stdout.write('\\u001b[32mgreen\\u001b[0m')",
  ])

  expect(ansi).toContain("green")
  expect(ansi).toMatch(/\[/)
})

test("keys are delivered once the screen has drawn", async () => {
  const ansi = await capture(
    sh,
    ["-c", 'printf ready; read line; printf " got:%s" "$line"'],
    { keys: "x\r", settle: 600, timeout: 10_000 },
  )

  expect(ansi).toContain("got:x")
})

test("gives up at the timeout rather than hanging on a command that never exits", async () => {
  const started = Date.now()
  await capture(
    node,
    ["-e", "process.stdout.write('up');setInterval(()=>{},1000)"],
    { settle: 200, timeout: 3_000 },
  )

  expect(Date.now() - started).toBeLessThan(6_000)
})

// node-pty forks first and fails inside the child, so this arrives as an exit
// rather than a throw. Resolved as an empty capture it would surface much later
// as "freeze: No input", blaming the renderer for a command that never ran.
test("a command that does not exist explains itself", async () => {
  await expect(capture("/nonexistent/command/xyz")).rejects.toThrow(
    /Could not open a pty/,
  )
})

test("a command that fails without drawing rejects rather than returning blank", async () => {
  await expect(capture(sh, ["-c", "exit 3"])).rejects.toThrow(/exited 3/)
})
