// The shared shapes for the async bulk-download build: the job state the coordinator Durable Object
// persists, the queue message the build consumer reads, and the DO RPC surface the download route and
// the consumer both call. One home so the DO, the consumer, and both routes never drift on field names.

import type { BundleOptions } from "@magna-carta/file-manager/bundle-options";
import type { BundleManifest } from "@magna-carta/file-manager/bundle-manifest";
import type { BuildResultVolume } from "./bundle-container-adapter.ts";

export type BundleJobStatus = "building" | "ready" | "failed";

export interface BundleJobState {
  readonly status: BundleJobStatus;
  readonly manifestHash: string;
  readonly r2Key: string | null; // set when ready via the plain client-zip lane (one artifact)
  // Set when ready via the optioned container lane: one volume for a non-split bundle, N for a 7z
  // split. Distinct from r2Key so the status route can sign each volume; only one of the two is ever
  // populated for a ready job (the plain lane sets r2Key, the optioned lane sets volumes).
  readonly volumes?: readonly BuildResultVolume[];
  readonly error: string | null; // set when failed
}

export interface BundleBuildMessage {
  readonly firmId: string;
  readonly bucketName: string;
  readonly manifestHash: string;
  readonly entries: readonly { readonly r2Key: string; readonly path: string }[];
  // Present for an optioned build (compression / 7z / split): the lane the container builds. When set,
  // the consumer hands `manifest` to the bundle container instead of streaming through client-zip; the
  // unencrypted async lane carries no password, so the manifest's `encryption` is null. Absent for the
  // plain client-zip build, which keeps `entries`.
  readonly options?: BundleOptions;
  readonly manifest?: BundleManifest;
}

// The DO RPC surface the route + consumer call.
export interface BundleCoordinator {
  requestBundle(message: BundleBuildMessage): Promise<BundleJobState>; // single-flight: enqueues on first call
  markReady(r2Key: string): Promise<void>; // the plain client-zip lane (one artifact key)
  markReadyVolumes(volumes: readonly BuildResultVolume[]): Promise<void>; // the optioned container lane
  markFailed(error: string): Promise<void>;
  status(): Promise<BundleJobState>;
}
