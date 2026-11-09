import { Container } from "@cloudflare/containers";
import type { Bindings } from "./index.ts";
import { ADDRESS_OBJECT_HOST, fixedLengthBody, serveObjectCall } from "./object-host.ts";
import { ADDRESS_SOURCE_HOST, serveSourceCall } from "./source-host.ts";

// The build instance of the address engine: the same image as the query instance, run large and only
// while a build is underway. A build fetches the OpenAddresses sources, cleans and indexes them into
// four partitions, uploads each as a split in parts, writes the attribution manifest, and publishes by
// writing the pointer. A failure anywhere leaves the pointer where it was.
//
// Least privilege: no credential and no internet. It reaches exactly two hosts, both through outbound
// interception — the object host (read-write, because publishing is its job) and the source host, an
// allow-list of the two OpenAddresses URLs a build needs. Every other host is refused.
export class AddressBuildContainer extends Container<Bindings> {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  // Three hours. A build runs for about an hour, and it is started by a single request that returns at
  // once, so the activity window that keeps the instance up begins at that request and is not renewed
  // by the build's own work. The window has to outlast the whole build with room to spare, or the
  // instance is put to sleep mid-build and the build is lost.
  override sleepAfter = "3h";
  override enableInternet = false; // no general egress — both reachable hosts are intercepted
  override pingEndpoint = "ready";

  // Registered by assignment in a static block, for the reason written beside
  // AddressIndexContainer's identical block (src/address-index-container.ts).
  static {
    this.outboundByHost = {
      [ADDRESS_OBJECT_HOST]: (request: Request, env: Bindings) =>
        serveObjectCall(request, {
          bucket: env.ADDRESS_INDEX,
          access: "read-write",
          knownLength: fixedLengthBody,
        }),
      [ADDRESS_SOURCE_HOST]: (request: Request) =>
        serveSourceCall(request, (input, init) => fetch(input, init)),
    };
  }
}
