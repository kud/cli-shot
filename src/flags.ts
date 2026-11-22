import type { MovieOptions } from "./movie.js"

type Raw = {
  fps?: string
  speed?: string
  maxDuration?: string
  loop?: string
  scale?: string
}

const number = (
  flag: string,
  value: string,
  check: (n: number) => boolean,
  rule: string,
) => {
  const parsed = Number(value)
  if (value.trim() === "" || !Number.isFinite(parsed) || !check(parsed)) {
    throw new Error(`${flag} must be ${rule}, got ${JSON.stringify(value)}.`)
  }
  return parsed
}

/**
 * Read the --fps, --speed, --max-duration, --loop and --scale flags into
 * movie options, refusing a value that would otherwise surface as an ffmpeg
 * error several seconds and one browser launch later. Absent flags stay
 * absent, so the defaults live in one place: movie.ts.
 */
export const movieFlags = ({
  fps,
  speed,
  maxDuration,
  loop,
  scale,
}: Raw): MovieOptions => ({
  ...(fps !== undefined && {
    fps: number(
      "--fps",
      fps,
      (n) => n > 0 && n <= 50,
      "a number above 0 and at most 50",
    ),
  }),
  ...(speed !== undefined && {
    speed: number("--speed", speed, (n) => n > 0, "a number above 0"),
  }),
  ...(maxDuration !== undefined && {
    maxDuration: number(
      "--max-duration",
      maxDuration,
      (n) => n > 0,
      "a number of seconds above 0",
    ),
  }),
  ...(loop !== undefined && {
    loop: number(
      "--loop",
      loop,
      (n) => Number.isInteger(n) && n >= 0,
      "a whole number, 0 for forever",
    ),
  }),
  ...(scale !== undefined && {
    scale: number(
      "--scale",
      scale,
      (n) => n > 0 && n <= 4,
      "a number above 0 and at most 4",
    ),
  }),
})
