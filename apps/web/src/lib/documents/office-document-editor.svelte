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
   * A launch that comes back `view` is a read-only seat: another member holds the document's
   * exclusive lock, and the editor opens on the document without the ability to change it. That
   * is stated once, above the frame, and never as a blocked screen — reading is never refused.
   *
   * THE LAUNCH IS NOT THE OPENING, AND CONFLATING THE TWO IS WHAT MADE THIS SCREEN A WHITE
   * RECTANGLE. The launch answers in a fraction of a second: it is our own worker minting a token.
   * What the member is waiting for is a coolwsd container, one per document, cold-starting and then
   * reading the document — measured at about twenty seconds from cold. Treating the launch as the
   * end of the wait meant the loading state ended almost immediately and the member then watched an
   * empty frame for twenty seconds with nothing to read, and watched the same empty frame forever
   * when the editor was never going to appear. The two are indistinguishable from the outside, so
   * the editor is asked to say which one is happening.
   *
   * HOW THE EDITOR SAYS SO. The host hands it a `PostMessageOrigin` in CheckFileInfo
   * (apps/api-worker/src/editing/wopi-routes.ts), and it then posts its own progress to this
   * document: `Frame_Ready` when its page is alive, which we answer with `Host_PostmessageReady`,
   * then `Document_Loaded` when the document is actually on screen. So the loading state here ends
   * where the member's wait ends, and silence past the deadlines below is reported as what it is
   * rather than rendered as a blank rectangle.
   *
   * WHY SILENCE IS SO EASY TO MISS. A frame can also be refused by the browser before the editor
   * runs at all — most often because the editor's own `frame-ancestors` does not name this origin —
   * and that refusal is reported in the FRAMED document's console, not this one. So the page that
   * embedded it sees nothing: no error, no event, no clue. Nothing in the browser will tell this
   * component that; only the absence of the editor's greeting will.
   */
  import { dev } from "$app/environment";
  import { onMount } from "svelte";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { fileDownloadUrl } from "$lib/file-manager/matter-file-api.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import { openEditSession, type EditSessionLaunch } from "./document-api.ts";
  import { loopStep } from "./document-loop-availability.ts";

  let { file }: { file: MatterFile } = $props();

  // One name for the frame and the form that posts into it. Minted once per instance, so two
  // editors on one page (two tabs' worth of documents, or a test) can never post into each other.
  const identity = $props.id();
  const frameName = `document-editor-${identity}`;
  const editorStep = loopStep("edit-in-browser");

  /**
   * How long the editor gets to say anything at all before its silence is reported as a failure.
   * Generous on purpose: the container is cold-started per document, and a cold start measured
   * around twenty seconds before the editor's page was even served. This is the ceiling on that,
   * not an estimate of it — crossing it means the frame is not coming, and the usual cause is a
   * refusal the browser only reported inside the frame.
   */
  const EDITOR_SILENCE_DEADLINE_MS = 75_000;

  /**
   * How long the document gets to appear once the editor has proved it is running. A SEPARATE
   * deadline from the one above, because the two silences mean opposite things and a member who is
   * told the wrong one goes looking in the wrong place. Nothing at all means the frame was refused
   * before the editor ran; the editor greeting us and then never opening the document means the
   * frame is fine and the document did not reach it — the editor reads the document back through
   * the host's own WOPI callbacks, so that is where a fault would be.
   */
  const DOCUMENT_LOAD_DEADLINE_MS = 60_000;

  /**
   * When a normal wait stops looking like one. Well inside the deadline, so a member on a cold
   * start reads that the editor is still being started rather than wondering whether it has hung.
   */
  const SLOW_START_MS = 12_000;

  let launch = $state<EditSessionLaunch | null>(null);
  let launchFailure = $state<StatedFailure | null>(null);
  let launchForm = $state<HTMLFormElement | null>(null);
  // The frame itself, so the handshake replies into a Window. `event.source` would do, but it is
  // typed as any of three message targets whose postMessage signatures differ, and the frame we
  // posted the token into is the one we mean anyway.
  let editorFrame = $state<HTMLIFrameElement | null>(null);

  /**
   * What the EDITOR is doing, as distinct from what the launch did.
   *
   * - `waiting`   — the frame has been posted into and the editor has said nothing yet.
   * - `answered`  — the editor has spoken, so the frame is genuinely running; the document is still
   *                 opening.
   * - `open`      — the editor reports the document on screen. The wait is over.
   * - `silent`    — the deadline passed with no word at all. The frame is not coming.
   * - `stalled`   — the editor is running and the document never arrived in it.
   */
  let editorState = $state<"waiting" | "answered" | "open" | "silent" | "stalled">("waiting");
  /** Set once the wait has run long enough to be worth remarking on. */
  let slowStart = $state(false);

  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let slowStartTimer: ReturnType<typeof setTimeout> | null = null;
  let documentTimer: ReturnType<typeof setTimeout> | null = null;

  // The member is waiting from the moment the screen opens until the editor reports the document
  // on screen — the launch is one short step inside that, not the end of it.
  const opening = $derived(
    launchFailure === null &&
      editorState !== "open" &&
      editorState !== "silent" &&
      editorState !== "stalled",
  );

  function clearTimers(): void {
    if (silenceTimer !== null) clearTimeout(silenceTimer);
    if (slowStartTimer !== null) clearTimeout(slowStartTimer);
    if (documentTimer !== null) clearTimeout(documentTimer);
    silenceTimer = null;
    slowStartTimer = null;
    documentTimer = null;
  }

  /** Ask for the session. Retry asks again for the same document, from the beginning. */
  async function open(): Promise<void> {
    clearTimers();
    launch = null;
    launchFailure = null;
    launchForm = null;
    editorState = "waiting";
    slowStart = false;

    const result = await openEditSession(fetch, file.id);
    if (result.kind !== "ok") {
      launchFailure = stated(
        result.failure,
        "The editing session did not open.",
        "Nothing answered when the editing session was opened.",
      );
      return;
    }
    launch = result.value;

    // The clock starts at the launch, because that is when the frame is posted into and when the
    // container begins starting. Both timers are cleared by the editor's first word.
    slowStartTimer = setTimeout(() => {
      slowStart = true;
    }, SLOW_START_MS);
    silenceTimer = setTimeout(() => {
      editorState = "silent";
    }, EDITOR_SILENCE_DEADLINE_MS);
  }

  /**
   * The editor's own messages. Everything from the editor arrives here as a postMessage, and the
   * origin is checked against the one this launch named before a byte of it is read — a frame is a
   * document anyone may message, so an unchecked handler would take instructions from any page.
   */
  function onEditorMessage(event: MessageEvent): void {
    const session = launch;
    if (session === null || event.origin !== session.editorOrigin) return;

    // The editor speaking AT ALL is the fact worth most here: it means the browser rendered the
    // frame and the container is serving, which is exactly what silence cannot distinguish. So the
    // deadline is lifted on the first message, whatever it says.
    if (editorState === "waiting") {
      editorState = "answered";
      clearTimers();
      slowStart = false;
      // One deadline replaces the other: the frame is proven, the document is not.
      documentTimer = setTimeout(() => {
        editorState = "stalled";
      }, DOCUMENT_LOAD_DEADLINE_MS);
    }

    // The editor posts JSON as a string; anything else is not its protocol and is ignored rather
    // than guessed at.
    let payload: unknown = event.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        return;
      }
    }
    if (typeof payload !== "object" || payload === null) return;
    const message = payload as { MessageId?: unknown; Values?: { Status?: unknown } };
    if (message.MessageId !== "App_LoadingStatus") return;

    const status = message.Values?.Status;
    if (status === "Frame_Ready") {
      // The half of the handshake the host owes: until this is answered the editor holds back the
      // events that follow, including the one that says the document is open.
      editorFrame?.contentWindow?.postMessage(
        JSON.stringify({ MessageId: "Host_PostmessageReady", SendTime: Date.now(), Values: null }),
        session.editorOrigin,
      );
      return;
    }
    if (status === "Document_Loaded") {
      clearTimers();
      editorState = "open";
    }
  }

  onMount(() => {
    void open();
    return clearTimers;
  });

  // The form exists only once a launch has answered, and it is submitted the moment it is in the
  // document: that is the one gesture that carries the token into the frame.
  $effect(() => {
    if (launch !== null && launchForm !== null) launchForm.submit();
  });
</script>

<svelte:window onmessage={onEditorMessage} />

<div class="flex min-h-0 flex-1 flex-col">
  {#if launch !== null && launch.capability === "view"}
    <div class="flex items-center gap-8 border-b border-border-default px-12 py-4 text-sm">
      <Badge variant="neutral">Read-only</Badge>
      <span class="text-text-muted">Another member holds this document's exclusive lock.</span>
    </div>
  {/if}

  {#if editorState === "stalled"}
    <!-- The editor is running — it greeted this page — and the document never appeared in it. That
         is a different fault from the one below and points somewhere else: the editor reads the
         document back through this host's own WOPI callbacks, so the frame is not the suspect. -->
    <div class="p-24">
      <Alert.Root variant="warning">
        <Alert.Title>The Editor Opened, but the Document Did Not</Alert.Title>
        <Alert.Description>
          The editor started and is running, and the document never arrived in it. The editor reads
          the document back from this application rather than holding a copy, so this is that read
          rather than the editor itself. The document is unharmed and can be downloaded.
        </Alert.Description>
        <div class="flex items-center gap-8">
          <Button variant="secondary" size="sm" onclick={open}>Try Again</Button>
          <Button
            variant="secondary"
            size="sm"
            href={fileDownloadUrl(file.id)}
            {...opensBeside("file")}
          >
            Download
          </Button>
        </div>
      </Alert.Root>
    </div>
  {:else if editorState === "silent"}
    <!-- The frame never spoke. Everything this screen knows is said here, because the browser said
         none of it anywhere the member could find: the refusal, where it happens, is reported only
         inside the frame that was refused. -->
    <div class="p-24">
      <Alert.Root variant="warning">
        <Alert.Title>The Editor Did Not Open This Document</Alert.Title>
        <Alert.Description>
          The editing session started and the document was sent to the editor, but the editor never
          reported back. It runs on its own address ({launch?.editorOrigin ?? "the editor host"}),
          and when nothing appears in its place the usual cause is that address refusing to open
          inside this page — a refusal the browser reports only inside the frame, which is why
          nothing reached the console here. The document itself is unharmed and can be downloaded.
        </Alert.Description>
        <div class="flex items-center gap-8">
          <Button variant="secondary" size="sm" onclick={open}>Try Again</Button>
          <Button
            variant="secondary"
            size="sm"
            href={fileDownloadUrl(file.id)}
            {...opensBeside("file")}
          >
            Download
          </Button>
        </div>
      </Alert.Root>
    </div>
  {:else}
    <LoadingRegion
      loading={opening}
      failed={launchFailure !== null}
      label={slowStart
        ? "Starting the editor for this document, which can take a moment the first time"
        : "Opening the editing session"}
      onRetry={open}
      class="flex min-h-0 flex-1 flex-col"
    >
      {#snippet failure()}
        {#if launchFailure !== null}
          <div class="p-24">
            <FailureNotice
              failure={launchFailure.failure}
              subject="The editing session"
              fallback={launchFailure.fallback}
              whenSilent={launchFailure.whenSilent}
              onRetry={open}
            />
          </div>
        {/if}
      {/snippet}

      {#if launch !== null}
        <form
          method="post"
          action={launch.editorUrl}
          target={frameName}
          hidden
          bind:this={launchForm}
        >
          <input type="hidden" name="access_token" value={launch.accessToken} />
          <input type="hidden" name="access_token_ttl" value={String(launch.accessTokenTtl)} />
        </form>
      {/if}
      <!-- Edge to edge, like the file manager's list: the header above and the canvas's own edges
           are the frame's only border. The frame is mounted while the editor is still starting —
           it is the thing doing the starting — but it holds no height until the editor reports the
           document open, so the member reads the loading state rather than a white rectangle
           standing in front of it. -->
      <iframe
        bind:this={editorFrame}
        name={frameName}
        title="Editor for {file.name}"
        allow="clipboard-read; clipboard-write"
        class="w-full border-0 bg-surface-raised {editorState === 'open'
          ? 'min-h-0 flex-1'
          : 'h-0 flex-none'}"
      ></iframe>
    </LoadingRegion>
  {/if}

  {#if dev}
    <p class="px-12 py-4 text-xs text-text-muted">{editorStep.behaviour}</p>
  {/if}
</div>
