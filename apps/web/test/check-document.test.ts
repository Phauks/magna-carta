import { describe, expect, it } from "vitest";
import { STANDARD_CHECK_FIELDS } from "@magna-carta/trust/check-layout";
import {
  checkBatchDocument,
  checkDateText,
  checkTestPageDocument,
  SAMPLE_CHECK,
} from "../src/lib/trust/checks/check-document.ts";

const stock = {
  pageLayout: "check_top" as const,
  fields: STANDARD_CHECK_FIELDS,
  shiftXMils: 0,
  shiftYMils: 0,
};

describe("check document", () => {
  it("writes the date the way a check prints it", () => {
    expect(checkDateText("2026-10-31")).toBe("10/31/2026");
  });

  it("places each field at its stock position, in points, with the amount in words filled", () => {
    const document = checkBatchDocument(stock, [SAMPLE_CHECK]);
    const payee = document.blocks.find(
      (block) => block.type === "placed" && block.text === "Desert Title Company",
    );
    // 1.15 inches from the left and 1.33 from the top of a check at the top of the page.
    expect(payee).toMatchObject({ x: 82.8, y: 95.76, size: 11 });
    const words = document.blocks.find(
      (block) => block.type === "placed" && block.text === "Three thousand and 00/100",
    );
    expect(words).toMatchObject({ fill: "*" });
    expect(document.title).toBe("Check 10422");
  });

  it("moves every line by the stock's shift", () => {
    const shifted = checkBatchDocument({ ...stock, shiftXMils: 100, shiftYMils: -50 }, [
      SAMPLE_CHECK,
    ]);
    const plain = checkBatchDocument(stock, [SAMPLE_CHECK]);
    shifted.blocks.forEach((block, index) => {
      const before = plain.blocks[index];
      if (block.type !== "placed" || before?.type !== "placed") return;
      expect(block.x - before.x).toBeCloseTo(7.2);
      expect(block.y - before.y).toBeCloseTo(-3.6);
    });
  });

  it("puts one check on a page with stubs, and three on three-up stock", () => {
    const second = { ...SAMPLE_CHECK, checkNumber: 10_423 };
    const third = { ...SAMPLE_CHECK, checkNumber: 10_424 };
    const single = checkBatchDocument(stock, [SAMPLE_CHECK, second]);
    expect(single.blocks.filter((block) => block.type === "pageBreak")).toHaveLength(1);
    const threeUp = checkBatchDocument({ ...stock, pageLayout: "three_per_page" }, [
      SAMPLE_CHECK,
      second,
      third,
    ]);
    expect(threeUp.blocks.filter((block) => block.type === "pageBreak")).toHaveLength(0);
    expect(threeUp.title).toBe("Checks 10422 to 10424");
  });

  it("outlines every box on the test page", () => {
    const test = checkTestPageDocument(stock);
    const outlined = test.blocks.filter(
      (block) => block.type === "placed" && block.outline === true,
    );
    // The check's own edge plus each field.
    expect(outlined).toHaveLength(STANDARD_CHECK_FIELDS.length + 1);
  });
});
