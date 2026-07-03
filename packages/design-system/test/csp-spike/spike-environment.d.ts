// Ambient declarations for the CSP spike probe only (this folder is plain Vite + Svelte,
// outside the package's normal source tree, so it carries its own .svelte module shim).
declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}

interface CapturedContentSecurityPolicyViolation {
  effectiveDirective: string;
  blockedURI: string;
  sample: string;
  sourceFile: string;
  lineNumber: number;
}

interface StyleWriteCounts {
  setAttributeStyle: number;
  cssTextAssignment: number;
  setPropertyCalls: number;
}

interface Window {
  __contentSecurityPolicyViolations: CapturedContentSecurityPolicyViolation[];
  __styleWriteCounts: StyleWriteCounts;
}
