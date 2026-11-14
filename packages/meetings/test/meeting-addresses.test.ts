import { describe, expect, it } from "vitest";
import {
  formatMeetingJoinCode,
  freeRoomAddressName,
  newMeetingJoinCode,
  parseMeetingJoinCode,
  roomAddressNames,
} from "../src/meeting-addresses.ts";

describe("a meeting's nine-digit address", () => {
  it("is nine digits that never start with zero", () => {
    for (let draw = 0; draw < 200; draw += 1) {
      expect(newMeetingJoinCode()).toMatch(/^[1-9]\d{8}$/);
    }
  });

  it("skips bytes that would make some digits likelier than others", () => {
    const bytes = [0, 250, 255, 13, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    let at = 0;
    const source = (length: number) =>
      Uint8Array.from({ length }, () => bytes[at++ % bytes.length] ?? 0);
    // 0 cannot lead, 250 and 255 are thrown away, 13 gives 3.
    expect(newMeetingJoinCode(source)).toBe("312345678");
  });

  it("is shown in three groups and read back with or without them", () => {
    expect(formatMeetingJoinCode("482917305")).toBe("482-917-305");
    expect(parseMeetingJoinCode("482-917-305")).toBe("482917305");
    expect(parseMeetingJoinCode(" 482 917 305 ")).toBe("482917305");
    expect(parseMeetingJoinCode("48291730")).toBeUndefined();
    expect(parseMeetingJoinCode("meeting_abc")).toBeUndefined();
  });
});

describe("a personal room's address by name", () => {
  it("tries the first name, then first and last joined", () => {
    expect(roomAddressNames("Trevor Goldsmith")).toEqual(["trevor", "trevor-goldsmith"]);
    expect(roomAddressNames("  Ada  ")).toEqual(["ada"]);
  });

  it("has no plain name to offer for an accent or a hyphen", () => {
    expect(roomAddressNames("Ana-Maria Lopez")).toEqual([]);
    expect(roomAddressNames("José Ruiz")).toEqual([]);
    expect(roomAddressNames("Ana Ruíz")).toEqual(["ana"]);
  });

  it("takes the first free candidate, then numbers the last", () => {
    expect(freeRoomAddressName(["trevor", "trevor-goldsmith"], new Set())).toBe("trevor");
    expect(freeRoomAddressName(["trevor", "trevor-goldsmith"], new Set(["trevor"]))).toBe(
      "trevor-goldsmith",
    );
    expect(
      freeRoomAddressName(
        ["trevor", "trevor-goldsmith"],
        new Set(["trevor", "trevor-goldsmith", "trevor-goldsmith-2"]),
      ),
    ).toBe("trevor-goldsmith-3");
  });
});
