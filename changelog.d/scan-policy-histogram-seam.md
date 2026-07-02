- **Scan policy:** the malware scanner's heuristic (`_SUSP_`) rule-score distribution is now retrievable
  at runtime — `GET /api/v1/firm/scan-policy/score-histogram` (behind the scan-policy permission) returns
  the engine's 5-point-bucket histogram, surfacing what was previously only an image-build log line so the
  firm scan-policy custom score-floor control has a data source. Returns an empty shape until the scan
  engine is deployed.
