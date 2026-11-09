<script lang="ts">
  /*
   * The feed's rows — the one place a notification becomes something a person reads, shared by the
   * notification centre and the bell's popover so the two can never drift into describing the same
   * row differently.
   *
   * THE WHOLE ROW IS THE LINK. A notification exists to get somebody to a record, so the target is
   * the row rather than a chase-link at its end, and following it settles the row on the way past:
   * a member who has dealt with something should not also have to tell the application they dealt
   * with it. Dismiss stays a separate, explicit control, because "I have seen this" and "this is
   * finished with" are different statements and only the second should be able to remove a row from
   * a filtered view.
   *
   * UNREAD IS CARRIED BY A MARK, NOT BY A BACKGROUND. A tinted row competes with the severity tint
   * that actually says how urgent something is, and on a long feed the two tints read as one noisy
   * surface. The dot and the heavier title are enough, and they survive high-contrast and
   * colour-blind viewing where a fill does not.
   *
   * NOTHING HERE INVENTS TEXT. Every word comes from ./notification-presentation.ts, which composes
   * it from the kind and the declared facts; the matter is shown by its NUMBER, which is what the
   * server resolved through the same join that enforces visibility.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { formatInstant, instantAttribute } from "@magna-carta/design-system/formatters";
  import Check from "@lucide/svelte/icons/check";
  import X from "@lucide/svelte/icons/x";
  import { notificationCategoryLabel } from "./category-vocabulary.ts";
  import {
    CATEGORY_PRESENTATION,
    SEVERITY_BADGE,
    PRIORITY_LABEL,
    describeNotification,
  } from "./notification-presentation.ts";
  import type { NotificationItem } from "./notifications-api.ts";

  let {
    items,
    onOpen,
    onDismiss,
    compact = false,
  }: {
    items: readonly NotificationItem[];
    /** Called when a row is followed or explicitly marked read. The host settles it. */
    onOpen: (item: NotificationItem) => void;
    /**
     * Called when a row is dismissed. Omitted by the popover, which is a glance surface: dismissing
     * from a list of five, with no filter and no undo in view, is too easy to do by accident.
     */
    onDismiss?: (item: NotificationItem) => void;
    /** The bell's register: tighter rows and no dismiss. The priority word stays, because the tray leads with it. */
    compact?: boolean;
  } = $props();
</script>

<ul class="flex flex-col" class:gap-4={compact}>
  {#each items as item (item.id)}
    {@const described = describeNotification(item)}
    {@const category = CATEGORY_PRESENTATION[item.category]}
    {@const categoryLabel = notificationCategoryLabel(item.category)}
    {@const unread = item.state === "unread"}
    <!-- A kind whose type has been retired resolves to no deep link, and the server sends an empty
         string rather than dropping the row. An `<a href="">` reloads the page the reader is
         standing on, which is worse than not being a link at all — so the title stays plain text
         and the row keeps its controls. -->
    {@const followable = item.link !== ""}
    <li
      class="group relative flex items-start gap-12 rounded-md border-border-subtle
             {compact ? 'p-8' : 'border-b p-12'}"
    >
      <!-- The category glyph. Decorative beside the title, which already names the category in
           words for anything that does not render icons. -->
      <span
        class="mt-2 flex size-32 shrink-0 items-center justify-center rounded-full bg-surface-sunken
               text-text-muted"
      >
        <category.icon class="size-16" aria-hidden="true" />
      </span>

      <div class="flex min-w-0 grow flex-col gap-2">
        <div class="flex items-baseline gap-8">
          <!-- The row's target. The stretched pseudo-element puts the hit area over the whole row
               without nesting the dismiss control inside the link, which would make it
               unreachable. -->
          {#if followable}
            <a
              href={item.link}
              class="after:absolute after:inset-0 focus-visible:outline-none"
              onclick={() => onOpen(item)}
            >
              <span class="text-sm {unread ? 'font-semibold' : 'font-medium'}"
                >{described.title}</span
              >
            </a>
          {:else}
            <span class="text-sm {unread ? 'font-semibold' : 'font-medium'}">{described.title}</span>
          {/if}
          {#if unread}
            <span
              class="size-8 shrink-0 rounded-full bg-accent-default"
              aria-label="Unread"
              role="img"
            ></span>
          {/if}
          {#if item.severity !== "informational"}
            <Badge variant={SEVERITY_BADGE[item.severity]}>{PRIORITY_LABEL[item.severity]}</Badge>
          {/if}
        </div>

        <p class="flex flex-wrap items-center gap-x-8 gap-y-2 text-xs text-text-muted">
          <span>{categoryLabel}</span>
          {#if item.matterNumber !== null}
            <span aria-hidden="true">·</span>
            <span>Matter {item.matterNumber}</span>
          {/if}
          {#if described.detail !== null}
            <span aria-hidden="true">·</span>
            <span>{described.detail}</span>
          {/if}
          <span aria-hidden="true">·</span>
          <time datetime={instantAttribute(item.occurredAt)}>{formatInstant(item.occurredAt)}</time>
        </p>
      </div>

      {#if !compact}
        <!-- The row controls have to sit above the link's stretched hit area or they cannot be
             pressed. `relative` alone does it — both are positioned elements in the row's stacking
             context, so the later one in document order paints on top, and no z-index is involved.
             They stay in the tab order at all times: revealing controls on hover alone would put
             them out of reach of anybody not using a mouse. -->
        <div
          class="relative flex shrink-0 items-center gap-4 opacity-0
                 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        >
          {#if unread}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Mark read"
              title="Mark read"
              onclick={() => onOpen(item)}
            >
              <Check class="size-16" aria-hidden="true" />
            </Button>
          {/if}
          {#if onDismiss !== undefined}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss"
              title="Dismiss"
              onclick={() => onDismiss(item)}
            >
              <X class="size-16" aria-hidden="true" />
            </Button>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
</ul>
