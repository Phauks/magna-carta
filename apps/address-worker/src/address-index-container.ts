import { Container } from "@cloudflare/containers";
import type { Bindings } from "./index.ts";
import { ADDRESS_OBJECT_HOST, fixedLengthBody, serveObjectCall } from "./object-host.ts";

// The query instance of the address engine (containers/address, over crates/address-core). It holds
// the four partitions of the index open across requests and caches the byte ranges it has read, which
// is the opposite of the discovery search engine and deliberately so: a discovery split is one firm's
// privileged content and that engine keeps nothing between calls, while this index is public reference
// data, identical for every firm, so keeping it open is a cache and nothing more.
//
// Least privilege: no credential and no internet. Its one reachable host is the object host, served
// from this worker's R2 binding through outbound interception, and it is served READ-ONLY — the query
// instance opens the pointer and range-reads partitions, and has no reason to be able to write,
// upload or delete. Only the build instance publishes.
export class AddressIndexContainer extends Container<Bindings> {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  // Fifteen minutes: long enough that a person filling in a form, pausing, and coming back to the next
  // address field finds the partitions still open, short enough that a quiet afternoon stops billing.
  // A cold start pays the first-open reads again (about 35 MB), which is the cost this window trades.
  override sleepAfter = "15m";
  override enableInternet = false; // no general egress — object access is intercepted, not routed
  override pingEndpoint = "ready";

  // Registered by ASSIGNMENT in a static block, never as a static field. `Container` declares
  // `outboundByHost` as a static accessor whose setter files the handlers in a registry keyed by class
  // name, and that registry is what the library's ContainerProxy reads when an intercepted request
  // arrives. A static field would define an own property that shadows the setter, so the runtime would
  // intercept the host while the proxy found no handler and refused every call with a 520.
  // test/address-containers.test.ts runs the library's own dispatch against this class to hold that.
  static {
    this.outboundByHost = {
      [ADDRESS_OBJECT_HOST]: (request: Request, env: Bindings) =>
        serveObjectCall(request, {
          bucket: env.ADDRESS_INDEX,
          access: "read",
          knownLength: fixedLengthBody,
        }),
    };
  }
}
