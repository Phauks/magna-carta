/*
 * A reconciliation's address names one record, and the shape of the identifier is the only thing
 * this load can answer for. Anything that is not the shape the platform mints 404s inside the app
 * chrome rather than rendering a working surface over a read that was never going to answer.
 *
 * WHETHER THE RECORD EXISTS IS THE SERVER'S ANSWER, NOT THIS ONE. The reconciliation, its proof,
 * its two sides and its matches are read on the client, the way the sibling trust screens read
 * theirs, and a 404 from that read is the screen's own not-found state.
 */
import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

/** The shape @magna-carta/identifiers mints for a reconciliation. */
const RECONCILIATION_IDENTIFIER = /^trustReconciliation_[A-Za-z0-9_-]{21}$/;

export const load: PageLoad = ({ params }) => {
  if (!RECONCILIATION_IDENTIFIER.test(params.reconciliationId)) error(404, "Not Found");
  return { reconciliationId: params.reconciliationId };
};
