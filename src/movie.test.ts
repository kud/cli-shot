import { afterAll, beforeAll, describe, test, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { hasFfmpeg, movieFrames, toMovie } from "./movie.js"
import { shootAll } from "./index.js"

const total = (frames: { duration: number }[]) =>
  frames.reduce((sum, frame) => sum + frame.duration, 0)

describe("movieFrames", () => {
  test("keeps one still per change, held until the next", () => {
    const frames = movieFrames([0, 0.5, 0.5, 1], { fps: 10, hold: 0 })
    expect(frames.map((frame) => frame.count)).toEqual([1, 3, 4])
    expect(frames.map((frame) => +frame.duration.toFixed(3))).toEqual([
      0.5, 0.5, 0.1,
    ])
  })

  test("the last frame shows every event and carries the hold", () => {
    const frames = movieFrames([0, 0.2, 3], { fps: 15, hold: 2 })
    expect(frames.at(-1)!.count).toBe(3)
    expect(total(frames)).toBeCloseTo(3 + 1 / 15 + 2, 5)
  })

  test("speed shortens the replay", () => {
    const times = [0, 1, 2, 4]
    expect(total(movieFrames(times, { speed: 2, hold: 0 }))).toBeCloseTo(
      total(movieFrames(times, { hold: 0 })) / 2,
      1,
    )
  })

  test("a recording longer than the max duration is sped up, not cut", () => {
    const frames = movieFrames([0, 5, 10, 20], {
      fps: 10,
      maxDuration: 4,
      hold: 0,
    })
    expect(total(frames)).toBeCloseTo(4.1, 5)
    expect(frames.at(-1)!.count).toBe(4)
  })

  test("a max duration the recording already fits changes nothing", () => {
    const times = [0, 0.5, 1]
    expect(movieFrames(times, { maxDuration: 10 })).toEqual(movieFrames(times))
  })

  test("an empty recording is one held frame", () => {
    expect(movieFrames([], { hold: 1 })).toEqual([
      { count: 0, duration: 1 + 1 / 15 },
    ])
  })

  test.each([
    [{ fps: 0 }],
    [{ speed: 0 }],
    [{ maxDuration: -1 }],
    [{ hold: -1 }],
  ])("refuses %o", (options) => {
    expect(() => movieFrames([0, 1], options)).toThrow(/must/)
  })
})

// Filming needs a browser and ffmpeg. CI without either skips rather than
// fails; the frame maths above runs everywhere.
const hasPlaywright = (() => {
  try {
    createRequire(import.meta.url).resolve("playwright")
    return true
  } catch {
    return false
  }
})()
const canFilm = hasPlaywright && hasFfmpeg()

describe.skipIf(!canFilm)("toMovie, against the example recording", () => {
  const cast = readFileSync(
    fileURLToPath(new URL("../examples/casts/queue.cast", import.meta.url)),
    "utf8",
  )
  let out: string
  beforeAll(() => {
    out = mkdtempSync(join(tmpdir(), "cli-shot-movie-"))
  })
  afterAll(() => rmSync(out, { recursive: true, force: true }))

  const probe = (file: string) =>
    spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-show_entries",
        "stream=codec_name,width,height,nb_read_frames",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8" },
    )

  test("writes a small looping GIF of the window", async () => {
    const output = join(out, "queue.gif")
    await toMovie({
      cast,
      screen: "queue",
      title: "harbour",
      output,
      format: "gif",
      fps: 10,
    })

    const bytes = readFileSync(output)
    expect(bytes.subarray(0, 6).toString()).toBe("GIF89a")
    // NETSCAPE2.0 is the extension that makes a GIF loop.
    expect(bytes.includes("NETSCAPE2.0")).toBe(true)
    expect(bytes.length).toBeLessThan(200_000)

    const stream = JSON.parse(probe(output).stdout).streams[0]
    expect(stream.codec_name).toBe("gif")
    expect(stream.width).toBeGreaterThan(600)
    expect(Number(stream.nb_read_frames)).toBeGreaterThan(2)
  }, 60_000)

  test("--loop 1 plays once", async () => {
    const output = join(out, "once.gif")
    await toMovie({
      cast,
      screen: "queue",
      output,
      format: "gif",
      loop: 1,
      maxDuration: 1,
    })
    expect(readFileSync(output).includes("NETSCAPE2.0")).toBe(false)
  }, 60_000)

  test("writes an H.264 MP4 with even dimensions", async () => {
    const output = join(out, "queue.mp4")
    await toMovie({
      cast,
      screen: "queue",
      output,
      format: "mp4",
      maxDuration: 1,
    })

    const stream = JSON.parse(probe(output).stdout).streams[0]
    expect(stream.codec_name).toBe("h264")
    expect(stream.width % 2).toBe(0)
    expect(stream.height % 2).toBe(0)
  }, 60_000)
})

describe.skipIf(!canFilm)("--format gif, end to end", () => {
  const fixture = fileURLToPath(
    new URL("../examples/harbour.mjs", import.meta.url),
  )

  test("films every screen from its capture, without keeping a cast nobody asked for", async () => {
    const out = mkdtempSync(join(tmpdir(), "cli-shot-gif-"))
    try {
      const written = await shootAll({
        command: process.execPath,
        args: [fixture],
        out,
        formats: ["gif"],
        maxDuration: 1,
      })
      expect(written.map((path) => path.slice(out.length + 1)).sort()).toEqual([
        "log.gif",
        "queue.gif",
      ])
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 90_000)
})
