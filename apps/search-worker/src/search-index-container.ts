import { Container } from "@cloudflare/containers";
import { forwardSplitObjectCall, SPLIT_OBJECT_HOST } from "./split-object-forwarding.ts";
import type { Bindings } from "./index.ts";

// The discovery keyword-index Container — the Tantivy engine (containers/search, over
// crates/search-core) held WARM, because the index is state and a resident engine is what makes the
// second query against a split cheap. It builds splits, range-reads them, and merges them; it owns no
// firm data of its own, since every split lives in the firm's own R2 bucket and every catalog decision
// is made in the app Worker before a call gets here.
//
// Least privilege, and the reason this class exists rather than a bare binding: the container holds no
// R2 credentials, no database handle, and no general egress. The single host it must reach — the
// split-object host — is reached NOT over the internet but through outbound interception, which hands
// the call to the app Worker over a service binding, inside the Workers runtime.
export class SearchIndexContainer extends Container<Bindings> {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  // Long, because a warm engine is the design's whole latency story: a searcher that is already open
  // over a split answers from held state, and a container that sleeps between queries pays the open
  // cost again on every one. The warm-poke cron is what keeps an instance inside this window.
  override sleepAfter = "30m";
  override enableInternet = false; // no general egress — object access is intercepted, not routed
  override pingEndpoint = "ready";

  // Outbound interception — the hinge that makes a credential-less engine able to read R2. The engine
  // issues an ordinary ranged GET (or a PUT of a built split) against the non-routable split-object
  // host; this handler forwards it to the app Worker, which verifies the capability token the engine
  // was handed for that one operation, resolves the firm's bucket, and performs exactly one R2
  // operation. Every other outbound host is refused by enableInternet = false.
  //
  // This hop carries no trust of its own: it adds no header, strips none, and grants nothing. A forged
  // or expired token still fails on the far side, which is why forwarding here is only plumbing.
  static override outboundByHost: Record<
    string,
    (request: Request, env: Bindings) => Promise<Response>
  > = {
    [SPLIT_OBJECT_HOST]: (request, env) => forwardSplitObjectCall(request, env.APP_WORKER),
  };
}
