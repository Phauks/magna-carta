<script lang="ts">
  /*
   * PermissionRequest — the one window a member is asked for a permission in.
   *
   * It is an ActionDialog question, not a panel of its own: the frame, the action bar, the dismissal
   * word and the close path are that shell's, so a permission is answered in the same place every
   * other question in the product is. What this component adds is the SHAPE of the ask, and it is
   * fixed: what is being allowed (the heading), who is asking (the subject line), and the grants (a
   * list). A feature supplies those three things and nothing else.
   *
   * IT STATES ONLY WHAT IT GRANTS. There is no slot for what is not granted, for reassurance, or for
   * a second column, and no body snippet a caller could put one in. That is the owner's ruling
   * (2026-11-10, docs/conventions/design-corrections.md) and it is held by the props rather than by
   * review: a caller cannot write what the component has nowhere to render.
   *
   * THE VERB IS THE COMPONENT'S. "Allow" for every request, so a reader who has answered one has
   * learned them all. What follows the answer — a provider's own sign-in page, a device prompt — is
   * the caller's, started from `onAllow`.
   *
   * Nothing is lost by walking away from a question that has no fields, so no exit asks first.
   */
  import type { Snippet } from "svelte";
  import ActionDialog from "../action-dialog/action-dialog.svelte";
  import type { ActionOutcome } from "../action-dialog/types.ts";
  import { ALLOW_LABEL, ALLOWING_LABEL, askedByLine } from "./permission-request-model.ts";
  import type { PermissionRequestContent } from "./types.ts";

  let {
    open = $bindable(false),
    heading,
    askedBy,
    grants,
    onAllow,
    onDismiss,
    notice,
  }: PermissionRequestContent & {
    /** Whether the request is showing. Bindable, so a surface can open and close it. */
    open?: boolean;
    /**
     * Grant it. "committed" closes the window; "refused" leaves it standing with whatever the caller
     * put in the notice; "done" leaves it standing with nothing left to ask.
     */
    onAllow: () => Promise<ActionOutcome>;
    /** Fired after the reader walks away without allowing. */
    onDismiss?: () => void;
    /** Where a failure to grant is reported; the content is the caller's, the place is the shell's. */
    notice?: Snippet;
  } = $props();
</script>

<ActionDialog
  bind:open
  kind="confirm"
  width="narrow"
  {heading}
  subtitle={{ facts: [askedByLine(askedBy)] }}
  commitLabel={ALLOW_LABEL}
  commitBusyLabel={ALLOWING_LABEL}
  unsavedChanges={false}
  onCommit={onAllow}
  {onDismiss}
  {notice}
>
  {#snippet fields()}
    <ul class="flex list-disc flex-col gap-2 ps-5 text-sm">
      {#each grants as grant (grant)}
        <li>{grant}</li>
      {/each}
    </ul>
  {/snippet}
</ActionDialog>
