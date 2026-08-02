import { execFileSync } from "node:child_process"

// The contract that keeps this package generic. A CLI declares its screens and
// this asks; the alternative is a table here of which keystrokes reach which
// tab in which tool, which would need editing every time any of them changed.
export const listScreens = (
  command: string,
  args: readonly string[] = [],
): string[] => {
  const printed = execFileSync(command, [...args, "--screen", "list"], {
    encoding: "utf8",
  })
  return printed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}
