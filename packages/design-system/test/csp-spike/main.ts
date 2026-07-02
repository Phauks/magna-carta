// CSP spike probe entry (bits-ui issue #1995).
//
// Order matters: the securitypolicyviolation collector MUST be registered before the Svelte
// app mounts, so violations fired during component mount are captured. Violation events fire
// on the violating element and bubble to document.
import { mount } from "svelte";
import App from "./App.svelte";

window.__contentSecurityPolicyViolations = [];
document.addEventListener("securitypolicyviolation", (event) => {
  window.__contentSecurityPolicyViolations.push({
    effectiveDirective: event.effectiveDirective,
    blockedURI: event.blockedURI,
    // `sample` is only populated when the policy carries 'report-sample' (the probe header does).
    sample: event.sample,
    sourceFile: event.sourceFile,
    lineNumber: event.lineNumber,
  });
});

// Mechanism attribution: count every style write per channel, so the driver can map each
// violation (or absence of one) to the exact API that produced it. This is the crux of the
// spike — CSP blocks the style ATTRIBUTE channel (setAttribute("style", ...)), while CSSOM
// writes (style.setProperty, style.foo =) are never subject to CSP; style.cssText sits in
// between (CSSOM per spec, but MDN describes it as blocked — browsers may diverge).
window.__styleWriteCounts = { setAttributeStyle: 0, cssTextAssignment: 0, setPropertyCalls: 0 };
// Prototype instrumentation is unbound by construction; every original is re-invoked with an
// explicit `.call(this, ...)`, so no `this` context is lost.
// oxlint-disable-next-line typescript/unbound-method
const originalSetAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function instrumentedSetAttribute(name: string, value: string) {
  if (String(name).toLowerCase() === "style") window.__styleWriteCounts.setAttributeStyle += 1;
  return originalSetAttribute.call(this, name, value);
};
const cssTextDescriptor = Object.getOwnPropertyDescriptor(
  CSSStyleDeclaration.prototype,
  "cssText",
)!;
Object.defineProperty(CSSStyleDeclaration.prototype, "cssText", {
  ...cssTextDescriptor,
  set(value: string) {
    window.__styleWriteCounts.cssTextAssignment += 1;
    cssTextDescriptor.set!.call(this, value);
  },
});
// oxlint-disable-next-line typescript/unbound-method -- see the setAttribute note above
const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
CSSStyleDeclaration.prototype.setProperty = function instrumentedSetProperty(
  property: string,
  value: string | null,
  priority?: string,
) {
  window.__styleWriteCounts.setPropertyCalls += 1;
  return originalSetProperty.call(this, property, value, priority);
};

// Pre-existing inline style on <body>, set via CSSOM (always CSP-legal). The scroll-lock
// RESTORE path (bits-ui body-scroll-lock resetBodyStyle) re-applies the captured initial
// body style with setAttribute("style", ...) — exactly the call strict style-src blocks.
// The driver checks whether this marker survives the blocked restore.
document.body.style.backgroundColor = "rgb(1, 2, 3)";

mount(App, { target: document.getElementById("probe-root")! });
