<script lang="ts">
  /*
   * An office document, open in the browser editor the edit worker serves.
   *
   * THE FRAME IS LOADED THE WAY A HOST MUST LOAD IT. The editor page expects the session's access
   * token as a form POST into its own frame — never as a query parameter, which would put a bearer
   * token in every address bar, history entry and referrer the frame touches. So the launch is
   * asked for on mount, and once it answers, a hidden form carrying `access_token` and
   * `access_token_ttl` is submitted programmatically into the named frame. Nothing here draws the
   * document: the editor provides the entire editing surface, and this component's whole job is
   * the launch, the frame and the states around them.
   *
   * OPENING IS A CHAIN OF STAGES, AND THE SCREEN NAMES EACH ONE. The launch call answers in a
   * moment; the editor behind the frame is a container that starts on first address, so a document
   * nobody has opened recently takes appreciably longer to appear than the call that addressed it.
   * The waiting state therefore runs from mount until the EDITOR says the document is up, and it
   * says where in the chain the open is: the session (the launch answering), the editor (the frame's
   * load after the form went in), the frame (the editor's own ready message), the host being asked
   * about the document and then for its bytes (the host's record of the editor's callbacks, read on
   * a cadence), and the document being shown. The first three come from this page; the two in the
   * middle happen inside the container, out of the browser's sight, which is why the host keeps a
   * record of them and this screen polls it. That record is a diagnostic and never a gate: a poll
   * that fails is ignored and the next one is asked.
   *
   * Silence past the budget is stated as a failure AT THE STAGE IT STOPPED, with the seconds each
   * earlier stage took and the host's last answer beside it, rather than a frame that never draws.
   * A refusal from the host (the editor asked for the document and was told no) ends the wait the
   * moment the poll reports it: the editor will not ask again. The words and the arithmetic are in
   * ./editor-open-progress.ts; the frame protocol is in ./editor-frame-readiness.ts.
   *
   * A launch that comes back `view` is a read-only seat: another member holds the document's
   * exclusive lock, and the editor opens on the document without the ability to change it. That
   * is stated once, above the frame, and never as a blocked screen — reading is never refused.
   *
   * THE EDITOR OPENS IN ITS TABBED INTERFACE. The same form carries `ui_defaults`, which is the
   * editor's own channel for how it first draws itself. Left unset it fell to the compact mode — a
   * menubar over one toolbar — where the paragraph and character settings sit behind the Format
   * menu, and the owner asked for them at the top (2026-09-18). The tabbed interface's Home tab is
   * where they are. It is a DEFAULT, not a lock: the editor's own View menu still switches modes,
   * and a switch made there is remembered by that browser and wins over this line thereafter.
   */
  import { dev } from "$app/environment";
  import { onMount, untrack } from "svelte";
  import Badge from "@magna-carta/design-system/badge";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import DocumentOpeningProgress from "./document-opening-progress.svelte";
  import {
    openEditSession,
    readEditOpenProgress,
    type EditSessionLaunch,
  } from "./document-api.ts";
  import {
    EDITOR_READY_BUDGET_MILLISECONDS,
    editorSignalOf,
    HOST_READY_MESSAGE,
  } from "./editor-frame-readiness.ts";
  import {
    currentStage,
    elapsedLabel,
    freshMarks,
    marked,
    OPEN_PROGRESS_POLL_MILLISECONDS,
    openRows,
    openSteps,
    openTrace,
    refusal,
    stalledSentence,
    stoppedLabel,
    type OpenMarks,
    type OpenStage,
  } from "./editor-open-progress.ts";
  import { loopStep } from "./document-loop-availability.ts";

  /**
   * How the editor first draws itself: the tabbed interface, whose Home tab carries the font and
   * paragraph controls the compact mode keeps behind a menu. `tabbed` is the editor's current name
   * for it (`notebookbar` is the older one it still accepts).
   */
  const EDITOR_INTERFACE_DEFAULTS = "UIMode=tabbed";

  let { file }: { file: MatterFile } = $props();

  // One name for the frame and the form that posts into it. Minted once per instance, so two
  // editors on one page (two tabs' worth of documents, or a test) can never post into each other.
  const identity = $props.id();
  const frameName = `document-editor-${identity}`;
  const editorStep = loopStep("edit-in-browser");

  let launch = $state<EditSessionLaunch | null>(null);
  let openFailure = $state<StatedFailure | null>(null);
  let launchForm = $state<HTMLFormElement | null>(null);
  let frame = $state<HTMLIFrameElement | null>(null);
  // True once the editor has reported the document on screen. Until then the region is waiting,
  // whether the launch call has answered or not.
  let documentShowing = $state(false);
  // When each stage of this open completed, and what the host last told the editor. Reset with
  // every launch, so a retry never reads the marks of the attempt before it.
  let marks = $state<OpenMarks>(freshMarks());
  // The stage the open stopped at, once it has; null while it is running or once it is done.
  let failedStage = $state<OpenStage | null>(null);
  // True once the launch form has gone into the frame. A blank frame fires a load of its own on
  // mount, and that load is not the editor page arriving.
  let launchSubmitted = $state(false);
  // Read once a second while opening, so the elapsed line moves. Never read for arithmetic that
  // matters: a mark is stamped with the moment it happened, not with this.
  let now = $state(new Date());

  const opening = $derived(!documentShowing && openFailure === null);
  const steps = $derived(openSteps(marks, failedStage, openFailure?.fallback));
  const editorOrigin = $derived(launch?.editorOrigin);

  function reach(stage: OpenStage): void {
    marks = marked(marks, stage, new Date());
  }

  /** Ask for the session. Retry asks again for the same document, from the beginning. */
  async function open(): Promise<void> {
    launch = null;
    openFailure = null;
    documentShowing = false;
    launchSubmitted = false;
    failedStage = null;
    marks = freshMarks();
    const result = await openEditSession(fetch, file.id);
    if (result.kind === "ok") {
      launch = result.value;
      reach("session");
      return;
    }
    failedStage = "session";
    openFailure = stated(
      result.failure,
      "The editing session did not open.",
      "Nothing answered when the editing session was opened.",
    );
  }

  /**
   * Call the open off at the stage it is on. The failure is recorded against the editor's own
   * callbacks rather than any request this page made: no call from here was refused, and where the
   * host refused the editor, its status and Error ID are the problem, so the notice can quote them.
   */
  function stopOpening(): void {
    const origin = launch?.editorOrigin ?? "";
    const reached = currentStage(marks);
    const stage: OpenStage = reached === "done" ? "shown" : reached;
    const refused = refusal(marks);
    const sentence = stalledSentence(stage, marks);
    failedStage = stage;
    openFailure = stated(
      {
        problem:
          refused === null
            ? null
            : { status: refused.status, ...(refused.errorId === null ? {} : { errorId: refused.errorId }) },
        request: `GET ${origin} (the editor's callbacks)`,
        failedAt: new Date(),
      },
      sentence,
      sentence,
    );
  }

  onMount(() => {
    void open();
  });

  // The form exists only once a launch has answered, and it is submitted the moment it is in the
  // document: that is the one gesture that carries the token into the frame.
  $effect(() => {
    if (launch !== null && launchForm !== null) {
      launchForm.submit();
      launchSubmitted = true;
    }
  });

  // The editor page arriving: the frame's load AFTER the form went in. The container's cold start
  // is the whole of this stage, which is why it is the long one.
  function onFrameLoad(): void {
    if (launchSubmitted) reach("editor");
  }

  /*
   * The editor's half of the handshake. The origin is checked before the message is read — the frame
   * is the only thing on this page allowed to move this screen's state — and the host's answer is
   * addressed to that same origin rather than to any window that happens to be listening.
   */
  $effect(() => {
    const origin = editorOrigin;
    if (origin === undefined || !opening) return undefined;

    function onMessage(event: MessageEvent): void {
      if (event.origin !== origin) return;
      const signal = editorSignalOf(event.data);
      if (signal === "frame-ready") {
        reach("frame");
        frame?.contentWindow?.postMessage(HOST_READY_MESSAGE, origin);
        return;
      }
      if (signal === "document-loaded") {
        reach("shown");
        documentShowing = true;
      }
    }

    window.addEventListener("message", onMessage);
    // Silence past the budget is itself an answer: the frame was refused, or the editor never came
    // up. The screen states it at the stage the open stopped, instead of holding a waiting state
    // that nothing will ever end.
    const budget = setTimeout(stopOpening, EDITOR_READY_BUDGET_MILLISECONDS);

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(budget);
    };
  });

  /*
   * The host's record of the editor's callbacks, read on a cadence from the launch until the
   * document is shown or the open has stopped. The marks it carries are stamped here with the
   * moment this screen learned of them, on the same clock as every other mark, so the seconds
   * between stages are measured on one clock rather than across two that may disagree. A read that
   * fails is ignored and the next one is asked: the record is a diagnostic, never a gate.
   */
  $effect(() => {
    if (launch === null || !opening) return undefined;
    const fileId = file.id;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      const result = await readEditOpenProgress(fetch, fileId);
      if (!live) return;
      if (result.kind === "ok") {
        const record = result.value;
        untrack(() => {
          if (record.checkFileInfoAt !== null) reach("information");
          if (record.getFileAt !== null) reach("bytes");
          marks = { ...marks, lastCallback: record.lastCallback };
          if (refusal(marks) !== null) {
            stopOpening();
            return;
          }
          timer = setTimeout(() => void tick(), OPEN_PROGRESS_POLL_MILLISECONDS);
        });
        return;
      }
      timer = setTimeout(() => void tick(), OPEN_PROGRESS_POLL_MILLISECONDS);
    };

    timer = setTimeout(() => void tick(), OPEN_PROGRESS_POLL_MILLISECONDS);
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
    };
  });

  // The elapsed line, once a second while the open is running.
  $effect(() => {
    if (!opening) return undefined;
    now = new Date();
    const ticker = setInterval(() => {
      now = new Date();
    }, 1000);
    return () => clearInterval(ticker);
  });
</script>

<div class="flex min-h-0 flex-1 flex-col">
  {#if launch !== null && launch.capability === "view" && openFailure === null}
    <div class="flex items-center gap-8 border-b border-border-default px-12 py-4 text-sm">
      <Badge variant="neutral">Read-only</Badge>
      <span class="text-text-muted">Another member holds this document's exclusive lock.</span>
    </div>
  {/if}

  <LoadingRegion
    loading={opening}
    failed={openFailure !== null}
    label="Opening this document in the editor"
    onRetry={open}
    class="flex min-h-0 flex-1 flex-col"
  >
    {#snippet failure()}
      {#if openFailure !== null}
        {@const failedAt = openFailure.failure.failedAt}
        <div class="p-24">
          <!-- The launch failing is the one stop this page's own request explains, so its notice
               keeps that request's facts and the rows stay with the notice. Every later stop is
               the editor's, and the rows say which stage, how long, and what the host answered. -->
          <DocumentOpeningProgress
            {steps}
            elapsed={stoppedLabel(marks.startedAt, failedAt)}
            rows={failedStage === "session" ? undefined : openRows(marks, failedAt)}
            trace={failedStage === "session" ? undefined : () => openTrace(marks, failedAt)}
          >
            <FailureNotice
              failure={openFailure.failure}
              subject="The editor"
              title={failedStage === "session" ? undefined : "The document did not open"}
              fallback={openFailure.fallback}
              whenSilent={openFailure.whenSilent}
              onRetry={open}
            />
          </DocumentOpeningProgress>
        </div>
      {/if}
    {/snippet}

    {#if opening}
      <div class="p-24">
        <DocumentOpeningProgress {steps} elapsed={elapsedLabel(marks.startedAt, now)} />
      </div>
    {/if}

    {#if launch !== null}
      <form method="post" action={launch.editorUrl} target={frameName} hidden bind:this={launchForm}>
        <input type="hidden" name="access_token" value={launch.accessToken} />
        <input type="hidden" name="access_token_ttl" value={String(launch.accessTokenTtl)} />
        <input type="hidden" name="ui_defaults" value={EDITOR_INTERFACE_DEFAULTS} />
      </form>
    {/if}
    <!-- Edge to edge, like the file manager's list: the header above and the canvas's own edges
         are the frame's only border. The frame is in the document from the start, because the form
         posts INTO it — it is what makes the launch possible, not a result of it. -->
    <iframe
      bind:this={frame}
      name={frameName}
      title="Editor for {file.name}"
      allow="clipboard-read; clipboard-write"
      onload={onFrameLoad}
      class="min-h-0 w-full flex-1 border-0 bg-surface-raised"
    ></iframe>
  </LoadingRegion>

  {#if dev}
    <p class="px-12 py-4 text-xs text-text-muted">{editorStep.behaviour}</p>
  {/if}
</div>
