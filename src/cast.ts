// asciicast v2: one JSON header line, then one JSON array per event.
// https://docs.asciinema.org/manual/asciicast/v2/
//
// Newline-delimited rather than one JSON document so a recording can be
// appended to as it happens and streamed back without parsing the whole file —
// which is also why every line, header included, must stay on one line.

/** `o` output, `i` input, `r` resize ("COLSxROWS"), `m` marker. */
export type CastEventCode = "o" | "i" | "r" | "m"

/** Seconds since the recording started, the event code, and its data. */
export type CastEvent = readonly [time: number, code: CastEventCode, data: string]

export type CastHeader = {
  /** Terminal columns. */
  width: number
  /** Terminal rows. */
  height: number
  /** Unix time, in seconds, the recording started. */
  timestamp?: number
  /** Gaps longer than this are shortened to it on replay, in seconds. */
  idleTimeLimit?: number
  title?: string
  /** Only TERM and SHELL are meaningful to players. */
  env?: Record<string, string>
}

// Microseconds are the finest resolution a pty read is worth; anything past
// that is float noise, and it makes every cast diff on every line.
const seconds = (value: number): number => Math.round(value * 1e6) / 1e6

export const castHeader = ({
  width,
  height,
  timestamp,
  idleTimeLimit,
  title,
  env,
}: CastHeader): string => {
  if (!Number.isInteger(width) || width < 1)
    throw new Error(`cast width must be a positive integer, got ${width}`)
  if (!Number.isInteger(height) || height < 1)
    throw new Error(`cast height must be a positive integer, got ${height}`)

  // Key order follows the spec's own listing, and optional keys are left out
  // rather than written as null: players differ on whether null means absent.
  return JSON.stringify({
    version: 2,
    width,
    height,
    ...(timestamp !== undefined && { timestamp: Math.floor(timestamp) }),
    ...(idleTimeLimit !== undefined && { idle_time_limit: idleTimeLimit }),
    ...(title !== undefined && { title }),
    ...(env !== undefined && { env }),
  })
}

export const castEvent = ([time, code, data]: CastEvent): string =>
  JSON.stringify([seconds(time), code, data])

// Times must never go backwards: a player sleeping for a negative interval
// either throws or jumps, depending on which one. Clock jitter between two
// reads is the realistic cause, so a late-stamped event is pulled forward to
// its predecessor rather than reordered — the bytes must stay in the order the
// terminal received them.
export const toCast = (header: CastHeader, events: readonly CastEvent[]): string => {
  let last = 0
  const lines = events.map(([time, code, data]) => {
    last = Math.max(last, seconds(time))
    return castEvent([last, code, data])
  })
  return [castHeader(header), ...lines].join("\n") + "\n"
}

export type ParsedCast = {
  header: { version: 2; width: number; height: number } & Record<string, unknown>
  events: CastEvent[]
}

export const parseCast = (text: string): ParsedCast => {
  const [first, ...rest] = text.split("\n").filter((line) => line.trim())
  if (!first) throw new Error("empty cast")

  const header = JSON.parse(first)
  if (header.version !== 2)
    throw new Error(`unsupported asciicast version ${header.version}`)

  return { header, events: rest.map((line) => JSON.parse(line) as CastEvent) }
}
