<script lang="ts">
  /*
   * RecordParties — the people and organizations linked to a record, and the one place any kind of
   * record shows them.
   *
   * REMOVING IS NOT DELETING, and every word here is chosen to keep that true. A record and a
   * directory entity are joined, in a role; ending the join ends the join, and the person stays
   * exactly where they are in the directory with everything recorded about them. So the act is
   * called Remove and never Delete, its glyph is a broken link and never a waste bin, its colour is
   * never the danger colour, and the confirmation says in as many words where the person will still
   * be afterwards.
   *
   * ONE ENTITY, AS MANY ROWS AS ROLES. The same person is the executor and a beneficiary on one
   * estate, and each of those is its own association that ends on its own. So an entity already on
   * the record is NOT hidden from the picker the way an attached document is; the tab says what it
   * already holds about them ("Already on this record as Executor and Beneficiary") and refuses only
   * the exact repeat, the same entity in the same role, which is the one link that means nothing.
   *
   * ADDING HAPPENS IN THE TAB, not in a panel over it. The add row opens INLINE beneath the list:
   * who, then the role where the record offers one, then the capacity where it takes one, then Add.
   * A person choosing who to link wants to see who is already linked while they do it.
   *
   * A RECORD MAY LAY THE ROWS OUT ITSELF. A record with more to say about each party than a name and
   * a role (a matter says whether its latest conflicts check searched them) hands over `rows` and
   * draws them as a table, while this tab keeps what must not be copied: the add row, the rules
   * about a repeat link, and the Remove confirmation, which the record's rows reach through
   * `askToRemove`.
   *
   * The tab is DOMAIN-BLIND. It is the same tab on a matter, a custodian packet or a calendar
   * event, so nothing here names one: a record hands over its parties, its role vocabulary and its
   * verbs, and this presents them.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import Unlink from "@lucide/svelte/icons/unlink";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import ActionDialog from "../action-dialog/action-dialog.svelte";
  import * as Alert from "../alert/index.ts";
  import Button from "../button/button.svelte";
  import * as Combobox from "../combobox/index.ts";
  import EmptyState from "../empty-state/empty-state.svelte";
  import EntityIdentity from "../entity-identity/entity-identity.svelte";
  import EntityPicker from "../entity-picker/entity-picker.svelte";
  import type { EntityKind } from "../entity-identity/types.ts";
  import type { EntitySearch, PickableEntity } from "../entity-picker/types.ts";
  import Input from "../input/input.svelte";
  import Label from "../label/label.svelte";
  import Skeleton from "../skeleton/index.ts";
  import {
    formatInstant as instantText,
    instantAttribute,
    type Instant,
  } from "../../formatters/instant.ts";
  import { personName } from "../../formatters/person-name.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { alreadyHeldSentence, isRepeatLink, rolesAlreadyHeld } from "./linkable-entities.ts";
  import type { PartyLink, PartyRole, RecordParty } from "./types.ts";

  let {
    parties,
    roles = [],
    allowNewRole = false,
    roleRequired = true,
    capacityOffered = true,
    kinds,
    search,
    onCreate,
    canEdit = true,
    linkDisabledReason,
    onLink,
    onUnlink,
    onOpen,
    loading = false,
    loadingMessage = "Loading who is on this record",
    errorMessage,
    errorIdentifier,
    onRetry,
    formatInstant = instantText,
    rows,
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** Everyone linked to this record, one row per association. The order is the caller's. */
    parties: readonly RecordParty[];
    /**
     * The roles a party may be linked in, offered when one is added. Empty means the record's links
     * carry no role at all, and the role field is not shown: a note's "who I met with" is a link
     * with nobody's part to name.
     */
    roles?: readonly PartyRole[];
    /**
     * Whether a role the vocabulary does not offer may be typed and kept. True ends the role list in
     * the platform's add row, and the typed role becomes the link's own value, trimmed. A firm's
     * roles are never complete, and the moment somebody needs a missing one is the moment they are
     * typing it.
     */
    allowNewRole?: boolean;
    /**
     * Whether a link must carry a role where roles are offered. True (the default) refuses Add until
     * one is chosen, because a party with no part on a matter is a party nobody can act on.
     */
    roleRequired?: boolean;
    /**
     * Whether the capacity field is shown — the free text a party acts in ("Administrator",
     * "Trustee"). It is a fact the reader records, never one inferred from the role.
     */
    capacityOffered?: boolean;
    /** Which kinds of entity may be offered. Left out, both are: a payee is either. */
    kinds?: readonly EntityKind[];
    /**
     * The directory search the picker runs. The tab never fetches — the caller supplies the
     * directory, the picker owns everything around asking it.
     */
    search: EntitySearch;
    /**
     * A person or organization the directory does not hold yet: open quick-create with what was
     * typed. Given, the picker's list ends in the platform's add row rather than dead-ending.
     */
    onCreate?: (typed: string) => void;
    /** Whether this account may change who is linked. False leaves the controls visible, refused. */
    canEdit?: boolean;
    /**
     * Why linking and removing are refused. Given with `canEdit` false, the controls stay where
     * they are and say this instead of disappearing: a control that vanishes leaves a reader
     * wondering whether they missed it, where a refused one tells them what would change the answer.
     */
    linkDisabledReason?: string;
    /** A party was added: who, in what role, in what capacity. Persist the link. */
    onLink?: (link: PartyLink) => void;
    /** End this record's association with the party. The directory entity is not touched. */
    onUnlink?: (party: RecordParty) => void;
    /**
     * Open the entity. Given, each name is a quiet control; without it the name is plain text.
     * Where it opens is the caller's business, not this tab's.
     */
    onOpen?: (party: RecordParty) => void;
    /** True while the parties are being fetched: placeholder rows stand in for the real ones. */
    loading?: boolean;
    /** What a screen reader is told while the list is loading. */
    loadingMessage?: string;
    /** Given, the list is replaced by a recoverable failure stating this. */
    errorMessage?: string;
    /** The failure's own reference, so a person reporting it can name the exact one they hit. */
    errorIdentifier?: string;
    /** Try the fetch again. Without it the failure states itself and offers nothing. */
    onRetry?: () => void;
    /**
     * How a link's instant is rendered. The default states the actual moment in the reader's local
     * time; an override must do the same, because elapsed time ("2 hours ago") decays while it is
     * being read and cannot be compared between two rows.
     */
    formatInstant?: (at: Instant) => string;
    /**
     * The rows, laid out by the record instead of as this tab's list. Handed the parties, the
     * accessible name for each one's Remove control, and `askToRemove`, which opens this tab's own
     * confirmation. The loading, failure and empty states, the add row and the confirmation stay
     * the tab's.
     */
    rows?: Snippet<
      [
        {
          parties: readonly RecordParty[];
          removeLabel: (party: RecordParty) => string;
          askToRemove: (party: RecordParty) => void;
        },
      ]
    >;
  } = $props();

  /** The one sentence for the link that means nothing: the same entity, in the same role, again. */
  const REPEAT_SENTENCE = "This record already links them in that role.";

  /** The field names, written once: each is the label beside its control and its ghost text. */
  const ENTITY_FIELD_NAME = "Person or organization";
  const ROLE_FIELD_NAME = "Role";
  const CAPACITY_FIELD_NAME = "Capacity";

  const identity = $props.id();
  const entityInputId = `${identity}-entity`;
  const roleInputId = `${identity}-role`;
  const capacityInputId = `${identity}-capacity`;

  /** The party that a press is asking to remove, held until the reader confirms or backs out. */
  let pendingRemoval = $state<RecordParty | null>(null);

  /* --- the add row ------------------------------------------------------------------------- */

  let adding = $state(false);
  let chosenEntity = $state<PickableEntity | null>(null);
  /** The role's stored value: one of `roles`, or a typed one where `allowNewRole` lets it be. */
  let chosenRole = $state<string | null>(null);
  /** What the role field reads. Owned here so typed-but-unchosen text can never become a value. */
  let roleQuery = $state("");
  let capacity = $state("");

  /*
   * The list is readable, so what the add row says about an entity can be trusted. While the
   * parties are still arriving nobody knows who this record already holds, and a row that cannot
   * say "already on this record" would let the one meaningless link through; a failed fetch has
   * the same problem and its own act to take first.
   */
  const listIsReadable = $derived(!loading && errorMessage === undefined);
  const rolesOffered = $derived(roles.length > 0);

  /** The role's label as a reader sees it; a typed role is its own label. */
  function roleLabelOf(value: string): string {
    return roles.find((role) => role.value === value)?.label ?? value;
  }

  /** Narrowed by what has been typed. An empty query offers the whole vocabulary. */
  const matchingRoles = $derived.by(() => {
    const needle = roleQuery.trim().toLowerCase();
    if (needle === "") return roles;
    return roles.filter((role) => role.label.toLowerCase().includes(needle));
  });

  /*
   * Every row the listbox holds, which is also what the primitive needs told: bits reads this list
   * to name the selection once the rows themselves are unmounted. A typed role is not in the
   * vocabulary, so it is added here for as long as it is the selection.
   */
  const roleItems = $derived.by(() => {
    const items = matchingRoles.map((role) => ({ value: role.value, label: role.label }));
    if (chosenRole !== null && !roles.some((role) => role.value === chosenRole)) {
      items.push({ value: chosenRole, label: chosenRole });
    }
    return items;
  });

  /* Nothing typed still offers the add row; an exact match does not, since there is nothing to add. */
  const offersNewRole = $derived(
    allowNewRole &&
      !roles.some((role) => role.label.toLowerCase() === roleQuery.trim().toLowerCase()),
  );

  const rolesHeld = $derived(
    chosenEntity === null ? [] : rolesAlreadyHeld(parties, chosenEntity.identifier),
  );
  const heldSentence = $derived(alreadyHeldSentence(rolesHeld));
  const repeatsALink = $derived(
    chosenEntity !== null && isRepeatLink(parties, chosenEntity.identifier, chosenRole),
  );

  /**
   * Why Add is refused, if it is. Undefined means it is available. The control validates before it
   * enables: a press that would fail on the client is a press that should not be possible.
   */
  const addRefusal = $derived.by((): string | undefined => {
    if (chosenEntity === null) return "Choose who to add first.";
    if (rolesOffered && roleRequired && chosenRole === null) return "Choose a role first.";
    if (repeatsALink) return REPEAT_SENTENCE;
    return undefined;
  });

  /**
   * Opens the add row. Exported so a screen with a create control of its own — the matter header's
   * New Party — can open the same row the tab's inline Add… opens, rather than a second form.
   */
  export function openAddRow(): void {
    adding = true;
  }

  function closeAddRow(): void {
    adding = false;
    chosenEntity = null;
    chosenRole = null;
    roleQuery = "";
    capacity = "";
  }

  function pickRole(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    if (chosen === "") {
      chosenRole = null;
      roleQuery = "";
      return;
    }
    if (Combobox.isAddOption(chosen)) {
      const typed = roleQuery.trim();
      if (typed === "") return;
      chosenRole = typed;
      roleQuery = typed;
      return;
    }
    chosenRole = chosen;
    roleQuery = roleLabelOf(chosen);
  }

  function link(): void {
    if (chosenEntity === null || addRefusal !== undefined) return;
    const trimmedCapacity = capacity.trim();
    onLink?.({
      entity: chosenEntity,
      role: chosenRole,
      capacity: trimmedCapacity === "" ? null : trimmedCapacity,
    });
    closeAddRow();
  }

  /* --- the rows ---------------------------------------------------------------------------- */

  const PLACEHOLDER_ROWS = [0, 1, 2];

  /** The row's second line: the role, and the capacity where there is one, as "Role · Capacity". */
  function asideOf(party: RecordParty): string | undefined {
    const parts = [party.roleLabel ?? party.role, party.capacity].filter(
      (part): part is string => part !== undefined && part !== "",
    );
    return parts.length === 0 ? undefined : parts.join(" · ");
  }

  /**
   * What the remove control is called for one row. A refused control keeps its name and adds the
   * reason, so a reader who cannot see it greyed out is told the same thing the pointer is told.
   */
  // The role is part of the name, because one person may be on the record twice: two controls
  // that both read "Remove Eleanor Whitcombe" are one control to a screen reader.
  function removeLabel(party: RecordParty): string {
    const role = party.roleLabel ?? party.role;
    const name = role === undefined || role === "" ? `Remove ${party.name}` : `Remove ${party.name} as ${role}`;
    return canEdit || linkDisabledReason === undefined ? name : `${name}: ${linkDisabledReason}`;
  }

  /* --- the confirmation ---------------------------------------------------------------------- */

  /**
   * The first sentence of the confirmation: what stops, named, and in which role where there is
   * one. The second sentence, where the person will still be, is fixed.
   */
  const removalSentence = $derived.by(() => {
    if (pendingRemoval === null) return "";
    const role = pendingRemoval.roleLabel ?? pendingRemoval.role;
    const inRole = role === undefined || role === "" ? "" : ` as ${role}`;
    return `${pendingRemoval.name} stops being linked to this record${inRole}.`;
  });

  async function confirmRemoval(): Promise<"committed"> {
    const party = pendingRemoval;
    if (party !== null) onUnlink?.(party);
    return "committed";
  }
</script>

<div
  bind:this={ref}
  aria-busy={loading ? "true" : undefined}
  class={mergeClasses("mc-record-parties", className)}
  {...restProps}
>
  {#if errorMessage !== undefined}
    <Alert.Root variant="danger">
      <Alert.Title>The Parties Could Not Be Loaded</Alert.Title>
      <Alert.Description>
        <span class="mc-record-parties-error-message">{errorMessage}</span>
        {#if errorIdentifier}
          <span class="mc-record-parties-error-identifier">Error {errorIdentifier}</span>
        {/if}
      </Alert.Description>
      {#if onRetry}
        <div class="mc-record-parties-error-actions">
          <Button variant="secondary" size="sm" onclick={onRetry}>Try Again</Button>
        </div>
      {/if}
    </Alert.Root>
  {:else if loading}
    <p class="sr-only">{loadingMessage}</p>
    <div class="mc-record-parties-list" aria-hidden="true">
      {#each PLACEHOLDER_ROWS as placeholder (placeholder)}
        <div class="mc-record-parties-item">
          <Skeleton class="mc-record-parties-placeholder-mark" />
          <div class="mc-record-parties-item-body">
            <Skeleton class="mc-record-parties-placeholder-line w-48" />
            <Skeleton class="mc-record-parties-placeholder-line w-32" />
          </div>
        </div>
      {/each}
    </div>
  {:else if parties.length === 0}
    <EmptyState title="Nobody Linked Yet" />
  {:else if rows}
    {@render rows({ parties, removeLabel, askToRemove: (party) => (pendingRemoval = party) })}
  {:else}
    <ul class="mc-record-parties-list">
      {#each parties as party (party.identifier)}
        <li class="mc-record-parties-item">
          <div class="mc-record-parties-item-body">
            <EntityIdentity
              kind={party.kind}
              href={party.href}
              name={party.name}
              size="default"
              aside={asideOf(party)}
              onOpen={onOpen === undefined || party.href !== undefined
                ? undefined
                : () => onOpen?.(party)}
            />
            {#if party.linkedAt !== undefined || party.linkedBy !== undefined}
              <p class="mc-record-parties-item-meta">
                {#if party.linkedAt !== undefined}
                  <time datetime={instantAttribute(party.linkedAt)}>
                    {formatInstant(party.linkedAt)}
                  </time>
                {/if}
                {#if party.linkedAt !== undefined && party.linkedBy !== undefined}
                  <span class="mc-record-parties-item-separator" aria-hidden="true">·</span>
                {/if}
                {#if party.linkedBy !== undefined}
                  <!-- Always the person's own name: the shared formatter is what keeps "You" out. -->
                  <span>{personName(party.linkedBy)}</span>
                {/if}
              </p>
            {/if}
          </div>
          {#if onUnlink}
            <button
              type="button"
              class="mc-record-parties-remove"
              disabled={!canEdit}
              title={canEdit ? "Remove" : linkDisabledReason}
              aria-label={removeLabel(party)}
              onclick={() => (pendingRemoval = party)}
            >
              <Unlink class="mc-record-parties-remove-icon" aria-hidden="true" />
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if listIsReadable}
    {#if adding}
      <!--
        Inline, beneath the list, so who is already linked stays in view while the next one is
        chosen. Who first, because the role and the capacity are facts about that person's link.
      -->
      <div class="mc-record-parties-add-row">
        <div class="mc-record-parties-field">
          <Label for={entityInputId}>{ENTITY_FIELD_NAME}</Label>
          <EntityPicker
            {search}
            {kinds}
            bind:value={chosenEntity}
            label={ENTITY_FIELD_NAME}
            inputId={entityInputId}
            {onCreate}
          />
          {#if heldSentence !== null}
            <!-- What the record already holds about them: stated, never a refusal on its own. -->
            <p class="mc-record-parties-held">{heldSentence}</p>
          {/if}
        </div>

        {#if rolesOffered}
          <div class="mc-record-parties-field">
            <Label for={roleInputId}>{ROLE_FIELD_NAME}</Label>
            <Combobox.Root
              type="single"
              items={roleItems}
              value={(chosenRole ?? "") as never}
              inputValue={roleQuery}
              onValueChange={pickRole}
              onOpenChange={(open) => {
                // Closing settles the text on the truth: the chosen role, or empty when none is.
                if (!open) roleQuery = chosenRole === null ? "" : roleLabelOf(chosenRole);
              }}
            >
              <Combobox.Input
                id={roleInputId}
                fieldName={ROLE_FIELD_NAME}
                oninput={(event) => (roleQuery = event.currentTarget.value)}
              />
              <Combobox.Content>
                {#each matchingRoles as role (role.value)}
                  <Combobox.Item value={role.value} label={role.label} />
                {/each}
                {#if offersNewRole}
                  <Combobox.AddOption fieldName={ROLE_FIELD_NAME} query={roleQuery} />
                {/if}
              </Combobox.Content>
            </Combobox.Root>
          </div>
        {/if}

        {#if capacityOffered}
          <div class="mc-record-parties-field">
            <Label for={capacityInputId}>{CAPACITY_FIELD_NAME}</Label>
            <Input id={capacityInputId} bind:value={capacity} />
          </div>
        {/if}

        <!--
          One visible line for why Add is refused, the way the shell states a refusal beside its
          commit — once somebody has begun, so the row never opens on an instruction.
        -->
        {#if chosenEntity !== null && addRefusal !== undefined}
          <p class="mc-record-parties-add-refusal">{addRefusal}</p>
        {/if}

        <div class="mc-record-parties-add-row-actions">
          <Button variant="secondary" onclick={closeAddRow}>Cancel</Button>
          <Button
            variant="primary"
            disabled={addRefusal !== undefined}
            title={addRefusal}
            aria-label={addRefusal === undefined ? undefined : `Add: ${addRefusal}`}
            onclick={link}
          >
            Add
          </Button>
        </div>
      </div>
    {:else}
      <div class="mc-record-parties-actions">
        <Button
          variant="secondary"
          disabled={!canEdit}
          title={canEdit ? undefined : linkDisabledReason}
          class="mc-record-parties-add w-full"
          onclick={openAddRow}
        >
          <UserPlus class="mc-record-parties-add-icon" aria-hidden="true" />
          Add…
        </Button>
        {#if !canEdit && linkDisabledReason !== undefined}
          <p class="mc-record-parties-refusal">{linkDisabledReason}</p>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<!--
  The confirmation. It names what stops and, in the same breath, where the person will still be —
  because the fear this dialog has to answer is that pressing Remove takes them out of the directory.
  Nothing was begun, so there is nothing to lose by backing out and no discard question to ask.
-->
<ActionDialog
  bind:open={
    () => pendingRemoval !== null,
    (open) => {
      if (!open) pendingRemoval = null;
    }
  }
  kind="confirm"
  heading="Remove This Party?"
  commitLabel="Remove"
  unsavedChanges={false}
  onCommit={confirmRemoval}
>
  {#snippet subtitle()}
    {removalSentence}
  {/snippet}
  {#snippet fields()}
    <p class="mc-record-parties-confirm-body">
      They stay in the directory, with everything recorded about them.
    </p>
  {/snippet}
</ActionDialog>
