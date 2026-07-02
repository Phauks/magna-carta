// Better Auth owns these five control-plane tables. Their storage follows what the
// pinned better-auth drizzle adapter expects — epoch-millisecond INTEGER timestamps — the one
// sanctioned exception to our ISO-8601 text instants. Everything else is OUR lineage.
// Single home for the list — every test that reasons about the Better Auth tables imports it here.
export const BETTER_AUTH_TABLE_NAMES: ReadonlySet<string> = new Set([
  "user",
  "session",
  "account",
  "verification",
  "two_factor",
]);
