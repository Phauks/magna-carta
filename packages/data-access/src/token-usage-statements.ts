import { idempotencyRecordInsertStatement, type SqlDatabase, type SqlStatement } from "./idempotency-statements.ts";

// Authoritative per-firm AI token usage, captured from the inference response — never the gateway
// logs. Behavior over the table lives here (the structure lives in @magna-carta/database's per-firm
// schema); the rollup is composed into the effect batch that records the run, so it moves atomically
// with it — the same delta-upsert idiom as the idempotency and outbox writes.
export const TOKEN_USAGE_METER_TABLE = "token_usage_meter";

export interface TokenUsageKey {
  readonly day: string; // YYYY-MM-DD civil date bucket (UTC)
  readonly slot: string; // reasoning | utility | embedding
  readonly modelId: string; // gateway-routable, provider-prefixed id
}

// The delta upsert: add this run's tokens (and one request) to its (day, slot, model_id) bucket,
// or seed the row. Composed into the same batch as the run it counts, so an idempotent replay
// no-ops with it. Returns SqlStatement[] so callers spread it into EffectWrite.statements.
export function tokenUsageCommitStatements(
  database: SqlDatabase,
  key: TokenUsageKey,
  inputTokens: number,
  outputTokens: number,
): SqlStatement[] {
  return [
    database
      .prepare(
        `INSERT INTO ${TOKEN_USAGE_METER_TABLE} (day, slot, model_id, input_tokens, output_tokens, request_count) VALUES (?1, ?2, ?3, ?4, ?5, 1) ON CONFLICT (day, slot, model_id) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens, request_count = request_count + 1`,
      )
      .bind(key.day, key.slot, key.modelId, inputTokens, outputTokens),
  ];
}

// The same-batch dedup record for an inference queue run: a UNIQUE(key)-keyed insert over the
// idempotency table. Composed beside the metering write so a redelivery's whole batch rolls back on
// the key collision — the re-meter stop. The key is the consumer's inferenceJobDedupKey; the
// fingerprint is the key itself (the only delivery for this key is this run, carrying no varying
// payload so fingerprint divergence is not meaningful here).
export function inferenceDedupStatements(
  database: SqlDatabase,
  key: string,
  now: string,
): SqlStatement[] {
  return [idempotencyRecordInsertStatement(database, { key, fingerprint: key, now })];
}

export interface TokenUsageRow {
  readonly slot: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly requestCount: number;
}

// The firm-usage-feed read: each domain owns the read of its own tables. Sums the rollup over all
// days, grouped by (slot, model_id), for the diagnostics snapshot consumed by the usage feed.
export async function readTokenUsage(database: SqlDatabase): Promise<readonly TokenUsageRow[]> {
  const { results } = await database
    .prepare(
      `SELECT slot, model_id, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(request_count) AS request_count FROM ${TOKEN_USAGE_METER_TABLE} GROUP BY slot, model_id`,
    )
    .all<{
      slot: string;
      model_id: string;
      input_tokens: number;
      output_tokens: number;
      request_count: number;
    }>();
  return results.map((row) => ({
    slot: row.slot,
    modelId: row.model_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    requestCount: row.request_count,
  }));
}
