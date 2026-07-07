# decryption-core test fixtures

Tiny, non-sensitive encrypted files for round-trip decryption tests. Each was generated
deterministically; the password is `test` unless noted. Regenerate with the noted command if needed.

## PDF (pypdf)

Generated with `pypdf` (pure Python) — this environment has no `qpdf`. A blank 200×200 page, then
`PdfWriter.encrypt(user_password="test", owner_password="test", algorithm=...)`.

- `pdf_userpw_test.pdf` — RC4-128 (revision 3/4), user+owner password `test`.
- `pdf_aes256_test.pdf` — AES-256 (revision 6 / PDF 2.0), user+owner password `test`.

Regenerate: `python scratchpad/gen_pdf_fixtures.py` (script writes both into this directory and verifies
each re-opens with the password and starts with `%PDF`).

## ZIP

ZIP fixtures are NOT checked in — the ZIP tests generate encrypted archives in-process with the `zip`
crate writer (WinZip-AES via the `aes-crypto` feature, and legacy ZipCrypto), so no external `7z`/`zip`
tool or binary blob is needed.

## OOXML

(See the OOXML task — fixture strategy recorded there.)
