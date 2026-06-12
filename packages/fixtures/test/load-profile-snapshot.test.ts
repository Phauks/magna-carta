import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
    // Mutate the working copy directly (sanctioned: deliberate corruption in tests).
    first.raw.prepare("DELETE FROM outbox").run();
    first.close();
    const second = track(await loadProfileSnapshot(TINY, "copy-seed", options));
    const { results } = await second.database
      .prepare("SELECT COUNT(*) AS n FROM outbox")
      .all<{ n: number }>();
    expect(results[0]!.n).toBeGreaterThan(0); // the cached artifact was untouched
    second.close();
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
