import { flushSync } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { DroppedEntry } from "@magna-carta/design-system/dropzone";
import {
  beginDigests,
  digestOf,
  digestReadBytes,
  digestReadiness,
  digestSettled,
  forgetDigests,
  intakeReadiness,
  resetDigestsForTests,
} from "$lib/file-manager/upload-digests.svelte.ts";
import { intakeEntryKey } from "$lib/file-manager/upload-intake.ts";

/*
 * The register exists so a file is READ while it waits, not when its upload lane reaches it. What
 * that promises is asserted here: reading starts at the choice, a file is read once however many
 * callers want the answer, the reads run one behind another rather than all at once, and a caller
 * arriving mid-read is told where the read has got to rather than starting from zero.
 */

function entry(name: string, size = 4): DroppedEntry {
  return {
    file: new File(["x".repeat(size)], name, { lastModified: 1_700_000_000_000 }),
    relativePath: "",
  };
}

interface Pending {
  readonly name: string;
  readonly report: (bytes: number) => void;
  readonly answer: (digest: string | null) => void;
}

/** A stand-in read the test drives by hand, so "still reading" is a state it can hold. */
function drivenReads(): { pending: Pending[]; read: Parameters<typeof resetDigestsForTests>[0] } {
  const pending: Pending[] = [];
  return {
    pending,
    read: (file, options) =>
      new Promise<string | null>((resolve) => {
        pending.push({ name: file.name, report: options.onProgress, answer: resolve });
      }),
  };
}

/** The firm's answer, driven by hand: which digests it holds, and whether it can answer at all. */
function firmHolding(
  held: Set<string>,
  options: { readonly answers?: boolean } = {},
): Parameters<typeof resetDigestsForTests>[1] {
  return async ({ sha256 }) => {
    if (options.answers === false) return null;
    return held.has(sha256);
  };
}

const MATTER = "matter-1";

afterEach(() => {
  resetDigestsForTests();
});

async function turns(count = 10): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) await Promise.resolve();
}

describe("the digest register", () => {
  it("starts reading when files are chosen, one behind another rather than all at once", async () => {
    const { pending, read } = drivenReads();
    resetDigestsForTests(read);
    beginDigests([entry("a.pdf"), entry("b.pdf"), entry("c.pdf")], MATTER);
    await Promise.resolve();
    expect(pending.map((one) => one.name)).toEqual(["a.pdf"]);
    pending[0]?.answer("digest-a");
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    expect(pending.map((one) => one.name)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("reads a file once however many callers ask, and answers them all", async () => {
    const { pending, read } = drivenReads();
    resetDigestsForTests(read);
    const chosen = entry("brief.pdf");
    const first = digestOf(chosen);
    const second = digestOf(chosen);
    await Promise.resolve();
    expect(pending).toHaveLength(1);
    pending[0]?.answer("one-digest");
    expect(await first).toBe("one-digest");
    expect(await second).toBe("one-digest");
  });

  it("tells a caller arriving mid-read where the read has got to", async () => {
    const { pending, read } = drivenReads();
    resetDigestsForTests(read);
    const chosen = entry("big.pdf", 100);
    beginDigests([chosen], MATTER);
    await Promise.resolve();
    pending[0]?.report(40);
    const seen: number[] = [];
    const waiting = digestOf(chosen, { onProgress: (bytes) => seen.push(bytes) });
    // The first thing a late watcher hears is the bytes already read, not zero.
    expect(seen).toEqual([40]);
    pending[0]?.report(90);
    expect(seen).toEqual([40, 90]);
    pending[0]?.answer("done");
    await waiting;
  });

  it("reports the read to the rows that show it, and stops once it has answered", async () => {
    const { pending, read } = drivenReads();
    resetDigestsForTests(read);
    const chosen = entry("watched.pdf", 100);
    const key = intakeEntryKey(chosen);
    beginDigests([chosen], MATTER);
    await Promise.resolve();
    pending[0]?.report(25);
    flushSync();
    expect(digestReadBytes(key)).toBe(25);
    expect(digestSettled(key)).toBe(false);
    pending[0]?.answer("done");
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    flushSync();
    expect(digestSettled(key)).toBe(true);
  });

  it("abandons a read for a file the reader took back out, and reads it again if it returns", async () => {
    const { pending, read } = drivenReads();
    resetDigestsForTests(read);
    const chosen = entry("removed.pdf");
    beginDigests([chosen], MATTER);
    await Promise.resolve();
    expect(pending).toHaveLength(1);
    forgetDigests([intakeEntryKey(chosen)]);
    flushSync();
    expect(digestReadBytes(intakeEntryKey(chosen))).toBe(0);
    pending[0]?.answer(null);
    beginDigests([chosen], MATTER);
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    expect(pending).toHaveLength(2);
  });

  it("asks the firm once the digest is in, and reports ready or held per file", async () => {
    const asked: { sha256: string; matterId: string }[] = [];
    resetDigestsForTests(
      async (file) => `${file.name}-digest`,
      async (question) => {
        asked.push({ sha256: question.sha256, matterId: question.matterId });
        return question.sha256 === "held.pdf-digest";
      },
    );
    const fresh = entry("fresh.pdf");
    const held = entry("held.pdf");
    beginDigests([fresh, held], MATTER);
    await turns(30);
    flushSync();
    expect(asked).toEqual([
      { sha256: "fresh.pdf-digest", matterId: MATTER },
      { sha256: "held.pdf-digest", matterId: MATTER },
    ]);
    expect(digestReadiness(intakeEntryKey(fresh))).toBe("ready");
    expect(digestReadiness(intakeEntryKey(held))).toBe("held");
    // The same answers, in the shape the table reads.
    const readiness = intakeReadiness([fresh, held]);
    expect(readiness.get(intakeEntryKey(fresh))).toEqual({ stage: "ready" });
    expect(readiness.get(intakeEntryKey(held))).toEqual({ stage: "held" });
  });

  it("reads a file that could not be read as not read, and a firm that cannot answer as ready", async () => {
    resetDigestsForTests(
      async (file) => (file.name === "broken.pdf" ? null : `${file.name}-digest`),
      firmHolding(new Set(), { answers: false }),
    );
    const broken = entry("broken.pdf");
    const fine = entry("fine.pdf");
    beginDigests([broken, fine], MATTER);
    await turns(30);
    flushSync();
    expect(digestReadiness(intakeEntryKey(broken))).toBe("unread");
    // A host that cannot answer costs nothing but the file reading as ready.
    expect(digestReadiness(intakeEntryKey(fine))).toBe("ready");
  });

  it("reports a file still being read as reading, and one not yet begun as nothing at all", async () => {
    const { pending, read } = drivenReads();
    resetDigestsForTests(read, firmHolding(new Set()));
    const first = entry("first.pdf", 100);
    const second = entry("second.pdf", 100);
    beginDigests([first, second], MATTER);
    await Promise.resolve();
    pending[0]?.report(40);
    flushSync();
    const readiness = intakeReadiness([first, second]);
    expect(readiness.get(intakeEntryKey(first))).toEqual({ stage: "hashing", hashedBytes: 40 });
    // Queued behind the first: chosen, and that is all.
    expect(readiness.has(intakeEntryKey(second))).toBe(false);
    pending[0]?.answer("first-digest");
    await turns(30);
    flushSync();
    expect(intakeReadiness([first]).get(intakeEntryKey(first))).toEqual({ stage: "ready" });
  });

  it("keeps reading the files behind one whose read threw", async () => {
    const failing = new Set(["bad.pdf"]);
    const seen: string[] = [];
    resetDigestsForTests(async (file) => {
      seen.push(file.name);
      if (failing.has(file.name)) throw new Error("unreadable");
      return `${file.name}-digest`;
    });
    beginDigests([entry("bad.pdf"), entry("good.pdf")], MATTER);
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    expect(seen).toEqual(["bad.pdf", "good.pdf"]);
    expect(await digestOf(entry("good.pdf"))).toBe("good.pdf-digest");
  });
});
