/*
 * Fixture matters for the matter detail screen. The screen is presentation-only until the
 * matters list stream wires the real API; these three fixtures cover the whole lifecycle
 * (open and numbered, prospective consultation, closed) so every header and page state is
 * reviewable at a stable URL. Shapes mirror the matter record and its adjacent surfaces —
 * when wiring lands, these types give way to the generated api-client types.
 */

export interface MatterFixture {
  id: string;
  title: string;
  description: string | null;
  status: "prospective" | "open" | "closed";
  /** Null until open draws it; frozen thereafter. A consultation is unnumbered by design. */
  matterNumber: string | null;
  matterTypeName: string | null;
  locationName: string | null;
  /** Null when the matter came from the API, which carries the member id rather than a name. */
  responsibleAttorneyName: string | null;
  clientDisplayName: string | null;
  clientCode: string | null;
  /** Null when unknown: the matter came from the API, which does not carry the setting. */
  eBilling: boolean | null;
  openedAt: string | null;
  closedAt: string | null;
  /** Null when the matter came from the API, which does not carry a creation timestamp. */
  createdAt: string | null;
  files: FileFixtureRow[];
  timeEntries: TimeEntryFixtureRow[];
  costs: CostFixtureRow[];
}

export interface FileFixtureRow {
  name: string;
  documentType: string;
  version: number;
  sizeBytes: number;
  updatedAt: string;
}

export interface TimeEntryFixtureRow {
  date: string;
  timekeeperName: string;
  narrative: string;
  hours: number;
  billable: boolean;
  amountMinor: number;
}

export interface CostFixtureRow {
  date: string;
  description: string;
  category: string;
  billable: boolean;
  amountMinor: number;
}

export const matterFixtures: readonly MatterFixture[] = [
  {
    id: "matter-fixture-open",
    title: "Ashcombe v. Delderfield Holdings",
    description:
      "Breach of a commercial lease over the Delderfield arcade premises; client seeks " +
      "recovery of improvement costs and holdover damages.",
    status: "open",
    matterNumber: "2026-0147",
    matterTypeName: "Commercial Litigation",
    locationName: "Reno",
    responsibleAttorneyName: "Eleanor Vance",
    clientDisplayName: "Ashcombe Mercantile LLC",
    clientCode: "ASH-01",
    eBilling: true,
    openedAt: "2026-02-11",
    closedAt: null,
    createdAt: "2026-02-09",
    files: [
      {
        name: "Complaint — filed.pdf",
        documentType: "Pleading",
        version: 3,
        sizeBytes: 412_608,
        updatedAt: "2026-03-02",
      },
      {
        name: "Lease agreement (2019, executed).pdf",
        documentType: "Contract",
        version: 1,
        sizeBytes: 2_184_533,
        updatedAt: "2026-02-11",
      },
      {
        name: "Demand letter to Delderfield.docx",
        documentType: "Correspondence",
        version: 5,
        sizeBytes: 48_112,
        updatedAt: "2026-02-24",
      },
      {
        name: "Premises photographs (north wall).zip",
        documentType: "Evidence",
        version: 1,
        sizeBytes: 181_400_231,
        updatedAt: "2026-02-17",
      },
    ],
    timeEntries: [
      {
        date: "2026-07-01",
        timekeeperName: "Eleanor Vance",
        narrative: "Drafted motion to compel responses to first set of interrogatories.",
        hours: 2.4,
        billable: true,
        amountMinor: 108_000,
      },
      {
        date: "2026-06-30",
        timekeeperName: "Marcus Okafor",
        narrative: "Reviewed produced lease amendments; summarized holdover provisions.",
        hours: 1.7,
        billable: true,
        amountMinor: 46_750,
      },
      {
        date: "2026-06-27",
        timekeeperName: "Eleanor Vance",
        narrative: "Telephone conference with client regarding settlement posture.",
        hours: 0.5,
        billable: true,
        amountMinor: 22_500,
      },
    ],
    costs: [
      {
        date: "2026-02-11",
        description: "Complaint filing fee — Second Judicial District Court",
        category: "Filing fees",
        billable: true,
        amountMinor: 27_000,
      },
      {
        date: "2026-02-13",
        description: "Process service on Delderfield Holdings (registered agent)",
        category: "Service",
        billable: true,
        amountMinor: 9_500,
      },
      {
        date: "2026-05-19",
        description: "Certified premises appraisal — Whitlock & Rowe",
        category: "Experts",
        billable: true,
        amountMinor: 185_000,
      },
    ],
  },
  {
    id: "matter-fixture-consultation",
    title: "Consultation — Whitmore estate inquiry",
    description:
      "Prospective client seeking advice on contesting the Whitmore testamentary trust; " +
      "conflicts run at intake, retention undecided.",
    status: "prospective",
    matterNumber: null,
    matterTypeName: "Estate & Probate",
    locationName: null,
    responsibleAttorneyName: "Priya Raghunathan",
    clientDisplayName: "Dorothea Whitmore",
    clientCode: null,
    eBilling: false,
    openedAt: null,
    closedAt: null,
    createdAt: "2026-07-02",
    files: [],
    timeEntries: [],
    costs: [],
  },
  {
    id: "matter-fixture-closed",
    title: "Barrow Ridge easement quiet title",
    description:
      "Quiet-title action establishing the prescriptive easement over the Barrow Ridge " +
      "access road; judgment entered and recorded.",
    status: "closed",
    matterNumber: "2024-0089",
    matterTypeName: "Real Property",
    locationName: "Reno",
    responsibleAttorneyName: "Marcus Okafor",
    clientDisplayName: "Barrow Ridge Ranch Trust",
    clientCode: "BRR-02",
    eBilling: false,
    openedAt: "2024-05-06",
    closedAt: "2025-11-20",
    createdAt: "2024-05-02",
    files: [
      {
        name: "Judgment — quiet title (recorded).pdf",
        documentType: "Judgment",
        version: 1,
        sizeBytes: 302_114,
        updatedAt: "2025-11-18",
      },
      {
        name: "Survey — Barrow Ridge access road.pdf",
        documentType: "Evidence",
        version: 2,
        sizeBytes: 14_882_907,
        updatedAt: "2024-08-30",
      },
    ],
    timeEntries: [
      {
        date: "2025-11-20",
        timekeeperName: "Marcus Okafor",
        narrative: "Final letter to client transmitting recorded judgment; closed file.",
        hours: 0.3,
        billable: true,
        amountMinor: 8_250,
      },
    ],
    costs: [
      {
        date: "2025-11-18",
        description: "Recording fee — Washoe County Recorder",
        category: "Filing fees",
        billable: true,
        amountMinor: 4_300,
      },
    ],
  },
];

export function findMatterFixture(id: string): MatterFixture | undefined {
  return matterFixtures.find((matter) => matter.id === id);
}
