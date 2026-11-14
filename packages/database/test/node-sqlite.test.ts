import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  loadMigrationsFromDisk,
  nodeSqliteBatchDatabase,
} from "../src/node-sqlite.ts";

function freshPerFirmDatabase() {
  const raw = new DatabaseSync(":memory:");
  applyMigrations(raw, loadMigrationsFromDisk("per-firm"));
  return raw;
}

describe("node:sqlite D1-shaped adapter (dev/test only)", () => {
  it("applies the committed per-firm migrations — ledger tables exist", () => {
    const raw = freshPerFirmDatabase();
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((table) => table.name);
    for (const expected of [
      "account_balance",
      "idempotency_key",
      "ledger_account",
      "ledger_entry",
      "ledger_line",
      "outbox",
      "member",
      "role",
      "role_permission",
      "member_role",
      "direct_grant",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("the role seeds actually execute: the default roles with their default grants", () => {
    const raw = freshPerFirmDatabase();
    const roles = raw.prepare("SELECT id, name, parent_role_id FROM role ORDER BY name").all() as {
      id: string;
      name: string;
      parent_role_id: string | null;
    }[];
    // A sub-role reaches its parent's grants through the parent's own member_role row, so "every
    // role carries X" is a claim about the top-level roles.
    const topLevelRoles = roles.filter((row) => row.parent_role_id === null);
    expect(roles.map((row) => row.name)).toEqual([
      "Admin",
      "Associate",
      "Attorney",
      "Billing",
      "Paralegal",
      "Partner",
      "Read-only",
    ]);
    const grants = raw.prepare("SELECT role_id, permission FROM role_permission").all() as {
      role_id: string;
      permission: string;
    }[];
    const grantsFor = (name: string) => {
      const roleId = roles.find((row) => row.name === name)?.id;
      return grants.filter((grant) => grant.role_id === roleId).map((grant) => grant.permission);
    };
    const ownerAdmin = roles.find((row) => row.name === "Admin");
    // firm:manageMembers is seeded onto Admin ONLY.
    expect(grants.filter((grant) => grant.permission === "firm:manageMembers")).toEqual([
      { role_id: ownerAdmin?.id, permission: "firm:manageMembers" },
    ]);
    expect(grantsFor("Attorney")).not.toContain("firm:manageMembers");
    // firm:manageProfile is Admin ONLY, and separately from firm:manageMembers: what the firm
    // is called reaches every invoice and every generated document, so administering who works here
    // does not carry it.
    expect(grants.filter((grant) => grant.permission === "firm:manageProfile")).toEqual([
      { role_id: ownerAdmin?.id, permission: "firm:manageProfile" },
    ]);
    expect(grantsFor("Attorney")).not.toContain("firm:manageProfile");
    // firm:reportIncident is seeded onto EVERY default role — any member may file a diagnostic
    // incident.
    expect(
      grants
        .filter((grant) => grant.permission === "firm:reportIncident")
        .map((grant) => grant.role_id)
        .toSorted(),
    ).toEqual(topLevelRoles.map((row) => row.id).toSorted());
    // notifications:read is likewise seeded onto EVERY default role, Read-only included — the
    // deliberate contrast with trust:read, which stops short of that seat. A member reading their
    // own feed is not a privilege: the read is scoped to the session's own user id and every row is
    // filtered by matter visibility at read time, so the key reveals nothing the member could not
    // already reach.
    expect(
      grants
        .filter((grant) => grant.permission === "notifications:read")
        .map((grant) => grant.role_id)
        .toSorted(),
    ).toEqual(topLevelRoles.map((row) => row.id).toSorted());
    // matters:viewNumbering joins that universal set: how the firm's numbers are shaped is a fact
    // every member reads off every record they open, so seeing the register is not a privilege.
    // Changing it is, and stays matters:manageNumbering (Admin).
    expect(
      grants
        .filter((grant) => grant.permission === "matters:viewNumbering")
        .map((grant) => grant.role_id)
        .toSorted(),
    ).toEqual(topLevelRoles.map((row) => row.id).toSorted());
    // firm:readMembers joins that universal set, and is the deliberate opposite of
    // firm:manageMembers above. Adding a person to the firm is Admin's; knowing who is
    // already in it is every seat's, because a screen that cannot name a colleague prints a raw
    // handle or prints nothing.
    expect(
      grants
        .filter((grant) => grant.permission === "firm:readMembers")
        .map((grant) => grant.role_id)
        .toSorted(),
    ).toEqual(topLevelRoles.map((row) => row.id).toSorted());
    // firm:editOwnProfile joins that universal set on the same reasoning, and is the platform's one
    // self-scoped mutation: it exists because the chokepoint refuses an authenticated write naming
    // no permission, and every statement behind it is scoped to the session's own user id. Writing
    // one's own name is not a privilege — a member who cannot correct the spelling of their own
    // name is the state this closed.
    expect(
      grants
        .filter((grant) => grant.permission === "firm:editOwnProfile")
        .map((grant) => grant.role_id)
        .toSorted(),
    ).toEqual(topLevelRoles.map((row) => row.id).toSorted());
    // The matters/locations/files grants extend the seed per the role distribution.
    expect(grantsFor("Admin")).toContain("matters:create");
    // Configuring the machine that files mail is narrower than filing mail: the two roles that own
    // the correspondence decision carry it by seed, and a paralegal receives it only by an explicit
    // firm grant. It is therefore absent from the Paralegal set asserted exhaustively below.
    expect(grantsFor("Admin")).toContain("emails:manageAutoFileRules");
    expect(grantsFor("Attorney")).toContain("emails:manageAutoFileRules");
    expect(grantsFor("Paralegal")).not.toContain("emails:manageAutoFileRules");
    // Reading every member's assistant conversation is a supervision capability and a separate grant
    // from being able to hold one, so it stops at Admin by seed.
    expect(grantsFor("Admin")).toContain("magnus:readAllConversations");
    expect(grantsFor("Attorney")).not.toContain("magnus:readAllConversations");
    expect(grantsFor("Paralegal")).not.toContain("magnus:readAllConversations");
    expect(grantsFor("Attorney")).toContain("magnus:converse");
    // The authority to act on client money — what the firm's authorization policy can require of
    // whoever lets a disbursement or an earned-fee application go, and the key that changes that
    // policy. Admin and Attorney by seed, deliberately narrower than trust:manage (which also
    // reaches Billing): holding it does nothing until a firm turns the approver-authority option
    // on, and a firm that wants its billing manager to carry authority grants the key.
    expect(grantsFor("Admin")).toContain("trust:authorize");
    expect(grantsFor("Attorney")).toContain("trust:authorize");
    expect(grantsFor("Paralegal")).not.toContain("trust:authorize");
    // Putting the FIRM'S own money into a client trust account is the one deliberate exception to
    // no-commingling, and it is seeded onto Admin alone — narrower than every other trust key,
    // including trust:authorize. An attorney who may release a client's money still may not open the
    // bank-charge carve-out or fund it; a firm that wants that reaches for a direct grant, which
    // leaves a record.
    expect(grants.filter((grant) => grant.permission === "trust:firmFunds")).toEqual([
      { role_id: ownerAdmin?.id, permission: "trust:firmFunds" },
    ]);
    expect(grantsFor("Attorney")).not.toContain("trust:firmFunds");
    expect(grantsFor("Billing")).not.toContain("trust:firmFunds");
    // The reports keys are seeded onto Admin, and two of them onto Partner too, including the two
    // that read money a Billing seat already sees per matter. The narrowness is the point: an
    // aggregate across every matter and client is a different exposure from a per-matter read, and
    // reports:productivity is a supervision surface over people rather than a financial read at all.
    // Partners are the people who supervise and own the firm, so those two reach them; a firm that
    // wants its bookkeeper to run reconciliation packs reaches for a direct grant, which leaves a
    // record.
    const partner = roles.find((row) => row.name === "Partner");
    for (const key of ["reports:trustCompliance", "reports:operational", "reports:produce"]) {
      expect(grants.filter((grant) => grant.permission === key)).toEqual([
        { role_id: ownerAdmin?.id, permission: key },
      ]);
    }
    for (const key of ["reports:financial", "reports:productivity"]) {
      expect(
        grants
          .filter((grant) => grant.permission === key)
          .map((grant) => grant.role_id)
          .toSorted(),
      ).toEqual([ownerAdmin?.id, partner?.id].toSorted());
    }
    // Partner and Associate are sub-roles of Attorney: each names Attorney as its parent, and each
    // carries only what it adds, because a member holding one also holds Attorney itself.
    const attorneyId = roles.find((row) => row.name === "Attorney")?.id;
    expect(partner?.parent_role_id).toBe(attorneyId);
    expect(roles.find((row) => row.name === "Associate")?.parent_role_id).toBe(attorneyId);
    expect(grantsFor("Partner").toSorted()).toEqual(
      [
        "costs:approve",
        "matters:reopen",
        "reports:financial",
        "reports:productivity",
        "time:approve",
        "time:viewFirm",
      ].toSorted(),
    );
    expect(grantsFor("Associate")).toEqual([]);
    for (const key of grantsFor("Partner")) expect(grantsFor("Attorney")).not.toContain(key);
    expect(roles.filter((row) => row.parent_role_id !== null).map((row) => row.name)).toEqual([
      "Associate",
      "Partner",
    ]);
    // Discovery is its own namespace, and that is the access rule: holding matters:* or files:* on
    // a matter reaches no review set on it. Billing and Read-only carry none of the five keys —
    // material produced by another party may be attorney's-eyes-only under a protective order.
    // Intake: reading a checklist and recording a step reach every working seat, Billing included
    // (the retainer arriving is a clerk's own fact to record); waiving a required step and authoring
    // the procedure stop at Admin and Attorney; Read-only carries none.
    for (const key of ["intake:read", "intake:record"]) {
      expect(grantsFor("Admin")).toContain(key);
      expect(grantsFor("Attorney")).toContain(key);
      expect(grantsFor("Paralegal")).toContain(key);
      expect(grantsFor("Billing")).toContain(key);
      expect(grantsFor("Read-only")).not.toContain(key);
    }
    for (const key of ["intake:waive", "intake:manageProcedures"]) {
      expect(
        grants
          .filter((grant) => grant.permission === key)
          .map((grant) => grant.role_id)
          .toSorted(),
      ).toEqual(
        [
          roles.find((row) => row.name === "Admin")?.id,
          roles.find((row) => row.name === "Attorney")?.id,
        ].toSorted(),
      );
    }
    expect(grantsFor("Attorney")).toContain("discovery:load");
    expect(grantsFor("Attorney")).toContain("discovery:review");
    expect(grantsFor("Attorney")).toContain("discovery:produce");
    expect(grantsFor("Billing")).not.toContain("discovery:read");
    expect(grantsFor("Billing")).not.toContain("discovery:review");
    expect(grantsFor("Read-only")).not.toContain("discovery:read");
    expect(grantsFor("Read-only")).not.toContain("discovery:review");
    expect(grantsFor("Admin")).toEqual(expect.arrayContaining(["esign:send", "esign:sign"]));
    expect(grantsFor("Attorney")).toEqual(expect.arrayContaining(["esign:send", "esign:sign"]));
    expect(grantsFor("Billing")).not.toContain("esign:send");
    // Paralegal carries the practitioner set: file/matter work plus the firm-wide tools. The
    // firm-wide tool grants (whois/safeBrowse, scanFile, metadataScrubber, fileIntegrity,
    // fileTypeVerifier, aiTextDetection, decryption, fileRepair, ocr) and support:request are
    // seeded to every role; for aiTextDetection the consent setting, not the permission, gates
    // egress.
    // conflicts:read and conflicts:run are broad, everyday capabilities (any member may screen a
    // consultation or read back a completed check) and are likewise seeded to every role;
    // conflicts:dispose is narrower (adjudicating a hit) and stays limited to Admin and
    // Attorney, so it is absent here.
    expect(grantsFor("Paralegal").toSorted()).toEqual(
      [
        // Assembling a working bill asserts nothing to anybody, so billing:draft reaches the
        // practitioner set; turning one into evidence (billing:finalize) does not.
        "billing:draft",
        "billing:read",
        // A paralegal docketing a hearing is the ordinary case, so this role carries both calendar
        // keys; Billing and Read-only get calendar:read alone.
        "calendar:manage",
        "calendar:read",
        // A paralegal records the firm's calls and texts and works the queue of ones nobody has
        // filed — which is reception's job in most firms, and is why reviewUnrouted reaches this
        // seat and not Attorney.
        "communications:log",
        "communications:read",
        "communications:reviewUnrouted",
        "conflicts:read",
        "conflicts:run",
        "costs:track",
        // A paralegal files originals into the safe and takes them back out, so this role carries
        // both custody keys; Billing and Read-only get custody:read alone.
        "custody:manage",
        "custody:read",
        // All five discovery keys reach the seats that do case work, and none of them reaches
        // Billing or Read-only. They are five keys rather than one so a firm can take four away —
        // a contract reviewer under a protective order holds discovery:read and discovery:review —
        // and the namespace is what carries the access rule: a review set is reachable from a
        // discovery grant and from nothing else, never from matters:* or files:*. Even then the
        // grant is not sufficient on its own: the review set's own access list is checked beside it.
        "discovery:load",
        "discovery:manageReviewSets",
        "discovery:produce",
        "discovery:read",
        "discovery:review",
        "documents:assemble",
        // Editing a document in the browser and taking it away to edit offline reach the same three
        // content-writing seats files:upload and documents:assemble do — typing a new version and
        // uploading one are the same act through two doors. What this seat does NOT get is
        // documents:reconcile (choosing which of two divergent copies is the firm's text of record)
        // or documents:forceReleaseLock (displacing a colleague's hold), so both are absent here.
        "documents:checkout",
        "documents:edit",
        // The download shelf is where a generated file waits to be collected, and it reaches every
        // default role: a member who could ask for the file is the member who collects it.
        "downloads:shelf",
        "emails:file",
        "emails:manageLinks",
        "emails:read",
        // A paralegal prepares and sends a document for signature as ordinary work, and signs one too.
        "esign:send",
        "esign:sign",
        "files:organize",
        "files:upload",
        // Writing one's own name reaches every seat, Read-only included: it is the platform's
        // one self-scoped mutation, and every statement behind it is scoped to the session's
        // own user id.
        "firm:editOwnProfile",
        "firm:readMembers",
        "firm:reportIncident",
        "firm:scanFile",
        "intake:read",
        "intake:record",
        // The assistant reaches the seats that do legal work. Seeding the key turns nothing on:
        // both firm-level consent settings default closed and every route reads them first.
        // magnus:readAllConversations is Admin only, so it is absent here.
        "magnus:converse",
        // Logging what an estate owns is the paralegal's job, so this role carries both asset keys.
        // Unlike custody:read and calendar:read, neither reaches Billing or Read-only by seed: the
        // register concentrates a matter's financially sensitive facts in one surface, so a firm
        // that wants its bookkeeper on it grants that deliberately.
        "matterAssets:manage",
        "matterAssets:read",
        "matters:create",
        // How the firm's numbers are shaped is a fact every seat reads off every record, so the
        // register's read reaches every role; changing it stays Admin.
        "matters:viewNumbering",
        // Meetings follow the call log: a paralegal convenes the settlement conference and is in it,
        // so this seat carries both keys, where Billing joins and does not host.
        "meetings:host",
        "meetings:join",
        // meetings:record is seeded to exactly the seats that hold meetings:host, so no firm's
        // behaviour changes the day it lands (20261110T000101_meeting-recording-and-who-was-told).
        "meetings:record",
        // A paralegal writes the note about the call they took, so this role carries both note keys.
        // Deleting rides notes:write rather than taking a key of its own: a member trusted to write
        // the firm's record of a case is trusted to remove what should not be in it. Billing and
        // Read-only carry neither, which is the deliberate contrast with calendar:read reaching
        // every seat — a note is the firm's candid assessment of a case.
        "notes:read",
        "notes:write",
        "notifications:read",
        // Consolidated matter search reaches every seat, and it discloses nothing by doing
        // so: each source behind it is checked against the reader's own capabilities before a
        // statement is built, so a seat without notes:read gets no note back from it.
        "search:matter",
        "support:request",
        // All three task keys reach the practitioner set. tasks:assign is separate from tasks:write
        // so a firm CAN reserve who puts work in other people's names, but it is seeded here because
        // paralegals and attorneys delegate to each other constantly and a default that made them
        // ask an administrator would be routed around on the first day. Billing carries read and
        // write but not assign; Read-only carries none.
        "tasks:assign",
        "tasks:read",
        "tasks:write",
        "tools:aiTextDetection",
        "tools:decryption",
        "tools:emailInspector",
        "tools:fileIntegrity",
        "tools:fileRepair",
        "tools:fileTypeVerifier",
        "tools:fileWorkbench",
        "tools:metadataScrubber",
        "tools:ocr",
        "tools:safeBrowse",
        "tools:speedTest",
        // A paralegal answers "how much of this client's money do we hold"; moving it is
        // trust:manage, which they deliberately do not have.
        "trust:read",
        "tools:legalCitations",
        "tools:whois",
        // The four public-record link libraries reach every default role: they open a government
        // or listing website in a new tab, read nothing of the firm's, hold no credential and
        // store nothing. tools:shipping is the contrast and is Admin alone, matching the
        // shipping:manage key that gates every operation behind the tile.
        "tools:attorneyLicense",
        "tools:businessLookup",
        "tools:propertyListings",
        "tools:propertyRecords",
      ].toSorted(),
    );
    // Billing and Read-only carry only the every-role set (firm:reportIncident, the firm-wide
    // tools, support:request, conflicts:read/run, custody:read, emails:read); Billing additionally
    // carries costs:approve and both trust keys. custody:read is deliberately in the every-role set:
    // "do we hold the deed for this client" is a question a billing clerk legitimately asks, and
    // custody:manage — which moves originals — is exactly what they must not have. The trust keys go
    // the other way: a bookkeeper is exactly who records trust activity, so Billing carries both,
    // and Read-only carries neither.
    expect(grantsFor("Billing").toSorted()).toEqual(
      [
        // A billing clerk assembles the bill and records the money that comes back against it; the
        // approval that turns a draft into evidence is a partner's, so billing:finalize is absent.
        "billing:apply",
        "billing:draft",
        "billing:read",
        "calendar:read",
        // "Did anyone ever reach this client about the unpaid invoice" is a question a billing clerk
        // has to answer, and the log's metadata answers it. Recording a call is not their job and
        // the queue is not theirs to work, so neither of the other two keys is here.
        "communications:read",
        "conflicts:read",
        "conflicts:run",
        "costs:approve",
        "custody:read",
        // The download shelf reaches every default role: whoever could ask for a generated file is
        // whoever collects it.
        "downloads:shelf",
        "emails:read",
        "esign:sign",
        // Writing one's own name reaches every seat, Read-only included: it is the platform's
        // one self-scoped mutation, and every statement behind it is scoped to the session's
        // own user id.
        "firm:editOwnProfile",
        "firm:readMembers",
        "firm:reportIncident",
        "firm:scanFile",
        "intake:read",
        "intake:record",
        // The numbering register's read reaches every seat, on notifications:read's reasoning.
        "matters:viewNumbering",
        // Being in the meeting about an unpaid invoice is ordinary work for this seat, on the same
        // line communications:read sits on directly above. Convening one is not, so meetings:host
        // is absent — the pair matches the read/log split exactly.
        "meetings:join",
        "notifications:read",
        "search:matter",
        "support:request",
        // Billing carries read and write but NOT assign. "Chase the Henderson retainer
        // replenishment" is a billing clerk's own work and a task list that cannot hold it sends
        // them to a spreadsheet; putting work in a lawyer's name is the act the third key reserves.
        "tasks:read",
        "tasks:write",
        "trust:manage",
        "trust:read",
        "tools:aiTextDetection",
        "tools:decryption",
        "tools:emailInspector",
        "tools:fileIntegrity",
        "tools:fileRepair",
        "tools:fileTypeVerifier",
        "tools:fileWorkbench",
        "tools:metadataScrubber",
        "tools:ocr",
        "tools:safeBrowse",
        "tools:speedTest",
        "tools:legalCitations",
        "tools:whois",
        // The four public-record link libraries reach every default role: they open a government
        // or listing website in a new tab, read nothing of the firm's, hold no credential and
        // store nothing. tools:shipping is the contrast and is Admin alone, matching the
        // shipping:manage key that gates every operation behind the tile.
        "tools:attorneyLicense",
        "tools:businessLookup",
        "tools:propertyListings",
        "tools:propertyRecords",
      ].toSorted(),
    );
    expect(grantsFor("Read-only").toSorted()).toEqual(
      [
        // calendar:read reaches every default role, custody:read's line: "when is the hearing" is a
        // question every seat in a firm asks, and a case timeline some seats cannot see is one that
        // gets kept in a spreadsheet instead. Asserting when a hearing IS stays calendar:manage.
        "calendar:read",
        "conflicts:read",
        "conflicts:run",
        "custody:read",
        "downloads:shelf",
        "emails:read",
        // Signing what the firm sends one is every seat's own act, the way an outside signer's is.
        "esign:sign",
        // Writing one's own name reaches every seat, Read-only included: it is the platform's
        // one self-scoped mutation, and every statement behind it is scoped to the session's
        // own user id.
        "firm:editOwnProfile",
        "firm:readMembers",
        "firm:reportIncident",
        "firm:scanFile",
        // The numbering register's read reaches every seat, on notifications:read's reasoning.
        "matters:viewNumbering",
        // Read-only carries it, where trust:read deliberately stops one seat short. The two are not
        // the same kind of read: a trust ledger is the record of money the firm holds for other
        // people, where a notification feed is the member's own, scoped to their own user id and
        // filtered by matter visibility before it returns a row.
        "notifications:read",
        "search:matter",
        "support:request",
        "tools:aiTextDetection",
        "tools:decryption",
        "tools:emailInspector",
        "tools:fileIntegrity",
        "tools:fileRepair",
        "tools:fileTypeVerifier",
        "tools:fileWorkbench",
        "tools:metadataScrubber",
        "tools:ocr",
        "tools:safeBrowse",
        "tools:speedTest",
        "tools:legalCitations",
        "tools:whois",
        // The four public-record link libraries reach every default role: they open a government
        // or listing website in a new tab, read nothing of the firm's, hold no credential and
        // store nothing. tools:shipping is the contrast and is Admin alone, matching the
        // shipping:manage key that gates every operation behind the tile.
        "tools:attorneyLicense",
        "tools:businessLookup",
        "tools:propertyListings",
        "tools:propertyRecords",
      ].toSorted(),
    );
  });

  it("prepare/bind/run/all round-trips and batch() is atomic (all-or-nothing)", async () => {
    const raw = freshPerFirmDatabase();
    const database = nodeSqliteBatchDatabase(raw);
    const goodInsert = database
      .prepare(
        "INSERT INTO ledger_account (id, name, type, currency, active, created_at) VALUES (?1, ?2, 'asset', 'USD', 1, ?3)",
      )
      .bind("ledgerAccount_aaaaaaaaaaaaaaaaaaaaa", "Operating Bank", "2026-01-05T09:00:00.000Z");
    // Second statement violates the name CHECK — the whole batch must roll back.
    const badInsert = database
      .prepare(
        "INSERT INTO ledger_account (id, name, type, currency, active, created_at) VALUES (?1, ?2, 'asset', 'USD', 1, ?3)",
      )
      .bind("ledgerAccount_bbbbbbbbbbbbbbbbbbbbb", "", "2026-01-05T09:00:00.000Z");
    await expect(database.batch([goodInsert, badInsert])).rejects.toThrow(/CHECK/);
    const { results } = await database
      .prepare("SELECT COUNT(*) AS n FROM ledger_account")
      .bind()
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(0); // nothing committed
  });

  it("the control-plane baseline lands the firm lifecycle constraints (status default, nullable database_identifier, UNIQUE name)", () => {
    const raw = new DatabaseSync(":memory:");
    applyMigrations(raw, loadMigrationsFromDisk("control-plane"));
    // The provisioning lifecycle inserts the firm row before a database exists: database_identifier
    // is nullable and status defaults to 'active'.
    const insertNameOnly = raw.prepare(
      "INSERT INTO firm (id, name, status, created_at) VALUES (?, ?, ?, ?)",
    );
    insertNameOnly.run(
      "firm_aaaaaaaaaaaaaaaaaaaaa",
      "Provisioning Firm",
      "provisioning",
      "2026-01-05T09:00:00.000Z",
    );
    const row = raw
      .prepare(
        "SELECT status, bucket_name, owner_user_id, database_identifier FROM firm WHERE name = ?",
      )
      .get("Provisioning Firm") as {
      status: string;
      bucket_name: string | null;
      owner_user_id: string | null;
      database_identifier: string | null;
    };
    expect(row).toEqual({
      status: "provisioning",
      bucket_name: null,
      owner_user_id: null,
      database_identifier: null,
    });
    // status defaults to 'active' when omitted.
    raw
      .prepare("INSERT INTO firm (id, name, created_at) VALUES (?, ?, ?)")
      .run("firm_ddddddddddddddddddddd", "Active Firm", "2026-01-05T09:00:00.000Z");
    const active = raw.prepare("SELECT status FROM firm WHERE name = ?").get("Active Firm") as {
      status: string;
    };
    expect(active.status).toBe("active");
    // UNIQUE(name) holds.
    expect(() =>
      insertNameOnly.run(
        "firm_bbbbbbbbbbbbbbbbbbbbb",
        "Provisioning Firm",
        "provisioning",
        "2026-01-05T09:00:00.000Z",
      ),
    ).toThrow(/UNIQUE/);
  });

  it("run() outside a batch autocommits independently", async () => {
    const raw = freshPerFirmDatabase();
    const database = nodeSqliteBatchDatabase(raw);
    const { meta } = await database
      .prepare(
        "INSERT INTO ledger_account (id, name, type, currency, active, created_at) VALUES (?1, ?2, 'asset', 'USD', 1, ?3)",
      )
      .bind("ledgerAccount_ccccccccccccccccccccc", "Trust Bank", "2026-01-05T09:00:00.000Z")
      .run();
    expect(meta.changes).toBe(1);
    // Visible immediately through the raw handle — committed, not held in an open transaction.
    const row = raw
      .prepare("SELECT name FROM ledger_account WHERE id = ?")
      .get("ledgerAccount_ccccccccccccccccccccc") as { name: string };
    expect(row.name).toBe("Trust Bank");
  });
});
