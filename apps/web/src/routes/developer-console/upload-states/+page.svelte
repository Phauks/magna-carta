<script lang="ts">
  /*
   * Upload states — the Upload dialog and the upload tray, in the states real data cannot be made
   * to hold still in.
   *
   * A transfer is over in seconds on a good connection and never fails on demand, so "what does a
   * half-finished batch with two failures look like" cannot be reviewed against the deployed site.
   * This page runs the REAL dialog and the REAL tray over the real upload queue, with the queue's
   * network seams replaced by a stand-in that moves each file through its stages on a timer and
   * fails the ones named below — so what a reviewer sees is the shipping component, paused where
   * they need it. Dev builds only, like the developer console itself.
   */
  import Button from "@magna-carta/design-system/button";
  import type { DroppedEntry } from "@magna-carta/design-system/dropzone";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import { MatterFileIndex } from "$lib/file-manager/file-rows.ts";
  import type { UploadStage } from "$lib/file-manager/file-upload.ts";
  import UploadDialog from "$lib/file-manager/upload-dialog.svelte";
  import UploadTray from "$lib/file-manager/upload-tray.svelte";
  import {
    startUploadBatch,
    type UploadBatchPlan,
    type UploadQueueDependencies,
  } from "$lib/file-manager/upload-queue.svelte.ts";

  const MATTER_ID = "sample-pemberton";
  const MATTER_TITLE = "Pemberton v. Hale";

  // A deterministic intake: two folders, one loose file, dates a year apart, one name that will
  // fail. No clock and no randomness, so the page reads the same on every render.
  function entry(relativePath: string, name: string, size: number, day: number): DroppedEntry {
    return {
      file: new File(["x".repeat(Math.min(size, 64))], name, {
        type: name.endsWith(".pdf") ? "application/pdf" : "",
        lastModified: Date.UTC(2025, 2, day, 9, 30),
      }),
      relativePath,
    };
  }

  const FIXTURE: DroppedEntry[] = [
    entry("Depositions/2024/Pemberton - transcript.pdf", "Pemberton - transcript.pdf", 4_812_330, 3),
    entry("Depositions/2024/Hale - transcript.pdf", "Hale - transcript.pdf", 3_902_114, 4),
    entry("Depositions/exhibit index.xlsx", "exhibit index.xlsx", 88_120, 11),
    entry("Correspondence/2026-08-12 letter to Hale.docx", "2026-08-12 letter to Hale.docx", 51_002, 19),
    entry("Correspondence/2026-08-14 reply.docx", "2026-08-14 reply.docx", 47_310, 21),
    entry("", "Motion to compel.pdf", 1_204_551, 27),
  ];

  const FAILS = new Set(["Hale - transcript.pdf", "2026-08-14 reply.docx"]);
  /** A file the matter already holds: the stand-in files it as a copy made server-side. */
  const ALREADY_HELD = new Set(["exhibit index.xlsx"]);
  /** The sizes the fixture declares; the File objects themselves are kept tiny. */
  const SIZES = new Map(FIXTURE.map((item) => [item.file.name, item.file.size]));
  const STAGES: UploadStage[] = ["reserving", "uploading", "committing", "scanning"];

  const index = new MatterFileIndex(
    [
      { id: "discovery", parentFolderId: null, name: "Discovery" },
      { id: "pleadings", parentFolderId: null, name: "Pleadings" },
    ],
    [],
  );

  /** Read through a call, so the checker does not narrow a flag that flips while the stand-in awaits. */
  const isCancelled = (signal: AbortSignal | undefined): boolean => signal?.aborted ?? false;

  /** The stand-in for the network: each stage takes a beat, and the named files fail on sending. */
  function stagedDependencies(beatMilliseconds: number): UploadQueueDependencies {
    const beat = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, beatMilliseconds));
    let made = 0;
    return {
      fetchImpl: fetch,
      // The stand-in reads nothing real: the gallery's files are a few bytes, so it plays the read
      // of the size the fixture declares over one beat, and whether the matter already holds a
      // file is its own answer below.
      digest: async (chosen, options) => {
        const total = SIZES.get(chosen.file.name) ?? chosen.file.size;
        for (let step = 1; step <= 10; step += 1) {
          await new Promise((resolve) => setTimeout(resolve, beatMilliseconds / 10));
          if (isCancelled(options.signal)) return null;
          options.onProgress(Math.round((total * step) / 10));
        }
        return null;
      },
      upload: async (request) => {
        // The fixture's declared sizes drive the progress the stand-in reports, in ten steps
        // across the sending beat, so the percent and the bytes-of-bytes line can be watched.
        const total = SIZES.get(request.file.name) ?? request.file.size;
        if (ALREADY_HELD.has(request.file.name)) {
          request.onStage?.("matching");
          await beat();
          request.onStage?.("settled");
          return {
            kind: "committed",
            fileId: "file-held",
            versionId: "version-held",
            copiedFrom: "matter",
          };
        }
        for (const stage of STAGES) {
          if (isCancelled(request.signal)) return { kind: "cancelled", stage };
          request.onStage?.(stage);
          if (stage === "uploading") {
            for (let step = 1; step <= 10; step += 1) {
              await new Promise((resolve) => setTimeout(resolve, beatMilliseconds / 10));
              if (isCancelled(request.signal)) return { kind: "cancelled", stage };
              request.onProgress?.(Math.round((total * step) / 10), total);
            }
            if (FAILS.has(request.file.name)) {
              return {
                kind: "problem",
                stage,
                problem: { status: 403, errorId: "ERR-7F3A2C" },
              };
            }
            continue;
          }
          await beat();
        }
        request.onStage?.("settled");
        return { kind: "committed", fileId: `file-${request.file.name}`, versionId: "v1" };
      },
      createFolder: async (input) => {
        await beat();
        made += 1;
        return { kind: "ok", value: { folderId: `made-${String(made)}-${input.name}` } };
      },
      now: () => new Date().toISOString(),
      newIdentifier: () => crypto.randomUUID(),
    };
  }

  let open = $state(false);
  let beat = $state(900);

  function start(plan: UploadBatchPlan) {
    return startUploadBatch(plan, stagedDependencies(beat));
  }
</script>

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex max-w-prose flex-col gap-8">
      <ScreenHeader title="Upload states" favoritable={false} back={DEVELOPER_CONSOLE_BACK} />
      <p class="text-sm text-text-muted">
        The Upload dialog and the top-bar upload tray, over the real upload queue with its network
        replaced by a stand-in that moves each file through its stages on a timer. Two files fail
        while sending, so the failed row, the folder tally and the tray's Retry can be looked at.
        Open the dialog holding the fixture, or empty, and press Upload.
      </p>
    </header>

    <section class="flex flex-col gap-12">
      <div class="flex flex-wrap items-center gap-8">
        <Button variant="primary" onclick={() => (open = true)}>Open Holding the Fixture</Button>
        <label class="flex items-center gap-8 text-sm">
          Beat per stage
          <input
            type="range"
            min="100"
            max="3000"
            step="100"
            bind:value={beat}
            aria-label="Milliseconds each stage takes"
          />
          <span class="tabular-nums text-text-muted">{beat} ms</span>
        </label>
        <span
          class="ms-auto flex items-center rounded-md p-4"
          style="background-color: var(--mc-chrome-surface)"
        >
          <UploadTray />
        </span>
      </div>
      <p class="text-xs text-text-muted">
        The tray on the right is the shipping component, seated here on the ink it sits on in the
        top bar. It reads the same queue the dialog writes.
      </p>
    </section>
  </div>

  <UploadDialog
    bind:open
    matterId={MATTER_ID}
    matterTitle={MATTER_TITLE}
    {index}
    baseFolderId="discovery"
    documentTypes={[
      { id: "type-corr", name: "Correspondence", code: "CORR", deactivatedAt: null },
      { id: "type-depo", name: "Deposition", code: "DEPO", deactivatedAt: null },
    ]}
    preselected={FIXTURE}
    onStart={start}
    onDismiss={() => {}}
  />
{:else}
  <p class="p-16 text-sm text-text-muted">This page is only available in development builds.</p>
{/if}
