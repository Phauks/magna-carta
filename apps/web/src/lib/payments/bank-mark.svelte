<script lang="ts">
  /*
   * The mark beside a bank account's name: the bank's own logo where a bank feed has given one,
   * otherwise the bank's initials in a quiet square, so every account still has a mark that is
   * told apart at a glance (owner's ask, 2026-11-20: "include bank logos if possible").
   */
  let {
    name,
    logo = null,
    size = "default",
  }: {
    /** The bank's name, or the account's where the bank is not known. */
    name: string;
    /** A PNG in base64, without the data: prefix, as the bank feed stores it. */
    logo?: string | null;
    size?: "default" | "sm";
  } = $props();

  const initials = $derived(
    name
      .split(/\s+/)
      .filter((word) => /^[A-Za-z0-9]/.test(word))
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?",
  );
  const box = $derived(size === "sm" ? "size-20 text-xs" : "size-24 text-xs");
</script>

{#if logo !== null && logo !== ""}
  <img
    src="data:image/png;base64,{logo}"
    alt=""
    aria-hidden="true"
    class="{box} shrink-0 rounded-sm object-contain"
  />
{:else}
  <span
    aria-hidden="true"
    class="{box} inline-flex shrink-0 items-center justify-center rounded-sm border border-border-default bg-surface-sunken font-semibold text-text-muted"
  >
    {initials}
  </span>
{/if}
