/*
 * The scan engine's composite version, as the container reports it, split into the three things
 * it is made of. Pure, so the node-pool tests exercise the split directly.
 *
 * The container (containers/scan) stamps itself `engine/<code>+yara-rules/<tag>+clamav-db/<db>`:
 * the engine's own build, the YARA Forge release its rules were baked from, and the ClamAV
 * signature database it boots with. Three facts a reader may need separately — a rules tag says
 * whether a nightly rebuild picked up a new release, a database number says whether a signature
 * is old enough to miss something — so the reading states them as three lines rather than one
 * string somebody has to know how to cut.
 *
 * A composite that does not carry all three is reported as unreadable rather than partly: a
 * partial split would put a value under the wrong label, which is worse than no value.
 */

export interface ScanEngineParts {
  readonly engineCode: string;
  readonly yaraRuleset: string;
  readonly malwareDefinitions: string;
}

/** One line of the reading: what the part is called, and what it reports. */
export interface ScanEngineReadingLine {
  readonly label: string;
  readonly value: string;
}

export function decomposeScanEngineVersion(composite: string): ScanEngineParts | null {
  const parts = new Map<string, string>();
  for (const component of composite.split("+")) {
    const separator = component.indexOf("/");
    if (separator > 0) parts.set(component.slice(0, separator), component.slice(separator + 1));
  }
  const engineCode = parts.get("engine");
  const yaraRuleset = parts.get("yara-rules");
  const malwareDefinitions = parts.get("clamav-db");
  if (
    engineCode === undefined ||
    yaraRuleset === undefined ||
    malwareDefinitions === undefined ||
    engineCode === "" ||
    yaraRuleset === "" ||
    malwareDefinitions === ""
  ) {
    return null;
  }
  return { engineCode, yaraRuleset, malwareDefinitions };
}

/** The reading as it prints: engine first, then the two things it scans with. */
export function scanEngineReadingLines(parts: ScanEngineParts): readonly ScanEngineReadingLine[] {
  return [
    { label: "Engine", value: parts.engineCode },
    { label: "YARA ruleset", value: parts.yaraRuleset },
    { label: "Malware definitions", value: parts.malwareDefinitions },
  ];
}

/** Sample parts for a loading fixture: plausible shapes, named by nothing real. */
export const SCAN_ENGINE_FIXTURE_PARTS: ScanEngineParts = {
  engineCode: "0.0.0",
  yaraRuleset: "0000-00-00",
  malwareDefinitions: "00000",
};

/** What the reading says where no engine reports. A fact about the deployment, not a fault. */
export const SCAN_ENGINE_UNREPORTED_LABEL = "Not reported";
export const SCAN_ENGINE_UNREPORTED_DETAIL =
  "No malware scanner is connected, so uploads are marked as unscanned.";
