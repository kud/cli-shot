import { cpus } from "node:os"
import { join } from "node:path"
import { capture, type CaptureOptions } from "./capture.js"
import { listScreens } from "./screens.js"
import { toImage, type RenderOptions } from "./render.js"

export { capture, type CaptureOptions } from "./capture.js"
export { listScreens } from "./screens.js"
export { toImage, DEFAULT_FONT, type RenderOptions } from "./render.js"

export type ShootOptions = CaptureOptions &
  RenderOptions & {
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
  }

const screenArgs = (
  args: readonly string[],
  screen: string,
  mock: boolean,
): string[] => [...args, ...(mock ? ["--mock"] : []), "--screen", screen]

export const shootScreen = async (
  screen: string,
  { command, args = [], out, mock = true, ...rest }: ShootOptions,
): Promise<string> => {
  const ansi = await capture(command, screenArgs(args, screen, mock), rest)
  return toImage(ansi, join(out, `${screen}.png`), rest)
}

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
  const screens = listScreens(options.command, options.args ?? [])
  return pool(screens, options.concurrency ?? defaultConcurrency(), (screen) =>
    shootScreen(screen, options),
  )
}
