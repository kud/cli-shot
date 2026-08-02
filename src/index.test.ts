import { test, expect } from "vitest"
import { drivenScreen } from "./index.js"

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
