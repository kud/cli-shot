import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { explainSpawnFailure } from "./capture.js";
import {
  HelperError,
  repairHelper,
  spawnWithRepair,
  type HelperContext,
} from "./spawn-helper.js";

const FAILURE = "posix_spawnp failed.";

let packageDir: string;
let helper: string;

// A fake node-pty install: only the layout and the mode bit matter here, so the
// darwin branch runs on any machine.
const install = (mode: number) => {
  const dir = join(packageDir, "prebuilds", "darwin-arm64");
  mkdirSync(dir, { recursive: true });
  helper = join(dir, "spawn-helper");
  writeFileSync(helper, "#!/bin/sh\n");
  chmodSync(helper, mode);
};

const darwin = (extra: Partial<HelperContext> = {}): HelperContext => ({
  platform: "darwin",
  arch: "arm64",
  packageDir,
  ...extra,
});

const executable = (path: string) => (statSync(path).mode & 0o111) !== 0;

beforeEach(() => {
  packageDir = mkdtempSync(join(tmpdir(), "cli-shot-pty-"));
});

afterEach(() => {
  rmSync(packageDir, { recursive: true, force: true });
});

describe("repairHelper", () => {
  it("sets the exec bit on a darwin helper that lacks it", () => {
    install(0o644);

    expect(repairHelper(FAILURE, darwin())).toEqual({
      kind: "repaired",
      helper,
    });
    expect(executable(helper)).toBe(true);
  });

  it("leaves an already executable helper alone, since the cause lies elsewhere", () => {
    install(0o755);

    expect(repairHelper(FAILURE, darwin()).kind).toBe("not-applicable");
  });

  it("does nothing off darwin", () => {
    install(0o644);

    expect(repairHelper(FAILURE, darwin({ platform: "linux" })).kind).toBe(
      "not-applicable",
    );
    expect(executable(helper)).toBe(false);
  });

  it("does nothing for an unrelated failure", () => {
    install(0o644);

    expect(repairHelper("ENOENT", darwin()).kind).toBe("not-applicable");
    expect(executable(helper)).toBe(false);
  });

  it("does nothing when the helper or node-pty cannot be found", () => {
    expect(repairHelper(FAILURE, darwin()).kind).toBe("not-applicable");
    expect(
      repairHelper(FAILURE, darwin({ packageDir: undefined })).kind,
    ).toBe("not-applicable");
  });

  it("reports a chmod that is refused instead of throwing", () => {
    install(0o644);
    const denied = () => {
      throw new Error("EACCES: permission denied");
    };

    expect(repairHelper(FAILURE, darwin({ chmod: denied }))).toEqual({
      kind: "unfixable",
      helper,
      reason: "EACCES: permission denied",
    });
  });
});

describe("spawnWithRepair", () => {
  it("retries once after repairing and returns the second spawn", () => {
    install(0o644);
    let calls = 0;
    const result = spawnWithRepair(() => {
      calls++;
      if (!executable(helper)) throw new Error(FAILURE);
      return "pty";
    }, darwin());

    expect(result).toBe("pty");
    expect(calls).toBe(2);
  });

  it("does not retry a failure it did not repair", () => {
    let calls = 0;
    const attempt = () =>
      spawnWithRepair(() => {
        calls++;
        throw new Error("ENOENT");
      }, darwin());

    expect(attempt).toThrow(HelperError);
    expect(calls).toBe(1);
  });

  it("gives up after one retry, carrying the repair with the error", () => {
    install(0o644);
    let calls = 0;
    let caught: unknown;
    try {
      spawnWithRepair(() => {
        calls++;
        throw new Error(FAILURE);
      }, darwin());
    } catch (error) {
      caught = error;
    }

    expect(calls).toBe(2);
    expect(caught).toBeInstanceOf(HelperError);
    expect((caught as HelperError).repair).toEqual({ kind: "repaired", helper });
  });
});

describe("explainSpawnFailure", () => {
  it("names the helper and the chmod when it could not be fixed", () => {
    install(0o644);
    const error = explainSpawnFailure(new Error(FAILURE), "pcloud", {
      kind: "unfixable",
      helper,
      reason: "EACCES: permission denied",
    });

    expect(error.message).toContain("Could not open a pty for pcloud");
    expect(error.message).toContain("EACCES: permission denied");
    expect(error.message).toContain(`chmod +x ${helper}`);
  });

  it("still names the chmod when the repair took but the retry failed", () => {
    install(0o755);
    const error = explainSpawnFailure(new Error(FAILURE), "pcloud", {
      kind: "repaired",
      helper,
    });

    expect(error.message).toContain(`chmod +x ${helper}`);
  });

  it("names the chmod for a non-executable helper without a repair attempt", () => {
    install(0o644);
    const error = explainSpawnFailure(
      new Error(FAILURE),
      "pcloud",
      { kind: "not-applicable" },
      darwin(),
    );

    expect(error.message).toContain(`chmod +x ${helper}`);
  });

  it("points at the command when the helper is not the cause", () => {
    install(0o755);
    const error = explainSpawnFailure(
      new Error(FAILURE),
      "pcloud",
      { kind: "not-applicable" },
      darwin(),
    );

    expect(error.message).toContain("Check that the command exists");
    expect(error.message).not.toContain("chmod");
  });
});
