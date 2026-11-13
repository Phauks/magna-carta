/*
 * Attorney License Lookup — which official register verifies a lawyer's standing, and where it is.
 *
 * The tool is a link generator and nothing else: bar admission is per state, every state publishes
 * its own register, and this platform neither queries them nor stores what they say. So the whole
 * job is to take the reader to the right one, and the only real work is turning the jurisdiction
 * registry (@magna-carta/government-links) into fifty-one rows somebody can read down.
 *
 * WHY THE WHOLE LIST RATHER THAN A CHOICE. This screen used to ask for a state and then reveal that
 * one state's register. Every answer it could ever give is a hyperlink, and there are fifty-one of
 * them, so putting fifty behind a picker bought nothing and cost the reader the questions a list
 * answers at a glance: is my state covered, what is the authority called there, and which of these
 * registers is not encrypted. A table also sorts itself, narrows from its own headers, and offers
 * the register's address as a column — none of which a picker and one revealed card can do.
 *
 * WHY THIS IS NOT A VERIFICATION. The registers are the authority; a copy of one of their answers,
 * held here and going stale, would be worse than no answer, because a suspension is exactly the
 * fact that changes after you look. The reader is handed the live page and reads it themselves.
 *
 * DOM-free on purpose, so the rows and the column model are checkable without rendering anything —
 * the same split the WHOIS tool keeps (tools/whois/whois-lookup.ts).
 */
import {
  LICENSING_STATES,
  attorneyLicenseSiteForState,
} from "@magna-carta/government-links/licensing";
import type { GridColumn } from "@magna-carta/design-system/data-table";

/** One state's register, as a row of the table. */
export interface AttorneyLicenseRow {
  /** The 2-digit state FIPS the registry is keyed by. Row identity; a reader never sees it. */
  readonly stateFips: string;
  /** The state's own name, which anchors the row and carries the link. */
  readonly state: string;
  /** The two-letter postal code — somebody looking for Pennsylvania reads "PA" as readily. */
  readonly code: string;
  /** The authority that keeps the register, named as it names itself. */
  readonly register: string;
  /** The register's public search page. */
  readonly searchUrl: string;
  /** Whether that page is served over TLS. */
  readonly secure: boolean;
}

/**
 * Every state (and the District of Columbia) that publishes a register, in the registry's own
 * order, which is by FIPS and therefore alphabetical by state name.
 *
 * A state the registry lists without an attorney-license register is dropped rather than rendered
 * as a row with nowhere to go. None is dropped today; the one that eventually joins LICENSING_STATES
 * for its business register alone would otherwise arrive here as a dead line.
 */
export function attorneyLicenseRows(): readonly AttorneyLicenseRow[] {
  return LICENSING_STATES.flatMap((state) => {
    const register = attorneyLicenseSiteForState(state.fipsPrefix);
    if (register === undefined) return [];
    return [
      {
        stateFips: state.fipsPrefix,
        state: state.name,
        code: state.code,
        register: register.name,
        searchUrl: register.searchUrl,
        secure: register.searchUrl.startsWith("https://"),
      },
    ];
  });
}

/*
 * HOW A REGISTER IS SERVED, as a word rather than a flag.
 *
 * Two of the fifty-one are not on TLS (Rhode Island's judiciary search and Washington's), which is
 * not a transcription error but a fact about US government portals — the county assessor registries
 * are full of the same. It is worth saying out loud rather than silently linking: the query a person
 * runs there is a named lawyer, typed by somebody at a law firm, and on a plain-HTTP page both the
 * question and the answer are readable by anything on the path. The reader still gets the link,
 * because the register is the authority whatever it is served over; they just get it knowingly.
 *
 * As a COLUMN this now answers across the whole list at once — a reader can narrow to the
 * unencrypted two and see who they are — where the old screen could only say it about the one state
 * already chosen.
 */
export const CONNECTION_ENCRYPTED = "Encrypted";
export const CONNECTION_UNENCRYPTED = "Not encrypted";

/** The closed vocabulary, declared so the column's set filter offers both whatever the rows hold. */
export const CONNECTION_STANDINGS = [CONNECTION_ENCRYPTED, CONNECTION_UNENCRYPTED] as const;
export type ConnectionStanding = (typeof CONNECTION_STANDINGS)[number];

export interface ConnectionEntry {
  readonly label: ConnectionStanding;
  /** What the standing means for the person about to type a lawyer's name into that page. */
  readonly meaning: string;
}

const ENCRYPTED_ENTRY: ConnectionEntry = {
  label: CONNECTION_ENCRYPTED,
  meaning:
    "This register is served over an encrypted connection, so the lawyer you search for and the " +
    "answer stay between you and it.",
};

const UNENCRYPTED_ENTRY: ConnectionEntry = {
  label: CONNECTION_UNENCRYPTED,
  meaning:
    "This state's lawyer register uses an insecure connection, so your search and its results could be seen by others on the network. It's still the official record of the lawyer's standing.",
};

/** How a row's register is served, and what that means. */
export function connectionEntry(row: AttorneyLicenseRow): ConnectionEntry {
  return row.secure ? ENCRYPTED_ENTRY : UNENCRYPTED_ENTRY;
}

/** The column ids the screen's cell snippet recognises. */
export const STATE_COLUMN_ID = "state";
export const CONNECTION_COLUMN_ID = "connection";
export const ADDRESS_COLUMN_ID = "address";

/**
 * The column model.
 *
 * The state anchors the row: it is what somebody scans for, it can never be hidden, and it carries
 * the link out. The address starts hidden because most readers want the register rather than its
 * URL — and it is a column rather than nothing at all, because the reader who wants to copy an
 * address, see which registers share a host, or check one against a bookmark has nowhere else to
 * ask.
 */
export function attorneyLicenseColumns(): GridColumn<AttorneyLicenseRow>[] {
  return [
    {
      id: STATE_COLUMN_ID,
      label: "State",
      type: "text",
      anchored: true,
      value: (row) => row.state,
      // The cell draws the name as a link, whose underline the model's text measure cannot see.
      fitExtra: 8,
    },
    {
      id: "code",
      label: "Code",
      type: "text",
      value: (row) => row.code,
    },
    {
      id: "register",
      label: "Register",
      type: "text",
      value: (row) => row.register,
    },
    {
      id: CONNECTION_COLUMN_ID,
      label: "Connection",
      type: "text",
      filter: "set",
      filterValues: CONNECTION_STANDINGS,
      value: (row) => connectionEntry(row).label,
      // The unencrypted cells carry a badge, whose padding is furniture beyond the word.
      fitExtra: 16,
    },
    {
      id: ADDRESS_COLUMN_ID,
      label: "Address",
      type: "text",
      hidden: true,
      value: (row) => row.searchUrl,
    },
  ];
}

/** Alphabetical by state, which is the order somebody scanning for their own state expects. */
export const ATTORNEY_LICENSE_INITIAL_SORT = {
  columnId: STATE_COLUMN_ID,
  direction: "ascending",
} as const;
