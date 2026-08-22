#!/usr/bin/env bash
set -euo pipefail

# The recovery container's acceptance gate: build the image (context: repo root), run it,
# assert /ready → "ok", then POST /recover-shard with a small shard over the baked NCSC
# wordlist and assert the response is valid JSON with a `candidatesTried` field (found may
# be null — the gate proves the container is wired, not that the test hash is in the list).
# Then POST /extract-hash twice — the committed encrypted PDF, then bytes that are not an
# encrypted document — to prove the header read answers with a hash and with a refusal. Finally
# POST /unlock twice, with the fixture's real password and with a wrong one, to prove the decrypt
# returns the plaintext, refuses with a stable code rather than a fault, and echoes no password.
#
# Requires a running Docker daemon. Run from the repo root:
#   containers/recovery/tests/recover_e2e.sh

IMAGE=magna-carta-recovery:e2e
CONTAINER=magna-carta-recovery-e2e
PORT=18081
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
# shellcheck source=../../docker-build.sh
. "$REPO_ROOT/containers/docker-build.sh"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "building $IMAGE (linux/amd64, context: repo root) ..."
container_build --platform linux/amd64 \
  -f "$REPO_ROOT/containers/recovery/Dockerfile" \
  -t "$IMAGE" \
  "$REPO_ROOT"

echo "starting container ..."
docker run -d --name "$CONTAINER" -p "$PORT:8080" "$IMAGE" >/dev/null

echo "waiting for /ready (service loads wordlist + rules at startup) ..."
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$PORT/ready" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/ready" | grep -q "^ok$" \
  || { echo "FAIL: /ready did not return 'ok'"; exit 1; }

# MS Office 2013 agile hash (hashcat example_hashes mode 9600, password = "hashcat").
# The container resolves shardIndex/shardCount into a word range itself (it's the only
# place that knows the baked wordlist's length); shardIndex 0 of 1 covers the whole
# wordlist — slow but sufficient to prove the engine is wired. found=null is expected
# and fine; we assert valid JSON only.
HASH='$office$*2013*100000*256*16*7dd611d7eb4c899f74816d1dec817b3b*948dc0b2c2c6c32f14b5995a543ad037*0b7ee0e48e935f937192a59de48a7d561ef2691d5c8a3ba87ec2d04402a94895'

echo "POST /recover-shard (shardIndex 0 of 1, ruleSet=none) ..."
response=$(curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -d "{\"hash\":\"$HASH\",\"format\":\"ooxml\",\"hashcatMode\":9600,\"shardIndex\":0,\"shardCount\":1,\"ruleSet\":\"none\"}" \
  "http://127.0.0.1:$PORT/recover-shard")
echo "  -> $response"

# Validate the response is JSON with a candidatesTried field (the minimum liveness proof).
echo "$response" | grep -q '"candidatesTried"' \
  || { echo "FAIL: /recover-shard did not return a JSON body with candidatesTried"; exit 1; }

# The encryption-header read the app worker makes on every inspect and every recovery start. It is
# a request-path call on a member's own connection, so proving it answers in a BUILT image — not
# only in the unit tests — is what stands between a deploy and a 503 on a live surface.
FIXTURE="$REPO_ROOT/crates/decryption-core/tests/fixtures/pdf_userpw_test.pdf"

echo "POST /extract-hash (the committed RC4-128 PDF fixture) ..."
extracted=$(curl -fsS -X POST \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$FIXTURE" \
  "http://127.0.0.1:$PORT/extract-hash")
echo "  -> $extracted"

echo "$extracted" | grep -q '"hashcatMode":10500' \
  || { echo "FAIL: /extract-hash did not report the fixture's hashcat mode"; exit 1; }
echo "$extracted" | grep -q '"tier":"cfCapable"' \
  || { echo "FAIL: /extract-hash did not report the fixture's recovery tier"; exit 1; }

# Bytes that are not an encrypted document must come back 422 with a stable code — never a 5xx,
# which the app worker reads as "the engine is down" and answers with a 503 instead of telling the
# member what is wrong with their file.
echo "POST /extract-hash (bytes that are not an encrypted document) ..."
refusal_status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -H "Content-Type: application/octet-stream" \
  --data-binary "not an encrypted document" \
  "http://127.0.0.1:$PORT/extract-hash")
[ "$refusal_status" = "422" ] \
  || { echo "FAIL: /extract-hash answered $refusal_status for unreadable bytes, expected 422"; exit 1; }

# The password decrypt. Its body is framed — a big-endian u32 password length, the password, then
# the file — because a password in a header or a query string is a password in the parts of a
# request that proxies and access logs record. Building the frame here is what proves the framing
# the app worker's adapter writes is the framing a BUILT image splits.
UNLOCK_BODY="$(mktemp)"
UNLOCK_REPLY="$(mktemp)"
trap 'rm -f "$UNLOCK_BODY" "$UNLOCK_REPLY"; cleanup' EXIT

# $1 = password, $2 = file path. Writes [u32 big-endian password length][password][file] to
# $UNLOCK_BODY. Every password this script sends is well under 256 bytes, so the first three length
# bytes are zero and only the last one varies.
frame_unlock() {
  local length=${#1}
  printf "\\x00\\x00\\x00\\x$(printf '%02x' "$length")" > "$UNLOCK_BODY"
  printf '%s' "$1" >> "$UNLOCK_BODY"
  cat "$2" >> "$UNLOCK_BODY"
}

echo "POST /unlock (the committed fixture, with its real password) ..."
frame_unlock "test" "$FIXTURE"
curl -fsS -X POST \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$UNLOCK_BODY" \
  "http://127.0.0.1:$PORT/unlock" > "$UNLOCK_REPLY"

grep -q '"format":"pdf"' "$UNLOCK_REPLY" \
  || { echo "FAIL: /unlock did not report the fixture's format"; exit 1; }
# The plaintext is base64 in the reply, and "JVBERi0" is the encoding of "%PDF-1". Asserting on the
# decrypted bytes rather than on the status is what distinguishes a working decrypt from a 200.
grep -q '"decryptedBase64":"JVBERi0' "$UNLOCK_REPLY" \
  || { echo "FAIL: /unlock did not return a decrypted PDF"; exit 1; }

# A wrong password is a VERDICT about what was submitted — 422 with a stable code, never a 5xx,
# which the app worker reads as "the engine is down", and never a 200. The password here is a long
# distinctive string so the no-echo assertion below cannot pass by accident.
echo "POST /unlock (the wrong password) ..."
WRONG_PASSWORD="not-the-password-a1b2c3d4"
frame_unlock "$WRONG_PASSWORD" "$FIXTURE"
wrong_status=$(curl -sS -o "$UNLOCK_REPLY" -w '%{http_code}' -X POST \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$UNLOCK_BODY" \
  "http://127.0.0.1:$PORT/unlock")
[ "$wrong_status" = "422" ] \
  || { echo "FAIL: /unlock answered $wrong_status for a wrong password, expected 422"; exit 1; }
grep -q '"code":"wrongPassword"' "$UNLOCK_REPLY" \
  || { echo "FAIL: /unlock did not return the wrongPassword code"; exit 1; }
# Nothing may carry the password back out. This is the assertion the whole framing exists to make
# true; a refusal that quoted its input would put a member's password wherever the reply is read.
if grep -q "$WRONG_PASSWORD" "$UNLOCK_REPLY"; then
  echo "FAIL: /unlock echoed the password into its refusal"
  exit 1
fi

echo "PASS: /ready returned ok, /recover-shard returned valid JSON, /extract-hash read the fixture, and /unlock decrypted it"
