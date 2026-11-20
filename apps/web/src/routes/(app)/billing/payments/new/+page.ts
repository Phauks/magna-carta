/*
 * Record a Payment reads two things before it can be filled in: the bills with something owing
 * (each line's Matter and Bill), and the firm's bank accounts (Deposit To). Both start here, where
 * the hover preload reaches them, and the screen reads them back out of the cache.
 */
import { billingOpenBillsOptions, ledgerChartOptions } from "@magna-carta/api-client";
import { warm } from "$lib/api/screen-data.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
  warm(billingOpenBillsOptions(), ledgerChartOptions());
};
