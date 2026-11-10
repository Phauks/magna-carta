<script module lang="ts">
  /*
   * FormattedCitation — one legal citation with Copy. Three states that render differently: a
   * complete citation with an italic case name, an incomplete one in the muted register, and one
   * shown without Copy for a surface that copies by other means.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import FormattedCitation from "../lib/components/formatted-citation/index.ts";

  const { Story } = defineMeta({
    title: "Data Display/Formatted Citation",
    component: FormattedCitation,
  });

  const complete = [
    { text: "Brown v. Bd. of Educ.", italic: true },
    { text: ", 347 U.S. 483, 495 (1954).", italic: false },
  ];
  const incomplete = [
    { text: "Brown v. Bd. of Educ.", italic: true },
    { text: ", 347 U.S. 483 ([year]).", italic: false },
  ];
</script>

<Story name="Complete" args={{ runs: complete }} />
<Story name="Incomplete" args={{ runs: incomplete, incomplete: true }} />
<Story name="Without Copy" args={{ runs: complete, copyable: false }} />
