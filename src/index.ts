import { mkdirSync, writeFileSync } from "node:fs"
import { cpus } from "node:os"
import { basename, join } from "node:path"
import {
  capture,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  type CaptureOptions,
} from "./capture.js"
import { toCast, type CastEvent } from "./cast.js"
import { listScreens } from "./screens.js"
import { toImage, type RenderOptions } from "./render.js"
import { buildPlayer } from "./web.js"
import {
  launchBrowser,
  toMovie,
  MOVIE_FORMATS,
  type MovieBrowser,
  type MovieOptions,
} from "./movie.js"

export { capture, type CaptureOptions } from "./capture.js"
export {
  toCast,
  parseCast,
  castHeader,
  castEvent,
  type CastHeader,
  type CastEvent,
  type CastEventCode,
  type ParsedCast,
} from "./cast.js"
export { listScreens } from "./screens.js"
export { buildPlayer, VERCEL_CONFIG, type PlayerOptions } from "./web.js"
export { toImage, DEFAULT_FONT, type RenderOptions } from "./render.js"
export {
  toMovie,
  movieFrames,
  launchBrowser,
  hasFfmpeg,
  MOVIE_FORMATS,
  DEFAULT_FPS,
  DEFAULT_HOLD,
  type MovieFormat,
  type MovieFrame,
  type MovieInput,
  type MovieOptions,
  type MovieBrowser,
} from "./movie.js"

export type ShootOptions = CaptureOptions &
  RenderOptions &
  MovieOptions & {
    /** The CLI to drive. */
    command: string
    /** Arguments before the ones this adds. */
    args?: readonly string[]
    /** Directory the PNGs are written to. */
    out: string
    /**
     * Drive from fixtures. On by default, and it should stay that way: a
     * folder listing says more about someone than they usually intend, and a
     * screenshot outlives the moment it was taken.
     */
    mock?: boolean
    /** How many screens to shoot at once. Defaults to the core count. */
    concurrency?: number
    /**
     * What to write: `png` (rendered through freeze), `cast` (an asciicast v2
     * recording of the same capture), `web` (the casts plus a static replay
     * page, deployable as is), and/or `gif` / `mp4` (that page's window,
     * filmed). Defaults to `["png"]`.
     */
    formats?: readonly Format[]
    /** Title of the `web` page, and of the gif/mp4 window. Defaults to the command's name. */
    title?: string
    /** Browser to film gif/mp4 in, shared across screens; launched per screen otherwise. */
    browser?: MovieBrowser
    /** `<base href>` for the `web` page, when served under another path. */
    base?: string
  }

export const FORMATS = ["png", "cast", "web", ...MOVIE_FORMATS] as const
export type Format = (typeof FORMATS)[number]

// Everything after `--` is the caller's, and it wins. cli-shot fills in only
// what is absent — appending a second --screen made the app read the caller's
// while the filename came from cli-shot's, which wrote a files.png holding the
// Sync screen with exit 0 and no warning.
export const drivenScreen = (args: readonly string[]): string | undefined => {
  const at = args.indexOf("--screen")
  return at === -1 ? undefined : args[at + 1]
}

const screenArgs = (
  args: readonly string[],
  screen: string,
  mock: boolean,
): string[] => [
  ...args,
  ...(mock && !args.includes("--mock") ? ["--mock"] : []),
  ...(drivenScreen(args) === undefined ? ["--screen", screen] : []),
]

// One capture feeds every format. The recording is the raw stream up to the
// moment the screen settled, and the PNG is the grid at that same moment — so
// a cast always ends on the frame its PNG shows, which two separate runs of a
// live CLI could not promise.
export const shootFormats = async (
  screen: string,
  {
    command,
    args = [],
    out,
    mock = true,
    formats = ["png"],
    title = basename(command),
    browser,
    ...rest
  }: ShootOptions,
): Promise<string[]> => {
  const events: CastEvent[] = []
  // The page replays casts, so asking for it is asking for them too. A movie
  // is filmed from a cast as well, but keeps it only if it was asked for.
  const movies = MOVIE_FORMATS.filter((format) => formats.includes(format))
  const keepCast = formats.includes("cast") || formats.includes("web")
  const recording = keepCast || movies.length > 0
  const startedAt = Date.now() / 1000

  const ansi = await capture(command, screenArgs(args, screen, mock), {
    ...rest,
    onOutput: recording
      ? (data, elapsed) => {
          events.push([elapsed / 1000, "o", data])
          rest.onOutput?.(data, elapsed)
        }
      : rest.onOutput,
  })

  const written: string[] = []
  if (formats.includes("png")) {
    written.push(toImage(ansi, join(out, `${screen}.png`), rest))
  }
  if (!recording) return written

  const cast = toCast(
    {
      width: rest.cols ?? DEFAULT_COLS,
      height: rest.rows ?? DEFAULT_ROWS,
      timestamp: startedAt,
      title: screen,
      env: { TERM: "xterm-256color" },
    },
    events,
  )
  if (keepCast) {
    const path = join(out, `${screen}.cast`)
    mkdirSync(out, { recursive: true })
    writeFileSync(path, cast)
    written.push(path)
  }
  for (const format of movies) {
    written.push(
      await toMovie({
        ...rest,
        cast,
        screen,
        title,
        format,
        browser,
        output: join(out, `${screen}.${format}`),
      }),
    )
  }
  return written
}

/** Shoot one screen to a PNG. See {@link shootFormats} for other formats. */
export const shootScreen = async (
  screen: string,
  options: ShootOptions,
): Promise<string> =>
  (await shootFormats(screen, { ...options, formats: ["png"] }))[0]!

// Each screen costs a pty and then a freeze render, both mostly CPU — so the
// core count is the useful ceiling. Measured on six pcloud screens: four jobs
// left the machine at 69% and took 23.7s; six saturated it and took 15.6s.
const defaultConcurrency = () => Math.max(2, Math.min(8, cpus().length))

// Screens are independent — separate processes, separate files — so they run
// concurrently. Capped rather than unbounded: each one holds a pty and then a
// freeze process, and a CLI with twenty screens would otherwise fork forty
// processes at once and finish slower than doing them in order.
const pool = async <T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await run(items[i]!, i)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return results
}

// Every screen the CLI admits to having, rather than a list kept here. A tab
// added to the app appears in the next run's output without this package being
// touched — and one that was quietly never captured stops being invisible.
export const shootAll = async (options: ShootOptions): Promise<string[]> => {
  // A screen named in the driven command is already an answer to "which one",
  // so there is nothing to enumerate — and the file takes its name.
  const pinned = drivenScreen(options.args ?? [])
  const screens = pinned
    ? [pinned]
    : listScreens(options.command, options.args ?? [])
  return shootScreens(screens, options)
}

/** Shoot the named screens in every requested format, and build the page if asked. */
export const shootScreens = async (
  screens: readonly string[],
  options: ShootOptions,
): Promise<string[]> => {
  // One browser films every screen: launching Chromium costs more than
  // filming a short screen in it.
  const filming = options.formats?.some((format) =>
    (MOVIE_FORMATS as readonly string[]).includes(format),
  )
  const browser =
    options.browser ?? (filming ? await launchBrowser() : undefined)

  let written: string[]
  try {
    written = (
      await pool(
        screens,
        options.concurrency ?? defaultConcurrency(),
        (screen) => shootFormats(screen, { ...options, browser }),
      )
    ).flat()
  } finally {
    if (browser !== options.browser) await browser?.close()
  }

  if (options.formats?.includes("web")) {
    written.push(
      ...buildPlayer({
        out: options.out,
        screens,
        title: options.title ?? basename(options.command),
        base: options.base,
      }),
    )
  }
  return written
}
