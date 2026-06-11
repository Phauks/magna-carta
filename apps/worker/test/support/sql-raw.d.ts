// Vite `?raw` imports resolve to the file's text at build time (Workers have no filesystem);
// TypeScript needs the module shape declared once for the generated-migration SQL imports.
declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}
