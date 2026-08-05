// A Code 128 encoder, written out here rather than taken from a dependency. Three reasons, in
// order of weight: a barcode symbology is a fixed, published table plus a modulo-103 checksum, so
// the whole implementation is smaller than the audit of a package that does it; the platform builds
// in memory-safe languages by default, and a barcode library's transitive graph is exactly the kind
// of thing that quietly pulls in a native canvas; and this runs in a Worker, where the output has to
// be bar widths rather than a bitmap anyway.
//
// Subset B only, deliberately. It covers all of printable ASCII, which is every character a custody
// number or an identifier handle can contain, and mixing in subset C to halve the width of numeric
// runs would add a shift/latch state machine for a saving nobody can see on a shelf label. Subset A
// (control characters) has nothing this subsystem needs to encode.

// Bar/space module widths for values 0..106, the published Code 128 table. Each entry is six digits:
// bar, space, bar, space, bar, space, in modules. Value 106 (the stop pattern) carries a seventh
// bar, appended in `code128Modules` so the table stays uniform.
const PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "233111",
] as const;

const START_B = 104;
const STOP = 106;
// Subset B maps character code 32 (space) to value 0 and runs contiguously to 126 (tilde).
const SUBSET_B_OFFSET = 32;
const SUBSET_B_MAX = 126;

export class Code128EncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Code128EncodingError";
  }
}

// The value sequence a payload encodes to, checksum included but stop excluded — exposed because it
// is the thing a test can assert against the published checksum worked example without reasoning
// about bar widths.
export function code128Values(payload: string): number[] {
  if (payload.length === 0) {
    throw new Code128EncodingError("a barcode needs a payload");
  }
  const values: number[] = [START_B];
  for (const character of payload) {
    const code = character.codePointAt(0) ?? 0;
    if (code < SUBSET_B_OFFSET || code > SUBSET_B_MAX) {
      throw new Code128EncodingError(
        `Code 128 subset B encodes printable ASCII only; refused character code ${code}`,
      );
    }
    values.push(code - SUBSET_B_OFFSET);
  }
  // Modulo-103 checksum: the start value plus each data value weighted by its one-based position.
  let checksum = START_B;
  for (let index = 1; index < values.length; index++) {
    checksum += (values[index] ?? 0) * index;
  }
  values.push(checksum % 103);
  return values;
}

// Alternating module widths, starting with a bar. The caller turns them into rectangles; nothing
// here knows about pixels, millimetres, or SVG.
export function code128Modules(payload: string): number[] {
  const modules: number[] = [];
  for (const value of [...code128Values(payload), STOP]) {
    const pattern = PATTERNS[value];
    if (pattern === undefined) {
      throw new Code128EncodingError(`no Code 128 pattern for value ${value}`);
    }
    for (const digit of pattern) modules.push(Number(digit));
  }
  // The stop pattern's trailing bar — two modules, which the six-digit table cannot carry.
  modules.push(2);
  return modules;
}

export interface Code128Bar {
  readonly offsetModules: number;
  readonly widthModules: number;
}

// Just the bars (the dark runs), with their offsets. Spaces are the gaps between them, so a renderer
// draws only these and never has to reason about which entries are which.
export function code128Bars(payload: string): { bars: Code128Bar[]; widthModules: number } {
  const modules = code128Modules(payload);
  const bars: Code128Bar[] = [];
  let offsetModules = 0;
  for (const [index, widthModules] of modules.entries()) {
    if (index % 2 === 0) bars.push({ offsetModules, widthModules });
    offsetModules += widthModules;
  }
  return { bars, widthModules: offsetModules };
}
