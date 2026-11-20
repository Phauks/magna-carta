/*
 * One reconciliation, named by the address. Whether it exists is the server's answer, read on the
 * client.
 */
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => ({ reconciliationId: params.reconciliationId });
