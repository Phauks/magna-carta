<script lang="ts">
  /*
   * The whole letter page as it will print: the check (or three), the voucher stubs where they fall,
   * and, at full detail, every line the PDF will set, at its place on the paper.
   *
   * IT IS DRAWN FROM THE SAME LINES THE PDF IS (check-document.ts `checkPage`), with the draft's
   * fields and its whole-page shift, so it changes as a field is dragged or the layout is changed
   * and cannot show a line anywhere the paper will not.
   *
   * A MINIATURE carries the outlines alone. It stands inside a choice that already names the layout,
   * so it is a picture and is hidden from a screen reader; the full preview is named.
   */
  import * as PlacementBoard from "@magna-carta/design-system/placement-board";
  import {
    CHECK_HEIGHT_MILS,
    CHECK_WIDTH_MILS,
    LETTER_HEIGHT_MILS,
    LETTER_WIDTH_MILS,
    MICR_BAND_TOP_MILS,
    fieldHeightMils,
  } from "@magna-carta/trust/check-layout";
  import { checkPage, samplePageChecks, type CheckStockLayout } from "./check-document.ts";
  import { textScaleOf } from "./checks-model.ts";

  let {
    stock,
    miniature = false,
  }: {
    stock: CheckStockLayout;
    /** Outlines only, as a picture inside a choice that names it. */
    miniature?: boolean;
  } = $props();

  const page = $derived(checkPage(stock, samplePageChecks(stock.pageLayout)));
  /** Where each stub ends: at the next part of the page, or the page's foot. */
  const stubHeight = (top: number): number => {
    const below = [...page.checkTops, ...page.stubTops, LETTER_HEIGHT_MILS]
      .filter((edge) => edge > top)
      .toSorted((left, right) => left - right);
    return (below[0] ?? LETTER_HEIGHT_MILS) - top;
  };
  const CAPTION = textScaleOf(8);
</script>

<PlacementBoard.Root
  width={LETTER_WIDTH_MILS}
  height={LETTER_HEIGHT_MILS}
  label="The whole page as it prints, with sample values"
  decorative={miniature}
>
  {#each page.stubTops as top (top)}
    <PlacementBoard.Region
      x={0}
      y={top}
      width={LETTER_WIDTH_MILS}
      height={stubHeight(top)}
      edge="dashed"
      caption={miniature ? undefined : "Stub"}
      textScale={CAPTION}
    />
  {/each}
  {#each page.checkTops as top (top)}
    <PlacementBoard.Region x={0} y={top} width={CHECK_WIDTH_MILS} height={CHECK_HEIGHT_MILS} />
    {#if !miniature}
      <PlacementBoard.Region
        x={0}
        y={top + MICR_BAND_TOP_MILS}
        width={CHECK_WIDTH_MILS}
        height={CHECK_HEIGHT_MILS - MICR_BAND_TOP_MILS}
        edge="dashed"
        caption="MICR band"
        textScale={CAPTION}
      />
    {/if}
  {/each}
  {#if !miniature}
    {#each page.lines as line, index (index)}
      <PlacementBoard.Mark
        x={line.xMils}
        y={line.yMils}
        width={line.widthMils}
        height={fieldHeightMils(line.sizePoints)}
        textScale={textScaleOf(line.sizePoints)}
        align={line.align}
        strong={line.bold}
      >
        {line.text}{line.fill === undefined ? "" : line.fill.repeat(40)}
      </PlacementBoard.Mark>
    {/each}
  {/if}
</PlacementBoard.Root>
