<script lang="ts">
  /*
   * The pane beside an open conversation: Context, Permissions and Artifacts (the owner's board,
   * rulings R2.15 to R2.17 in docs/conventions/magnus-rulings.md).
   *
   * CONTEXT is what this conversation carries: the files attached to it, the documents Magnus wrote
   * in it, and, when that permission is on, a line saying the reader's other conversations on the
   * matter are read too.
   *
   * PERMISSIONS says what Magnus may read, per conversation. Only what is built is offered: the
   * attached files of This Matter, which is what attaching already means, and the author's own other
   * conversations on the same matter, off until turned on. Firm records, the client's other matters,
   * research services and the firm library are not shown as switches, because a switch that changes
   * nothing would tell a member Magnus can read something it cannot (the decision record
   * docs/decisions/pending/what-magnus-reads-widens-one-disclosure-at-a-time.md).
   *
   * ARTIFACTS lists the documents Magnus wrote; opening one shows it with its versions
   * (artifact-view.svelte).
   */
  import FileText from "@lucide/svelte/icons/file-text";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import X from "@lucide/svelte/icons/x";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import Switch from "@magna-carta/design-system/switch";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import { toast } from "@magna-carta/design-system/toast";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import ArtifactView from "./artifact-view.svelte";
  import { latestVersion, versionOrigin } from "./artifact-text.ts";
  import type { ConversationSession } from "./conversation-session.svelte.ts";
  import { attachmentName, attachmentStatusSentence } from "./magnus-vocabulary.ts";

  export type PaneTab = "context" | "permissions" | "artifacts";

  let {
    session,
    fetchImpl,
    tab = $bindable("context"),
    openDocument = $bindable(null),
    memberName,
    readerIsAuthor,
    matterLine,
    attachRefusal,
    detachingFileId,
    onAttach,
    onDetach,
    onClose,
  }: {
    session: ConversationSession;
    fetchImpl: typeof fetch;
    tab?: PaneTab;
    /** The document open in the pane, and the version on screen; null shows the tabs. */
    openDocument?: { artifactId: string; versionNumber: number } | null;
    /** Who asks in the conversation. */
    memberName: string;
    /** True when the reader started the conversation, so may change it. */
    readerIsAuthor: boolean;
    /** The matter the conversation is kept on, as its number and name; null when on none. */
    matterLine: string | null;
    /** Why a file cannot be attached now, if it cannot. */
    attachRefusal?: string;
    detachingFileId: string | null;
    onAttach: () => void;
    onDetach: (fileId: string) => void;
    onClose: () => void;
  } = $props();

  let changingPermission = $state(false);

  const earlierOn = $derived(session.permissions.includes("own-matter-conversations"));
  const openArtifact = $derived(
    openDocument === null
      ? undefined
      : session.artifacts.find((artifact) => artifact.id === openDocument?.artifactId),
  );

  async function setEarlier(granted: boolean): Promise<void> {
    changingPermission = true;
    const outcome = await session.setPermission("own-matter-conversations", granted);
    changingPermission = false;
    if (outcome !== null && outcome.kind !== "ok") {
      toast.error("Nothing changed. The permission is as it was.");
    }
  }

  async function restore(versionNumber: number): Promise<boolean> {
    if (openDocument === null) return false;
    const outcome = await session.restoreVersion(openDocument.artifactId, versionNumber);
    if (outcome === null || outcome.kind !== "ok") {
      toast.error("The version was not restored. Nothing changed.");
      return false;
    }
    return true;
  }

  function open(artifactId: string, versionNumber: number): void {
    openDocument = { artifactId, versionNumber };
  }
</script>

{#snippet closeButton()}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="ghost" size="icon-sm" aria-label="Close the pane" onclick={onClose}>
          <X class="size-16" aria-hidden="true" />
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">Close</Tooltip.Content>
  </Tooltip.Root>
{/snippet}

{#snippet documentCards()}
  <ul class="flex flex-col gap-8" aria-label="Documents Magnus wrote">
    {#each session.artifacts as artifact (artifact.id)}
      {@const latest = latestVersion(artifact)}
      <li>
        <button
          type="button"
          class="flex w-full items-start gap-8 rounded-md border border-border bg-surface px-12 py-8 text-left hover:bg-surface-subtle"
          onclick={() => open(artifact.id, latest?.versionNumber ?? 1)}
        >
          <FileText class="mt-2 size-16 shrink-0 text-text-muted" aria-hidden="true" />
          <span class="flex min-w-0 flex-1 flex-col gap-2">
            <span class="truncate text-sm font-semibold">{artifact.title}</span>
            <span class="text-xs text-text-muted">
              {artifact.versions.length}
              {artifact.versions.length === 1 ? "version" : "versions"} · Only in this conversation
            </span>
            {#if latest !== undefined}
              <span class="text-xs text-text-muted">
                Last changed by {versionOrigin(latest, memberName)} · {formatInstant(
                  latest.createdAt,
                )}
              </span>
            {/if}
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/snippet}

<aside
  aria-label="Context, permissions and artifacts"
  class="flex min-h-0 w-full shrink-0 flex-col border-l border-border bg-surface-subtle md:w-xs data-[document=true]:md:w-md"
  data-document={openArtifact !== undefined}
>
  {#if openArtifact !== undefined && openDocument !== null}
    <ArtifactView
      artifact={openArtifact}
      conversationId={session.conversationId ?? ""}
      bind:versionNumber={
        () => openDocument?.versionNumber ?? 1,
        (versionNumber) => {
          if (openDocument !== null) openDocument = { ...openDocument, versionNumber };
        }
      }
      {memberName}
      canRestore={readerIsAuthor}
      {fetchImpl}
      onBack={() => {
        openDocument = null;
        tab = "artifacts";
      }}
      onRestore={restore}
    />
  {:else}
    <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col">
      <div class="flex items-center justify-between gap-8 px-16 py-8">
        <Tabs.List aria-label="Pane sections">
          <Tabs.Trigger value="context">Context</Tabs.Trigger>
          <Tabs.Trigger value="permissions">Permissions</Tabs.Trigger>
          <Tabs.Trigger value="artifacts">Artifacts</Tabs.Trigger>
        </Tabs.List>
        {@render closeButton()}
      </div>

      <Tabs.Content value="context" class="flex min-h-0 flex-1 flex-col gap-16 mc-scrollbar overflow-y-auto px-16 pb-16">
        <section class="flex flex-col gap-8" aria-labelledby="pane-attached">
          <div class="flex items-center justify-between gap-8">
            <FieldLabel as="h3" id="pane-attached">Attached Files</FieldLabel>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Attach files"
                    disabled={attachRefusal !== undefined || !readerIsAuthor}
                    onclick={onAttach}
                  >
                    <Paperclip class="size-16" aria-hidden="true" />
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content side="bottom">{attachRefusal ?? "Attach Files"}</Tooltip.Content>
            </Tooltip.Root>
          </div>
          {#if session.attachments.length === 0}
            <p class="text-sm text-text-muted">None attached.</p>
          {:else}
            <ul class="flex flex-col gap-8">
              {#each session.attachments as attachment (attachment.fileId)}
                <li
                  class="flex items-start justify-between gap-8 rounded-md border border-border bg-surface px-12 py-8"
                >
                  <span class="flex min-w-0 flex-col gap-2">
                    <span class="truncate text-sm font-medium">{attachmentName(attachment)}</span>
                    <span class="text-xs text-text-muted">{attachmentStatusSentence(attachment)}</span>
                  </span>
                  {#if readerIsAuthor}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={detachingFileId === attachment.fileId}
                      onclick={() => onDetach(attachment.fileId)}
                      aria-label="Take {attachmentName(attachment)} off this conversation"
                    >
                      Remove
                    </Button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="flex flex-col gap-8" aria-labelledby="pane-documents">
          <FieldLabel as="h3" id="pane-documents">Documents Magnus Wrote</FieldLabel>
          {#if session.artifacts.length === 0}
            <p class="text-sm text-text-muted">None yet.</p>
          {:else}
            {@render documentCards()}
          {/if}
        </section>

        {#if earlierOn}
          <section class="flex flex-col gap-4" aria-labelledby="pane-other">
            <FieldLabel as="h3" id="pane-other">Other Conversations</FieldLabel>
            <p class="text-sm text-text-muted">
              Magnus also reads the latest messages of up to five of {readerIsAuthor
                ? "your"
                : `${memberName}'s`} other conversations on this matter.
            </p>
          </section>
        {/if}
      </Tabs.Content>

      <Tabs.Content value="permissions" class="flex min-h-0 flex-1 flex-col gap-16 mc-scrollbar overflow-y-auto px-16 pb-16">
        <section class="flex flex-col gap-8" aria-labelledby="pane-this-matter">
          <div class="flex flex-col gap-2">
            <FieldLabel as="h3" id="pane-this-matter">This Matter</FieldLabel>
            <p class="text-xs text-text-muted">{matterLine ?? "This conversation is not kept on a matter."}</p>
          </div>
          <div class="flex items-start justify-between gap-12 rounded-md border border-border bg-surface px-12 py-8">
            <span class="flex min-w-0 flex-col gap-2">
              <span class="text-sm font-medium">Attached Files</span>
              <span class="text-xs text-text-muted">
                Always on. Magnus reads the files attached to this conversation, and no others.
              </span>
            </span>
          </div>
          <div class="flex items-start justify-between gap-12 rounded-md border border-border bg-surface px-12 py-8">
            <span class="flex min-w-0 flex-col gap-2">
              <span id="pane-earlier-label" class="text-sm font-medium">
                {readerIsAuthor ? "Your" : `${memberName}'s`} Other Conversations on This Matter
              </span>
              <span class="text-xs text-text-muted">
                {#if matterLine === null}
                  Keep this conversation on a matter to turn this on.
                {:else}
                  Off unless turned on. When on, Magnus reads the latest messages of up to five of
                  {readerIsAuthor ? "your" : `${memberName}'s`} most recent other conversations on this
                  matter. Never a colleague's.
                {/if}
              </span>
            </span>
            <Switch
              aria-labelledby="pane-earlier-label"
              checked={earlierOn}
              disabled={matterLine === null || !readerIsAuthor || changingPermission}
              onCheckedChange={(checked) => void setEarlier(checked)}
            />
          </div>
        </section>
        <p class="text-xs text-text-muted">
          Firm records, the client's other matters, research services and the firm library are not
          read. Each appears here once Magnus can search it, off until it is turned on.
        </p>
      </Tabs.Content>

      <Tabs.Content value="artifacts" class="flex min-h-0 flex-1 flex-col gap-8 mc-scrollbar overflow-y-auto px-16 pb-16">
        {#if session.artifacts.length === 0}
          <p class="text-sm text-text-muted">
            None yet. Ask Magnus to draft a letter, a table or a timeline and it opens here.
          </p>
        {:else}
          {@render documentCards()}
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</aside>
