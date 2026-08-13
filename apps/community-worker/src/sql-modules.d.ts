// A plain `.sql` import resolves to the file's text. The Vite-side half of the contract is the
// sql-as-text plugin in vitest.config.ts; this declares the module shape once for TypeScript.
declare module "*.sql" {
  const sql: string;
  export default sql;
}
