<script lang="ts">
  /*
   * A record's picture at the head of its window: a person's photograph or an organization's logo,
   * or their initials until there is one.
   *
   * WHAT PRESSING IT DOES DEPENDS ON WHAT IS THERE TO DO, so it never opens a menu of one. A record
   * with no picture, seen by somebody who may edit the directory, opens Add Photo straight away, and
   * the small camera badge says so. A record with a picture offers Change Photo, View Full Size and
   * Remove Photo. Somebody who may not edit sees the picture, and pressing it shows it full size.
   * Initials with nothing to offer are only initials.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { personInitials } from "@magna-carta/design-system/formatters";
  import { toast } from "@magna-carta/design-system/toast";
  import Camera from "@lucide/svelte/icons/camera";
  import Expand from "@lucide/svelte/icons/expand";
  import ImageUp from "@lucide/svelte/icons/image-up";
  import Trash2 from "@lucide/svelte/icons/trash-2";
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
  let busy = $state(false);

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
        : "The picture was not saved. Try again.";
    }
    photo = outcome.value.photo;
    toast.success("Photo saved");
    return null;
  }

  async function remove(): Promise<void> {
    if (busy) return;
    busy = true;
    const outcome = await removeDirectoryEntityPhoto(fetch, entityId, crypto.randomUUID());
    busy = false;
    if (outcome.kind !== "ok") {
      toast.error("The photo was not removed. Try again.");
      return;
    }
    photo = null;
    toast.success("Photo removed");
  }

  function viewFullSize(): void {
    if (href !== null) window.open(href, "_blank", "noopener");
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

{#if photo !== null && mayEdit}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-focus-ring"
      aria-label={`Photo of ${name}: change, view or remove`}
      disabled={busy}
    >
      {@render face()}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start">
      <DropdownMenu.Item onSelect={() => (cropping = true)}>
        <ImageUp class="size-16" aria-hidden="true" />
        Change Photo
      </DropdownMenu.Item>
      <DropdownMenu.Item onSelect={viewFullSize}>
        <Expand class="size-16" aria-hidden="true" />
        View Full Size
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item onSelect={() => void remove()}>
        <Trash2 class="size-16" aria-hidden="true" />
        Remove Photo
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{:else if photo !== null}
  <button
    type="button"
    class="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-focus-ring"
    aria-label={`View the photo of ${name} full size`}
    onclick={viewFullSize}
  >
    {@render face()}
  </button>
{:else if mayEdit}
  <button
    type="button"
    class="relative shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-focus-ring"
    aria-label={`Add a photo of ${name}`}
    title="Add Photo"
    onclick={() => (cropping = true)}
  >
    {@render face()}
    <span
      aria-hidden="true"
      class="absolute -end-4 -bottom-4 flex size-20 items-center justify-center rounded-full border border-border-default bg-surface-raised"
    >
      <Camera class="size-12" />
    </span>
  </button>
{:else}
  {@render face()}
{/if}

<PhotoCropDialog
  bind:open={cropping}
  heading={photo === null ? "Add Photo" : "Change Photo"}
  subject={name}
  onSave={save}
/>
