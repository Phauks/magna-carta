// The message both capture entrances enqueue and the capture consumer drains. Its own module so the
// route that files an email (the HTTP side) and the consumer that captures it (the background side)
// share the shape without either importing the other.
export interface EmailsCaptureMessage {
  readonly firmId: string;
  readonly bucketName: string | null;
  readonly stagedR2Key: string; // where the entrance staged the raw MIME
  // Which entrance recorded the capture. `forward` is the Email Worker; `api` and `addin` both post to
  // the authenticated file-to-matter endpoint and are told apart because only an add-in capture
  // carries the original message intact.
  readonly capturedVia: "forward" | "api" | "addin";
  readonly matterId: string | null; // a candidate matter already resolved by the entrance (the API path)
  // The forward/CC token, when the entrance could not resolve a matter itself (the Email Worker has no
  // per-firm database handle). The consumer resolves it against the firm's capture-address store.
  readonly captureToken: string | null;
  readonly linkedBy: string | null;
  readonly acceptOnCapture: boolean;
  readonly jobId: string; // idempotency key: capture:<jobId>
}
