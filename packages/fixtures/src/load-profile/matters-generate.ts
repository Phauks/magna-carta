import {
  commitEffectBatch,
  type BatchDatabase,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FileId,
  FolderId,
  LocationId,
  MatterId,
  MatterTypeId,
  UserId,
} from "@magna-carta/identifiers/types";
import { commitVersion, initiateUpload } from "@magna-carta/file-manager/file-service";
import { createFolder } from "@magna-carta/file-manager/folder-service";
import { firmDefaultLocationDefinition } from "@magna-carta/locations/settings";
import {
  assignMemberLocations,
  createLocation,
  setLocationAddresses,
} from "@magna-carta/locations/location-service";
import { createMatter, openMatter } from "@magna-carta/matters/matter-service";
import { closeMatter } from "@magna-carta/matters/matter-service";
import { createMatterType } from "@magna-carta/matters/matter-type-service";
import { setActiveNumberingScheme } from "@magna-carta/sequence-numbering/scheme-service";
import type { NumberSegment } from "@magna-carta/sequence-numbering/segments";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { PracticeVolume } from "./profile.ts";

// The practice volume (matters / locations / file-manager): offices, matter types, the active
// numbering scheme, matters across the lifecycle, and the folder/file tree with committed clean
// versions. Every write rides a REAL domain
// service (createLocation/createMatter/openMatter/createFolder/initiateUpload/commitVersion, plus the
// member-mirror and firm-setting statement builders the outbox consumer and settings accessor use) —
// valid at any scale by construction. All randomness is drawn from the one FixtureContext; the module
// reads no wall-clock and calls no external service.
//
// The R2 blob layer is MODELED, not stored: node:sqlite has no R2 binding. A committed version's
// size/hash/sniffed-type are synthesized deterministically, and the file/file_version/storage_meter
// rows they write are the queryable shadow of the R2 objects a production read would resolve against.

// Probe identifiers the matters measurement layer binds real queries to — deterministic for a given
// profile + seed, recorded in the snapshot manifest.
export interface PracticeProbes {
  readonly busiestMatterId: MatterId; // the matter with the most clean files — the hot list/ZIP target
  readonly busyFolderId: FolderId; // a folder holding several files
  readonly multiVersionFileId: FileId; // a file with several committed clean versions
  readonly responsibleMemberId: UserId; // the attorney owning the most consultations + matters
  readonly listLocationId: LocationId; // a location used as a list filter
  readonly listMatterTypeId: MatterTypeId; // a matter type used as a list filter
  readonly storageMeterPrefix: string; // the prefix the firm's storage_meter rows roll up under
}

export interface PracticeGenerationResult {
  readonly matterCount: number;
  readonly fileCount: number;
  readonly fileVersionCount: number;
  readonly folderCount: number;
  readonly probes: PracticeProbes;
}

const MATTER_TYPE_NAMES = [
  "Personal Injury",
  "Family Law",
  "Real Estate",
  "Estate Planning",
  "Corporate",
  "Criminal Defense",
  "Employment",
  "Immigration",
  "Bankruptcy",
  "Intellectual Property",
] as const;

const DOCUMENT_NAMES = [
  "Engagement Letter",
  "Complaint",
  "Answer",
  "Motion",
  "Discovery Request",
  "Deposition Transcript",
  "Settlement Agreement",
  "Correspondence",
  "Invoice",
  "Memorandum",
] as const;

const FOLDER_NAMES = [
  "Pleadings",
  "Correspondence",
  "Discovery",
  "Billing",
  "Research",
  "Client Documents",
  "Court Filings",
  "Internal Notes",
] as const;

// A location-scoped year+counter scheme: the counter resets per office, so opening matters across
// offices exercises distinct counter scopes (the draw path the busy measurement targets).
const NUMBERING_SCHEME: readonly NumberSegment[] = [
  { kind: "location_code", scoping: true },
  { kind: "literal", text: "-" },
  { kind: "year", digits: 4 },
  { kind: "literal", text: "-" },
  { kind: "counter", padWidth: 4 },
];

// Generate the practice volume on the same FixtureContext the ledger generation used.
export async function generatePracticeVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: PracticeVolume,
  options: SeedingOptions,
): Promise<PracticeGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const serviceOptions = { clock, actorUserId: null, randomSource };
  const commit = (effect: EffectWrite) =>
    commitEffectBatch(database, effect, { now: () => clock.now() });

  // --- Responsible members: mirror a handful of attorneys (the responsible_member_id every matter
  // carries). The mirror statement is the real outbox-consumer write path. ---
  const memberCount = Math.max(2, Math.round(volume.openMatterCount / 60));
  const members: UserId[] = [];
  for (let index = 0; index < memberCount; index += 1) {
    const userId = newIdentifier("user", randomSource);
    await database.batch([
      insertMemberStatement(database, {
        userId,
        displayName: faker.person.fullName(),
        now: clock.now(),
      }),
    ]);
    members.push(userId);
  }
  const pickMember = (): UserId => members[faker.number.int({ min: 0, max: members.length - 1 })]!;

  // --- Offices: each with a unique number code (the scheme's scoping segment), addresses, and one
  // assigned member. The first office is the firm default. ---
  const locations: { id: LocationId; code: string }[] = [];
  for (let index = 0; index < volume.locationCount; index += 1) {
    const code = `L${String(index + 1).padStart(2, "0")}`;
    const city = faker.location.city();
    const { locationId, effect } = await createLocation(
      database,
      { name: `${city} Office`, jurisdiction: faker.location.state(), numberCode: code },
      serviceOptions,
    );
    await commit(effect);
    const addresses = await setLocationAddresses(
      database,
      locationId,
      [
        {
          kind: "physical",
          street: faker.location.streetAddress(),
          city,
          region: faker.location.state({ abbreviated: true }),
          postal: faker.location.zipCode(),
          phone: faker.phone.number(),
        },
      ],
      serviceOptions,
    );
    await commit(addresses.effect);
    locations.push({ id: locationId, code });
  }
  // Assign each member to one office (the first is their primary).
  for (const member of members) {
    const office = locations[faker.number.int({ min: 0, max: locations.length - 1 })]!;
    const assignment = await assignMemberLocations(
      database,
      member,
      [{ locationId: office.id, isPrimary: true }],
      serviceOptions,
    );
    await commit(assignment.effect);
  }
  // The firm default office — the fallback the location-scoped scheme resolves against.
  await database.batch([
    writeFirmSettingStatement(
      database,
      firmDefaultLocationDefinition,
      locations[0]!.id,
      clock.now(),
    ),
  ]);

  // --- Matter types: a slice of the canonical practice areas. ---
  const matterTypes: MatterTypeId[] = [];
  for (let index = 0; index < volume.matterTypeCount; index += 1) {
    const name = MATTER_TYPE_NAMES[index % MATTER_TYPE_NAMES.length]!;
    const { matterTypeId, effect } = await createMatterType(
      database,
      // Distinct name/code across the run even past the canonical list (name/code are UNIQUE).
      { name: index < MATTER_TYPE_NAMES.length ? name : `${name} ${index}`, code: `T${index + 1}` },
      serviceOptions,
    );
    await commit(effect);
    matterTypes.push(matterTypeId);
  }

  // --- The one active numbering scheme. ---
  const scheme = setActiveNumberingScheme(database, NUMBERING_SCHEME, serviceOptions);
  await commit(scheme.effect);

  // The number context the route would assemble: the office code drives the scoping segment.
  const numberContextFor = (office: { code: string }) => ({ locationCode: office.code });
  const pickOffice = () => locations[faker.number.int({ min: 0, max: locations.length - 1 })]!;
  const pickType = () => matterTypes[faker.number.int({ min: 0, max: matterTypes.length - 1 })]!;

  // The responsible member the probes point at: the first member, deliberately given the heaviest
  // share so its consultations + caseload list reads are the volume-shaped hot case.
  const probeMember = members[0]!;
  // Roughly a third of matters land on the probe member; the rest spread across the others.
  const responsibleFor = (): UserId =>
    faker.number.int({ min: 0, max: 2 }) === 0 ? probeMember : pickMember();

  let matterCount = 0;
  const matterShape = (matterId: MatterId, office: { id: LocationId; code: string }) => ({
    matterId,
    locationId: office.id,
  });
  // Track the file count per matter so the busiest-matter probe is honest.
  const matterFiles: { matterId: MatterId; locationId: LocationId; files: number }[] = [];

  const newMatter = async (
    status: "consultation" | "open",
    responsibleMemberId: UserId,
  ): Promise<{ matterId: MatterId; locationId: LocationId }> => {
    const office = pickOffice();
    const title = `${faker.person.lastName()} v. ${faker.person.lastName()}`;
    const created = await createMatter(
      database,
      {
        title,
        responsibleMemberId,
        status,
        matterTypeId: pickType(),
        locationId: office.id,
        clientDisplayName: faker.company.name(),
        clientCode: faker.string.alphanumeric({ length: 6, casing: "upper" }),
        numberContext: status === "open" ? numberContextFor(office) : undefined,
      },
      serviceOptions,
    );
    matterCount += 1;
    return matterShape(created.matterId, office);
  };

  // Consultations (no matter number, the matter counter untouched). The probe member owns the lion's share.
  for (let index = 0; index < volume.consultationMatterCount; index += 1) {
    await newMatter("consultation", responsibleFor());
  }

  // Open matters: createMatter status 'open' draws the number through the counter at creation.
  for (let index = 0; index < volume.openMatterCount; index += 1) {
    const matter = await newMatter("open", responsibleFor());
    matterFiles.push({ matterId: matter.matterId, locationId: matter.locationId, files: 0 });
  }

  // Closed matters: open at a number, then close. A closed matter still resolves in the caseload list.
  for (let index = 0; index < volume.closedMatterCount; index += 1) {
    // Open through the consultation→open draw path so the counter is exercised on its own (openMatter).
    const office = pickOffice();
    const consultation = await createMatter(
      database,
      {
        title: `${faker.person.lastName()} Estate`,
        responsibleMemberId: responsibleFor(),
        status: "consultation",
        matterTypeId: pickType(),
        locationId: office.id,
        clientDisplayName: faker.company.name(),
        clientCode: faker.string.alphanumeric({ length: 6, casing: "upper" }),
      },
      serviceOptions,
    );
    matterCount += 1;
    await openMatter(
      database,
      consultation.matterId,
      { numberContext: numberContextFor(office) },
      serviceOptions,
    );
    await closeMatter(database, consultation.matterId, serviceOptions);
    matterFiles.push({ matterId: consultation.matterId, locationId: office.id, files: 0 });
  }

  // --- The folder/file tree. Only matters that carry a number (open/closed) get documents; a
  // consultation has none yet. ---
  let folderCount = 0;
  let fileCount = 0;
  let fileVersionCount = 0;
  let busyFolderId: FolderId | null = null;
  let busyFolderFiles = -1;
  let multiVersionFileId: FileId | null = null;
  let multiVersionCount = -1;

  const randomFolderName = () =>
    FOLDER_NAMES[faker.number.int({ min: 0, max: FOLDER_NAMES.length - 1 })]!;

  for (const matter of matterFiles) {
    // Folders under the matter root (flat; names unique per matter via the set we pick from).
    const folderTarget = faker.number.int({
      min: volume.foldersPerMatter.min,
      max: volume.foldersPerMatter.max,
    });
    const usedNames = new Set<string>();
    const folders: FolderId[] = [];
    for (let index = 0; index < folderTarget; index += 1) {
      let name: string = randomFolderName();
      while (usedNames.has(name)) name = `${randomFolderName()} ${index}`;
      usedNames.add(name);
      const { folderId, effect } = await createFolder(
        database,
        { matterId: matter.matterId, name },
        serviceOptions,
      );
      await commit(effect);
      folders.push(folderId);
      folderCount += 1;
    }

    const fileTarget = faker.number.int({
      min: volume.filesPerMatter.min,
      max: volume.filesPerMatter.max,
    });
    const folderFileTally = new Map<FolderId, number>();
    for (let index = 0; index < fileTarget; index += 1) {
      // A file lands in a matter folder (most of the time) or the matter root.
      const folderId =
        folders.length > 0 && faker.number.int({ min: 0, max: 9 }) > 1
          ? folders[faker.number.int({ min: 0, max: folders.length - 1 })]!
          : null;
      const docName = DOCUMENT_NAMES[faker.number.int({ min: 0, max: DOCUMENT_NAMES.length - 1 })]!;
      const fileName = `${docName} ${index + 1}.pdf`;

      const versionTarget = faker.number.int({
        min: volume.versionsPerFile.min,
        max: volume.versionsPerFile.max,
      });
      let fileId: FileId | undefined;
      for (let versionIndex = 0; versionIndex < versionTarget; versionIndex += 1) {
        const initiated = await initiateUpload(
          database,
          {
            matterId: matter.matterId,
            folderId,
            name: fileName,
            declaredSize: null,
            declaredContentType: "application/pdf",
            uploadedBy: null,
            mode: "put",
            fileId, // present on versions 2+ — a new version on the same file
          },
          serviceOptions,
        );
        await commit(initiated.effect);
        fileId = initiated.fileId;
        // Synthetic but deterministic version facts — the modeled R2 blob. A distinct hash per
        // version keeps every version a real new commit (the no-op hash-skip never fires).
        const sizeBytes = faker.number.int({
          min: volume.fileSizeBytes.min,
          max: volume.fileSizeBytes.max,
        });
        const contentSha256 = faker.string.hexadecimal({ length: 64, prefix: "", casing: "lower" });
        const committed = await commitVersion(
          database,
          {
            versionId: initiated.versionId,
            sizeBytes,
            sniffedContentType: "application/pdf",
            contentSha256,
            // A deterministic mix: a fraction await the scan engine (scan_verdict='unscanned'), the rest
            // are already scanned clean — the data shape the weekly re-scan sweep's find-unscanned batch
            // reads against. Status stays 'clean' either way (an unscanned commit is still visible).
            scanVerdict:
              faker.number.float() < volume.unscannedVersionFraction ? "unscanned" : "clean",
            scanEngineVersion: null,
            scanDetail: null,
            now: clock.now(),
          },
          serviceOptions,
        );
        await commit(committed.effect);
        fileVersionCount += 1;
        clock.advanceMinutes(1);
      }
      fileCount += 1;
      matter.files += 1;
      if (fileId !== undefined && versionTarget > multiVersionCount) {
        multiVersionCount = versionTarget;
        multiVersionFileId = fileId;
      }
      if (folderId !== null) {
        const tally = (folderFileTally.get(folderId) ?? 0) + 1;
        folderFileTally.set(folderId, tally);
        if (tally > busyFolderFiles) {
          busyFolderFiles = tally;
          busyFolderId = folderId;
        }
      }
    }
  }

  // The busiest matter by clean-file count — the hot list/ZIP target.
  let busiest = matterFiles[0]!;
  for (const matter of matterFiles) {
    if (matter.files > busiest.files) busiest = matter;
  }
  if (busyFolderId === null) {
    throw new Error("load-profile: practice volume generated no folder holding a file");
  }
  if (multiVersionFileId === null) {
    throw new Error("load-profile: practice volume generated no file");
  }

  return {
    matterCount,
    fileCount,
    fileVersionCount,
    folderCount,
    probes: {
      busiestMatterId: busiest.matterId,
      busyFolderId,
      multiVersionFileId,
      responsibleMemberId: probeMember,
      listLocationId: locations[0]!.id,
      listMatterTypeId: matterTypes[0]!,
      // Every committed version meters under the "files" prefix (FILES_PREFIX / 'original' / standard).
      storageMeterPrefix: "files",
    },
  };
}
