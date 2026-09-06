<script module lang="ts">
  /*
   * CreateControl — the product's one control for making something new on a screen, at one width
   * on every screen. The stories show the three shapes it takes: one action, a menu of choices, and
   * refused with its reason. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import Building2 from "@lucide/svelte/icons/building-2";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import CreateControl from "../lib/components/create-control/create-control.svelte";

  const { Story } = defineMeta({
    title: "Actions/CreateControl",
    component: CreateControl,
    parameters: {
      controls: { include: ["noun", "title", "refusal"] },
    },
  });
</script>

<Story
  name="One action"
  args={{ noun: "Matter", title: "Open a new matter." }}
  play={async ({ canvas, step }) => {
    await step("The label is the verb and the noun, and the control is pressable", async () => {
      const control = canvas.getByRole("button", { name: "New Matter" });
      await expect(control).toBeEnabled();
      await expect(control).toHaveAttribute("title", "Open a new matter.");
    });
  }}
>
  {#snippet template(args)}
    <CreateControl {...args} onpress={() => {}} />
  {/snippet}
</Story>

<Story
  name="A menu of choices"
  args={{ noun: null, title: "Record a person or an organization." }}
  play={async ({ canvas, step }) => {
    await step("Without a noun the control reads the bare verb and opens a menu", async () => {
      const control = canvas.getByRole("button", { name: "New" });
      await expect(control).toBeEnabled();
      await expect(control).toHaveAttribute("aria-haspopup", "menu");
    });
  }}
>
  {#snippet template(args)}
    <CreateControl
      {...args}
      choices={[
        { label: "Person", icon: UserPlus, onselect: () => {} },
        { label: "Organization", icon: Building2, onselect: () => {} },
      ]}
    />
  {/snippet}
</Story>

<Story
  name="Refused with its reason"
  args={{
    noun: "Packet",
    refusal: "Logging a packet needs the custody:manage permission, which this account does not hold.",
  }}
  play={async ({ canvas, step }) => {
    await step("The control stays on the row, disabled, and the reason is its title", async () => {
      const control = canvas.getByRole("button", { name: "New Packet" });
      await expect(control).toBeDisabled();
      await expect(control).toHaveAttribute("title", expect.stringContaining("custody:manage"));
    });
  }}
>
  {#snippet template(args)}
    <CreateControl {...args} onpress={() => {}} />
  {/snippet}
</Story>

<Story name="Every label, one width">
  {#snippet template()}
    <!-- Side by side, the fixed width is the point: the shortest and the longest labels take the
         same footprint, so whatever sits beside the control never moves between screens. -->
    <div class="flex flex-col items-start gap-8">
      <CreateControl noun={null} onpress={() => {}} />
      <CreateControl noun="Fee" onpress={() => {}} />
      <CreateControl noun="Packet" onpress={() => {}} />
      <CreateControl
        noun="File"
        choices={[{ label: "New Document", icon: UserPlus, onselect: () => {} }]}
      />
    </div>
  {/snippet}
</Story>
