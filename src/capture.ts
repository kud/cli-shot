import { accessSync, constants, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { spawn } from "node-pty"
// @xterm/headless is CommonJS and exposes Terminal only through the default
// export, so a named import type-checks against its .d.ts and then fails at
// runtime with "does not provide an export named 'Terminal'".
import headless from "@xterm/headless"
import { SerializeAddon } from "@xterm/addon-serialize"

const { Terminal } = headless

// node-pty spawns a small helper binary, and "posix_spawnp failed" is all it
// says when that helper is not executable. Its prebuilds ship without the mode
// bit and the postinstall that sets it is the first thing an npm allow-scripts
// policy blocks — so the common cause is a permission, not a bad command, and
// the raw error points at neither.
const explainSpawnFailure = (error: unknown, command: string): Error => {
  const message = error instanceof Error ? error.message : String(error)
  const helper = helperPath()
  const notExecutable =
    message.includes("posix_spawnp") &&
    helper !== undefined &&
    !isExecutable(helper)

  return new Error(
    `Could not open a pty for ${command}: ${message}\n` +
      (notExecutable
        ? `  node-pty's helper is not executable. Fix with:\n` +
          `    chmod +x ${helper}\n` +
          `  It ships without the mode bit when install scripts are blocked;\n` +
          `  npm approve-scripts node-pty makes it survive a reinstall.`
        : `  Check that the command exists and is executable.`),
    { cause: error },
  )
}

const helperPath = (): string | undefined => {
  const candidate = createRequire(import.meta.url)
    .resolve("node-pty")
    .replace(
      /node-pty\/.*$/,
      `node-pty/prebuilds/${process.platform}-${process.arch}/spawn-helper`,
    )
  return existsSync(candidate) ? candidate : undefined
}

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export type CaptureOptions = {
  cols?: number
  rows?: number
  /** Milliseconds of silence that count as "finished drawing". */
  settle?: number
  /** Hard limit before the child is killed regardless. */
  timeout?: number
  env?: NodeJS.ProcessEnv
  /** Keystrokes sent once the first draw has settled, for state a flag cannot name. */
  keys?: string
}

// A pty hands back every redraw in order, not a picture of the screen. Written
// straight out, a capture is the whole animation concatenated — plus the escape
// that switched to the alternate screen — which renders as noise rather than a
// screenshot.
//
// So the stream is fed to a real terminal emulator, which resolves it to the
// character grid a user would be looking at, and only that grid is serialised.
// Cursor moves, clears and repaints all collapse the way they do on screen.
export const capture = (
  command: string,
  args: readonly string[] = [],
  {
    cols = 110,
    rows = 32,
    settle = 800,
    timeout = 15_000,
    env,
    keys,
  }: CaptureOptions = {},
): Promise<string> =>
  new Promise((resolve, reject) => {
    const term = new Terminal({ cols, rows, allowProposedApi: true })
    const serializer = new SerializeAddon()
    term.loadAddon(serializer)

    let pty: ReturnType<typeof spawn>
    try {
      pty = spawn(command, [...args], {
        name: "xterm-256color",
        cols,
        rows,
        env: { ...process.env, ...env } as Record<string, string>,
      })
    } catch (error) {
      reject(explainSpawnFailure(error, command))
      return
    }

    let raw = 0
    let sentKeys = false
    let finished = false
    let previous = ""

    const finish = () => {
      if (finished) return
      finished = true
      clearInterval(poll)
      clearTimeout(hard)
      try {
        pty.kill()
      } catch {
        // Already gone — a command that exits on its own is the normal case.
      }
      // xterm's write queue is asynchronous, so serialising without flushing
      // first returns whatever happened to have been parsed by then.
      term.write("", () => resolve(serializer.serialize()))
    }

    // What settles is the SCREEN, not the stream. An Ink TUI keeps emitting
    // cursor moves and repaints long after it looks finished, so waiting for the
    // stream to go quiet never fires — every capture ran to the hard timeout,
    // which is where the seconds were going. Comparing the rendered grid instead
    // ends the wait as soon as the picture stops changing, however much traffic
    // is still flowing.
    //
    // Reading the grid also distinguishes "finished" from "has not started":
    // an empty screen is never stable, so a slow startup keeps waiting.
    const grid = () => {
      const buffer = term.buffer.active
      const lines: string[] = []
      for (let y = 0; y < buffer.length; y++) {
        lines.push(buffer.getLine(y)?.translateToString(true) ?? "")
      }
      return lines.join("\n")
    }

    const poll = setInterval(() => {
      const current = grid()
      if (current.trim() && current === previous) {
        if (keys && !sentKeys) {
          sentKeys = true
          pty.write(keys)
          previous = ""
          return
        }
        finish()
        return
      }
      previous = current
    }, settle)

    const hard = setTimeout(finish, timeout)

    pty.onData((data) => {
      raw += data.length
      term.write(data)
    })

    // node-pty does not always throw for a command that cannot be run — it
    // forks, fails inside the child, and reports it as an exit. Resolving that
    // as an empty capture would hand freeze nothing and blame the renderer, so
    // a non-zero exit that drew nothing rejects here where the cause is known.
    pty.onExit(({ exitCode }) => {
      if (exitCode !== 0 && raw === 0) {
        finished = true
        clearInterval(poll)
        clearTimeout(hard)
        reject(
          explainSpawnFailure(
            new Error(`exited ${exitCode} without drawing anything`),
            command,
          ),
        )
        return
      }
      // A command that exits on its own has drawn everything it is going to.
      finish()
    })
  })
