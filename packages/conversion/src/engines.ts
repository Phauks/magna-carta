import type { EngineId } from "./format.ts";
import { type ConversionPort, engineNotImplemented } from "./port.ts";

// Engines whose execution needs the gated substrate resolve here until implemented. Returning a typed
// result (not throwing) lets the eventual orchestrator branch on `engine-not-implemented`.
export const deferredEngine: ConversionPort = {
  convert() {
    return Promise.resolve(engineNotImplemented());
  },
};

const ENGINES = new Map<EngineId, ConversionPort>();

export function registerEngine(id: EngineId, port: ConversionPort): void {
  ENGINES.set(id, port);
}

export function engineFor(id: EngineId): ConversionPort {
  return ENGINES.get(id) ?? deferredEngine;
}
