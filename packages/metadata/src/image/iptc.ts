// The values in a JPEG's Photoshop segment (APP13): the IPTC record a newsroom or a photo library
// writes, naming the photographer, the place and the caption. The segment is a run of Photoshop
// image resources ("8BIM" blocks); resource 0x0404 holds the IPTC datasets.

import { type FieldCollector, momentFromParts, textValue } from "../fields.ts";

const PHOTOSHOP_SIGNATURE = "Photoshop 3.0\0";
const IPTC_RESOURCE = 0x0404;
const MAX_RESOURCES = 256;
const MAX_DATASETS = 512;

// Application record (2) datasets worth showing, in reading order.
const DATASETS: ReadonlyMap<number, string> = new Map([
  [80, "Author"],
  [85, "Author Title"],
  [116, "Copyright"],
  [110, "Credit"],
  [115, "Source"],
  [5, "Title"],
  [105, "Headline"],
  [120, "Description"],
  [122, "Description Writer"],
  [25, "Keywords"],
  [90, "City"],
  [92, "Location"],
  [95, "State"],
  [101, "Country"],
]);
const DATE_CREATED = 55;
const TIME_CREATED = 60;

function u16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) << 24) |
      ((bytes[at + 1] ?? 0) << 16) |
      ((bytes[at + 2] ?? 0) << 8) |
      (bytes[at + 3] ?? 0)) >>>
    0
  );
}

function startsWith(bytes: Uint8Array, ascii: string): boolean {
  for (let index = 0; index < ascii.length; index++) {
    if (bytes[index] !== ascii.charCodeAt(index)) return false;
  }
  return true;
}

// The IPTC block inside the resources, or undefined.
function iptcBlock(segment: Uint8Array): Uint8Array | undefined {
  if (!startsWith(segment, PHOTOSHOP_SIGNATURE)) return undefined;
  let at = PHOTOSHOP_SIGNATURE.length;
  for (let resource = 0; resource < MAX_RESOURCES && at + 12 <= segment.length; resource++) {
    if (!startsWith(segment.subarray(at), "8BIM")) return undefined;
    const id = u16(segment, at + 4);
    const nameLength = segment[at + 6] ?? 0;
    // The name is a Pascal string padded so length byte plus name is even.
    let cursor = at + 6 + 1 + nameLength;
    if ((1 + nameLength) % 2 === 1) cursor++;
    if (cursor + 4 > segment.length) return undefined;
    const size = u32(segment, cursor);
    const dataStart = cursor + 4;
    if (dataStart + size > segment.length) return undefined;
    if (id === IPTC_RESOURCE) return segment.subarray(dataStart, dataStart + size);
    at = dataStart + size + (size % 2);
  }
  return undefined;
}

/** Read the IPTC record out of a JPEG APP13 segment's payload. */
export function readIptc(segment: Uint8Array, fields: FieldCollector): void {
  const block = iptcBlock(segment);
  if (block === undefined) return;
  const values = new Map<number, string[]>();
  let at = 0;
  for (let dataset = 0; dataset < MAX_DATASETS && at + 5 <= block.length; dataset++) {
    if (block[at] !== 0x1c) break;
    const record = block[at + 1] ?? 0;
    const number = block[at + 2] ?? 0;
    const length = u16(block, at + 3);
    // An extended dataset (length's high bit set) carries its length in further bytes. No dataset
    // worth showing uses one, so the walk stops rather than read a length it cannot trust.
    if ((length & 0x8000) !== 0) break;
    const start = at + 5;
    if (start + length > block.length) break;
    if (record === 2) {
      const text = new TextDecoder("utf-8").decode(block.subarray(start, start + length));
      const list = values.get(number) ?? [];
      list.push(text);
      values.set(number, list);
    }
    at = start + length;
  }

  // Date created (CCYYMMDD) and time created (HHMMSS with an optional offset, +HHMM).
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(values.get(DATE_CREATED)?.[0]?.trim() ?? "");
  if (date !== null) {
    const time = /^(\d{2})(\d{2})(\d{2})([+-]\d{4})?$/.exec(
      values.get(TIME_CREATED)?.[0]?.trim() ?? "",
    );
    const moment = momentFromParts(
      {
        year: Number(date[1]),
        month: Number(date[2]),
        day: Number(date[3]),
        hour: time === null ? undefined : Number(time[1]),
        minute: time === null ? undefined : Number(time[2]),
        second: time === null ? 0 : Number(time[3]),
      },
      time?.[4],
    );
    if (moment !== undefined) fields.add({ name: "Created", value: moment });
  }
  for (const [number, label] of DATASETS) {
    const list = values.get(number);
    if (list !== undefined) fields.addNamed(label, textValue(list.join("; ")));
  }
}
