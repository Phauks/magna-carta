/*
 * A recorded deposit's page reads the deposit and the firm's bank accounts (for the account's
 * mark), started where the hover preload can reach them.
 */
import { billingDepositOptions, ledgerChartOptions } from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params }) => {
  warm(billingDepositOptions({ path: { depositId: params.depositId } }), ledgerChartOptions());
};
