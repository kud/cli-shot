import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

export type RenderOptions = {
  /** Extra flags passed straight to freeze, e.g. ["--theme", "nord"]. */
  freezeArgs?: readonly string[]
}

// The ANSI goes in over stdin rather than as a file argument, and the reason is
// worth keeping: freeze prefers piped stdin whenever stdin is not a terminal.
// Spawned from Node it never is — so passing a path while the child holds an
// empty pipe makes freeze read the pipe, ignore the path, and fail with "No
// input" naming neither. Piping is both correct and shorter: no temp file.
//
// freeze also needs telling the content is ANSI. Left to guess it highlights
// the escape codes as source, which looks convincingly like a rendering bug.
export const toImage = (
  ansi: string,
  output: string,
  { freezeArgs = [] }: RenderOptions = {},
): string => {
  const args = ["--language", "ansi", "--output", output, ...freezeArgs]
  mkdirSync(dirname(output), { recursive: true })

  try {
    execFileSync("freeze", args, { input: ansi })
    return output
  } catch (error) {
    const detail = String((error as { stdout?: unknown }).stdout ?? "").trim()
    throw new Error(
      `freeze failed for ${output}\n` +
        `  command: freeze ${args.join(" ")}\n` +
        `  input:   ${ansi.length} chars over stdin\n` +
        (detail ? `  said:    ${detail.replace(/\s+/g, " ")}` : ""),
      { cause: error },
    )
  }
}
