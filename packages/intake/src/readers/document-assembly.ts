import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { DOCUMENT_ASSEMBLY_TABLE } from "@magna-carta/document-assembly/assembly-statements";
import type { IntakeStepReader } from "../checklist.ts";

// The document and engagement-letter steps, answered by an assembly of the named template landing
// on the matter. A step that names no template is declined — there is nothing to look for — and is
// then a member's record or nothing. An assembly that produced a document with absent fields still
// counts: the document exists on the matter, and what it is missing is reported where the assembly
// is, not swallowed here.
//
// Signature is not a fact this reader can see. E-signature is unbuilt, and the day it lands the
// engagement-letter kind gains its own reader over the signing record; until then a signed letter
// that came back is a member's record, which the kind accepts.
export const assembledDocumentStepReader: IntakeStepReader = async ({
  database,
  matterId,
  step,
}) => {
  const templateId = step.reference_id;
  if (templateId === null) return null;
  const { results } = await database
    .prepare(
      `SELECT completed_at, outcome FROM ${DOCUMENT_ASSEMBLY_TABLE} ` +
        `WHERE matter_id = ?1 AND template_id = ?2 AND status = 'done' ` +
        `AND outcome IN ('succeeded', 'succeeded_with_absences') ` +
        `ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(matterId, templateId)
    .all<{ completed_at: string | null; outcome: string }>();
  const latest = results[0];
  if (latest === undefined) {
    return {
      satisfied: false,
      statement: "No document has been assembled onto this matter from the named template.",
    };
  }
  const when = latest.completed_at === null ? "" : ` on ${civilDateOf(latest.completed_at)}`;
  return {
    satisfied: true,
    statement:
      latest.outcome === "succeeded_with_absences"
        ? `Assembled onto the matter${when}, with some fields left blank.`
        : `Assembled onto the matter${when}.`,
  };
};
