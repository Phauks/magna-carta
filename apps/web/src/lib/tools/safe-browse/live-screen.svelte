<script lang="ts">
  /*
   * The live remote browser's screen: a canvas the stream's JPEG frames are drawn into, and the
   * member's pointer, wheel, keys and pasted text sent back as input.
   *
   * IT IS A PICTURE THAT TAKES INPUT, NOT A PAGE. Nothing the suspect site sends is ever parsed as
   * markup here: a frame is decoded as an image and drawn, and what goes back is a position, a key
   * name or a string of pasted text. The site's code runs on the remote machine and nowhere else.
   * The one piece of the site's own text shown outside the picture — what a dismissed dialog said —
   * is set apart as the page's words, in monospace under a heading that says whose they are, so a
   * page cannot borrow the product's voice.
   *
   * THE CANVAS TAKES EVERY KEY WHILE IT HAS FOCUS — Tab included, because Tab moves between the
   * remote page's fields. So it has a stated way out: Escape twice in quick succession leaves it
   * (the first Escape still reaches the page, which may be closing a menu). The paste chord is the
   * member's too: it raises the paste event, which is the only way their clipboard text crosses.
   *
   * EVERY STATE HOLDS THE FRAME. Notices sit over the top of the screen rather than above it, so one
   * appearing never pushes the remote page down (which would also resize the remote browser). A
   * stopped stream hides its last frame, so a screen that no longer takes input never looks as
   * though it does. Opening shows the address and the seconds elapsed, as the static capture's
   * loading viewport does, and a fault being retried shows each attempt.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import {
    LIVE_SESSION_IDLE_MILLISECONDS,
    LIVE_SESSION_MAXIMUM_AGE_MILLISECONDS,
  } from "@magna-carta/safe-browse/live-session";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import {
    forwardsKey,
    isLeaveGesture,
    modifiersOf,
    pointerButton,
    remotePoint,
    wheelPixels,
  } from "./live-input.ts";
  import type { LiveStreamClient } from "./live-stream-client.svelte.ts";

  let {
    client,
    onrestart,
    onretrydownload,
  }: {
    client: LiveStreamClient;
    /** Start the stream again after it stopped, at the address it was last on. */
    onrestart?: () => void;
    /** Try the archive download again after the remote browser could not prepare it. */
    onretrydownload?: () => void;
  } = $props();

  const instructionsIdentifier = $props.id();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let stateRegion = $state<HTMLDivElement | null>(null);
  let spaceWidth = $state(0);
  let spaceHeight = $state(0);
  let elapsedSeconds = $state(0);

  // A pointer move is sent at most once per animation frame: a mouse reports far more often than a
  // remote screen can repaint, and every extra move is a message nobody will see the result of.
  let pendingMove: PointerEvent | null = null;
  let moveFrame: number | null = null;
  let previousEscapeAt: number | null = null;
  // Pointer events report no click count, so a double click is counted here: a second press close
  // in time and place to the first.
  let lastPress: { at: number; x: number; y: number; count: number } | null = null;

  const minutes = (milliseconds: number) => {
    const count = Math.round(milliseconds / 60_000);
    return count === 1 ? "1 minute" : `${count} minutes`;
  };

  const opening = $derived(
    client.status === "connecting" || (client.status === "open" && !client.showing),
  );

  // What a screen reader is told as the stream changes state. One region that always exists, so a
  // change is announced rather than missed as a region appearing with its text already in it.
  const stateAnnouncement = $derived.by(() => {
    if (client.retrying !== null) {
      return `The secure browser didn't respond. Trying again, attempt ${client.retrying.attempt} of ${client.retrying.maximumAttempts}.`;
    }
    if (opening) return "Opening the isolated remote browser.";
    if (client.status === "ended") return endedTitle();
    return "";
  });

  function endedTitle(): string {
    switch (client.stopReason) {
      case "idle":
        return `Live ended after ${minutes(LIVE_SESSION_IDLE_MILLISECONDS)} with no input`;
      case "ceiling":
        return `Live ended after ${minutes(LIVE_SESSION_MAXIMUM_AGE_MILLISECONDS)}, its longest session`;
      case "replaced":
        return "Live moved to another tab or window";
      case "closed":
        return "Live was ended";
      case "failed":
        return "The isolated browser could not be opened";
      case "lost":
      case null:
        return "The connection to the isolated browser was lost";
    }
  }

  function decode(base64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  $effect(() => {
    const target = canvas;
    if (target === null) return;
    const context = target.getContext("2d");
    if (context === null) return;
    return client.attachScreen(async (data, width, height) => {
      const bitmap = await createImageBitmap(new Blob([decode(data)], { type: "image/jpeg" }));
      if (target.width !== width) target.width = width;
      if (target.height !== height) target.height = height;
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
    });
  });

  $effect(() => {
    const width = spaceWidth;
    const height = spaceHeight;
    if (width <= 0 || height <= 0) return;
    const timer = setTimeout(() => client.resize({ width, height }), 250);
    return () => clearTimeout(timer);
  });

  // The opening screen's elapsed seconds, one interval per connect.
  $effect(() => {
    const since = client.connectingSince;
    if (since === null) return;
    elapsedSeconds = 0;
    const timer = setInterval(() => {
      elapsedSeconds = Math.floor((Date.now() - since) / 1000);
    }, 1000);
    return () => clearInterval(timer);
  });

  // A screen that stops taking input while it has focus hands focus to what replaced it, rather
  // than dropping it on the page body where a keyboard user would have to find their way back.
  $effect(() => {
    if (client.showing || canvas === null || stateRegion === null) return;
    if (document.activeElement === canvas) stateRegion.focus();
  });

  // Registered by hand because a wheel handler must be able to stop the member's own page from
  // scrolling, and a passive listener cannot.
  $effect(() => {
    const target = canvas;
    if (target === null) return;
    const onWheel = (event: WheelEvent) => {
      const point = pointOf(event);
      if (point === null) return;
      event.preventDefault();
      client.input({
        type: "wheel",
        ...point,
        ...wheelPixels(event, client.frameSize?.height ?? 600),
        modifiers: modifiersOf(event),
      });
    };
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => target.removeEventListener("wheel", onWheel);
  });

  function pointOf(event: { clientX: number; clientY: number }) {
    const frame = client.frameSize;
    if (canvas === null || frame === null) return null;
    return remotePoint(event, canvas.getBoundingClientRect(), frame);
  }

  function clickCountFor(event: PointerEvent): number {
    const now = event.timeStamp;
    const near =
      lastPress !== null &&
      now - lastPress.at < 500 &&
      Math.abs(event.clientX - lastPress.x) < 5 &&
      Math.abs(event.clientY - lastPress.y) < 5;
    const count = near && lastPress !== null ? Math.min(3, lastPress.count + 1) : 1;
    lastPress = { at: now, x: event.clientX, y: event.clientY, count };
    return count;
  }

  function sendPointer(event: PointerEvent, action: "move" | "down" | "up", clickCount = 0) {
    const point = pointOf(event);
    if (point === null) return;
    client.input({
      type: "pointer",
      action,
      ...point,
      button: action === "move" ? "none" : pointerButton(event.button),
      clickCount,
      modifiers: modifiersOf(event),
    });
  }

  function onPointerDown(event: PointerEvent) {
    event.preventDefault();
    canvas?.focus();
    canvas?.setPointerCapture(event.pointerId);
    sendPointer(event, "down", clickCountFor(event));
  }

  function onPointerUp(event: PointerEvent) {
    sendPointer(event, "up", lastPress?.count ?? 1);
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    pendingMove = event;
    if (moveFrame !== null) return;
    moveFrame = requestAnimationFrame(() => {
      moveFrame = null;
      const latest = pendingMove;
      pendingMove = null;
      if (latest !== null) sendPointer(latest, "move");
    });
  }

  function onKeyDown(event: KeyboardEvent) {
    const now = event.timeStamp;
    if (isLeaveGesture(event.key, now, previousEscapeAt)) {
      previousEscapeAt = null;
      event.preventDefault();
      canvas?.blur();
      return;
    }
    previousEscapeAt = event.key === "Escape" ? now : null;
    if (!forwardsKey(event)) return;
    event.preventDefault();
    client.input({
      type: "key",
      action: "down",
      key: event.key,
      code: event.code,
      modifiers: modifiersOf(event),
    });
  }

  function onKeyUp(event: KeyboardEvent) {
    if (!forwardsKey(event)) return;
    event.preventDefault();
    client.input({
      type: "key",
      action: "up",
      key: event.key,
      code: event.code,
      modifiers: modifiersOf(event),
    });
  }

  function onPaste(event: ClipboardEvent) {
    event.preventDefault();
    client.paste(event.clipboardData?.getData("text/plain") ?? "");
  }
</script>

<div aria-live="polite" class="sr-only">{stateAnnouncement}</div>

<div
  class="relative h-full min-h-0"
  bind:clientWidth={spaceWidth}
  bind:clientHeight={spaceHeight}
>
  <!-- The canvas scales the remote screen to fit and centres it; remotePoint allows for that fit
       when it maps a click back onto the remote page. Hidden while there is no live frame, so a
       stopped stream's last picture never passes for a working screen.
       role="application" is deliberate: the canvas is a remote page the keyboard drives directly, so
       assistive technology has to pass keys through rather than read it as an image. -->
  <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
  <canvas
    bind:this={canvas}
    tabindex={client.showing ? 0 : -1}
    role="application"
    aria-label="Live remote browser"
    aria-describedby={instructionsIdentifier}
    class="absolute inset-0 block h-full w-full touch-none object-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring {client.showing
      ? ''
      : 'invisible'}"
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
    onpointermove={onPointerMove}
    onkeydown={onKeyDown}
    onkeyup={onKeyUp}
    onpaste={onPaste}
    oncontextmenu={(event) => event.preventDefault()}
  ></canvas>
  <p id={instructionsIdentifier} class="sr-only">
    A live view of a remote browser. Click, scroll and type to use the page. Press Escape twice to leave.
  </p>

  <!-- What replaces the screen when it is not showing a live frame. Focusable so focus has somewhere
       to land when the screen it was on goes away. -->
  <div bind:this={stateRegion} tabindex="-1" class="outline-none">
    {#if client.status === "ended"}
      <div class="absolute inset-0 flex flex-col justify-center p-16">
        {#if client.failure !== null}
          <FailureNotice
            failure={client.failure}
            title={endedTitle()}
            fallback="The secure browser didn't respond after several attempts."
            whenSilent="The connection dropped and did not come back after several attempts."
            onRetry={onrestart}
          />
        {:else}
          <Alert.Root variant="info">
            <Alert.Title>{endedTitle()}</Alert.Title>
            <Alert.Description>
              <span class="mt-8 block">
                {#if onrestart}
                  <Button variant="secondary" size="sm" onclick={onrestart}>Start Again</Button>
                {/if}
              </span>
            </Alert.Description>
          </Alert.Root>
        {/if}
      </div>
    {:else if opening}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-8 p-16">
        {#if client.opening !== null}
          <p class="max-w-full truncate font-mono text-sm text-text-default" title={client.opening}>
            {client.opening}
          </p>
        {/if}
        <p class="text-sm text-text-muted">
          {client.retrying !== null
            ? `The isolated browser did not answer. Trying again, attempt ${client.retrying.attempt} of ${client.retrying.maximumAttempts}…`
            : "Opening the isolated remote browser…"}
        </p>
        <p class="font-mono text-xs text-text-muted">{elapsedSeconds}s</p>
      </div>
    {/if}
  </div>

  <!-- Notices sit over the screen's top edge, never above it: one appearing must not push the
       remote page down and resize the remote browser under the member's pointer. -->
  {#if client.notice !== null && client.status === "open"}
    <div class="absolute inset-x-0 top-0 p-8">
      {#if client.notice.kind === "refused"}
        <Alert.Root variant="warning">
          <Alert.Title>That address cannot be viewed</Alert.Title>
          <Alert.Description>
            Private, local and internal addresses are refused, including when a page tries to send
            the browser to one.
          </Alert.Description>
        </Alert.Root>
      {:else if client.notice.kind === "dialog"}
        <Alert.Root variant="info">
          <Alert.Title>The page showed a {client.notice.dialogKind} box, which was closed</Alert.Title>
          {#if client.notice.message !== ""}
            <Alert.Description>
              <span class="block">The page's own words:</span>
              <span class="mt-4 block font-mono break-words">{client.notice.message}</span>
            </Alert.Description>
          {/if}
        </Alert.Root>
      {:else if client.notice.action === "capture"}
        <Alert.Root variant="danger">
          <Alert.Title>Download failed</Alert.Title>
          <Alert.Description>
            <span class="block">The isolated browser could not capture the page.</span>
            {#if onretrydownload}
              <span class="mt-8 block">
                <Button variant="secondary" size="sm" onclick={onretrydownload}>Retry</Button>
              </span>
            {/if}
          </Alert.Description>
        </Alert.Root>
      {:else}
        <Alert.Root variant="warning">
          <Alert.Title>That page could not be opened</Alert.Title>
        </Alert.Root>
      {/if}
    </div>
  {:else if client.loading && client.showing}
    <p
      class="absolute bottom-8 left-8 rounded-sm bg-surface-raised px-8 py-4 text-xs text-text-muted"
    >
      Loading…
    </p>
  {/if}
</div>
