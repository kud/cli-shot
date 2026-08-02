import { test, expect } from "vitest"
import { listScreens } from "./screens.js"

// `sh -c <script>` rather than `node -e`: node claims any --flag that follows
// as one of its own options, and listScreens appends --screen list by design.
// sh takes trailing arguments as positional parameters, which is both closer to
// how a real CLI receives them and lets a test read them back.
const sh = "/bin/sh"

test("reads one screen name per line", () => {
  const screens = listScreens(sh, ["-c", "echo files; echo rewind; echo trash"])

  expect(screens).toEqual(["files", "rewind", "trash"])
})

// A CLI that pads its output, or ends without a trailing newline, still has to
// produce usable names — otherwise a stray blank becomes a screen and cli-shot
// tries to open it.
test("ignores blank lines and surrounding whitespace", () => {
  const screens = listScreens(sh, ["-c", "printf '  files  \\n\\n  sync\\n'"])

  expect(screens).toEqual(["files", "sync"])
})

test("appends --screen list after the caller's own arguments", () => {
  const screens = listScreens(sh, ["-c", 'printf "%s|%s\\n" "$0" "$1"'])

  expect(screens).toEqual(["--screen|list"])
})

test("a command that fails surfaces rather than reading as no screens", () => {
  expect(() => listScreens(sh, ["-c", "exit 2"])).toThrow()
})
