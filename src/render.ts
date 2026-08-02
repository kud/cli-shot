import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export type RenderOptions = {
  /** Extra flags passed straight to freeze, e.g. ["--theme", "nord"]. */
  freezeArgs?: readonly string[]
}

// freeze reads a file rather than stdin, and needs telling the content is ANSI
// — left to guess it syntax-highlights the escape codes as source, which looks
// convincingly like a rendering bug.
export const toImage = (
  ansi: string,
  output: string,
  { freezeArgs = [] }: RenderOptions = {},
): string => {
  const staging = mkdtempSync(join(tmpdir(), "cli-shot-"))
  const source = join(staging, "capture.ansi")

  try {
    writeFileSync(source, ansi)
    mkdirSync(dirname(output), { recursive: true })
    execFileSync(
      "freeze",
      ["--language", "ansi", source, "--output", output, ...freezeArgs],
      { encoding: "utf8" },
    )
    return output
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
