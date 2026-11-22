import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, extname, join, relative, sep } from "node:path"
import { buildPlayer } from "./web.js"

export const MOVIE_FORMATS = ["gif", "mp4"] as const
export type MovieFormat = (typeof MOVIE_FORMATS)[number]

export type MovieOptions = {
  /** Frames per second the replay is sampled at. Defaults to 15. */
  fps?: number
  /** Playback speed: 2 plays twice as fast. Defaults to 1. */
  speed?: number
  /**
   * Longest the replay may run, in seconds, before the final hold. A longer
   * recording is sped up to fit rather than cut, so it still ends on the
   * settled frame — the one the PNG shows.
   */
  maxDuration?: number
  /** How long the final frame stays up, in seconds. Defaults to 2. */
  hold?: number
  /** GIF only: times to play, 0 for forever. Defaults to 0. */
  loop?: number
  /** Device pixels per CSS pixel. 2 is sharper and roughly three times larger. Defaults to 1. */
  scale?: number
}

export type MovieInput = MovieOptions & {
  /** The asciicast v2 text to replay. */
  cast: string
  /** Screen name, shown in the window's title bar. */
  screen: string
  /** Command name, shown before the screen in the title bar. */
  title?: string
  /** File to write: `.gif` or `.mp4`. */
  output: string
  format: MovieFormat
  /** A browser to reuse across several movies; one is launched and closed otherwise. */
  browser?: MovieBrowser
}

/** One still: how many events it shows, and for how long, in seconds. */
export type MovieFrame = { count: number; duration: number }

export const DEFAULT_FPS = 15
export const DEFAULT_HOLD = 2

/**
 * Sample a recording at `fps`, keeping only the ticks where something changed.
 * A terminal is still most of the time, so a frame per tick would mostly
 * repeat itself; one still held for the gap is the same picture, and far less
 * to screenshot and encode. The last frame always shows every event.
 */
export const movieFrames = (
  times: readonly number[],
  {
    fps = DEFAULT_FPS,
    speed = 1,
    maxDuration,
    hold = DEFAULT_HOLD,
  }: MovieOptions = {},
): MovieFrame[] => {
  if (!(fps > 0)) throw new Error(`fps must be positive, got ${fps}`)
  if (!(speed > 0)) throw new Error(`speed must be positive, got ${speed}`)
  if (maxDuration !== undefined && !(maxDuration > 0))
    throw new Error(`max duration must be positive, got ${maxDuration}`)
  if (!(hold >= 0)) throw new Error(`hold must not be negative, got ${hold}`)

  const last = times.at(-1) ?? 0
  const rate =
    maxDuration !== undefined && last / speed > maxDuration
      ? last / maxDuration
      : speed
  const ticks = Math.ceil((last / rate) * fps - 1e-9)

  const frames: MovieFrame[] = []
  let count = 0
  for (let tick = 0; tick <= ticks; tick++) {
    const at = (tick / fps) * rate + 1e-9
    while (count < times.length && times[count]! <= at) count++
    const previous = frames.at(-1)
    if (previous && previous.count === count) previous.duration += 1 / fps
    else frames.push({ count, duration: 1 / fps })
  }
  frames.at(-1)!.count = times.length
  frames.at(-1)!.duration += hold
  return frames
}

// The handful of Playwright calls used here, typed locally so Playwright stays
// an optional peer: most runs only want PNGs, and a browser is a heavy thing
// to install for them.
type Route = {
  request(): { url(): string }
  fulfill(response: { path: string; contentType: string }): Promise<void>
  abort(): Promise<void>
}
type Box = { x: number; y: number; width: number; height: number }
type Page = {
  route(url: string, handler: (route: Route) => unknown): Promise<void>
  goto(url: string): Promise<unknown>
  waitForSelector(selector: string): Promise<unknown>
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>
  locator(selector: string): { boundingBox(): Promise<Box | null> }
  screenshot(options: { path: string; clip: Box }): Promise<unknown>
  close(): Promise<void>
}
export type MovieBrowser = {
  newPage(options: {
    viewport: { width: number; height: number }
    deviceScaleFactor: number
  }): Promise<Page>
  close(): Promise<void>
}

/** Launch the headless Chromium movies are filmed in. Needs `playwright` installed. */
export const launchBrowser = async (): Promise<MovieBrowser> => {
  let playwright: { chromium: { launch(): Promise<MovieBrowser> } }
  try {
    // Through require rather than import(), so NODE_PATH and a global
    // install are honoured the way they are for any other CLI dependency.
    playwright = createRequire(import.meta.url)("playwright")
  } catch {
    throw new Error(
      "--format gif and mp4 film the web player in a headless browser, " +
        "and need Playwright:\n  npm install playwright && npx playwright install chromium",
    )
  }
  return playwright.chromium.launch()
}

/** Whether ffmpeg is on PATH; movies are encoded with it. */
export const hasFfmpeg = (): boolean =>
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".cast": "application/x-asciicast; charset=utf-8",
  ".woff2": "font/woff2",
}

// Served from a made-up origin and answered from disk, so the page loads as it
// would from a deployment — module scripts and fetch() both refuse file:// —
// without a local server or a port to find.
const ORIGIN = "http://cli-shot.invalid/"

// Room around the window for its shadow, in the page's own background.
const MARGIN = 24

const ffmpegArgs = (
  list: string,
  output: string,
  format: MovieFormat,
  { fps = DEFAULT_FPS, loop = 0 }: MovieOptions,
): string[] => {
  const input = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
  ]
  if (format === "gif") {
    // One palette for the whole film, built from what it shows, then applied
    // without dithering: terminal text is flat colour, and dither noise on it
    // costs bytes and reads as grain. Only the changed rectangle of each frame
    // is stored.
    return [
      ...input,
      "-filter_complex",
      "split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
      "-fps_mode",
      "vfr",
      // ffmpeg counts repeats after the first play: -1 plays once, 0 forever.
      "-loop",
      String(loop === 0 ? 0 : loop === 1 ? -1 : loop - 1),
      output,
    ]
  }
  // H.264 wants even dimensions and yuv420p to play everywhere; a constant
  // frame rate keeps every player's seek bar honest.
  return [
    ...input,
    "-vf",
    `pad=ceil(iw/2)*2:ceil(ih/2)*2:color=black,fps=${fps}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "20",
    "-tune",
    "stillimage",
    "-movflags",
    "+faststart",
    output,
  ]
}

/**
 * Film a recording in the web player's window and encode it as a GIF or MP4.
 * The frames are the player's own rendering, stepped on the recording's clock
 * rather than played in real time, so a slow machine films the same thing a
 * fast one does. Returns the path written.
 */
export const toMovie = async ({
  cast,
  screen,
  title = "cli-shot",
  output,
  format,
  browser,
  ...options
}: MovieInput): Promise<string> => {
  if (!hasFfmpeg()) {
    throw new Error(
      `--format ${format} encodes with ffmpeg, which is not on PATH. ` +
        "Install it (brew install ffmpeg, apt install ffmpeg) and run again.",
    )
  }
  const scale = options.scale ?? 1
  if (!(scale > 0)) throw new Error(`scale must be positive, got ${scale}`)

  const work = mkdtempSync(join(tmpdir(), "cli-shot-movie-"))
  const owned = browser ? undefined : await launchBrowser()
  const page = await (browser ?? owned)!.newPage({
    viewport: { width: 2400, height: 1600 },
    deviceScaleFactor: scale,
  })

  try {
    const site = join(work, "site")
    mkdirSync(site)
    writeFileSync(join(site, `${screen}.cast`), cast)
    buildPlayer({ out: site, screens: [screen], title })

    await page.route(`${ORIGIN}**`, (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname)
      const file = join(site, path.endsWith("/") ? `${path}index.html` : path)
      const inside = relative(site, file)
      if (inside.startsWith("..") || inside.startsWith(sep))
        return route.abort()
      return route.fulfill({
        path: file,
        contentType: CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      })
    })
    await page.goto(`${ORIGIN}?capture&theme=light`)
    await page.waitForSelector('.window[data-capture="ready"]')

    const times = await page.evaluate(
      () =>
        (window as unknown as { cliShotCapture: { times: number[] } })
          .cliShotCapture.times,
      undefined,
    )
    const box = await page.locator(".window").boundingBox()
    if (!box) throw new Error(`the player drew no window for ${screen}`)
    const clip = {
      x: Math.max(0, Math.floor(box.x - MARGIN)),
      y: Math.max(0, Math.floor(box.y - MARGIN)),
      width: Math.ceil(box.width + MARGIN * 2),
      height: Math.ceil(box.height + MARGIN * 2),
    }

    const frames = movieFrames(times, options)
    const list: string[] = []
    for (const [index, frame] of frames.entries()) {
      await page.evaluate(
        (count) =>
          (
            window as unknown as {
              cliShotCapture: { until(count: number): Promise<void> }
            }
          ).cliShotCapture.until(count),
        frame.count,
      )
      const still = join(work, `frame-${String(index).padStart(5, "0")}.png`)
      await page.screenshot({ path: still, clip })
      list.push(`file '${still}'`, `duration ${frame.duration.toFixed(6)}`)
    }
    // The concat demuxer drops the last entry's duration unless the file is
    // named once more after it.
    list.push(list.at(-2)!)
    const listFile = join(work, "frames.txt")
    writeFileSync(listFile, list.join("\n") + "\n")

    mkdirSync(dirname(output), { recursive: true })
    const args = ffmpegArgs(listFile, output, format, options)
    const result = spawnSync("ffmpeg", args, { encoding: "utf8" })
    if (result.status !== 0) {
      throw new Error(
        `ffmpeg failed for ${output}\n` +
          `  command: ffmpeg ${args.join(" ")}\n` +
          `  said:    ${(result.stderr || String(result.error ?? "")).trim().replace(/\s+/g, " ")}`,
      )
    }
    return output
  } finally {
    await page.close()
    await owned?.close()
    rmSync(work, { recursive: true, force: true })
  }
}
