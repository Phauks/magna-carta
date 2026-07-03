// CONFIDENTIALITY: Recovery job/shard messages carry the extracted HASH string ONLY.
// Never the file bytes, never the password (except RecoveryJobState.password,
// which is set only on "found" status and surfaced once, never logged or audited).

// The extracted-hash job the coordinator fans out. NEVER carries file bytes or the password.
export type RecoveryTierName = "cfCapable" | "gpuRequired";

export type RecoveryJobStatus =
  | "queued"      // shards enqueued, none reported yet
  | "running"     // at least one shard reported, none found, not all done
  | "found"       // a shard recovered the password (terminal)
  | "exhausted"   // every shard reported, none found (terminal)
  | "needsGpu"    // slow KDF — not attempted on CF (terminal; the GPU rung fills this seam)
  | "cancelled";  // caller cancelled (terminal)

export interface RecoveryProgress {
  readonly candidatesTried: number; // summed across reported shards
  readonly shardsDone: number;      // shards that have reported
  readonly shardCount: number;      // total shards fanned out (0 for needsGpu)
}

export interface RecoveryJobState {
  readonly status: RecoveryJobStatus;
  readonly tier: RecoveryTierName;
  readonly progress: RecoveryProgress;
  readonly password: string | null; // set ONLY when status === "found"; surfaced once, then purged (see coordinator retention alarm)
  readonly error: string | null;
  // The user who started the job. Retrieval of the recovered password is bound to this identity —
  // the status route returns result.password only to the same user, so a jobId leaked to another
  // firm member does not surrender the password. Not part of the HTTP response body.
  readonly startedByUserId: string;
}

// One message per shard on the recovery Queue. Hash string only — never the file.
export interface RecoveryShardMessage {
  readonly firmId: string;
  readonly jobId: string;
  readonly shardIndex: number;
  readonly shardCount: number;
  readonly hash: string;
  readonly format: "pdf" | "zip" | "ooxml";
  readonly hashcatMode: number;
  readonly ruleSet: "best64" | "none";
}

// The container's JSON reply (mirrors the Rust ShardOutcome).
export interface ShardOutcome {
  readonly found: string | null;
  readonly candidatesTried: number;
}

// The parameters the route hands the coordinator to start a job.
export interface RecoveryStartInput {
  readonly tier: RecoveryTierName;   // gpuRequired => no shards enqueued, terminal needsGpu
  readonly shardCount: number;       // the modest CF shard count (0 for gpuRequired)
  readonly hash: string;
  readonly format: "pdf" | "zip" | "ooxml";
  readonly hashcatMode: number;
  readonly ruleSet: "best64" | "none";
  readonly firmId: string;
  readonly jobId: string;
  readonly startedByUserId: string; // binds password retrieval to the initiating user
}

// The DO RPC surface the route + consumer call.
export interface RecoveryCoordinator {
  start(input: RecoveryStartInput): Promise<RecoveryJobState>; // enqueues shardCount messages (or terminal needsGpu)
  reportShard(shardIndex: number, outcome: ShardOutcome): Promise<void>; // aggregate; first found wins
  cancel(): Promise<void>;
  status(): Promise<RecoveryJobState>;
}

// The backend seam — the coordinator is backend-agnostic on purpose. Slice 2 ships ONE
// implementation: the Cloudflare-CPU container backend. The later GPU-rung adapter plugs in here
// with no coordinator rework (same split + first-hit-cancel; only the backend differs). This app
// has no generic fan-out primitive today — recovery is its first fan-out consumer — so the generic
// cross-domain primitive is NOT built here; the next non-recovery domain that needs container
// fan-out extracts it FROM this coordinator rather than rolling its own.
export interface RecoveryBackend {
  recoverShard(message: RecoveryShardMessage): Promise<ShardOutcome>;
}
