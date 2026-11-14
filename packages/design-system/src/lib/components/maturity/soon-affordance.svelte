<script lang="ts">
  /*
   * SoonAffordance — a control that is designed but not yet served, rendered honestly.
   *
   * The standing rule is that a capability the backend does not serve yet still RENDERS: its real
   * anatomy, its real words, the affordance disabled, and the Soon mark beside it. Users then see
   * the shape of what is coming and can never mistake it for working. What that rule kept costing
   * was consistency, because every call site wrote its own `disabled` plus its own title plus its
   * own badge, and the three drifted apart surface by surface.
   *
   * So the composition lives here, once. A call site hands over the reason and its control, and
   * gets back the disabled control, the Soon badge, and the dependency in the one place the rest
   * of the product puts an explanation:
   *
   *   <SoonAffordance reason="archive extraction">
   *     {#snippet control(soon)}
   *       <Button {...soon}>Restore This File Into the Matter</Button>
   *     {/snippet}
   *   </SoonAffordance>
   *
   * WHERE THE DEPENDENCY IS SAID. On the hover, by default: the badge alone carries the fact, and
   * a sentence printed under every disabled item in a menu would bury the menu it belongs to.
   * Where the surface is a whole capability rather than one item in a list, `reasonPlacement="line"`
   * draws the line beneath it instead, which is what the standing rule asks for on that kind of
   * surface.
   *
   * Either way the reason reaches a screen reader. A disabled control cannot be hovered or focused,
   * so a title alone would say nothing to anyone not using a mouse; the sentence is therefore
   * always the control's accessible description, whether or not it is drawn.
   *
   * It lives in the design system rather than the app because the ActionDialog shell is one of its
   * callers: a panel whose commit is not served yet hands the shell `commitSoon`, and the shell
   * wraps its own commit in this, so a not-yet-served act reads the same in a panel as it does in
   * a menu or a record window.
   */
  import type { Snippet } from "svelte";
  import MaturityBadge from "./maturity-badge.svelte";
  import { soonControlProperties, type SoonControlProperties } from "./soon-affordance.ts";

  let {
    reason,
    reasonPlacement = "hover",
    control,
    class: className,
  }: {
    /**
     * What the capability waits on, as a noun phrase: "file conversion", "client-portal
     * document sharing". It is completed into a sentence here, so every surface words it the same.
     */
    reason: string;
    /** Whether the dependency is drawn beneath the control or left to the hover and the reader. */
    reasonPlacement?: "hover" | "line";
    /** The real control, given the attributes that make it disabled and honest about why. */
    control: Snippet<[SoonControlProperties]>;
    class?: string;
  } = $props();

  const descriptionIdentifier = $props.id();
  const properties = $derived(soonControlProperties(reason, descriptionIdentifier));
</script>

<div class="flex flex-col gap-4 {className ?? ''}">
  <div class="flex items-center gap-8">
    {@render control(properties)}
    <MaturityBadge stage="soon" />
  </div>
  <p
    id={descriptionIdentifier}
    class={reasonPlacement === "line" ? "text-xs text-text-muted" : "sr-only"}
  >
    {properties.title}
  </p>
</div>
