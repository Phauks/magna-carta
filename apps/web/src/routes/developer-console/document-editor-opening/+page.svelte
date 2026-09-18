<script lang="ts">
  /*
   * Document opening stages — the staged wait a member sees while a document opens in the browser
   * editor, rendered from the shipping component over fixed marks so every stage can be looked at
   * without waiting on a container, and the two ways an open stops beside them.
   *
   * WHAT IS REAL HERE: the panel, the steps, the notice and the details are the shipping
   * components, and every specimen's steps, sentences, rows and trace are worked out by the same
   * module the editor screen uses ($lib/documents/editor-open-progress.ts) from a set of marks.
   * Nothing on this page is a hand-written step list, so a change to the words or the arithmetic
   * shows here before it ships. Dev builds only, behind the import.meta.env.DEV gate, like the rest
   * of the developer console.
   */
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated } from "$lib/diagnostics/failure-view.ts";
  import DocumentOpeningProgress from "$lib/documents/document-opening-progress.svelte";
  import {
    freshMarks,
    marked,
    OPEN_STAGES,
    openFeed,
    openPace,
    openRows,
    openTrace,
    refusal,
    stalledSentence,
    type OpenMarks,
    type OpenStage,
  } from "$lib/documents/editor-open-progress.ts";

  const STARTED_AT = new Date("2026-09-17T14:00:00.000Z");
  const EDITOR_ORIGIN = "https://edit.example.test";

  const at = (seconds: number): Date => new Date(STARTED_AT.getTime() + seconds * 1000);

  // A plausible open of a document nobody has touched recently: the session in a moment, then the
  // container's cold start taking most of the wait, then the rest in quick succession.
  const REACHED_AT: Record<OpenStage, number> = {
    session: 0.4,
    editor: 28.1,
    frame: 29.6,
    information: 30.2,
    bytes: 31,
    shown: 33.5,
  };

  /** Marks with every stage up to and including `through` reached. */
  function reached(through: OpenStage | null): OpenMarks {
    let marks = freshMarks(STARTED_AT);
    if (through === null) return marks;
    for (const stage of OPEN_STAGES) {
      marks = marked(marks, stage.id, at(REACHED_AT[stage.id]));
      if (stage.id === through) break;
    }
    return marks;
  }

  // One specimen per stage, each caught a few seconds into that stage.
  const active: readonly { stage: OpenStage; marks: OpenMarks; now: Date }[] = OPEN_STAGES.map(
    ({ id }, index) => {
      const previous = index === 0 ? null : (OPEN_STAGES[index - 1]?.id ?? null);
      const from = previous === null ? 0 : REACHED_AT[previous];
      return { stage: id, marks: reached(previous), now: at(from + (id === "editor" ? 6 : 2.5)) };
    },
  );

  // The two long waits: past the usual half minute with the bar full and the words saying so, and
  // past forty-five seconds, where Retry is offered. Both still on the editor's cold start.
  const runningLong = { marks: reached("session"), now: at(38) };
  const pastRetry = { marks: reached("session"), now: at(52) };

  // The budget running out while the editor, up and ready, never asked the host about the document.
  const stalledMarks = reached("frame");
  const stalledAt = at(90);
  const stalledStage: OpenStage = "information";
  const stalledSentenceText = stalledSentence(stalledStage, stalledMarks);
  const stalledFailure = stated(
    { problem: null, request: `GET ${EDITOR_ORIGIN} (the editor's callbacks)`, failedAt: stalledAt },
    stalledSentenceText,
    stalledSentenceText,
  );

  // The host refusing the editor's request for the bytes: the open ends the moment the poll says so.
  const refusedMarks: OpenMarks = {
    ...reached("information"),
    lastCallback: {
      operation: "wopi:get-file",
      status: 404,
      errorId: "error_01J8Q4R7ZK3TV9M2XH6B5NP0DW",
      at: at(34.6).toISOString(),
    },
  };
  const refusedAt = at(34.9);
  const refused = refusal(refusedMarks);
  const refusedStage: OpenStage = refused?.stage ?? "bytes";
  const refusedSentenceText = stalledSentence(refusedStage, refusedMarks);
  const refusedFailure = stated(
    {
      problem: {
        status: refused?.status ?? 404,
        ...(refused?.errorId ? { errorId: refused.errorId } : {}),
      },
      request: `GET ${EDITOR_ORIGIN} (the editor's callbacks)`,
      failedAt: refusedAt,
    },
    refusedSentenceText,
    refusedSentenceText,
  );
</script>

<svelte:head><title>Document opening stages · Magna Carta</title></svelte:head>

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex max-w-prose flex-col gap-8">
      <ScreenHeader
        title="Document opening stages"
        favoritable={false}
        back={DEVELOPER_CONSOLE_BACK}
      />
      <p class="text-sm text-text-muted">
        The wait a member sees while a document opens in the browser editor, told as it happens:
        a line for each stage as it finishes, the stage under way saying what it is doing, a bar
        filling over the usual half minute, and the full sequence behind Show details. Every
        specimen is the shipping panel over a fixed set of marks, worked out by the same module the
        editor screen uses, so nothing here is a hand-written list. The first six catch the open a
        few seconds into each stage; then the two long waits, one past the usual time and one past
        the point Retry is offered; then the two ways an open stops, with the facts a report needs
        beneath the notice.
      </p>
    </header>

    <section class="flex flex-col gap-24">
      <h2 class="text-xl font-semibold">Each stage, as it runs</h2>
      <div class="grid gap-24 lg:grid-cols-2">
        {#each active as specimen (specimen.stage)}
          <section class="flex flex-col gap-8">
            <h3 class="text-sm font-semibold">
              {OPEN_STAGES.find((stage) => stage.id === specimen.stage)?.label}
            </h3>
            <DocumentOpeningProgress
              feed={openFeed(specimen.marks, specimen.now)}
              pace={openPace(specimen.marks.startedAt, specimen.now)}
              rows={openRows(specimen.marks, specimen.now)}
              trace={() => openTrace(specimen.marks, specimen.now)}
            />
          </section>
        {/each}
      </div>
    </section>

    <section class="flex flex-col gap-24">
      <h2 class="text-xl font-semibold">The long waits</h2>
      <div class="grid gap-24 lg:grid-cols-2">
        <section class="flex flex-col gap-8">
          <h3 class="text-sm font-semibold">Past the usual half minute</h3>
          <p class="text-sm text-text-muted">
            The bar is full and says the open is running long. Retry is not yet offered: an open
            past the usual time is far more often about to finish than stuck.
          </p>
          <DocumentOpeningProgress
            feed={openFeed(runningLong.marks, runningLong.now)}
            pace={openPace(runningLong.marks.startedAt, runningLong.now)}
            rows={openRows(runningLong.marks, runningLong.now)}
            trace={() => openTrace(runningLong.marks, runningLong.now)}
          />
        </section>
        <section class="flex flex-col gap-8">
          <h3 class="text-sm font-semibold">Past forty-five seconds</h3>
          <p class="text-sm text-text-muted">
            The sentence and Retry appear inside the panel, beneath the bar, without moving
            anything above them.
          </p>
          <DocumentOpeningProgress
            feed={openFeed(pastRetry.marks, pastRetry.now)}
            pace={openPace(pastRetry.marks.startedAt, pastRetry.now)}
            stalled
            onRetry={() => {}}
            rows={openRows(pastRetry.marks, pastRetry.now)}
            trace={() => openTrace(pastRetry.marks, pastRetry.now)}
          />
        </section>
      </div>
    </section>

    <section class="flex flex-col gap-24">
      <h2 class="text-xl font-semibold">How an open stops</h2>
      <div class="grid gap-24 lg:grid-cols-2">
        <section class="flex flex-col gap-8">
          <h3 class="text-sm font-semibold">A stall: the budget ran out at the fourth stage</h3>
          <p class="text-sm text-text-muted">
            The editor came up and reported itself ready, then never asked the host about the
            document. Ninety seconds in, the screen calls it off at the stage it stopped and says
            how long each earlier one took.
          </p>
          <DocumentOpeningProgress
            feed={openFeed(stalledMarks, stalledAt, stalledStage)}
            rows={openRows(stalledMarks, stalledAt)}
            trace={() => openTrace(stalledMarks, stalledAt)}
            stopped
          >
            <FailureNotice
              failure={stalledFailure.failure}
              subject="The editor"
              title="The Document Did Not Open"
              fallback={stalledFailure.fallback}
              whenSilent={stalledFailure.whenSilent}
              onRetry={() => {}}
            />
          </DocumentOpeningProgress>
        </section>

        <section class="flex flex-col gap-8">
          <h3 class="text-sm font-semibold">A refusal: the host answered 404 at the fifth stage</h3>
          <p class="text-sm text-text-muted">
            The host described the document, then refused the editor's request for its bytes. The
            poll reports the refusal and the open ends at once, quoting the status and the Error ID
            the host issued, rather than waiting out the budget.
          </p>
          <DocumentOpeningProgress
            feed={openFeed(refusedMarks, refusedAt, refusedStage)}
            rows={openRows(refusedMarks, refusedAt)}
            trace={() => openTrace(refusedMarks, refusedAt)}
            stopped
          >
            <FailureNotice
              failure={refusedFailure.failure}
              subject="The editor"
              title="The Document Did Not Open"
              fallback={refusedFailure.fallback}
              whenSilent={refusedFailure.whenSilent}
              onRetry={() => {}}
            />
          </DocumentOpeningProgress>
        </section>
      </div>
    </section>
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">
    This review surface is only available in development builds.
  </p>
{/if}
