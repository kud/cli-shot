import { spawn } from "node-pty"
// @xterm/headless is CommonJS and exposes Terminal only through the default
// export, so a named import type-checks against its .d.ts and then fails at
// runtime with "does not provide an export named 'Terminal'".
import headless from "@xterm/headless"
import { SerializeAddon } from "@xterm/addon-serialize"

const { Terminal } = headless

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
    cols = 120,
    rows = 36,
    settle = 700,
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
      reject(error)
      return
    }

    let idle: NodeJS.Timeout | undefined
    let sentKeys = false
    let finished = false

    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(idle)
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

    const onSettled = () => {
      if (keys && !sentKeys) {
        sentKeys = true
        pty.write(keys)
        idle = setTimeout(onSettled, settle)
        return
      }
      finish()
    }

    const hard = setTimeout(finish, timeout)

    pty.onData((data) => {
      term.write(data)
      clearTimeout(idle)
      idle = setTimeout(onSettled, settle)
    })

    pty.onExit(() => {
      clearTimeout(idle)
      idle = setTimeout(onSettled, 0)
    })
  })
