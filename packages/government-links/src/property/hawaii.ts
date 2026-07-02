import type { AssessorSite } from "../types.ts";
import { stateSites } from "./helpers.ts";

// Hawaii's 5 county-equivalents. All real-property assessment runs on Schneider qPublic, one app
// per county, so each deep-links through the shared `beaconQpublic` adapter using the county's
// AppID/LayerID plus the `hawaiiTmk` key format (a TMK reduced to its 12-digit KeyValue). Kalawao
// (population ~80) has no assessor of its own and is administered under Maui, so it just opens
// Maui's search page. AppID/LayerID values verified against live qPublic parcel-report links.
const { search, platform } = stateSites("HI");

const QPUBLIC_HOST = "qpublic.schneidercorp.com";

const qpublic = (
  jurisdictionId: string,
  name: string,
  app: string,
  appId: string,
  layerId: string,
): AssessorSite =>
  platform(
    jurisdictionId,
    name,
    `https://${QPUBLIC_HOST}/Application.aspx?App=${app}&PageType=Search`,
    "beaconQpublic",
    QPUBLIC_HOST,
    { params: { appId, layerId, pageTypeId: "4" }, keyFormat: "hawaiiTmk" },
  );

const MAUI_SEARCH = `https://${QPUBLIC_HOST}/Application.aspx?App=MauiCountyHI&PageType=Search`;

export const HAWAII_ASSESSOR_SITES: readonly AssessorSite[] = [
  qpublic("15001", "Hawaii", "HawaiiCountyHI", "1048", "23618"),
  qpublic("15003", "Honolulu", "HonoluluCountyHI", "1045", "23342"),
  search("15005", "Kalawao", MAUI_SEARCH),
  qpublic("15007", "Kauai", "KauaiCountyHI", "986", "20101"),
  qpublic("15009", "Maui", "MauiCountyHI", "1029", "21689"),
];
