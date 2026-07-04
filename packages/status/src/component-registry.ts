// Our components. "core-probe" primitives are cheap and always warm, so the cron actively probes
// them and a probe failure is positive evidence. "engine" components are scale-to-zero containers
// we never boot just to check — their health comes only from telemetry error signal or an operator.
export type ComponentKind = "core-probe" | "engine";
export interface ComponentDefinition {
  id: string;
  name: string;
  group: string;
  kind: ComponentKind;
}

export const COMPONENT_REGISTRY: readonly ComponentDefinition[] = [
  { id: "api", name: "Application API", group: "Core", kind: "core-probe" },
  {
    id: "control-plane-database",
    name: "Control-plane database",
    group: "Core",
    kind: "core-probe",
  },
  { id: "object-storage", name: "Object storage", group: "Core", kind: "core-probe" },
  { id: "status-store", name: "Status store", group: "Core", kind: "core-probe" },
  { id: "collabora", name: "Document editing", group: "Engines", kind: "engine" },
  { id: "libreoffice", name: "Document conversion", group: "Engines", kind: "engine" },
  { id: "tantivy", name: "Search indexing", group: "Engines", kind: "engine" },
  { id: "ocr", name: "OCR", group: "Engines", kind: "engine" },
  { id: "scan", name: "Malware scanning", group: "Engines", kind: "engine" },
];
