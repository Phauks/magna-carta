<script lang="ts">
  /*
   * A record's picture at the head of its window: a person's photograph or an organization's logo,
   * or their initials until there is one.
   *
   * PRESSING THE PICTURE ONLY LOOKS AT IT. It opens the picture large, on the same screen, with the
   * facts about it; changing it is a separate, named act (Edit Photo there), because somebody who
   * presses a face wants to see it, and landing in an editor they did not ask for is a trap. The
   * editor is the one place every change is made: re-centre, choose another file, or remove.
   *
   * With no picture there is nothing to look at, so the initials are only initials, and somebody
   * who may edit the directory gets the small camera button beside them that says Add Photo.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Button from "@magna-carta/design-system/button";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import {
    formatInstant,
    formatNumber,
    personInitials,
  } from "@magna-carta/design-system/formatters";
  import { toast } from "@magna-carta/design-system/toast";
  import Camera from "@lucide/svelte/icons/camera";
  import Download from "@lucide/svelte/icons/download";
  import Pencil from "@lucide/svelte/icons/pencil";
  import {
    entityPhotoHref,
    readDirectoryEntityPhoto,
    removeDirectoryEntityPhoto,
    setDirectoryEntityPhoto,
    type DirectoryEntityPhoto,
  } from "./directory-api.ts";
  import PhotoCropDialog from "./photo-crop-dialog.svelte";

  let {
    entityId,
    name,
    mayEdit,
  }: {
    entityId: string;
    /** What the record is called: the initials, and the picture's accessible name. */
    name: string;
    /** Whether the reader may change the directory. */
    mayEdit: boolean;
  } = $props();

  let photo = $state<DirectoryEntityPhoto | null>(null);
  let cropping = $state(false);
  let viewing = $state(false);

  $effect(() => {
    const id = entityId;
    photo = null;
    let cancelled = false;
    void (async () => {
      const outcome = await readDirectoryEntityPhoto(fetch, id);
      if (!cancelled && outcome.kind === "ok") photo = outcome.value.photo;
    })();
    return () => {
      cancelled = true;
    };
  });

  const initials = $derived(personInitials(name));
  const href = $derived(photo === null ? null : entityPhotoHref(entityId, photo));

  async function save(imageBase64: string): Promise<string | null> {
    const outcome = await setDirectoryEntityPhoto(fetch, entityId, imageBase64, crypto.randomUUID());
    if (outcome.kind !== "ok") {
      return outcome.kind === "problem" && outcome.problem.detail !== undefined
        ? outcome.problem.detail
        : "The picture wasn't saved. Try again.";
    }
    photo = outcome.value.photo;
    toast.success("Photo saved");
    return null;
  }

  async function remove(): Promise<boolean> {
    const outcome = await removeDirectoryEntityPhoto(fetch, entityId, crypto.randomUUID());
    if (outcome.kind !== "ok") {
      toast.error("The photo wasn't removed. Try again.");
      return false;
    }
    photo = null;
    toast.success("Photo removed");
    return true;
  }

  function facts(held: DirectoryEntityPhoto): string {
    return `${formatNumber(held.widthPixels)} by ${formatNumber(held.heightPixels)} pixels · set ${formatInstant(held.updatedAt)}`;
  }

  /** The name a downloaded picture is saved under: the record's name, and the format's extension. */
  const downloadName = $derived(
    `${name.trim() === "" ? "photo" : name.trim()}.${photo?.contentType === "image/png" ? "png" : "jpg"}`,
  );

  function edit(): void {
    viewing = false;
    cropping = true;
  }
</script>

{#snippet face()}
  <Avatar.Root class="size-48 shrink-0">
    {#if href !== null}
      <Avatar.Image src={href} alt={`Photo of ${name}`} />
    {/if}
    <Avatar.Fallback>{initials}</Avatar.Fallback>
  </Avatar.Root>
{/snippet}

{#if photo !== null}
  <button
    type="button"
    class="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-focus-ring"
    aria-label={`View the photo of ${name}`}
    title="View Photo"
    onclick={() => (viewing = true)}
  >
    {@render face()}
  </button>
{:else if mayEdit}
  <span class="relative shrink-0">
    {@render face()}
    <button
      type="button"
      class="absolute -end-4 -bottom-4 flex size-20 items-center justify-center rounded-full border border-border-default bg-surface-raised hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus-ring"
      aria-label={`Add a photo of ${name}`}
      title="Add Photo"
      onclick={() => (cropping = true)}
    >
      <Camera class="size-12" aria-hidden="true" />
    </button>
  </span>
{:else}
  {@render face()}
{/if}

{#if photo !== null && href !== null}
  <ActionDialog
    bind:open={viewing}
    kind="reading"
    heading="Photo"
    subtitle={{ facts: [name, facts(photo)] }}
  >
    {#snippet fields()}
      <div class="flex flex-col gap-16">
        <img
          src={href}
          alt={`Photo of ${name}`}
          class="block aspect-square w-full rounded-md bg-surface-sunken object-cover"
        />
        <div class="flex flex-wrap gap-8">
          {#if mayEdit}
            <Button variant="secondary" onclick={edit}>
              <Pencil class="size-16" aria-hidden="true" />
              Edit Photo
            </Button>
          {/if}
          <Button variant="secondary" {href} download={downloadName}>
            <Download class="size-16" aria-hidden="true" />
            Download
          </Button>
        </div>
      </div>
    {/snippet}
  </ActionDialog>
{/if}

<PhotoCropDialog
  bind:open={cropping}
  heading={photo === null ? "Add Photo" : "Edit Photo"}
  subject={name}
  current={href}
  onSave={save}
  onRemove={remove}
/>
