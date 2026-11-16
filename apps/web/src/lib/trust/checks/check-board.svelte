<script lang="ts">
  /*
   * The check, drawn at its true proportion with each field where it will print.
   *
   * WHAT IS BEHIND THE FIELDS IS THE READER'S CHOICE: the account's own straightened scan, nothing,
   * or a plain business check drawn as rules and captions for a firm that has not scanned its stock
   * yet. The fields read the sample check's values either way, so a reader judges a box by the
   * text that will actually sit in it.
   *
   * A FIELD MAY NOT BE DRAGGED INTO THE MICR BAND: a drag stops at its edge. A value typed into the
   * panel is not clamped, so a field can still stand somewhere it may not, and then it is red.
   */
  import * as PlacementBoard from "@magna-carta/design-system/placement-board";
  import {
    CHECK_HEIGHT_MILS,
    CHECK_WIDTH_MILS,
    MICR_BAND_TOP_MILS,
    checkFieldProblem,
    fieldHeightMils,
    type CheckField,
    type CheckFieldKind,
  } from "@magna-carta/trust/check-layout";
  import { SAMPLE_CHECK, checkFieldText } from "./check-document.ts";
  import {
    clampedPosition,
    clampedWidth,
    fieldLabel,
    textScaleOf,
    type CheckBackdrop,
  } from "./checks-model.ts";

  let {
    fields,
    selectedKind,
    backdrop,
    scanUrl,
    tagged = true,
    onselect,
    onchange,
  }: {
    fields: readonly CheckField[];
    selectedKind: CheckFieldKind | null;
    backdrop: CheckBackdrop;
    /** The straightened scan, or null where the account has none. */
    scanUrl: string | null;
    /** Whether every field's name stands on a tag, or only the chosen one's. */
    tagged?: boolean;
    onselect: (kind: CheckFieldKind) => void;
    onchange: (field: CheckField) => void;
  } = $props();

  /** A caption's size: seven points, as a business check prints its captions. */
  const CAPTION = textScaleOf(7);
</script>

<PlacementBoard.Root
  width={CHECK_WIDTH_MILS}
  height={CHECK_HEIGHT_MILS}
  label="The check, with each field where it prints"
  image={backdrop === "scan" ? scanUrl : null}
  band={{ from: MICR_BAND_TOP_MILS, label: "MICR band, nothing prints here" }}
>
  {#if backdrop === "sample"}
    <PlacementBoard.Guide x={6_150} y={990} width={1_750} caption="Date" textScale={CAPTION} />
    <PlacementBoard.Guide x={1_150} y={1_540} width={5_250} caption="Pay to the order of" textScale={CAPTION} />
    <PlacementBoard.Guide x={6_950} y={1_540} width={1_350} caption="$" textScale={CAPTION} />
    <PlacementBoard.Guide x={450} y={1_980} width={6_950} caption="Dollars" captionPlacement="after" textScale={CAPTION} />
    <PlacementBoard.Guide x={700} y={2_740} width={3_650} caption="Memo" textScale={CAPTION} />
    <PlacementBoard.Guide
      x={5_000}
      y={2_600}
      width={3_300}
      caption="Authorized signature"
      captionPlacement="below"
      textScale={CAPTION}
    />
  {/if}
  {#each fields as field (field.kind)}
    <PlacementBoard.Box
      x={field.xMils}
      y={field.yMils}
      width={field.widthMils}
      height={fieldHeightMils(field.sizePoints)}
      label={fieldLabel(field.kind)}
      align={field.align}
      textScale={textScaleOf(field.sizePoints)}
      step={10}
      largeStep={100}
      minimumWidth={300}
      {tagged}
      selected={selectedKind === field.kind}
      invalid={checkFieldProblem(field) !== null}
      onselect={() => onselect(field.kind)}
      onmove={(x, y) => onchange({ ...field, ...clampedPosition(field, x, y) })}
      onresize={(width) => onchange({ ...field, widthMils: clampedWidth(field, width) })}
    >
      {checkFieldText(field.kind, SAMPLE_CHECK)}
    </PlacementBoard.Box>
  {/each}
</PlacementBoard.Root>
