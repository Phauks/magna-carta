import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ledgerVolume, scaleProfile } from "../src/load-profile/profile.ts";
import { loadProfileSnapshot, type LoadedSnapshot } from "../src/load-profile/snapshot.ts";

const TINY = scaleProfile(ledgerVolume, 0.002);

describe("load-profile snapshots", () => {
  const temporaryDirectories: string[] = [];
  const openSnapshots: LoadedSnapshot[] = [];
  const newCacheDirectory = () => {
    const directory = mkdtempSync(join(tmpdir(), "mc-load-profile-cache-"));
    temporaryDirectories.push(directory);
    return directory;
  };
  // Every snapshot goes through here: its handle joins the close list (a mid-test assertion
  // failure must not leak an open handle into an EPERM cleanup error on Windows) and its
  // working-copy directory — created OUTSIDE the cache directory — joins the cleanup list.
  const track = (snapshot: LoadedSnapshot): LoadedSnapshot => {
    openSnapshots.push(snapshot);
    temporaryDirectories.push(dirname(snapshot.workingPath));
    return snapshot;
  };
  afterEach(() => {
    // Close handles before cleanup — Windows refuses to delete a file another handle still
    // holds open. close() is idempotent, so snapshots the test already closed are fine.
    for (const snapshot of openSnapshots.splice(0)) {
      snapshot.close();
    }
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("generates on a cache miss, replays on a hit, and the replayed data is intact", async () => {
    const cacheDirectory = newCacheDirectory();
    let generations = 0;
    const options = {
      allowSeeding: true as const,
      cacheDirectory,
      onGenerate: () => {
        generations += 1;
      },
    };

    const first = track(await loadProfileSnapshot(TINY, "snap-seed", options));
    expect(generations).toBe(1);
    expect(existsSync(join(cacheDirectory, `${first.cacheKey}.sqlite`))).toBe(true);
    expect(existsSync(join(cacheDirectory, `${first.cacheKey}.json`))).toBe(true);
    const { results: firstCount } = await first.database
      .prepare("SELECT COUNT(*) AS n FROM ledger_entry")
      .all<{ n: number }>();
    first.close();

    const second = track(await loadProfileSnapshot(TINY, "snap-seed", options));
    expect(generations).toBe(1); // replayed, not regenerated
    const { results: secondCount } = await second.database
      .prepare("SELECT COUNT(*) AS n FROM ledger_entry")
      .all<{ n: number }>();
    expect(secondCount).toEqual(firstCount);
    expect(second.manifest.probes.busySubledgerAccountId).toBe(
      first.manifest.probes.busySubledgerAccountId,
    );
    second.close();
  });

  it("regenerates when snapshot identity changes (profile version bump)", async () => {
    const cacheDirectory = newCacheDirectory();
    let generations = 0;
    const options = {
      allowSeeding: true as const,
      cacheDirectory,
      onGenerate: () => {
        generations += 1;
      },
    };
    const first = track(await loadProfileSnapshot(TINY, "ident-seed", options));
    first.close();
    const bumped = { ...TINY, version: TINY.version + 1 };
    const second = track(await loadProfileSnapshot(bumped, "ident-seed", options));
    second.close();
    expect(generations).toBe(2);
    expect(second.cacheKey).not.toBe(first.cacheKey);
  });

  it("hands out an isolated working copy — writes never touch the cached artifact", async () => {
    const cacheDirectory = newCacheDirectory();
    const options = { allowSeeding: true as const, cacheDirectory };
    const first = track(await loadProfileSnapshot(TINY, "copy-seed", options));
    const artifactPath = join(cacheDirectory, `${first.cacheKey}.sqlite`);
    const artifactBefore = statSync(artifactPath);
    // Mutate the working copy directly (sanctioned: deliberate corruption in tests).
    first.raw.prepare("DELETE FROM outbox").run();
    first.close();
    // Physical proof the cached artifact was untouched, not just that the replay looks intact.
    const artifactAfter = statSync(artifactPath);
    expect(artifactAfter.size).toBe(artifactBefore.size);
    expect(artifactAfter.mtimeMs).toBe(artifactBefore.mtimeMs);
    const second = track(await loadProfileSnapshot(TINY, "copy-seed", options));
    const { results } = await second.database
      .prepare("SELECT COUNT(*) AS n FROM outbox")
      .all<{ n: number }>();
    expect(results[0]!.n).toBeGreaterThan(0); // the cached artifact was untouched
    second.close();
  });

  it("reaps its own working copy on close", async () => {
    // The working copy is a full copy of the snapshot database. Nothing but the snapshotter knows its
    // name, so nothing but the snapshotter can remove it — and when it did not, ~125 of them
    // accumulated in the system temp directory and filled the disk.
    const snapshot = track(
      await loadProfileSnapshot(TINY, "reap-seed", {
        allowSeeding: true,
        cacheDirectory: newCacheDirectory(),
      }),
    );
    const workingDirectory = dirname(snapshot.workingPath);
    expect(existsSync(workingDirectory)).toBe(true);
    snapshot.close();
    expect(existsSync(workingDirectory)).toBe(false);
    // Still idempotent — collector-style cleanup closes again, and must not throw on the second call.
    expect(() => {
      snapshot.close();
    }).not.toThrow();
  });

  it("reaps the working copy even when closing the database handle throws", async () => {
    const snapshot = track(
      await loadProfileSnapshot(TINY, "reap-throw-seed", {
        allowSeeding: true,
        cacheDirectory: newCacheDirectory(),
      }),
    );
    const workingDirectory = dirname(snapshot.workingPath);
    // Close the real handle, then throw: the failure shape where the handle is gone but the caller
    // still sees an error on the way out. Reaping has to survive it, or the paths that already went
    // wrong are exactly the ones that strand a database copy on disk.
    const realClose = snapshot.raw.close.bind(snapshot.raw);
    (snapshot.raw as { close: () => void }).close = () => {
      realClose();
      throw new Error("handle close failed");
    };
    expect(() => {
      snapshot.close();
    }).toThrow(/handle close failed/);
    expect(existsSync(workingDirectory)).toBe(false);
  });

  it("refuses without the seeding opt-in", async () => {
    await expect(
      loadProfileSnapshot(TINY, "guard-seed", {
        allowSeeding: false,
        cacheDirectory: newCacheDirectory(),
      }),
    ).rejects.toThrow(/allowSeeding/);
  });
});
