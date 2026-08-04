#!/usr/bin/env python3
"""Regenerate the acceptance fixtures.

The fixtures are committed, so this script is not part of the gate — it exists so the documents can
be re-derived and reviewed rather than being opaque blobs nobody can explain. Run it and commit the
result when a fixture needs to change:

    python3 containers/libreoffice/tests/fixtures/build-fixtures.py

Both documents are two paragraphs of text this repository wrote, with no third-party content and
nothing privileged. The Word document deliberately asks for **Calibri** body text and **Cambria**
headings: those are the two faces Carlito and Caladea are metric-compatible with, so the acceptance
suite's embedded-font assertion is what proves the metric-compatible pair is installed and being
substituted in, rather than the layout silently shifting onto Liberation.
"""

import pathlib
import zipfile

HERE = pathlib.Path(__file__).parent

HEADING_TEXT = "Conversion acceptance fixture"
BODY_TEXT = (
    "This document exists so the conversion engine can be asserted against a known result. "
    "It carries no privileged content."
)

DOCX_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>
"""

DOCX_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""

DOCX_DOCUMENT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"""

# Cambria for the heading, Calibri for the body: the metric-compatible pair the font assertion pins.
DOCX_STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
</w:styles>
"""

DOCX_DOCUMENT = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/></w:rPr><w:t>{HEADING_TEXT}</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr><w:t>{BODY_TEXT}</w:t></w:r>
    </w:p>
  </w:body>
</w:document>
"""

ODT_MANIFEST = """<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>
"""

ODT_STYLES = """<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
  <office:styles/>
</office:document-styles>
"""

ODT_CONTENT = f"""<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
  <office:body>
    <office:text>
      <text:h text:outline-level="1">{HEADING_TEXT}</text:h>
      <text:p>{BODY_TEXT}</text:p>
    </office:text>
  </office:body>
</office:document-content>
"""


def write_zip(path, entries, mimetype=None):
    # A fixed timestamp keeps regeneration byte-stable, so a fixture diff is a content diff.
    fixed_time = (2026, 1, 1, 0, 0, 0)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        if mimetype is not None:
            # OpenDocument requires the mimetype entry first and stored uncompressed.
            info = zipfile.ZipInfo("mimetype", fixed_time)
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, mimetype)
        for name, body in entries:
            info = zipfile.ZipInfo(name, fixed_time)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, body)


def main():
    write_zip(
        HERE / "acceptance.docx",
        [
            ("[Content_Types].xml", DOCX_CONTENT_TYPES),
            ("_rels/.rels", DOCX_RELS),
            ("word/_rels/document.xml.rels", DOCX_DOCUMENT_RELS),
            ("word/styles.xml", DOCX_STYLES),
            ("word/document.xml", DOCX_DOCUMENT),
        ],
    )
    write_zip(
        HERE / "acceptance.odt",
        [
            ("META-INF/manifest.xml", ODT_MANIFEST),
            ("styles.xml", ODT_STYLES),
            ("content.xml", ODT_CONTENT),
        ],
        mimetype="application/vnd.oasis.opendocument.text",
    )
    print("wrote acceptance.docx and acceptance.odt")


if __name__ == "__main__":
    main()
