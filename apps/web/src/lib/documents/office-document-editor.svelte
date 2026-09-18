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
   * OPENING IS TWO WAITS, AND THE SECOND IS THE LONG ONE. The launch call answers in a moment; the
   * editor behind the frame is a container that starts on first address, so a document nobody has
   * opened recently takes appreciably longer to appear than the call that addressed it. The waiting
   * state therefore runs from mount until the EDITOR says the document is up, not until the launch
   * call returns — otherwise the screen falls quiet at the exact moment the real wait begins, which
   * is the one moment a member needs to be told something is happening. The editor says so through
   * the frame message protocol in ./editor-frame-readiness.ts, and silence past the budget there is
   * stated as a failure with Retry rather than left as a frame that never draws.
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
  import { onMount } from "svelte";
  import Badge from "@magna-carta/design-system/badge";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { openEditSession, type EditSessionLaunch } from "./document-api.ts";
  import {
    EDITOR_READY_BUDGET_MILLISECONDS,
    editorSignalOf,
    HOST_READY_MESSAGE,
  } from "./editor-frame-readiness.ts";
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

  const opening = $derived(!documentShowing && openFailure === null);

  /** Ask for the session. Retry asks again for the same document, from the beginning. */
  async function open(): Promise<void> {
    launch = null;
    openFailure = null;
    documentShowing = false;
    const result = await openEditSession(fetch, file.id);
    if (result.kind === "ok") {
      launch = result.value;
      return;
    }
    openFailure = stated(
      result.failure,
      "The editing session did not open.",
      "Nothing answered when the editing session was opened.",
    );
  }

  onMount(() => {
    void open();
  });

  // The form exists only once a launch has answered, and it is submitted the moment it is in the
  // document: that is the one gesture that carries the token into the frame.
  $effect(() => {
    if (launch !== null && launchForm !== null) launchForm.submit();
  });

  /*
   * The editor's half of the handshake. The origin is checked before the message is read — the frame
   * is the only thing on this page allowed to move this screen's state — and the host's answer is
   * addressed to that same origin rather than to any window that happens to be listening.
   */
  $effect(() => {
    const editorOrigin = launch?.editorOrigin;
    if (editorOrigin === undefined || documentShowing) return undefined;

    function onMessage(event: MessageEvent): void {
      if (event.origin !== editorOrigin) return;
      const signal = editorSignalOf(event.data);
      if (signal === "frame-ready") {
        frame?.contentWindow?.postMessage(HOST_READY_MESSAGE, editorOrigin);
        return;
      }
      if (signal === "document-loaded") documentShowing = true;
    }

    window.addEventListener("message", onMessage);
    // Silence past the budget is itself an answer: the frame was refused, or the editor never came
    // up. The screen states it instead of holding a waiting state that nothing will ever end. It is
    // recorded as a failure that nothing answered, because that is exactly what happened — no
    // request refused this, and there is no Error ID to quote, so the notice says so rather than
    // inventing one.
    const budget = setTimeout(() => {
      openFailure = stated(
        { problem: null, request: `POST ${editorOrigin}`, failedAt: new Date() },
        "The editing session opened, but the editor did not come up.",
        "The editing session opened, but the editor never reported itself ready.",
      );
    }, EDITOR_READY_BUDGET_MILLISECONDS);

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(budget);
    };
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
        <div class="p-24">
          <FailureNotice
            failure={openFailure.failure}
            subject="The editor"
            fallback={openFailure.fallback}
            whenSilent={openFailure.whenSilent}
            onRetry={open}
          />
        </div>
      {/if}
    {/snippet}

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
      class="min-h-0 w-full flex-1 border-0 bg-surface-raised"
    ></iframe>
  </LoadingRegion>

  {#if dev}
    <p class="px-12 py-4 text-xs text-text-muted">{editorStep.behaviour}</p>
  {/if}
</div>
