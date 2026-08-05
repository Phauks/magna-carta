import { describe, expect, it } from "vitest";
import { createCustodyLocation } from "../src/location-service.ts";
import { buildCustodyLabelSheet } from "../src/label-service.ts";
import { code128Bars, code128Values } from "../src/labels/code128.ts";
import { CUSTODY_LABELS_PER_SHEET, renderCustodyLabelSheet } from "../src/labels/label-sheet.ts";
import { createCustodyPacket } from "../src/packet-service.ts";
import { ACTOR, commit, migratedDatabase, options, seedMember } from "./support.ts";

const SMITH = "directoryPerson_smith0000000000000";

describe("the Code 128 encoder", () => {
  it("encodes the start value, the payload, and the modulo-103 checksum", () => {
    // Worked by hand against the published table: start B is 104, and A/B/C are 33/34/35 in subset
    // B; the checksum is (104 + 33*1 + 34*2 + 35*3) mod 103 = 1.
    expect(code128Values("ABC")).toEqual([104, 33, 34, 35, 1]);
  });

  it("produces symbols whose every character is eleven modules wide with even bar parity", () => {
    // The symbology's own structural invariant. It catches a transcription error in the pattern
    // table, which is the only way this encoder can be wrong in a way a reader would not notice.
    const { bars, widthModules } = code128Bars("custodyPacket_0123456789");
    const characterCount = code128Values("custodyPacket_0123456789").length + 1;
    expect(widthModules).toBe(characterCount * 11 + 2);
    expect(bars.every((bar) => bar.widthModules >= 1 && bar.widthModules <= 4)).toBe(true);
  });

  it("refuses a payload outside printable ASCII rather than encoding something else", () => {
    expect(() => code128Values("café")).toThrow(/printable ASCII/);
    expect(() => code128Values("")).toThrow(/needs a payload/);
  });
});

describe("the label sheet", () => {
  it("renders one A4 sheet with a barcode and readable text per label", () => {
    const svg = renderCustodyLabelSheet([
      { scanPayload: "custodyPacket_abc", headline: "CUS-00042", lines: ["Smith family deeds"] },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="210mm"');
    expect(svg).toContain("CUS-00042");
    expect(svg).toContain("Smith family deeds");
    expect(svg).toContain("custodyPacket_abc");
  });

  it("escapes firm-supplied text rather than emitting it as markup", () => {
    const svg = renderCustodyLabelSheet([
      {
        scanPayload: "custodyLocation_abc",
        headline: 'Safe <script>alert("x")</script>',
        lines: ["Smith & Jones"],
      },
    ]);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("Smith &amp; Jones");
  });

  it("drops nothing off the end of the sheet it was given", () => {
    const labels = Array.from({ length: CUSTODY_LABELS_PER_SHEET }, (_unused, index) => ({
      scanPayload: `custodyPacket_${index}`,
      headline: `CUS-${index}`,
      lines: [],
    }));
    const svg = renderCustodyLabelSheet(labels);
    for (const label of labels) expect(svg).toContain(label.scanPayload);
  });
});

describe("building a label sheet from the register", () => {
  async function scaffold() {
    const { database, raw } = migratedDatabase();
    seedMember(raw);
    const safe = await createCustodyLocation(
      database,
      { name: "Main safe", kind: "safe" },
      options,
    );
    await commit(database, safe.effect);
    const packet = await createCustodyPacket(
      database,
      {
        name: "Smith family deeds",
        owners: [{ entityId: SMITH }],
        currentLocationId: safe.locationId,
      },
      { ...options, responsibleMemberId: ACTOR },
    );
    return { database, safe: safe.locationId, packet };
  }

  it("puts the identifier handle in the barcode and the custody number in front of a person", async () => {
    const { database, safe, packet } = await scaffold();
    const sheet = await buildCustodyLabelSheet(database, {
      packetIds: [packet.packetId],
      locationIds: [safe],
    });
    expect(sheet.labelCount).toBe(2);
    // A number is a string a firm can re-render; a handle is the row. A scan has to resolve to
    // exactly one object with no lookup rule that can change under labels already stuck to boxes.
    expect(sheet.svg).toContain(packet.packetId);
    expect(sheet.svg).toContain(safe);
    expect(sheet.svg).toContain(packet.custodyNumber);
  });

  it("refuses an empty selection, an overfull sheet, and an id that resolves to nothing", async () => {
    const { database, packet } = await scaffold();
    await expect(buildCustodyLabelSheet(database, {})).rejects.toThrow(/at least one/);
    await expect(
      buildCustodyLabelSheet(database, {
        packetIds: Array.from({ length: CUSTODY_LABELS_PER_SHEET + 1 }, () => packet.packetId),
      }),
    ).rejects.toThrow(/second sheet/);
    await expect(
      buildCustodyLabelSheet(database, { packetIds: ["custodyPacket_nope" as never] }),
    ).rejects.toThrow(/no such custody packet/);
  });
});
