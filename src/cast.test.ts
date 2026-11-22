import { test, expect } from "vitest"
import { castHeader, castEvent, toCast, parseCast } from "./cast.js"

test("the header is a single v2 JSON line with the terminal size", () => {
  const line = castHeader({ width: 110, height: 32 })

  expect(line).not.toContain("\n")
  expect(JSON.parse(line)).toEqual({ version: 2, width: 110, height: 32 })
})

test("optional header fields use the spec's names and are omitted when absent", () => {
  const header = JSON.parse(
    castHeader({
      width: 80,
      height: 24,
      timestamp: 1_700_000_000.75,
      idleTimeLimit: 1.5,
      title: "tidepool",
      env: { TERM: "xterm-256color" },
    }),
  )

  expect(header).toEqual({
    version: 2,
    width: 80,
    height: 24,
    timestamp: 1_700_000_000,
    idle_time_limit: 1.5,
    title: "tidepool",
    env: { TERM: "xterm-256color" },
  })
})

test("a size that is not a positive integer is refused", () => {
  expect(() => castHeader({ width: 0, height: 24 })).toThrow(/width/)
  expect(() => castHeader({ width: 80, height: 2.5 })).toThrow(/height/)
})

test("an event is [seconds, code, data] on one line, escapes included", () => {
  const line = castEvent([0.25, "o", "\u001b[32mok\u001b[0m\r\n"])

  expect(line).not.toContain("\n")
  expect(JSON.parse(line)).toEqual([0.25, "o", "\u001b[32mok\u001b[0m\r\n"])
})

test("times are kept to microseconds", () => {
  expect(JSON.parse(castEvent([1 / 3, "o", "x"]))[0]).toBe(0.333333)
})

test("a cast is the header then one line per event, newline-terminated", () => {
  const text = toCast({ width: 10, height: 2 }, [
    [0, "o", "a"],
    [0.5, "o", "b"],
  ])

  expect(text.endsWith("\n")).toBe(true)
  expect(text.trimEnd().split("\n")).toEqual([
    '{"version":2,"width":10,"height":2}',
    '[0,"o","a"]',
    '[0.5,"o","b"]',
  ])
})

// Clock jitter can stamp a later read a hair earlier. Reordering would change
// what the terminal shows; clamping keeps the bytes in arrival order.
test("time never goes backwards, and order is preserved", () => {
  const { events } = parseCast(
    toCast({ width: 10, height: 2 }, [
      [0.2, "o", "first"],
      [0.1, "o", "second"],
      [0.3, "o", "third"],
    ]),
  )

  expect(events.map(([, , data]) => data)).toEqual(["first", "second", "third"])
  expect(events.map(([time]) => time)).toEqual([0.2, 0.2, 0.3])
})

test("an empty recording is still a valid cast", () => {
  const { header, events } = parseCast(toCast({ width: 10, height: 2 }, []))

  expect(header.version).toBe(2)
  expect(events).toEqual([])
})

test("parsing refuses what is not asciicast v2", () => {
  expect(() => parseCast("")).toThrow(/empty/)
  expect(() => parseCast('{"version":1}\n')).toThrow(/version 1/)
})
