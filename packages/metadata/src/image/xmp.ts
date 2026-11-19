// The values in an XMP packet: the RDF/XML block editing software writes into a picture (and a PDF,
// and an office file) naming the tool, the author, the moments it was made and changed, and the
// identifiers that link this file to the one it was edited from.
//
// The packet is read for a fixed list of properties by pattern, not parsed as a whole: a packet is
// free-form RDF that any tool can extend, and the question asked of it is a short list of names.
// Each property may be written as an attribute (xmp:CreatorTool="...") or an element, and an
// element may hold a list (rdf:Seq, rdf:Bag, rdf:Alt) whose items are joined.

import { decodeXmlEntities, type FieldCollector, momentOrText, textValue } from "../fields.ts";

// A packet is at most one JPEG segment (64 KiB) or one PNG chunk. Larger text is cut before any
// pattern runs over it.
const MAX_PACKET_CHARACTERS = 256 * 1024;

interface XmpProperty {
  readonly name: string; // the qualified name in the packet
  readonly label: string;
  readonly moment?: boolean;
}

const PROPERTIES: readonly XmpProperty[] = [
  { name: "dc:creator", label: "Author" },
  { name: "dc:title", label: "Title" },
  { name: "dc:description", label: "Description" },
  { name: "dc:rights", label: "Copyright" },
  { name: "photoshop:AuthorsPosition", label: "Author Position" },
  { name: "photoshop:Credit", label: "Credit" },
  { name: "photoshop:City", label: "City" },
  { name: "photoshop:State", label: "State" },
  { name: "photoshop:Country", label: "Country" },
  { name: "exif:GPSLatitude", label: "Latitude" },
  { name: "exif:GPSLongitude", label: "Longitude" },
  { name: "xmp:CreatorTool", label: "Software" },
  { name: "pdf:Producer", label: "Producer" },
  { name: "xmp:CreateDate", label: "Created", moment: true },
  { name: "photoshop:DateCreated", label: "Created", moment: true },
  { name: "xmp:ModifyDate", label: "Modified", moment: true },
  { name: "xmp:MetadataDate", label: "Metadata Changed", moment: true },
  { name: "tiff:Make", label: "Camera Make" },
  { name: "tiff:Model", label: "Camera Model" },
  { name: "aux:SerialNumber", label: "Camera Serial Number" },
  { name: "xmpMM:DocumentID", label: "Document Identifier" },
  { name: "xmpMM:OriginalDocumentID", label: "Original Document Identifier" },
];

// Markup inside a value becomes a space. One pass: an unclosed "<" swallows the rest of the text.
function stripTags(text: string): string {
  let out = "";
  let inTag = false;
  for (const character of text) {
    if (character === "<") inTag = true;
    else if (character === ">" && inTag) {
      inTag = false;
      out += " ";
    } else if (!inTag) out += character;
  }
  return out;
}

// Every search below is an indexOf from a known position, never a backtracking pattern over the
// whole packet: a crafted packet of ten thousand unclosed openings must cost one pass, not ten
// thousand.

// name="value" or name='value', as an attribute of some element.
function attributeValue(packet: string, name: string): string | undefined {
  let from = 0;
  for (;;) {
    const at = packet.indexOf(name, from);
    if (at === -1) return undefined;
    from = at + name.length;
    const before = packet[at - 1];
    if (before !== undefined && !/\s/.test(before)) continue;
    let cursor = from;
    while (cursor < packet.length && /\s/.test(packet[cursor] ?? "")) cursor++;
    if (packet[cursor] !== "=") continue;
    cursor++;
    while (cursor < packet.length && /\s/.test(packet[cursor] ?? "")) cursor++;
    const quote = packet[cursor];
    if (quote !== '"' && quote !== "'") continue;
    const end = packet.indexOf(quote, cursor + 1);
    if (end === -1) return undefined;
    return decodeXmlEntities(packet.slice(cursor + 1, end));
  }
}

// <name ...>content</name>, with a list's items joined.
function elementValue(packet: string, name: string): string | undefined {
  const opening = `<${name}`;
  const closing = `</${name}>`;
  let from = 0;
  for (;;) {
    const at = packet.indexOf(opening, from);
    if (at === -1) return undefined;
    from = at + opening.length;
    const next = packet[from];
    if (next !== ">" && next !== undefined && !/\s/.test(next)) continue; // dc:creatorX
    const startOfContent = packet.indexOf(">", from);
    if (startOfContent === -1) return undefined;
    if (packet[startOfContent - 1] === "/") continue; // an empty element
    const end = packet.indexOf(closing, startOfContent);
    if (end === -1) return undefined;
    const inner = packet.slice(startOfContent + 1, end);
    const items: string[] = [];
    let itemFrom = 0;
    for (;;) {
      const itemAt = inner.indexOf("<rdf:li", itemFrom);
      if (itemAt === -1) break;
      const itemStart = inner.indexOf(">", itemAt);
      const itemEnd = itemStart === -1 ? -1 : inner.indexOf("</rdf:li>", itemStart);
      if (itemEnd === -1) break;
      const item = decodeXmlEntities(stripTags(inner.slice(itemStart + 1, itemEnd))).trim();
      if (item !== "") items.push(item);
      itemFrom = itemEnd;
    }
    if (items.length > 0) return items.join("; ");
    return decodeXmlEntities(stripTags(inner));
  }
}

function valueOf(packet: string, name: string): string | undefined {
  return attributeValue(packet, name) ?? elementValue(packet, name);
}

/** Read the listed properties out of an XMP packet's text. */
export function readXmp(text: string, fields: FieldCollector): void {
  const packet = text.length > MAX_PACKET_CHARACTERS ? text.slice(0, MAX_PACKET_CHARACTERS) : text;
  const seen = new Set<string>();
  for (const property of PROPERTIES) {
    const raw = valueOf(packet, property.name);
    if (raw === undefined) continue;
    const value = property.moment === true ? momentOrText(raw) : textValue(raw);
    if (value === undefined) continue;
    // Two properties can carry the same reading (xmp:CreateDate and photoshop:DateCreated): the
    // first one listed is shown, so a label appears once.
    if (seen.has(property.label)) continue;
    seen.add(property.label);
    fields.add({ name: property.label, value });
  }
}
