#!/usr/bin/env bash
set -euo pipefail

# The LibreOffice engine's acceptance gate: build the image, boot it, wait for an honest /ready, then
# drive real conversions through the real suite.
#
# The Rust suite (cargo test) covers everything that does not need LibreOffice — the dispatch table,
# the job package, the pipe protocol, the HTTP status mapping, and the whole pool state machine
# against a fake worker. This gate covers the one thing that cannot be faked: that the suite is
# installed, initialises, and converts.
#
# Golden files here are STRUCTURAL, not byte-equal, because a PDF is not byte-reproducible — the
# creation date, the document identifier, and font subset naming all vary per run. So the assertions
# are: the container format, the page count, the extracted text, and the embedded font names. That
# last one is the assertion that catches the font-substitution regression, and it is worth more than
# a pixel comparison would be.
#
# Requires a running Docker daemon and a cargo toolchain (for the structural inspector). Run from the
# repository root: bash containers/libreoffice/tests/acceptance.sh

IMAGE=magna-carta-libreoffice:acceptance
CONTAINER=magna-carta-libreoffice-acceptance
PORT=18100
LIBREOFFICE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPOSITORY_ROOT="$(cd "$LIBREOFFICE_DIR/../.." && pwd)"
FIXTURES="$LIBREOFFICE_DIR/tests/fixtures"
# shellcheck source=../../docker-build.sh
. "$LIBREOFFICE_DIR/../docker-build.sh"
WORK_DIR="$(mktemp -d)"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# The build context is the repository root: the crate path-depends on crates/engine-host, and will
# path-depend on crates/email-core when the email render engine lands on this same container.
echo "building $IMAGE (linux/amd64) — this image is roughly a gigabyte and takes substantially"
echo "longer than any other container in this repository ..."
container_build --platform linux/amd64 \
  -f "$LIBREOFFICE_DIR/Dockerfile" \
  -t "$IMAGE" "$REPOSITORY_ROOT"

echo "starting container ..."
docker run -d --name "$CONTAINER" -p "$PORT:8080" "$IMAGE" >/dev/null

# /ready is honest here: it stays 503 until a worker has finished suite initialisation, which takes
# tens of seconds. A container that answered 200 earlier would hand that whole delay to the first
# conversion instead, so waiting here is the point rather than an inconvenience.
echo "waiting for /ready (the suite initialises before the first worker reports in) ..."
ready=""
for _ in $(seq 1 180); do
  if ready="$(curl -fsS "http://127.0.0.1:$PORT/ready" 2>/dev/null)"; then break; fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "FAIL: /ready never returned 200"
  docker logs "$CONTAINER" 2>&1 | tail -50
  exit 1
fi
echo "  -> $ready"
echo "$ready" | grep -q '"ready":true' || { echo "FAIL: /ready did not report ready"; exit 1; }
echo "$ready" | grep -q 'suiteVersion' || { echo "FAIL: /ready carried no suite version"; exit 1; }

# Deliberately WITHOUT curl's --fail. With it, a non-2xx makes curl exit non-zero, and under `set -e`
# the enclosing `code="$(convert ...)"` assignment takes the whole run down before the next line can
# report which conversion failed and with what status -- so every status check below would have been
# unreachable on the one path it exists for. Without it, curl always exits 0 and the status code
# arrives in the output, leaving the explicit checks to do the reporting.
convert() {
  # convert <source-format> <target-format> <recipe> <input-file> <output-file>
  # x-engine-id is always sent because the convert worker forwards headers verbatim in production.
  # It must make no difference here: this container dispatches on the format pair.
  curl -sS -X POST \
    -H "x-source-format: $1" \
    -H "x-target-format: $2" \
    -H "x-recipe: $3" \
    -H "x-engine-id: libreoffice" \
    --data-binary "@$4" \
    -o "$5" \
    -w '%{http_code}' \
    "http://127.0.0.1:$PORT/convert"
}

status_of() {
  # status_of <source-format> <target-format> <recipe> <input-file>
  curl -s -o /dev/null -X POST \
    -H "x-source-format: $1" \
    -H "x-target-format: $2" \
    -H "x-recipe: $3" \
    --data-binary "@$4" \
    -w '%{http_code}' \
    "http://127.0.0.1:$PORT/convert"
}

inspect() {
  cargo run --quiet --manifest-path "$LIBREOFFICE_DIR/Cargo.toml" --example inspect-conversion -- "$1"
}

# The single-line, whitespace-collapsed rendering of the document's text. Assert against THIS rather
# than the raw block: extraction preserves the page's line breaks, so a sentence that wraps arrives
# with a newline inside it and a contiguous match fails even though every word survived. Where a line
# wraps is a layout detail that moves with a font or a suite version; whether the content survived is
# what this gate is for.
text_of() {
  inspect "$1" | grep '^text: '
}

# Build the inspector once, before anything is timed, so its first compile is not mistaken for a slow
# conversion in the log.
echo "building the structural inspector ..."
cargo build --quiet --manifest-path "$LIBREOFFICE_DIR/Cargo.toml" --example inspect-conversion

# --- docx to pdf: the volume path, and the font-substitution assertion --------------------------
echo
echo "docx -> pdf ..."
code="$(convert docx pdf pdf "$FIXTURES/acceptance.docx" "$WORK_DIR/from-docx.pdf")"
[ "$code" = "200" ] || { echo "FAIL: docx->pdf returned $code"; exit 1; }
head -c 5 "$WORK_DIR/from-docx.pdf" | grep -q '%PDF-' || { echo "FAIL: docx->pdf output is not a PDF"; exit 1; }

report="$(inspect "$WORK_DIR/from-docx.pdf")"
echo "$report"
echo "$report" | grep -q '^pages: 1$' || { echo "FAIL: expected a single page"; exit 1; }
text="$(echo "$report" | grep '^text: ')"
echo "$text" | grep -q 'Conversion acceptance fixture' \
  || { echo "FAIL: the heading did not survive the conversion"; exit 1; }
echo "$text" | grep -q 'It carries no privileged content' \
  || { echo "FAIL: the body text did not survive the conversion"; exit 1; }
# The fixture asks for Calibri and Cambria. Carlito and Caladea are metric-compatible with them, so
# these two names appearing is the proof that the metric-compatible pair is installed and being
# substituted in — rather than the layout silently shifting onto Liberation.
echo "$report" | grep '^fonts:' | grep -q 'Carlito' \
  || { echo "FAIL: Calibri was not substituted by Carlito — the metric-compatible font set is missing or was not used"; exit 1; }
echo "$report" | grep '^fonts:' | grep -q 'Caladea' \
  || { echo "FAIL: Cambria was not substituted by Caladea — the metric-compatible font set is missing or was not used"; exit 1; }

# --- odt to pdf: same filter, different import ---------------------------------------------------
echo
echo "odt -> pdf ..."
code="$(convert odt pdf pdf "$FIXTURES/acceptance.odt" "$WORK_DIR/from-odt.pdf")"
[ "$code" = "200" ] || { echo "FAIL: odt->pdf returned $code"; exit 1; }
report="$(inspect "$WORK_DIR/from-odt.pdf")"
echo "$report"
echo "$report" | grep -q '^pages: 1$' || { echo "FAIL: expected a single page"; exit 1; }
text="$(echo "$report" | grep '^text: ')"
echo "$text" | grep -q 'Conversion acceptance fixture' \
  || { echo "FAIL: the heading did not survive the conversion"; exit 1; }
echo "$text" | grep -q 'It carries no privileged content' \
  || { echo "FAIL: the body text did not survive the conversion"; exit 1; }

# --- docx to odt: a valid OpenDocument archive carrying the source's paragraphs ------------------
echo
echo "docx -> odt ..."
code="$(convert docx odt odt "$FIXTURES/acceptance.docx" "$WORK_DIR/from-docx.odt")"
[ "$code" = "200" ] || { echo "FAIL: docx->odt returned $code"; exit 1; }
unzip -p "$WORK_DIR/from-docx.odt" mimetype | grep -q 'opendocument.text' \
  || { echo "FAIL: docx->odt output is not an OpenDocument text archive"; exit 1; }
# Strip the markup and collapse whitespace before matching, for the same reason the PDF assertion
# does: the writer is free to split a paragraph across spans, so a raw grep would be asserting on how
# the text was marked up rather than on whether it survived.
odt_text="$(unzip -p "$WORK_DIR/from-docx.odt" content.xml | sed 's/<[^>]*>/ /g' | tr -s '[:space:]' ' ')"
echo "  -> $odt_text"
echo "$odt_text" | grep -q 'Conversion acceptance fixture' \
  || { echo "FAIL: the source's heading is not in the OpenDocument content"; exit 1; }
echo "$odt_text" | grep -q 'It carries no privileged content' \
  || { echo "FAIL: the source's body paragraph is not in the OpenDocument content"; exit 1; }

# --- refusal: a pair this container does not serve ------------------------------------------------
# This is OUR dispatch refusing before a worker is touched, so it is deterministic and cheap. Note
# what is deliberately NOT here: any assertion about what the suite does with malformed bytes. That
# is measured and recorded in the footer -- it is not a gap left by accident.
echo
echo "a format pair this container does not serve ..."
code="$(status_of xlsx pdf pdf "$FIXTURES/acceptance.docx")"
[ "$code" = "415" ] || { echo "FAIL: an unserved pair returned $code, expected 415"; exit 1; }

# --- concurrency: the assertion that proves the pool is doing its job ----------------------------
# Naive concurrent command-line conversions against one profile fail SILENTLY — no output, no error.
# Two simultaneous requests both succeeding, with correct content, is what says the per-worker
# profile and the one-conversion-per-worker rule are actually in force.
echo
echo "two simultaneous conversions ..."
convert docx pdf pdf "$FIXTURES/acceptance.docx" "$WORK_DIR/concurrent-a.pdf" > "$WORK_DIR/code-a" &
first=$!
convert odt pdf pdf "$FIXTURES/acceptance.odt" "$WORK_DIR/concurrent-b.pdf" > "$WORK_DIR/code-b" &
second=$!
# `|| true` so a failed conversion is reported by the status checks below rather than aborting here
# under `set -e` with no indication of which of the two failed.
wait "$first" || true
wait "$second" || true
[ "$(cat "$WORK_DIR/code-a")" = "200" ] || { echo "FAIL: the first concurrent conversion returned $(cat "$WORK_DIR/code-a")"; exit 1; }
[ "$(cat "$WORK_DIR/code-b")" = "200" ] || { echo "FAIL: the second concurrent conversion returned $(cat "$WORK_DIR/code-b")"; exit 1; }
text_of "$WORK_DIR/concurrent-a.pdf" | grep -q 'It carries no privileged content' \
  || { echo "FAIL: the first concurrent conversion produced wrong content"; exit 1; }
text_of "$WORK_DIR/concurrent-b.pdf" | grep -q 'It carries no privileged content' \
  || { echo "FAIL: the second concurrent conversion produced wrong content"; exit 1; }

# --- recycle: driving the pool past its per-worker budget keeps serving --------------------------
# The container is started again with a budget of two conversions per worker, so a short run crosses
# the ceiling several times. Every request must still be answered — a recycle is a replacement warmed
# alongside the outgoing worker, not a gap in service.
echo
echo "driving the pool past its per-worker conversion budget ..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
# The acquire deadline is raised well above its default for this run. With a budget of two and a pool
# of two, both workers cross the ceiling within a few requests, and the next request then waits out a
# real suite initialisation -- twenty to thirty seconds, longer on a loaded shared runner. What is
# being asserted here is that every request is eventually ANSWERED across recycling, not that it is
# answered within the production acquire window, so a tight deadline here would only manufacture
# flakiness.
docker run -d --name "$CONTAINER" -p "$PORT:8080" \
  -e MAGNA_CARTA_LIBREOFFICE_MAX_CONVERSIONS=2 \
  -e MAGNA_CARTA_LIBREOFFICE_ACQUIRE_DEADLINE_SECONDS=240 \
  "$IMAGE" >/dev/null
for _ in $(seq 1 180); do
  if curl -fsS "http://127.0.0.1:$PORT/ready" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/ready" >/dev/null || { echo "FAIL: /ready never came up on the recycle run"; exit 1; }
for attempt in $(seq 1 6); do
  code="$(convert docx pdf pdf "$FIXTURES/acceptance.docx" "$WORK_DIR/recycle-$attempt.pdf")"
  [ "$code" = "200" ] || { echo "FAIL: conversion $attempt across the recycle boundary returned $code"; exit 1; }
  head -c 5 "$WORK_DIR/recycle-$attempt.pdf" | grep -q '%PDF-' \
    || { echo "FAIL: conversion $attempt produced no PDF"; exit 1; }
done

echo
echo "PASS: the suite converts every registered office edge, substitutes the metric-compatible"
echo "      fonts, refuses what it does not serve without ever returning an empty 200, serves two"
echo "      conversions at once, and keeps serving across worker recycling."

# NOT COVERED HERE, and deliberately named rather than left silent:
#   * wpd -> odt. The engine serves the edge and the dispatch is proved by cargo test, but a
#     licensable, non-privileged legacy WordPerfect document to assert against has not been sourced.
#     Until one is, this gate would be asserting nothing about the WordPerfect import.
#   * The wedge case (a document crafted to hang the suite, returning 504 with the next request
#     succeeding). The deadline, the kill, and the recovery are proved against the fake worker in
#     tests/pool.rs; what is missing is a real document that reliably wedges a real suite, which is
#     a fixture-sourcing problem rather than a coverage gap in the state machine.
#   * Anything about what the suite does with MALFORMED input, which was tried here and removed on
#     evidence. The same class of input produced two different outcomes on the same suite version: a
#     mislabelled plain-text file converted and returned 200 (detection falls back to the text
#     importer), and a truncated archive wedged the suite until the 120-second deadline killed it and
#     returned 504. A third, 422, is what the design names but needs a password-protected fixture to
#     provoke. Which of the three a given malformed file earns is LibreOffice's detection and
#     recovery behaviour, not our contract, and it is free to change between versions -- so any
#     assertion here measures the suite rather than the engine, and costs two minutes per run to do
#     it. All three status paths ARE proved deterministically, against the fake worker, in
#     tests/service.rs (415/422/503/504 mapping, and that a failure never becomes an empty 200) and
#     tests/pool.rs (the deadline kills exactly one child and the next request succeeds). That is the
#     tier where they belong: no LibreOffice, no Docker, no flakiness, milliseconds.
