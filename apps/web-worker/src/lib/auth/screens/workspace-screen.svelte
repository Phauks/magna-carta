<script lang="ts">
  /*
   * Select Workspace — the fork, and the first screen that is allowed to know anything about the
   * person in front of it.
   *
   * FIRM ASSOCIATIONS ARE REVEALED ONLY AFTER AUTHENTICATION. That is the whole reason this screen
   * exists as its own step rather than as a choice on the sign-in form: which firms a person deals
   * with is privileged, and asking before they have proved who they are would answer it for anyone
   * who typed the address.
   *
   * It is also why there is ONE sign-in surface for firm members and portal clients alike. The
   * client portal is a post-authentication host, not a second front door: authentication happens
   * first, and this chooser decides where the person lands. Two consequences a later change must
   * not undo — do not add a portal login, and never brand the sign-in screen as firm-only or
   * client-only, because it serves both and serves them before it knows which one is typing.
   *
   * Each row carries WHERE the workspace is and WHEN this person last opened it. That is not
   * decoration: it is what tells two similarly named firms apart, which is the only hard part of
   * this screen.
   *
   * With a default set and a valid session, neither this screen nor sign-in appears — the person
   * lands in their workspace. It shows on a sign-in where several associations exist and no default
   * is set. Moving between workspaces afterwards is an in-app switcher, never a trip back here.
   */
  import Building from "@lucide/svelte/icons/building-2";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import ChoiceRow from "@magna-carta/design-system/choice-row";
  import Label from "@magna-carta/design-system/label";
  import AuthPanel from "../auth-panel.svelte";

  export interface WorkspaceOption {
    id: string;
    name: string;
    /** Where the workspace is, and when this person last opened it. */
    detail: string;
    /** Whether this person is at the firm or a client of it. */
    relationship: "Firm" | "Client";
  }

  let {
    workspaces,
    selectedId = $bindable<string | null>(null),
    makeDefault = $bindable(true),
    pending = false,
    onContinue,
  }: {
    workspaces: readonly WorkspaceOption[];
    selectedId?: string | null;
    makeDefault?: boolean;
    pending?: boolean;
    onContinue: () => void;
  } = $props();
</script>

<AuthPanel title="Select Workspace">
  {#snippet children()}
    <div class="flex flex-col gap-8">
      {#each workspaces as workspace (workspace.id)}
        <ChoiceRow
          selected={selectedId === workspace.id}
          onclick={() => (selectedId = workspace.id)}
        >
          {#snippet icon()}<Building size={17} />{/snippet}
          {#snippet detail()}{workspace.detail}{/snippet}
          {#snippet trailing()}<Badge variant="neutral">{workspace.relationship}</Badge>{/snippet}
          {workspace.name}
        </ChoiceRow>
      {/each}
    </div>

    <div class="flex items-center gap-8">
      <Checkbox id="workspace-default" bind:checked={makeDefault} disabled={pending} />
      <Label for="workspace-default">Make this my default Workspace.</Label>
    </div>

    <Button
      variant="primary"
      size="lg"
      class="w-full"
      disabled={pending || selectedId === null}
      onclick={onContinue}
    >
      Continue
    </Button>
  {/snippet}
</AuthPanel>
