import { describe, expect, it } from "vitest";
import {
  BROKEN_PIPE_CODES,
  BROKEN_PIPE_EXIT_CODE,
  isBrokenPipe,
  outputMode,
  stdioFor,
  writeIgnoringBrokenPipe,
} from "./broken-pipe.mjs";

describe("recognising the reader going away", () => {
  it("accepts every code that means the destination is gone", () => {
    for (const code of BROKEN_PIPE_CODES) {
      expect(isBrokenPipe(Object.assign(new Error("write failed"), { code }))).toBe(true);
    }
  });

  it("rejects a fault that deserves to be reported instead of swallowed", () => {
    expect(isBrokenPipe(Object.assign(new Error("disk full"), { code: "ENOSPC" }))).toBe(false);
    expect(isBrokenPipe(new Error("no code at all"))).toBe(false);
  });

  it("rejects non-errors rather than throwing on them", () => {
    expect(isBrokenPipe(null)).toBe(false);
    expect(isBrokenPipe(undefined)).toBe(false);
    expect(isBrokenPipe("EPIPE")).toBe(false);
  });
});

describe("choosing how to wire the child's output", () => {
  it("inherits on a TTY, where there is no reader that can walk away", () => {
    expect(outputMode(true)).toBe("inherit");
    expect(stdioFor(outputMode(true))).toBe("inherit");
  });

  it("forwards when stdout is not a TTY, so the parent can see the destination fail", () => {
    expect(outputMode(false)).toBe("forward");
    expect(stdioFor(outputMode(false))).toEqual(["inherit", "pipe", "pipe"]);
  });

  it("keeps stdin inherited in both modes, so a watch run stays interactive", () => {
    expect(stdioFor("inherit")).toBe("inherit");
    expect(stdioFor("forward")[0]).toBe("inherit");
  });
});

describe("the guard's own messages", () => {
  it("writes through when the stream is healthy", () => {
    const written = [];
    writeIgnoringBrokenPipe({ write: (text) => written.push(text) }, "test: hello\n");
    expect(written).toEqual(["test: hello\n"]);
  });

  it("swallows a broken pipe, so reporting cannot strand a held lock", () => {
    const stream = {
      write() {
        throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      },
    };
    expect(() => writeIgnoringBrokenPipe(stream, "test: hello\n")).not.toThrow();
  });

  it("still surfaces a real write failure rather than hiding every error", () => {
    const stream = {
      write() {
        throw Object.assign(new Error("no space left"), { code: "ENOSPC" });
      },
    };
    expect(() => writeIgnoringBrokenPipe(stream, "test: hello\n")).toThrow(/no space left/);
  });
});

describe("the exit code for a run cut short", () => {
  it("is the conventional 128 + SIGPIPE, and neither a pass nor a test failure", () => {
    expect(BROKEN_PIPE_EXIT_CODE).toBe(141);
    expect(BROKEN_PIPE_EXIT_CODE).not.toBe(0);
    expect(BROKEN_PIPE_EXIT_CODE).not.toBe(1);
  });
});
