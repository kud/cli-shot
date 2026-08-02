import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

// A TUI draws its icons from the Nerd Font private use area, and freeze's stock
// font has nothing there — so every glyph renders as a tofu box printing its own
// codepoint, which looks like a bug in the app rather than a missing font. A
// Nerd Font by default is what makes a screenshot match the terminal it came
// from. Override for a machine that has a different one installed.
export const DEFAULT_FONT = "JetBrainsMono Nerd Font Mono"

export type RenderOptions = {
  /** Font family freeze renders with. Needs Nerd Font coverage for TUI icons. */
  font?: string
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
  { font = DEFAULT_FONT, freezeArgs = [] }: RenderOptions = {},
): string => {
  const args = [
    "--language",
    "ansi",
    "--output",
    output,
    "--font.family",
    font,
    ...freezeArgs,
  ]
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
