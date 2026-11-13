<script lang="ts">
  /*
   * The member's own picture, on Account · Profile.
   *
   * WHAT IT IS FOR, which decides everything below: a roster of names is a list somebody reads, and
   * a roster of faces is one they recognise. So the plate leads with the picture ITSELF at the size
   * it is actually seen at, not with a filename or a row of facts about some bytes. The facts under
   * it exist for one question — "is this the one I meant to upload?" — and say nothing else.
   *
   * EVERY ACT COMMITS AT ONCE. There is no staging here and no page-level save: choosing a file
   * uploads it, and removing removes. That is the firm brand-image plate's posture and it is right
   * for the same reason — a picture is judged by looking at it, so the fastest path from "not that
   * one" to "this one" is what the plate is for.
   *
   * THE FILE CHOOSER IS THE CONTROL, and it is deliberately not wrapped in a dialog. A dialog earns
   * its place where an act needs terms set beside it (the firm's marks need a role and a caption);
   * this one needs a file and nothing else, and a panel around a single file input is a step a
   * person has to get through rather than a step that helps them.
   *
   * THE REFUSAL IS SAID BEFORE THE UPLOAD where the file itself decides it — the wrong format, or
   * larger than the server's ceiling — because waiting for a two-megabyte round trip to be told the
   * file was never going to work is the one failure this plate can spare somebody.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Button from "@magna-carta/design-system/button";
  import FileInput from "@magna-carta/design-system/file-input";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import {
    formatInstant,
    formatNumber,
    personInitials,
  } from "@magna-carta/design-system/formatters";
  import { toast } from "@magna-carta/design-system/toast";
  import type { Failure } from "$lib/api/request.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { fileToBase64 } from "$lib/offices/offices-api.ts";
  import {
    ACCEPTED_PHOTO_TYPES,
    MAXIMUM_PHOTO_BYTES,
    MAXIMUM_PHOTO_MEGABYTES,
    memberPhotoHref,
    readMemberPhoto,
    removeMemberPhoto,
    writeMemberPhoto,
    type MemberPhoto,
  } from "$lib/account/member-photo-api.ts";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";

  let {
    /** What the member is called, so the empty state shows their initials rather than a blank disc. */
    displayName = "",
  }: { displayName?: string } = $props();

  let photo = $state<MemberPhoto | null>(null);
  /** Distinguishes "read has not happened yet" from "read happened, there is no picture". */
  let read = $state(false);
  let readFailure = $state<Failure | null>(null);
  let actionFailure = $state<StatedFailure | null>(null);
  let busy = $state(false);
  /** A refusal the chosen file itself decided, before anything was sent. */
  let chosenFileRefusal = $state<string | null>(null);
  /*
   * The chooser itself, so its selection can be cleared after every act.
   *
   * A FILE INPUT ONLY FIRES WHEN ITS VALUE CHANGES, and the value is the filename. Left holding the
   * last choice, the control silently does nothing when the same file is chosen again — which is
   * exactly the sequence somebody performs after removing a picture and changing their mind, and
   * after an upload that was refused. Clearing it after each act makes every choice a change.
   */
  let chooser = $state<HTMLInputElement | null>(null);

  function clearChooser(): void {
    if (chooser !== null) chooser.value = "";
  }

  async function load(): Promise<void> {
    readFailure = null;
    const outcome = await readMemberPhoto();
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    photo = outcome.value.photo;
    read = true;
  }

  $effect(() => {
    void load();
  });

  const initials = $derived(personInitials(displayName));

  function facts(held: MemberPhoto): string {
    return `${formatNumber(held.widthPixels)} by ${formatNumber(held.heightPixels)} pixels · ${
      held.contentType === "image/png" ? "PNG" : "JPEG"
    } · set ${formatInstant(held.updatedAt)}`;
  }

  async function choose(file: File | null): Promise<void> {
    chosenFileRefusal = null;
    if (file === null || busy) return;
    if (file.size > MAXIMUM_PHOTO_BYTES) {
      chosenFileRefusal = `That file is larger than ${MAXIMUM_PHOTO_MEGABYTES} MB. Choose a smaller one.`;
      clearChooser();
      return;
    }
    busy = true;
    actionFailure = null;
    const outcome = await writeMemberPhoto(await fileToBase64(file));
    busy = false;
    clearChooser();
    if (outcome.kind !== "ok") {
      actionFailure = stated(
        outcome.failure,
        "Your picture was not changed.",
        "Couldn't connect. Nothing changed. Choose the file again to retry.",
      );
      return;
    }
    photo = outcome.value.photo;
    toast.success("Your picture is set.");
  }

  async function remove(): Promise<void> {
    if (busy) return;
    busy = true;
    actionFailure = null;
    const outcome = await removeMemberPhoto();
    busy = false;
    if (outcome.kind !== "ok") {
      actionFailure = stated(outcome.failure, "Your picture was not removed.");
      return;
    }
    photo = outcome.value.photo;
    clearChooser();
    toast.success("Your picture is removed.");
  }
</script>

<SettingsPlate heading="Photo">
  <LoadingRegion
    loading={!read && readFailure === null}
    failed={readFailure !== null && !read}
    label="Reading your picture"
    onRetry={() => void load()}
    class="flex flex-col"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="Your Picture Could Not Be Read"
          fallback="Your picture was not read."
          onRetry={() => void load()}
        />
      {/if}
    {/snippet}

    {#if actionFailure !== null}
      <div class="py-12">
        <FailureNotice
          failure={actionFailure.failure}
          fallback={actionFailure.fallback}
          whenSilent={actionFailure.whenSilent}
        />
      </div>
    {/if}

    <div class="flex items-center gap-24 py-12">
      <!-- The picture at the size it is seen at. The fallback is the member's own initials, which
           is what every other avatar in the product falls back to, so an account with no picture
           does not read as an account with a broken one. -->
      <Avatar.Root class="size-96 shrink-0">
        {#if photo !== null}
          <Avatar.Image src={memberPhotoHref(photo)} alt="Your picture" />
        {/if}
        <Avatar.Fallback class="text-md">{initials}</Avatar.Fallback>
      </Avatar.Root>

      <div class="flex min-w-0 grow flex-col gap-8">
        <div class="flex flex-col gap-4">
          <FileInput
            bind:ref={chooser}
            accept={ACCEPTED_PHOTO_TYPES}
            disabled={busy}
            aria-label={photo === null ? "Choose a picture" : "Choose a different picture"}
            onchange={(event) => void choose(event.currentTarget.files?.[0] ?? null)}
          />
          {#if chosenFileRefusal !== null}
            <p class="text-sm text-text-danger">{chosenFileRefusal}</p>
          {:else if photo !== null}
            <p class="text-sm text-text-muted">{facts(photo)}</p>
          {/if}
        </div>
      </div>

      {#if photo !== null}
        <Button variant="secondary" size="sm" disabled={busy} onclick={() => void remove()}>
          Remove
        </Button>
      {/if}
    </div>
  </LoadingRegion>
</SettingsPlate>
