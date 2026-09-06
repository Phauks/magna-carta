<script lang="ts">
  /*
   * DataTable.LoadMore — the way to the rest of a keyset-paginated list, in one shape and one place.
   *
   * IT SITS IN THE FOOTER, beside the counts that told the reader there was more. Three surfaces put
   * it in three shapes and two places, one of them below the strip entirely, where it read as an act
   * on the page rather than on the list.
   *
   * IT EXISTS ONLY WHILE THERE IS MORE, on the same rule as every other control that undoes a state:
   * a list that has reached its end shows nothing rather than a disabled button, because the absence
   * is what says the reader has seen everything.
   *
   * IT SAYS THE NOUN. "Load more matters", not "Load more" — the strip beside it is already counting
   * a noun, and a control that would not read the same on two screens is the one worth spelling out.
   */
  import Button from "../button/index.ts";

  let {
    noun,
    more,
    loading = false,
    onLoad,
    class: className,
  }: {
    /** What is being loaded, plural and lower case: "matters", "packets", "records". */
    noun: string;
    /** Whether the list has a next page at all. */
    more: boolean;
    /** A page is in flight. The control stays put and says so rather than leaving the row. */
    loading?: boolean;
    onLoad: () => void;
    class?: string;
  } = $props();
</script>

{#if more}
  <Button
    variant="secondary"
    size="sm"
    class={className}
    disabled={loading}
    onclick={onLoad}
    data-load-more
  >
    {loading ? "Loading" : `Load more ${noun}`}
  </Button>
{/if}
