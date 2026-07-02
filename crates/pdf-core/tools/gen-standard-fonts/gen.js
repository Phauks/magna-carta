const fs = require("fs");

// --- 1. encodings: eval the pdf.js arrays (strip the trailing `export {}`) ---
let enc = fs.readFileSync("encodings.js", "utf8").replace(/export\s*\{[\s\S]*?\};?/m, "");
const sandbox = {};
new Function(
  "with(this){" +
    enc +
    ";this.__out={StandardEncoding,WinAnsiEncoding,MacRomanEncoding,SymbolSetEncoding,ZapfDingbatsEncoding};}",
).call(sandbox);
const E = sandbox.__out;
for (const k of Object.keys(E)) {
  const a = E[k].slice(0, 256);
  while (a.length < 256) a.push("");
  E[k] = a.map((x) => x || "");
}

// --- 2. AFM widths: parse `C code ; WX w ; N name ;` -> {name: width} ---
const fonts = [
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
  "Courier",
  "Courier-Bold",
  "Courier-Oblique",
  "Courier-BoldOblique",
  "Times-Roman",
  "Times-Bold",
  "Times-Italic",
  "Times-BoldItalic",
  "Symbol",
  "ZapfDingbats",
];
const widths = {};
for (const f of fonts) {
  const txt = fs.readFileSync(f + ".afm", "utf8");
  const m = {};
  for (const line of txt.split(/\r?\n/)) {
    const r = line.match(/^C\s+(-?\d+)\s*;\s*WX\s+(-?\d+)\s*;\s*N\s+(\S+)\s*;/);
    if (r) m[r[3]] = parseInt(r[2], 10);
  }
  widths[f] = m;
}

// --- 3. emit Rust ---
const constName = (f) => f.toUpperCase().replace(/-/g, "_");
function emitWidths(f) {
  const m = widths[f];
  const keys = Object.keys(m).sort();
  const items = keys.map((n) => `("${n}", ${m[n]})`).join(", ");
  return `pub(crate) const ${constName(f)}: &[(&str, i16)] = &[${items}];`;
}
function emitEnc(name, arr) {
  const items = arr.map((s) => `"${s}"`).join(", ");
  return `pub(crate) const ${name}: [&str; 256] = [${items}];`;
}
let out = "";
out += "// Adobe Core-14 standard-font glyph advance widths (glyph-space, 1000 units/em)\n";
out += "// and the standard code-to-glyph-name encoding tables. The advance values are\n";
out +=
  "// functional font metrics. Generated data: see crates/pdf-core/tools/gen-standard-fonts.\n";
out += "// Each font slice is sorted by glyph name for binary search.\n\n";
for (const f of fonts) out += emitWidths(f) + "\n";
out += "\n";
out += emitEnc("STANDARD_ENCODING", E.StandardEncoding) + "\n";
out += emitEnc("WIN_ANSI_ENCODING", E.WinAnsiEncoding) + "\n";
out += emitEnc("MAC_ROMAN_ENCODING", E.MacRomanEncoding) + "\n";
out += emitEnc("SYMBOL_ENCODING", E.SymbolSetEncoding) + "\n";
out += emitEnc("ZAPF_DINGBATS_ENCODING", E.ZapfDingbatsEncoding) + "\n";
fs.writeFileSync("standard_fonts_data.rs", out);

// spot checks (printed, deterministic)
console.log("Helvetica space =", widths["Helvetica"]["space"], "(expect 278)");
console.log("Helvetica A     =", widths["Helvetica"]["A"], "(expect 667)");
console.log("Times-Roman A   =", widths["Times-Roman"]["A"], "(expect 722)");
console.log("Courier any (m) =", widths["Courier"]["m"], "(expect 600)");
console.log("WinAnsi[65]     =", E.WinAnsiEncoding[65], "(expect A)");
console.log("WinAnsi[32]     =", E.WinAnsiEncoding[32], "(expect space)");
console.log("Standard[65]    =", E.StandardEncoding[65], "(expect A)");
console.log("Symbol glyphs   =", Object.keys(widths["Symbol"]).length);
console.log("Helvetica glyphs=", Object.keys(widths["Helvetica"]).length);
console.log("output bytes    =", out.length);
