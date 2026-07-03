<script lang="ts">
  /*
   * Story support: a matter's status as a pale-tint Badge pill, mapping the status string to the
   * status register (Open = success, Pending = the gold "held" accent, Closed = neutral). Mounted as a
   * column cell via renderComponent — shows the calm status register on the work surface, not plain
   * text. NOT part of the design-system API.
   *
   * Props are typed Record<string, unknown> (what renderComponent mounts a cell with) and narrowed.
   */
  import Badge, { type BadgeVariant } from "../../lib/components/badge/index.ts";

  let { value }: Record<string, unknown> = $props();
  const status = $derived(String(value ?? ""));

  const VARIANT: Record<string, BadgeVariant> = {
    Open: "success",
    Pending: "accent",
    Closed: "neutral",
    Draft: "neutral",
    Prospective: "warning",
  };
</script>

<Badge variant={VARIANT[status] ?? "neutral"}>{status}</Badge>
