<script lang="ts">
  /*
   * EntityIdentity — the one mark for a person or an organization wherever one is named: a directory
   * row, a party on a record, a payee on a cost, the chip standing inside a picker.
   *
   * It exists so those surfaces cannot drift. The entity a conflicts result matches and the entity
   * the directory shows are one record, so the glyph that says which side of the directory it is,
   * the name, the stated pronouns and the folded-away mark have to read the same in every one of
   * them. The component takes a name and facts, never a fetch: what to show is the caller's, how it
   * looks is settled here. Nothing here infers anything from the name — the kind is supplied, and
   * the pronouns arrive already in their short form.
   *
   * Two sizes. `default` is a table cell or a list row: the glyph, the name with its pronouns beside
   * it, and a quieter second line. `sm` is a chip standing inside a field or beside a name, one line,
   * where the mark must not out-weigh the control it sits in; the aside is not drawn there, because
   * a chip names the record and has no room to explain it.
   *
   * The name is a link where the record has an address, a quiet button where the caller opens it
   * some other way, and plain text otherwise. Removing is the one act a chip owns; it is a real
   * control that stays visible when refused and says why, because a control that vanishes leaves a
   * reader wondering whether they missed it.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import Building2 from "@lucide/svelte/icons/building-2";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";
  import User from "@lucide/svelte/icons/user";
  import X from "@lucide/svelte/icons/x";
  import Badge from "../badge/badge.svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { entityKindLabel } from "./entity-kind-label.ts";
  import type { EntityIdentitySize, EntityKind } from "./types.ts";

  let {
    kind,
    name,
    size = "default",
    pronouns = null,
    merged = false,
    href,
    onOpen,
    aside = null,
    onRemove,
    removeLabel,
    disabled = false,
    disabledReason,
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> & {
    /**
     * Which side of the directory this is. A fact the caller supplies, never a guess from the name.
     * Null where the directory no longer resolves the record: the mark then says so rather than
     * wearing a glyph nobody can vouch for.
     */
    kind: EntityKind | null;
    /** The name the firm knows the entity by. */
    name: string;
    /** `default` for a row or a cell; `sm` for a chip inside a field. */
    size?: EntityIdentitySize;
    /** The person's stated pronouns, already in their short form ("she/her"). Never derived. */
    pronouns?: string | null;
    /** Whether this record has been folded into another one. */
    merged?: boolean;
    /** Where the record lives. Given, the name is the link to it. */
    href?: string;
    /** Open the record some way other than a link. Used only where there is no `href`. */
    onOpen?: () => void;
    /** A quieter second line the caller owns: an organization's legal name, a role on a record. */
    aside?: string | null;
    /** Supply to render the remove control. Omitted, the mark only names. */
    onRemove?: () => void;
    /** Accessible name for the remove control; defaults to "Remove <name>". */
    removeLabel?: string;
    /** Refuses the remove control while keeping it visible. */
    disabled?: boolean;
    /** Why removing is refused. Stated on the refused control. */
    disabledReason?: string;
  } = $props();

  const Glyph = $derived(kind === "person" ? User : kind === "organization" ? Building2 : CircleDashed);
  const kindWord = $derived(kind === null ? "Not in the directory" : entityKindLabel(kind));
  const showsAside = $derived(size === "default" && aside !== null && aside !== "");
</script>

<span
  bind:this={ref}
  class={mergeClasses(
    "mc-entity-identity",
    size === "sm" ? "mc-entity-identity-sm" : undefined,
    className,
  )}
  {...restProps}
>
  <Glyph class="mc-entity-identity-glyph" aria-hidden="true" />
  <span class="mc-entity-identity-body">
    <span class="mc-entity-identity-line">
      {#if href !== undefined}
        <a class="mc-entity-identity-name mc-entity-identity-link" {href}>{name}</a>
      {:else if onOpen}
        <button type="button" class="mc-entity-identity-name mc-entity-identity-open" onclick={onOpen}>
          {name}
        </button>
      {:else}
        <span class="mc-entity-identity-name">{name}</span>
      {/if}
      <span class="sr-only">{kindWord}</span>
      {#if pronouns !== null && pronouns !== ""}
        <!-- Beside the name, because that is where it governs: a pronoun is only useful at the
             moment somebody is about to write about this person. -->
        <span class="mc-entity-identity-pronouns">{pronouns}</span>
      {/if}
      {#if merged}
        <Badge variant="neutral">Folded in</Badge>
      {/if}
      {#if kind === null}
        <Badge variant="warning">Not in the directory</Badge>
      {/if}
    </span>
    {#if showsAside}
      <span class="mc-entity-identity-aside">{aside}</span>
    {/if}
  </span>
  {#if onRemove}
    <button
      type="button"
      class="mc-entity-identity-remove"
      {disabled}
      title={disabled ? disabledReason : undefined}
      aria-label={removeLabel ?? `Remove ${name}`}
      onclick={onRemove}
    >
      <X class="mc-entity-identity-remove-icon" aria-hidden="true" />
    </button>
  {/if}
</span>
