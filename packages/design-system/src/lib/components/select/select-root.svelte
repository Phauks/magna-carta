<script lang="ts">
  /* Select.Root — owns the selected value and the open state and pairs the Trigger with its Content;
     renders no visible DOM of its own (a Floating UI anchor context plus the hidden form input).
     Thin wrapper over Bits UI Select.Root. `type` ("single" | "multiple") is required; `value` and
     `open` are bindable, and `name` makes the selection a form field via the hidden input.

     Multiple-select ordering: bits appends to the value array in SELECTION order, so the trigger's
     joined labels (and the submitted value) would read in pick order. When `items` is supplied (the
     same list that backs label resolution), the value is normalised to the order the options appear
     in that list, so the display and form value are predictable regardless of pick order. Single
     selects hold a scalar and are untouched.

     `allowDeselect` defaults to true (bits ships it false): a single select can return to the empty
     state by re-clicking the selected option (a multiple select ignores it). A required field that
     must keep a value once chosen passes `allowDeselect={false}`. bits closes a single select when a
     NEW value is picked but not when the current one is deselected; we close it on deselect too, so
     every single-select pick (set or clear) closes consistently.

     A list longer than SEARCH_THRESHOLD options (counted from `items`) narrows as it is typed into
     while open; see select-search.svelte.ts. Root owns that query and clears it when the list
     closes. */
  import { Select as SelectPrimitive } from "bits-ui";
  import { SelectSearch, setSelectSearch } from "./select-search.svelte.ts";

  let {
    value = $bindable(),
    open = $bindable(false),
    allowDeselect = true,
    ...restProps
  }: SelectPrimitive.RootProps = $props();

  // restProps still carries `type` and `items` (only `value` was pulled out for binding); read them
  // through a narrow view rather than re-typing the discriminated union.
  const ordering = $derived(
    restProps as {
      type?: "single" | "multiple";
      items?: ReadonlyArray<{ value: string; label?: string }>;
    },
  );

  const search = setSelectSearch(
    new SelectSearch({
      labels: () => (ordering.items ?? []).map((item) => item.label ?? item.value),
      isOpen: () => open,
    }),
  );
  $effect(() => {
    if (!open) search.clear();
  });

  // A pure reorder (no write-back): bits feeds the trigger and the hidden inputs from whatever the
  // bind getter returns, so presenting the multiple value in list order makes the display and the
  // submitted value predictable while selection updates still flow in through the setter.
  const orderedValue = $derived.by(() => {
    const items = ordering.items;
    if (ordering.type !== "multiple" || !Array.isArray(value) || !items) return value;
    const listOrder = items.map((item) => item.value);
    return [...value].sort((first, second) => listOrder.indexOf(first) - listOrder.indexOf(second));
  });
</script>

<!-- bits' value prop is a discriminated union (string for single, string[] for multiple) that a
     wrapper cannot statically narrow; the function-form binding feeds bits the reordered value and
     writes raw selections back, and the getter is cast so the forwarded props satisfy either branch. -->
<SelectPrimitive.Root
  bind:value={
    () => orderedValue as never,
    (next) => {
      value = next;
      // A single select clears to an empty value; bits leaves the listbox open on deselect, so close
      // it here to match the close-on-pick behaviour. Multiple selects stay open (they ignore this).
      if (ordering.type !== "multiple" && (next === undefined || next === "")) open = false;
    }
  }
  bind:open
  {allowDeselect}
  {...restProps}
/>
