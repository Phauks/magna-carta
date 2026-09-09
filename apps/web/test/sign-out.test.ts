import { describe, expect, it } from "vitest";
import {
  SIGN_OUT_FAILED,
  SIGNED_OUT_PATH,
  signOut,
  type SignOutSeams,
} from "../src/lib/auth/sign-out.ts";

// Signing out is three steps whose ORDER is the design (src/lib/auth/sign-out.ts), and none of the
// three is observable from a test that runs the real ones — the server call, the browser state and
// the document load all leave nothing behind to assert on. So the seams are recorded here and the
// order they ran in is what the suite actually pins.

interface Recorder {
  readonly seams: SignOutSeams;
  readonly steps: string[];
  readonly left: string[];
}

function recorder(endSession: () => Promise<{ error?: unknown }>): Recorder {
  const steps: string[] = [];
  const left: string[] = [];
  return {
    steps,
    left,
    seams: {
      endSession: async () => {
        steps.push("end-session");
        return endSession();
      },
      forgetLocalState: () => steps.push("forget-local-state"),
      leave: (path) => {
        steps.push("leave");
        left.push(path);
      },
    },
  };
}

const accepted = () => Promise.resolve({ error: null });

describe("signing out", () => {
  it("ends the session, then forgets local state, then leaves for the sign-in screen", async () => {
    const { seams, steps, left } = recorder(accepted);

    expect(await signOut(seams)).toEqual({ kind: "signed-out" });

    expect(steps).toEqual(["end-session", "forget-local-state", "leave"]);
    expect(left).toEqual([SIGNED_OUT_PATH]);
  });

  it("leaves with no return path: somebody who signed out is not on their way somewhere", async () => {
    const { seams, left } = recorder(accepted);
    await signOut(seams);
    expect(left[0]).not.toContain("next=");
  });

  // The refusal path is the one that matters on a shared machine: the cookie may still be live, so
  // a sign-out that could not be completed must not look like one that was.
  it("keeps local state and stays put when the server refuses", async () => {
    const { seams, steps, left } = recorder(() =>
      Promise.resolve({ error: { status: 500, message: "nope" } }),
    );

    expect(await signOut(seams)).toEqual({ kind: "failed", message: SIGN_OUT_FAILED });

    expect(steps).toEqual(["end-session"]);
    expect(left).toEqual([]);
  });

  it("treats no answer at all the same as a refusal", async () => {
    const { seams, steps } = recorder(() => Promise.reject(new Error("offline")));

    expect(await signOut(seams)).toEqual({ kind: "failed", message: SIGN_OUT_FAILED });

    expect(steps).toEqual(["end-session"]);
  });

  // Better Auth's client resolves `{ data, error }` and omits neither — but a version that answered
  // a bare `{}` on success would, read carelessly, be a sign-out that never left.
  it("reads an absent error as success", async () => {
    const { seams, left } = recorder(() => Promise.resolve({}));

    expect(await signOut(seams)).toEqual({ kind: "signed-out" });

    expect(left).toEqual([SIGNED_OUT_PATH]);
  });

  it("says the session is still open, so the sentence is actionable on a shared computer", () => {
    expect(SIGN_OUT_FAILED).toContain("still open");
  });
});
