<script module lang="ts">
  /*
   * PlacementBoard — Compound Inputs. A sheet at its true proportion with boxes a reader places on
   * it: the check stock editor's surface, shown here over a blank business check (8,500 by 3,500
   * thousandths of an inch) with the band along the bottom where nothing may go. A box moves by
   * dragging or with the arrow keys (Shift for the larger step), and the caller decides where it may
   * land; a box that cannot stand where it is turns red and says nothing.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect, userEvent } from "storybook/test";
  import * as PlacementBoard from "../lib/components/placement-board/index.ts";
  import PlacementBoardRoot from "../lib/components/placement-board/placement-board.svelte";

  const { Story } = defineMeta({
    title: "Compound Inputs/PlacementBoard",
    component: PlacementBoardRoot,
    parameters: { controls: { include: [] } },
  });

  const WIDTH = 8_500;
  const HEIGHT = 3_500;
  const BAND = 2_875;
  /** Eleven points over a board 612 points wide. */
  const TEXT = 11 / 612;
</script>

<script lang="ts">
  let payee = $state({ x: 1_150, y: 1_330, width: 5_150 });
  let amount = $state({ x: 7_000, y: 1_330, width: 1_250 });
  let chosen = $state<"payee" | "amount">("payee");
  let corners = $state([
    { x: 60, y: 40 },
    { x: 790, y: 60 },
    { x: 810, y: 320 },
    { x: 40, y: 300 },
  ]);
  const CORNER_NAMES = ["Top left corner", "Top right corner", "Bottom right corner", "Bottom left corner"];
</script>

{#snippet boxes()}
  <div class="max-w-3xl">
    <PlacementBoard.Root
      width={WIDTH}
      height={HEIGHT}
      label="Check layout"
      band={{ from: BAND, label: "MICR band, nothing prints here" }}
    >
      <PlacementBoard.Guide x={1_150} y={1_500} width={5_200} caption="Pay to the order of" textScale={8 / 612} />
      <PlacementBoard.Guide x={6_400} y={2_700} width={1_800} caption="Authorized signature" captionPlacement="below" textScale={7 / 612} />
      <PlacementBoard.Box
        {...payee}
        height={190}
        label="Payee"
        textScale={TEXT}
        step={10}
        largeStep={100}
        selected={chosen === "payee"}
        onselect={() => (chosen = "payee")}
        onmove={(x, y) => (payee = { ...payee, x, y })}
        onresize={(width) => (payee = { ...payee, width })}
      >
        Desert Title Company
      </PlacementBoard.Box>
      <PlacementBoard.Box
        {...amount}
        height={190}
        label="Amount"
        align="end"
        textScale={TEXT}
        step={10}
        largeStep={100}
        invalid={amount.y + 190 > BAND}
        selected={chosen === "amount"}
        onselect={() => (chosen = "amount")}
        onmove={(x, y) => (amount = { ...amount, x, y })}
        onresize={(width) => (amount = { ...amount, width })}
      >
        **3,000.00
      </PlacementBoard.Box>
    </PlacementBoard.Root>
    <p class="mt-8 text-sm text-text-muted" data-testid="payee-position">
      Payee at {payee.x}, {payee.y}
    </p>
  </div>
{/snippet}

{#snippet wholePage()}
  <div class="flex flex-wrap items-start gap-24">
    <div class="w-64">
      <PlacementBoard.Root width={WIDTH} height={11_000} decorative>
        <PlacementBoard.Region x={0} y={0} width={WIDTH} height={HEIGHT} />
        <PlacementBoard.Region x={0} y={3_667} width={WIDTH} height={3_666} edge="dashed" />
        <PlacementBoard.Region x={0} y={7_333} width={WIDTH} height={3_667} edge="dashed" />
      </PlacementBoard.Root>
    </div>
    <div class="w-full max-w-xs">
      <PlacementBoard.Root width={WIDTH} height={11_000} label="The whole page as it prints">
        <PlacementBoard.Region x={0} y={0} width={WIDTH} height={HEIGHT} />
        <PlacementBoard.Mark x={1_150} y={1_330} width={5_150} height={190} textScale={TEXT}>
          Desert Title Company
        </PlacementBoard.Mark>
        <PlacementBoard.Mark x={7_000} y={1_330} width={1_250} height={190} textScale={TEXT} align="end">
          **3,000.00
        </PlacementBoard.Mark>
        <PlacementBoard.Region
          x={0}
          y={3_667}
          width={WIDTH}
          height={3_666}
          edge="dashed"
          caption="Stub"
          textScale={7 / 612}
        />
        <PlacementBoard.Mark x={500} y={4_067} width={6_300} height={190} textScale={10 / 612} strong>
          10422
        </PlacementBoard.Mark>
      </PlacementBoard.Root>
    </div>
  </div>
{/snippet}

{#snippet points()}
  <div class="max-w-xl">
    <PlacementBoard.Root width={850} height={350} label="Mark the four corners">
      <PlacementBoard.Outline points={corners} />
      {#each corners as corner, index (index)}
        <PlacementBoard.Handle
          x={corner.x}
          y={corner.y}
          label={CORNER_NAMES[index] ?? "Corner"}
          step={2}
          largeStep={20}
          onmove={(x, y) => (corners[index] = { x, y })}
        />
      {/each}
    </PlacementBoard.Root>
  </div>
{/snippet}

<Story
  name="Boxes"
  template={boxes}
  play={async ({ canvas, step }) => {
    const board = canvas.getByRole("group", { name: "Check layout" });
    const payeeBox = canvas.getByRole("button", { name: /^Payee/ });
    const amountBox = canvas.getByRole("button", { name: /^Amount/ });
    await step("The board and its boxes are on screen, the payee chosen", async () => {
      await expect(board).toBeVisible();
      await expect(payeeBox).toHaveAttribute("aria-pressed", "true");
      await expect(amountBox).toHaveAttribute("aria-pressed", "false");
    });
    await step("An arrow key moves the chosen box one step", async () => {
      payeeBox.focus();
      await userEvent.keyboard("{ArrowRight}");
      await expect(canvas.getByTestId("payee-position")).toHaveTextContent("Payee at 1160, 1330");
    });
    await step("Shift with an arrow moves it the larger step", async () => {
      await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
      await expect(canvas.getByTestId("payee-position")).toHaveTextContent("Payee at 1160, 1430");
    });
    await step("A box moved into the band turns red", async () => {
      amountBox.focus();
      await userEvent.click(amountBox);
      await expect(amountBox).toHaveAttribute("aria-pressed", "true");
      for (let press = 0; press < 15; press += 1) await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
      await expect(amountBox).toHaveAttribute("data-invalid");
    });
  }}
/>

<Story
  name="Whole Page"
  template={wholePage}
  play={async ({ canvas, step }) => {
    await step("A page of regions and marks is a picture, with nothing to press", async () => {
      await expect(canvas.getByRole("group", { name: "The whole page as it prints" })).toBeVisible();
      await expect(canvas.queryAllByRole("button")).toHaveLength(0);
    });
    await step("Each mark reads what the page will print", async () => {
      await expect(canvas.getByText("Desert Title Company")).toBeVisible();
      await expect(canvas.getByText("10422")).toBeVisible();
    });
    await step("A decorative miniature has no name of its own", async () => {
      await expect(canvas.getAllByRole("group")).toHaveLength(1);
    });
  }}
/>

<Story
  name="Corner Handles"
  template={points}
  play={async ({ canvas, step }) => {
    const corner = canvas.getByRole("button", { name: "Top left corner" });
    await step("Each corner is a control of its own", async () => {
      await expect(canvas.getAllByRole("button")).toHaveLength(4);
    });
    await step("An arrow key moves a corner", async () => {
      const before = corner.getAttribute("style");
      corner.focus();
      await userEvent.keyboard("{ArrowRight}");
      await expect(corner.getAttribute("style")).not.toBe(before);
    });
  }}
/>
