# Standard-font metric generator

Regenerates `crates/pdf-core/src/standard_fonts_data.rs` — the Adobe Core-14
standard-font glyph advance widths and the standard code-to-glyph-name encoding
tables. The advance values are functional font metrics (how wide each glyph is);
they are baked as plain Rust constants so text-preserving redaction can position
glyphs on pages whose simple fonts omit an embedded `/Widths` array.

This is a one-time / maintenance tool. The output is checked in; you only run
this if the metric source changes.

## Regenerate

From this directory, fetch the sources and run the generator:

```sh
BASE=https://raw.githubusercontent.com/apache/pdfbox/trunk/pdfbox/src/main/resources/org/apache/pdfbox/resources/afm
for f in Helvetica Helvetica-Bold Helvetica-Oblique Helvetica-BoldOblique \
         Courier Courier-Bold Courier-Oblique Courier-BoldOblique \
         Times-Roman Times-Bold Times-Italic Times-BoldItalic Symbol ZapfDingbats; do
  curl -sSL "$BASE/$f.afm" -o "$f.afm"
done
curl -sSL https://raw.githubusercontent.com/mozilla/pdf.js/master/src/core/encodings.js -o encodings.js

node gen.js   # writes standard_fonts_data.rs in the cwd; move it to ../../src/
```

The generator parses each AFM's `C <code> ; WX <width> ; N <name> ;` lines into a
name-to-width map (sorted by glyph name for binary search), and evaluates the
five encoding arrays (`StandardEncoding`, `WinAnsiEncoding`, `MacRomanEncoding`,
`SymbolSetEncoding`, `ZapfDingbatsEncoding`) into `[&str; 256]` code-to-name
tables. It prints spot checks (e.g. Helvetica `space` = 278, `A` = 667, Courier
= 600) that must hold.

Sources: the AFM files are Adobe's published Core-14 metrics (mirrored in Apache
PDFBox); the encoding arrays are from Mozilla pdf.js (Apache-2.0). Only the
numeric widths and the code-to-name mappings — functional facts — are reproduced.
