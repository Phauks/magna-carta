<script module lang="ts">
  /*
   * ScreenSearch — Compound Inputs. The product's ONE control for searching within the screen you
   * are on, as distinct from the top bar's command palette. No variant axis, so the showcase is one
   * story; every prop is a Control, declared on the component so docgen lists them under
   * "Properties".
   *
   * The rulings the play functions pin, in the words they were issued in:
   *   - it expands from an icon and collapses when unused;
   *   - a live query carries an X that clears it, and Escape still clears too;
   *   - clicking away from an empty field closes it, including a click that lands on nothing;
   *   - Enter hands the whole query to the screen, flushing any pending debounce first;
   *   - an active search keeps it open, with the accent treatment.
   *
   * The X REVERSES an earlier ruling that Escape alone was clearing enough, and the click-away
   * close corrects a collapse that only watched focus. Both reversals, and why, are in
   * docs/conventions/design-corrections.md; this file is where a regression against them fails.
   *
   * And the one thing that makes it centralizable: the SAME control serves a filter that runs in
   * the browser and a search that leaves the machine, and the calling screen writes the same shape
   * either way. Both are exercised below against the same component.
   *
   * A regression against any of them fails this file. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, userEvent, waitFor } from "storybook/test";
  import ScreenSearch from "../lib/components/screen-search/index.ts";
  import Button from "../lib/components/button/index.ts";

  const { Story } = defineMeta({
    title: "Compound Inputs/ScreenSearch",
    component: ScreenSearch,
    argTypes: {
      size: { control: "select", options: ["sm", "default", "lg"] },
      searchOn: { control: "select", options: ["keystroke", "pause"] },
    },
  });

  type ScreenSearchStoryArgs = ComponentProps<typeof ScreenSearch>;
</script>

<script lang="ts">
  // The two transports, both driving the same component. A screen author writes one of these; the
  // control cannot tell them apart and neither can the person using it.
  let rowsInTheBrowser = $state<string[]>([]);
  let rowsFromTheServer = $state<string[]>([]);
  const CASELOAD = [
    "Pemberton v. Hale Construction Co.",
    "Vance Pemberton Family Trust",
    "Estate of Marguerite Calloway",
  ];
  let serverCalls = $state(0);
  // What the screen was handed when Enter was pressed, and how many times.
  let submitted = $state<string[]>([]);
</script>

{#snippet template(args: ScreenSearchStoryArgs)}
  <!-- The action row this control was designed for: one row, the primary action and the search as
       icon controls beside it. -->
  <div class="flex items-center justify-end gap-8">
    <ScreenSearch label="Search matters" {...args} />
    <Button variant="primary">New matter</Button>
  </div>
{/snippet}

<!-- The showcase + Docs Primary. -->
<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "Search matters" });

    await step("At rest it is an icon, and the field is not in the tab order", async () => {
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(canvas.queryByRole("searchbox", { name: "Search matters" })).toBeNull();
    });

    await step("Pressing the icon expands the field and puts the caret in it", async () => {
      await userEvent.click(trigger);
      await expect(canvas.getByRole("searchbox", { name: "Search matters" })).toHaveFocus();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    await step("A live query marks the control searching, so it cannot close under you", async () => {
      await userEvent.keyboard("Pemberton");
      await expect(canvas.getByRole("searchbox", { name: "Search matters" })).toHaveValue(
        "Pemberton",
      );
      await expect(canvas.getByRole("search", { name: "Search matters" })).toHaveAttribute(
        "data-searching",
        "true",
      );
    });

    await step("A live query carries an X, and clearing from it keeps the caret in the field", async () => {
      const clear = canvas.getByRole("button", { name: "Clear search" });
      await userEvent.click(clear);
      const field = canvas.getByRole("searchbox", { name: "Search matters" });
      await expect(field).toHaveValue("");
      await expect(field).toHaveFocus();
    });

    await step("With nothing to clear the X is gone, so it never offers to undo nothing", async () => {
      await expect(canvas.queryByRole("button", { name: "Clear search" })).toBeNull();
    });

    await step("Escape still clears: the glyph names the way out, it does not replace it", async () => {
      await userEvent.keyboard("Pemberton");
      await userEvent.keyboard("{Escape}");
      const field = canvas.getByRole("searchbox", { name: "Search matters" });
      await expect(field).toHaveValue("");
      await expect(field).toHaveFocus();
    });

    await step("Escape on an empty field collapses it and hands focus back", async () => {
      await userEvent.keyboard("{Escape}");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toHaveFocus();
    });
  }}
/>

<!-- The centralization claim, tested: one component, two transports, one calling shape. -->
<Story
  name="Either transport"
  play={async ({ canvas, step }) => {
    await step("A filter already in the browser runs on every keystroke", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Search the caseload" }));
      await userEvent.keyboard("Pemberton");
      await expect(canvas.getByTestId("browser-rows")).toHaveTextContent(
        "Pemberton v. Hale Construction Co., Vance Pemberton Family Trust",
      );
    });

    await step("A search that leaves the machine waits for a pause in typing", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Search the register" }));
      await userEvent.keyboard("Calloway");
      // Mid-flight: the field already shows the text, the request has not gone yet.
      await expect(canvas.getByRole("searchbox", { name: "Search the register" })).toHaveValue(
        "Calloway",
      );
      await waitFor(() => expect(canvas.getByTestId("server-rows")).toHaveTextContent("Calloway"));
    });

    await step("Eight keystrokes made ONE request, not eight", async () => {
      await expect(canvas.getByTestId("server-calls")).toHaveTextContent("1");
    });

    await step("The control reports itself busy while the request is in flight", async () => {
      const register = canvas.getByRole("search", { name: "Search the register" });
      await expect(register).toHaveAttribute("data-busy", "false");
      await userEvent.keyboard(" Estate");
      await waitFor(() => expect(register).toHaveAttribute("data-busy", "true"));
      await waitFor(() => expect(register).toHaveAttribute("data-busy", "false"));
    });
  }}
>
  {#snippet template()}
    <div class="flex flex-col items-start gap-16">
      <ScreenSearch
        label="Search the caseload"
        onsearch={(query) => {
          rowsInTheBrowser = CASELOAD.filter((row) =>
            row.toLowerCase().includes(query.toLowerCase()),
          );
        }}
      />
      <p data-testid="browser-rows">{rowsInTheBrowser.join(", ")}</p>

      <ScreenSearch
        label="Search the register"
        searchOn="pause"
        onsearch={async (query) => {
          serverCalls += 1;
          // Stands in for the round trip. Long enough that the busy window below is observable
          // without a race, short enough that the story stays quick.
          await new Promise((resolve) => setTimeout(resolve, 250));
          rowsFromTheServer = CASELOAD.filter((row) =>
            row.toLowerCase().includes(query.toLowerCase()),
          );
        }}
      />
      <p data-testid="server-rows">{rowsFromTheServer.join(", ")}</p>
      <p data-testid="server-calls">{serverCalls}</p>
    </div>
  {/snippet}
</Story>

<!-- The seams, built and exercised, wired to no screen yet: the scope control at the field's
     leading edge, and the match count at its trailing edge. -->
<Story
  name="Seams: scope and count"
  play={async ({ canvas, step }) => {
    await step("The scope control seats at the field's leading edge", async () => {
      await expect(canvas.getByRole("button", { name: "Change scope: This list" })).toBeVisible();
      await expect(canvas.getByText("2 of 6")).toBeVisible();
    });
    await step("Reaching for the scope does not collapse the field", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Change scope: This list" }));
      await expect(canvas.getByRole("searchbox", { name: "Search this list" })).toBeVisible();
    });
  }}
>
  {#snippet template()}
    <div class="flex items-center justify-end gap-8">
      <ScreenSearch label="Search this list" value="Pemberton" expanded matchSummary="2 of 6">
        {#snippet scope()}
          <Button variant="ghost" size="sm" aria-label="Change scope: This list">This list</Button>
        {/snippet}
      </ScreenSearch>
      <Button variant="primary">New matter</Button>
    </div>
  {/snippet}
</Story>

<!-- The arrangement the owner ruled on: the icon opens LEFT to type and DOWN to aim. The panel is
     a seam on the control rather than a sibling beside it, which is the whole point of the story. -->
<Story
  name="Seams: the downward panel"
  play={async ({ canvas, step }) => {
    const trigger = canvas.getByRole("button", { name: "Search this matter" });

    await step("The panel opens with the field, so the scope is reachable before typing", async () => {
      await userEvent.click(trigger);
      await expect(canvas.getByRole("searchbox", { name: "Search this matter" })).toHaveFocus();
      await expect(canvas.getByTestId("panel-contents")).toBeVisible();
    });

    await step("Reaching into the panel does not collapse the control", async () => {
      // A panel rendered BESIDE the control sits outside its root, so both collapse watches read
      // a click into it as a click away and the whole thing shuts on first use. Rendering it
      // inside the root is what makes the panel usable at all.
      await userEvent.click(canvas.getByRole("button", { name: "Everything on this matter" }));
      await expect(canvas.getByRole("searchbox", { name: "Search this matter" })).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    await step("Enter hands the whole query to the screen, once", async () => {
      await userEvent.click(canvas.getByRole("searchbox", { name: "Search this matter" }));
      await userEvent.keyboard("Calloway{Enter}");
      await waitFor(() => expect(canvas.getByTestId("submitted")).toHaveTextContent("Calloway"));
      await expect(canvas.getByTestId("submit-count")).toHaveTextContent("1");
    });
  }}
>
  {#snippet template()}
    <div class="flex flex-col items-start gap-16">
      <div class="flex w-full items-center justify-end gap-8">
        <ScreenSearch
          label="Search this matter"
          onsubmit={(query) => {
            submitted = [...submitted, query];
          }}
        >
          {#snippet panel()}
            <div data-testid="panel-contents" class="flex flex-col items-start gap-8 p-8">
              <Button variant="ghost" size="sm">Everything on this matter</Button>
            </div>
          {/snippet}
        </ScreenSearch>
        <Button variant="primary">New note</Button>
      </div>
      <p data-testid="submitted">{submitted.join(", ")}</p>
      <p data-testid="submit-count">{submitted.length}</p>
    </div>
  {/snippet}
</Story>

<!-- Behaviour not visible on a showcase instance: collapse-when-unused, the dormant shortcut, and
     disabled. -->
<Story
  name="Behaviour"
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, step }) => {
    const bystander = canvas.getByRole("button", { name: "Somewhere else" });

    await step("Leaving an empty field collapses it", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Search notes" }));
      await expect(canvas.getByRole("searchbox", { name: "Search notes" })).toHaveFocus();
      await userEvent.click(bystander);
      // The collapse waits for focus to settle, so this is the one assertion that must wait too.
      await waitFor(() =>
        expect(canvas.getByRole("button", { name: "Search notes" })).toHaveAttribute(
          "aria-expanded",
          "false",
        ),
      );
    });

    await step("A click that lands on nothing closes an empty field too", async () => {
      // The correction this pins: collapse used to watch FOCUS, and a click on non-focusable
      // page furniture moves focus to the document body, which reads as "focus went nowhere".
      // To a person there is no such place — they clicked away and the field stayed open. The
      // pointer watch is a separate one for exactly this reason; focus structurally cannot see it.
      await userEvent.click(canvas.getByRole("button", { name: "Search notes" }));
      await expect(canvas.getByRole("searchbox", { name: "Search notes" })).toHaveFocus();
      await userEvent.click(canvas.getByTestId("dead-space"));
      await waitFor(() =>
        expect(canvas.getByRole("button", { name: "Search notes" })).toHaveAttribute(
          "aria-expanded",
          "false",
        ),
      );
    });

    await step("Leaving a field that carries a query keeps it open", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Search notes" }));
      await userEvent.keyboard("lien");
      await userEvent.click(bystander);
      await expect(canvas.getByRole("searchbox", { name: "Search notes" })).toHaveValue("lien");
    });

    await step("A shortcut key reaches only the control whose screen asked for one", async () => {
      await userEvent.click(bystander);
      await userEvent.keyboard("/");
      // The docket asked for the key; notes did not, and no key is armed by default.
      await expect(canvas.getByRole("searchbox", { name: "Search the docket" })).toHaveFocus();
      await expect(canvas.getByRole("searchbox", { name: "Search notes" })).not.toHaveFocus();
    });

    await step("A disabled control cannot be expanded", async () => {
      const locked = canvas.getByRole("button", { name: "Search the closed register" });
      await expect(locked).toBeDisabled();
      await expect(locked).toHaveAttribute("aria-expanded", "false");
    });
  }}
>
  {#snippet template()}
    <div class="flex flex-col items-start gap-16">
      <Button variant="secondary">Somewhere else</Button>
      <!-- Page furniture, deliberately not focusable: clicking it is the case the focus watch
           cannot see. -->
      <p data-testid="dead-space" class="text-sm text-text-muted">Page furniture</p>
      <ScreenSearch label="Search notes" />
      <ScreenSearch label="Search the docket" shortcut="/" />
      <ScreenSearch label="Search the closed register" disabled />
    </div>
  {/snippet}
</Story>
