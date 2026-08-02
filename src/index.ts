import { join } from "node:path"
import { capture, type CaptureOptions } from "./capture.js"
import { listScreens } from "./screens.js"
import { toImage, type RenderOptions } from "./render.js"

export { capture, type CaptureOptions } from "./capture.js"
export { listScreens } from "./screens.js"
export { toImage, type RenderOptions } from "./render.js"

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

// Every screen the CLI admits to having, rather than a list kept here. A tab
// added to the app appears in the next run's output without this package being
// touched — and one that was quietly never captured stops being invisible.
export const shootAll = async (options: ShootOptions): Promise<string[]> => {
  const screens = listScreens(options.command, options.args ?? [])
  const written: string[] = []
  for (const screen of screens) {
    written.push(await shootScreen(screen, options))
  }
  return written
}
