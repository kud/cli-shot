import { spawn } from "node-pty";
// @xterm/headless is CommonJS and exposes Terminal only through the default
// export, so a named import type-checks against its .d.ts and then fails at
// runtime with "does not provide an export named 'Terminal'".
import headless from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import {
  HelperError,
  currentContext,
  helperPath,
  isExecutable,
  isHelperFailure,
  spawnWithRepair,
  type HelperContext,
  type Repair,
} from "./spawn-helper.js";

const { Terminal } = headless;

// How often the screen is sampled. Independent of `settle`, which is how long
// it must hold still to count as finished.
const TICK_MS = 60;

// node-pty's own messages, not an application's — matched narrowly so a CLI that
// legitimately prints "No such file or directory" is not mistaken for one that
// never ran.
const HELPER_FAILURE = /execvp\(\d\) failed|posix_spawnp failed/;

// The raw error from node-pty names neither the command nor the helper it
// could not start, so it is rewritten into one that says which file to fix and
// how, including after a repair attempt that did not take.
export const explainSpawnFailure = (
  error: unknown,
  command: string,
  repair: Repair = { kind: "not-applicable" },
  context: HelperContext = currentContext(),
): Error => {
  const message = error instanceof Error ? error.message : String(error);
  const fix = (helper: string) => `    chmod +x ${helper}\n`;

  let advice: string;
  if (repair.kind === "unfixable") {
    advice =
      `  node-pty's helper is not executable and could not be fixed (${repair.reason}):\n` +
      `    ${repair.helper}\n` +
      `  Fix with:\n` +
      fix(repair.helper);
  } else if (repair.kind === "repaired") {
    advice =
      `  node-pty's helper was made executable but the spawn still failed:\n` +
      `    ${repair.helper}\n` +
      `  If it lost the bit again, fix with:\n` +
      fix(repair.helper);
  } else {
    const helper = helperPath(context);
    advice =
      isHelperFailure(message) && helper !== undefined && !isExecutable(helper)
        ? `  node-pty's helper is not executable. Fix with:\n` +
          fix(helper) +
          `  It ships without the mode bit when install scripts are blocked;\n` +
          `  npm approve-scripts node-pty makes it survive a reinstall.`
        : `  Check that the command exists and is executable.`;
  }

  return new Error(
    `Could not open a pty for ${command}: ${message}\n${advice.trimEnd()}`,
    { cause: error },
  );
};

// Shared with anything that describes the capture afterwards, such as a cast
// header, so the size written down is the size the pty was opened at.
// A capture runs the command in a real pty, so it is interactive whatever the
// machine around it is. Build hosts (Vercel, GitHub Actions) set `CI`, and Ink
// reads that as "not interactive" and holds every frame until exit: a TUI that
// never exits then records nothing. The caller's own `env` still wins.
const CI_MARKERS = ["CI", "CONTINUOUS_INTEGRATION"] as const;

export const childEnv = (
  base: NodeJS.ProcessEnv,
  extra: NodeJS.ProcessEnv = {},
): Record<string, string> => {
  const merged: NodeJS.ProcessEnv = { ...base };
  for (const key of CI_MARKERS) delete merged[key];
  return Object.fromEntries(
    Object.entries({ ...merged, ...extra }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
};

export const DEFAULT_COLS = 110;
export const DEFAULT_ROWS = 32;

export type CaptureOptions = {
  cols?: number;
  rows?: number;
  /** How long the rendered screen must hold still to count as finished. */
  settle?: number;
  /** Hard limit before the child is killed regardless. */
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  /** Keystrokes sent once the first draw has settled, for state a flag cannot name. */
  keys?: string;
  /**
   * Every chunk the pty produced, in order, with milliseconds since spawn —
   * the raw stream before the emulator resolves it, which is what a recording
   * replays. Stops at the moment the capture does.
   */
  onOutput?: (data: string, elapsed: number) => void;
};

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
    cols = DEFAULT_COLS,
    rows = DEFAULT_ROWS,
    settle = 350,
    timeout = 15_000,
    env,
    keys,
    onOutput,
  }: CaptureOptions = {},
): Promise<string> =>
  new Promise((resolve, reject) => {
    const term = new Terminal({ cols, rows, allowProposedApi: true });
    const serializer = new SerializeAddon();
    term.loadAddon(serializer);

    let pty: ReturnType<typeof spawn>;
    try {
      pty = spawnWithRepair(() =>
        spawn(command, [...args], {
          name: "xterm-256color",
          cols,
          rows,
          env: childEnv(process.env, env),
        }),
      );
    } catch (error) {
      reject(
        error instanceof HelperError
          ? explainSpawnFailure(error.original, command, error.repair)
          : explainSpawnFailure(error, command),
      );
      return;
    }

    let raw = 0;
    // Kept alongside the terminal because xterm parses asynchronously: at exit
    // the grid may still be empty while the bytes have plainly arrived, so the
    // failure has to be looked for on the raw side of that queue.
    let rawText = "";
    let sentKeys = false;
    let finished = false;
    let previous = "";
    const started = performance.now();

    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      clearTimeout(hard);
      try {
        pty.kill();
      } catch {
        // Already gone — a command that exits on its own is the normal case.
      }
      // xterm's write queue is asynchronous, so serialising without flushing
      // first returns whatever happened to have been parsed by then.
      term.write("", () => resolve(serializer.serialize()));
    };

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
      const buffer = term.buffer.active;
      const lines: string[] = [];
      for (let y = 0; y < buffer.length; y++) {
        lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
      }
      return lines.join("\n");
    };

    // Sampled far more often than the stability window it is proving. Polling
    // once per `settle` would make the minimum wait two full windows — one
    // sample to record, one to compare — so a 800ms window cost 1.6s even on a
    // screen that was final immediately. Ticking finely decouples "how long the
    // screen must hold still" from "how soon we notice that it has".
    let stableFor = 0;
    const poll = setInterval(() => {
      const current = grid();

      if (current !== previous || !current.trim()) {
        previous = current;
        stableFor = 0;
        return;
      }

      stableFor += TICK_MS;
      if (stableFor < settle) return;

      if (keys && !sentKeys) {
        sentKeys = true;
        pty.write(keys);
        previous = "";
        stableFor = 0;
        return;
      }
      finish();
    }, TICK_MS);

    const hard = setTimeout(finish, timeout);

    pty.onData((data) => {
      // Bytes that arrive after the screen settled are not part of what was
      // captured; a recording that kept them would end on a different frame
      // from the PNG of the same screen.
      if (!finished) onOutput?.(data, performance.now() - started);
      raw += data.length;
      if (rawText.length < 2_048) rawText += data;
      term.write(data);
    });

    // node-pty does not always throw for a command that cannot be run — it
    // forks, fails inside the child, and reports it as an exit. Resolving that
    // as an empty capture would hand freeze nothing and blame the renderer, so
    // a non-zero exit that drew nothing rejects here where the cause is known.
    pty.onExit(({ exitCode }) => {
      // Platforms disagree about where the failure goes. macOS fails before the
      // child writes anything, so nothing is drawn. Linux writes the helper's
      // own "execvp(3) failed" into the pty and then exits — which counts as
      // having drawn, so a check on emptiness alone let it through and resolved
      // with that message as the screen. Left there, cli-shot would render a
      // PNG of the error rather than reporting one.
      if (exitCode !== 0 && (raw === 0 || HELPER_FAILURE.test(rawText))) {
        finished = true;
        clearInterval(poll);
        clearTimeout(hard);
        reject(
          explainSpawnFailure(
            new Error(
              `the command exited ${exitCode} without drawing a screen`,
            ),
            command,
          ),
        );
        return;
      }
      // A command that exits on its own has drawn everything it is going to.
      finish();
    });
  });
