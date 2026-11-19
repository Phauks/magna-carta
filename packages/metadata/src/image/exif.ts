// The values in an EXIF block: where a picture was taken, on what, by whom and when. EXIF is a TIFF
// structure (a header, then directories of tagged entries pointing at their values), so this reads
// three directories by offset: the first image directory, the EXIF directory and the GPS directory.
//
// Every offset and count comes from the file, so every read is bounds-checked, the number of entries
// read from a directory is capped, and a directory is never visited twice (a crafted file can point
// two directories at each other). A value that cannot be read is skipped, never guessed.

import { cleanText, type FieldCollector, momentFromParts, textValue } from "../fields.ts";
import type { FieldMoment, FieldValue } from "../model.ts";

const MAX_ENTRIES_PER_DIRECTORY = 512;
const MAX_ASCII_BYTES = 4096;

const TYPE_SIZES: Readonly<Record<number, number>> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

interface Entry {
  readonly type: number;
  readonly count: number;
  readonly at: number; // where the value's bytes start
}

class TiffReader {
  readonly littleEndian: boolean;

  constructor(private readonly bytes: Uint8Array) {
    this.littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49;
  }

  static open(bytes: Uint8Array): TiffReader | undefined {
    const little = bytes[0] === 0x49 && bytes[1] === 0x49;
    const big = bytes[0] === 0x4d && bytes[1] === 0x4d;
    if (!little && !big) return undefined;
    const reader = new TiffReader(bytes);
    return reader.u16(2) === 42 ? reader : undefined;
  }

  u16(offset: number): number | undefined {
    if (offset < 0 || offset + 2 > this.bytes.length) return undefined;
    const a = this.bytes[offset] ?? 0;
    const b = this.bytes[offset + 1] ?? 0;
    return this.littleEndian ? a | (b << 8) : (a << 8) | b;
  }

  u32(offset: number): number | undefined {
    if (offset < 0 || offset + 4 > this.bytes.length) return undefined;
    const a = this.bytes[offset] ?? 0;
    const b = this.bytes[offset + 1] ?? 0;
    const c = this.bytes[offset + 2] ?? 0;
    const d = this.bytes[offset + 3] ?? 0;
    return (
      (this.littleEndian
        ? (d << 24) | (c << 16) | (b << 8) | a
        : (a << 24) | (b << 16) | (c << 8) | d) >>> 0
    );
  }

  directory(offset: number): Map<number, Entry> {
    const entries = new Map<number, Entry>();
    const count = this.u16(offset);
    if (count === undefined) return entries;
    for (let index = 0; index < Math.min(count, MAX_ENTRIES_PER_DIRECTORY); index++) {
      const entryAt = offset + 2 + index * 12;
      const tag = this.u16(entryAt);
      const type = this.u16(entryAt + 2);
      const valueCount = this.u32(entryAt + 4);
      if (tag === undefined || type === undefined || valueCount === undefined) break;
      const size = TYPE_SIZES[type];
      if (size === undefined) continue;
      const length = size * valueCount;
      const at = length <= 4 ? entryAt + 8 : this.u32(entryAt + 8);
      if (at === undefined || at + length > this.bytes.length) continue;
      entries.set(tag, { type, count: valueCount, at });
    }
    return entries;
  }

  ascii(entry: Entry | undefined): string | undefined {
    if (entry === undefined || (entry.type !== 2 && entry.type !== 7 && entry.type !== 1)) {
      return undefined;
    }
    const end = entry.at + Math.min(entry.count, MAX_ASCII_BYTES);
    let stop = entry.at;
    while (stop < end && this.bytes[stop] !== 0) stop++;
    return new TextDecoder("utf-8").decode(this.bytes.subarray(entry.at, stop));
  }

  number(entry: Entry | undefined, index = 0): number | undefined {
    if (entry === undefined || index >= entry.count) return undefined;
    if (entry.type === 3) return this.u16(entry.at + index * 2);
    if (entry.type === 4) return this.u32(entry.at + index * 4);
    if (entry.type === 1) return this.bytes[entry.at + index];
    if (entry.type === 5 || entry.type === 10) {
      const numerator = this.u32(entry.at + index * 8);
      const denominator = this.u32(entry.at + index * 8 + 4);
      if (numerator === undefined || denominator === undefined || denominator === 0)
        return undefined;
      return entry.type === 10 ? (numerator | 0) / (denominator | 0) : numerator / denominator;
    }
    return undefined;
  }

  // EXIF's UserComment: an eight-byte character-set code, then the text.
  userComment(entry: Entry | undefined): string | undefined {
    if (entry === undefined || entry.count <= 8) return undefined;
    const code = String.fromCharCode(...this.bytes.subarray(entry.at, entry.at + 8)).replace(
      /\0+$/,
      "",
    );
    const text = this.bytes.subarray(
      entry.at + 8,
      entry.at + Math.min(entry.count, MAX_ASCII_BYTES),
    );
    if (code === "ASCII" || code === "")
      return new TextDecoder("utf-8").decode(text).replace(/\0+$/, "");
    if (code === "UNICODE") {
      return new TextDecoder(this.littleEndian ? "utf-16le" : "utf-16be")
        .decode(text)
        .replace(/\0+$/, "");
    }
    return undefined;
  }
}

const IFD0 = {
  imageDescription: 0x010e,
  make: 0x010f,
  model: 0x0110,
  software: 0x0131,
  dateTime: 0x0132,
  artist: 0x013b,
  hostComputer: 0x013c,
  copyright: 0x8298,
  exifPointer: 0x8769,
  gpsPointer: 0x8825,
} as const;

const EXIF = {
  dateTimeOriginal: 0x9003,
  dateTimeDigitized: 0x9004,
  offsetTime: 0x9010,
  offsetTimeOriginal: 0x9011,
  offsetTimeDigitized: 0x9012,
  userComment: 0x9286,
  imageUniqueIdentifier: 0xa420,
  cameraOwnerName: 0xa430,
  bodySerialNumber: 0xa431,
  lensMake: 0xa433,
  lensModel: 0xa434,
  lensSerialNumber: 0xa435,
} as const;

const GPS = {
  latitudeReference: 1,
  latitude: 2,
  longitudeReference: 3,
  longitude: 4,
  altitudeReference: 5,
  altitude: 6,
  timeStamp: 7,
  dateStamp: 0x1d,
} as const;

const EXIF_DATE_TIME = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;
const OFFSET = /^[+-]\d{2}:\d{2}$/;

// "2026:10:02 14:31:07", with the offset EXIF 2.31 keeps beside it where the camera knew its zone.
// Without an offset it is the camera's clock, in whatever zone it was set to, and reads as such.
function exifMoment(raw: string | undefined, offset: string | undefined): FieldMoment | undefined {
  if (raw === undefined) return undefined;
  const match = EXIF_DATE_TIME.exec(raw.trim());
  if (match === null) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const zone = offset !== undefined && OFFSET.test(offset.trim()) ? offset.trim() : undefined;
  return momentFromParts(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: second === undefined ? 0 : Number(second),
    },
    zone,
  );
}

function degrees(reader: TiffReader, entry: Entry | undefined): number | undefined {
  const whole = reader.number(entry, 0);
  const minutes = reader.number(entry, 1) ?? 0;
  const seconds = reader.number(entry, 2) ?? 0;
  if (whole === undefined) return undefined;
  return whole + minutes / 60 + seconds / 3600;
}

function gpsFields(reader: TiffReader, gps: Map<number, Entry>, fields: FieldCollector): void {
  const latitude = degrees(reader, gps.get(GPS.latitude));
  const longitude = degrees(reader, gps.get(GPS.longitude));
  if (latitude !== undefined && longitude !== undefined && latitude <= 90 && longitude <= 180) {
    const south = reader.ascii(gps.get(GPS.latitudeReference))?.toUpperCase() === "S";
    const west = reader.ascii(gps.get(GPS.longitudeReference))?.toUpperCase() === "W";
    const signedLatitude = (south ? -latitude : latitude).toFixed(6);
    const signedLongitude = (west ? -longitude : longitude).toFixed(6);
    fields.addNamed("Location", textValue(`${signedLatitude}, ${signedLongitude}`));
  }
  const altitude = reader.number(gps.get(GPS.altitude));
  if (altitude !== undefined && Number.isFinite(altitude)) {
    const below = reader.number(gps.get(GPS.altitudeReference)) === 1;
    fields.addNamed("Altitude", textValue(`${(below ? -altitude : altitude).toFixed(1)} m`));
  }
  // GPS time is always UTC: a satellite fix, not the camera's clock.
  const date = reader.ascii(gps.get(GPS.dateStamp));
  const time = gps.get(GPS.timeStamp);
  const hour = reader.number(time, 0);
  const minute = reader.number(time, 1);
  const second = reader.number(time, 2);
  if (date !== undefined && hour !== undefined && minute !== undefined) {
    const moment = exifMoment(
      `${date.trim()} ${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.floor(minute)).padStart(2, "0")}:${String(Math.floor(second ?? 0)).padStart(2, "0")}`,
      "+00:00",
    );
    if (moment !== undefined) fields.add({ name: "Location Time", value: moment });
  }
}

function addText(fields: FieldCollector, name: string, raw: string | undefined): void {
  fields.addNamed(name, textValue(raw));
}

function addMoment(fields: FieldCollector, name: string, moment: FieldValue | undefined): void {
  if (moment !== undefined) fields.add({ name: cleanText(name), value: moment });
}

/**
 * Read an EXIF block, given as the TIFF structure it holds (the bytes after a JPEG APP1 segment's
 * "Exif\0\0" marker, or a PNG eXIf chunk's data). A block that is not a TIFF structure adds nothing.
 */
export function readExif(tiff: Uint8Array, fields: FieldCollector): void {
  const reader = TiffReader.open(tiff);
  if (reader === undefined) return;
  const visited = new Set<number>();
  const directoryAt = (offset: number | undefined): Map<number, Entry> => {
    if (offset === undefined || offset < 8 || visited.has(offset)) return new Map();
    visited.add(offset);
    return reader.directory(offset);
  };

  const first = directoryAt(reader.u32(4));
  const exif = directoryAt(reader.number(first.get(IFD0.exifPointer)));
  const gps = directoryAt(reader.number(first.get(IFD0.gpsPointer)));

  gpsFields(reader, gps, fields);
  addMoment(
    fields,
    "Taken",
    exifMoment(
      reader.ascii(exif.get(EXIF.dateTimeOriginal)),
      reader.ascii(exif.get(EXIF.offsetTimeOriginal)),
    ),
  );
  addMoment(
    fields,
    "Digitized",
    exifMoment(
      reader.ascii(exif.get(EXIF.dateTimeDigitized)),
      reader.ascii(exif.get(EXIF.offsetTimeDigitized)),
    ),
  );
  addMoment(
    fields,
    "Modified",
    exifMoment(reader.ascii(first.get(IFD0.dateTime)), reader.ascii(exif.get(EXIF.offsetTime))),
  );
  addText(fields, "Camera Make", reader.ascii(first.get(IFD0.make)));
  addText(fields, "Camera Model", reader.ascii(first.get(IFD0.model)));
  addText(fields, "Camera Owner", reader.ascii(exif.get(EXIF.cameraOwnerName)));
  addText(fields, "Camera Serial Number", reader.ascii(exif.get(EXIF.bodySerialNumber)));
  addText(fields, "Lens Make", reader.ascii(exif.get(EXIF.lensMake)));
  addText(fields, "Lens Model", reader.ascii(exif.get(EXIF.lensModel)));
  addText(fields, "Lens Serial Number", reader.ascii(exif.get(EXIF.lensSerialNumber)));
  addText(fields, "Software", reader.ascii(first.get(IFD0.software)));
  addText(fields, "Computer", reader.ascii(first.get(IFD0.hostComputer)));
  addText(fields, "Artist", reader.ascii(first.get(IFD0.artist)));
  addText(fields, "Copyright", reader.ascii(first.get(IFD0.copyright)));
  addText(fields, "Description", reader.ascii(first.get(IFD0.imageDescription)));
  addText(fields, "User Comment", reader.userComment(exif.get(EXIF.userComment)));
  addText(fields, "Picture Identifier", reader.ascii(exif.get(EXIF.imageUniqueIdentifier)));
}
