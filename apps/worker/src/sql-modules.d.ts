// Plain `.sql` imports resolve to the file's text in BOTH builds — the sql-as-text plugin in
// vitest.config.ts (Vite) and the Text module rule in wrangler.jsonc (`wrangler deploy`'s
// esbuild, which rejects Vite's `?raw` suffix). TypeScript needs the module shape declared once.
declare module "*.sql" {
  const sql: string;
  export default sql;
}
