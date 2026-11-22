import { accessSync, chmodSync, constants, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// node-pty spawns a small helper binary, and "posix_spawnp failed" is all it
// says when that helper is not executable. Its macOS prebuilds can land without
// the mode bit — the postinstall that sets it is the first thing an npm
// allow-scripts policy blocks — so the common cause is a permission, not a bad
// command, and the raw error points at neither.
//
// Repairing it here, at the moment it fails, rather than in a postinstall of
// our own: an install script would be blocked by the same policy, and one that
// writes into another package's directory on every install is a larger thing
// to trust than a chmod on the one file that just failed.

export type HelperContext = {
  platform: NodeJS.Platform;
  arch: string;
  /** node-pty's package directory, or undefined when it cannot be resolved. */
  packageDir: string | undefined;
  chmod?: (path: string, mode: number) => void;
};

export type Repair =
  | { kind: "not-applicable" }
  | { kind: "repaired"; helper: string }
  | { kind: "unfixable"; helper: string; reason: string };

const nodePtyDir = (): string | undefined => {
  try {
    return dirname(
      createRequire(import.meta.url).resolve("node-pty/package.json"),
    );
  } catch {
    return undefined;
  }
};

export const currentContext = (): HelperContext => ({
  platform: process.platform,
  arch: process.arch,
  packageDir: nodePtyDir(),
});

export const helperPath = ({
  platform,
  arch,
  packageDir,
}: HelperContext): string | undefined => {
  if (!packageDir) return undefined;
  const candidate = join(
    packageDir,
    "prebuilds",
    `${platform}-${arch}`,
    "spawn-helper",
  );
  return existsSync(candidate) ? candidate : undefined;
};

export const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const isHelperFailure = (message: string): boolean =>
  message.includes("posix_spawnp");

// Only the macOS case is repaired: that is where node-pty uses the prebuilt
// helper through posix_spawnp, and where the missing bit has been seen. An
// executable helper means the failure lies elsewhere, so a chmod would change
// nothing and a retry would only fail again.
export const repairHelper = (
  message: string,
  context: HelperContext,
): Repair => {
  if (context.platform !== "darwin" || !isHelperFailure(message)) {
    return { kind: "not-applicable" };
  }
  const helper = helperPath(context);
  if (helper === undefined || isExecutable(helper)) {
    return { kind: "not-applicable" };
  }
  try {
    (context.chmod ?? chmodSync)(helper, 0o755);
  } catch (error) {
    return {
      kind: "unfixable",
      helper,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return { kind: "repaired", helper };
};

// Runs `spawn`, and if it throws the helper failure on macOS, repairs the
// helper once and tries once more. Whatever happens after that is the caller's
// to explain; the repair outcome travels with the error so it can.
export const spawnWithRepair = <T>(
  spawn: () => T,
  context: HelperContext = currentContext(),
): T => {
  try {
    return spawn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const repair = repairHelper(message, context);
    if (repair.kind !== "repaired") throw new HelperError(error, repair);
    try {
      return spawn();
    } catch (retryError) {
      throw new HelperError(retryError, repair);
    }
  }
};

export class HelperError extends Error {
  constructor(
    readonly original: unknown,
    readonly repair: Repair,
  ) {
    super(
      original instanceof Error ? original.message : String(original),
      { cause: original },
    );
  }
}
