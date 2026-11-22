import { test, expect } from "vitest"
import { movieFlags } from "./flags.js"

test("absent flags stay absent, so movie.ts keeps the defaults", () => {
  expect(movieFlags({})).toEqual({})
})

test("reads every movie flag as a number", () => {
  expect(
    movieFlags({
      fps: "24",
      speed: "1.5",
      maxDuration: "8",
      loop: "3",
      scale: "2",
    }),
  ).toEqual({ fps: 24, speed: 1.5, maxDuration: 8, loop: 3, scale: 2 })
})

test("--loop 0 means forever and is accepted", () => {
  expect(movieFlags({ loop: "0" })).toEqual({ loop: 0 })
})

test.each([
  [{ fps: "0" }, /--fps must be a number above 0 and at most 50, got "0"/],
  [{ fps: "60" }, /--fps/],
  [{ fps: "fast" }, /--fps/],
  [{ speed: "-1" }, /--speed must be a number above 0/],
  [{ maxDuration: "" }, /--max-duration/],
  [{ loop: "1.5" }, /--loop must be a whole number/],
  [{ loop: "-1" }, /--loop/],
  [{ scale: "8" }, /--scale/],
])("refuses %o before any browser is launched", (raw, message) => {
  expect(() => movieFlags(raw)).toThrow(message)
})
