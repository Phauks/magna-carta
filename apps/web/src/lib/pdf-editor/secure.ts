/*
 * Protecting a PDF before it goes out: what the file already carries, and the password and
 * permissions the protected copy will have.
 *
 * THE READINGS ARE COUNTS, NEVER CONTENT. The engine's check for hidden text hands back the words it
 * recovered, and those words can be exactly what someone tried to withhold. Only how many places
 * of each kind it found crosses into this module, so the screen can say "3 places" and never what
 * they say.
 *
 * Protecting is the engine's `secureDocument`: AES-256 by default, AES-128 for older readers, never
 * RC4. A password to change permissions is always set, because permissions without one are a
 * request any reader may ignore; the screen makes one when the reader does not.
 */
import type {
  DetectionFinding,
  SecureOptions,
  SecurityInfo,
  SecurityPermissions,
} from "@magna-carta/pdf";

/** What the file carries, counted. Built in the worker from the engine's readings. */
export interface DocumentReadings {
  readonly encrypted: boolean;
  /** Places where text is covered, invisible, white on white, or left behind outside the page. */
  readonly hiddenText: number;
  /** Comments and other notes a reader can delete. */
  readonly comments: number;
  /** Places the metadata says more than the pages do. */
  readonly metadata: number;
  /** Layers switched off, which can hold content nobody sees. */
  readonly hiddenLayers: number;
  /** Form fields holding an answer. */
  readonly filledFormFields: number;
}

/** Count the engine's findings by kind. The recovered text on each finding is not kept. */
export function countReadings(
  security: Pick<SecurityInfo, "encrypted">,
  findings: readonly Pick<DetectionFinding, "category">[],
  formValues: readonly unknown[],
): DocumentReadings {
  const count = (categories: readonly DetectionFinding["category"][]): number =>
    findings.filter((finding) => categories.includes(finding.category)).length;
  return {
    encrypted: security.encrypted,
    hiddenText: count(["coveredText", "invisibleText", "whiteoutText", "orphanedText"]),
    comments: count(["removableAnnotation"]),
    metadata: count(["metadataLeak"]),
    hiddenLayers: count(["hiddenLayer"]),
    filledFormFields: formValues.filter(
      (value) => value !== null && value !== "" && value !== false,
    ).length,
  };
}

/** The four things a recipient may be allowed to do, as the screen offers them. */
export interface RecipientPermissions {
  readonly print: boolean;
  readonly copy: boolean;
  readonly editAndFill: boolean;
  readonly comment: boolean;
}

export const DEFAULT_PERMISSIONS: RecipientPermissions = {
  print: true,
  copy: false,
  editAndFill: false,
  comment: true,
};

export interface SecureSettings {
  readonly openPassword: string;
  readonly permissionsPassword: string;
  readonly permissions: RecipientPermissions;
  readonly algorithm: "aes256" | "aes128";
  /** Remove metadata, attachments, form values, bookmarks and layers before protecting. */
  readonly scrubFirst: boolean;
}

export const DEFAULT_SECURE: SecureSettings = {
  openPassword: "",
  permissionsPassword: "",
  permissions: DEFAULT_PERMISSIONS,
  algorithm: "aes256",
  scrubFirst: true,
};

/** The shortest password the screen accepts. Shorter is guessed in moments, encrypted or not. */
export const MINIMUM_PASSWORD_LENGTH = 8;

/** What is wrong with the settings, field by field. Empty means the engine can be asked. */
export function secureProblems(
  settings: SecureSettings,
): Partial<Record<"openPassword" | "permissionsPassword", string>> {
  const problems: Partial<Record<"openPassword" | "permissionsPassword", string>> = {};
  if (settings.openPassword !== "" && settings.openPassword.length < MINIMUM_PASSWORD_LENGTH) {
    problems.openPassword = `Use at least ${MINIMUM_PASSWORD_LENGTH} characters, or leave it empty.`;
  }
  if (
    settings.permissionsPassword !== "" &&
    settings.permissionsPassword.length < MINIMUM_PASSWORD_LENGTH
  ) {
    problems.permissionsPassword = `Use at least ${MINIMUM_PASSWORD_LENGTH} characters, or leave it empty to have one made.`;
  } else if (
    settings.permissionsPassword !== "" &&
    settings.permissionsPassword === settings.openPassword
  ) {
    problems.permissionsPassword =
      "Use a different password from the open password, or anyone who can open it can change it.";
  }
  return problems;
}

/** A long random password, for a permissions password the reader did not set. */
export function madePassword(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = random(new Uint8Array(24));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/** The engine's options. `permissionsPassword` is the one actually used, made if left empty. */
export function secureOptions(
  settings: SecureSettings,
  permissionsPassword: string,
): SecureOptions {
  const permissions: Partial<SecurityPermissions> = {
    print: settings.permissions.print,
    printHighRes: settings.permissions.print,
    copy: settings.permissions.copy,
    // Copying for a screen reader stays allowed whatever else is refused: refusing it shuts out
    // a reader who is blind and stops nobody else.
    accessibilityCopy: true,
    modify: settings.permissions.editAndFill,
    fillForms: settings.permissions.editAndFill || settings.permissions.comment,
    assemble: settings.permissions.editAndFill,
    annotate: settings.permissions.comment,
  };
  return {
    ownerPassword: permissionsPassword,
    ...(settings.openPassword === "" ? {} : { userPassword: settings.openPassword }),
    permissions,
    encryptMetadata: true,
    algorithm: settings.algorithm,
  };
}

/** "Smith.pdf" -> "Smith (Protected).pdf". */
export function protectedCopyName(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < originalName.length - 1;
  const stem = hasExtension ? originalName.slice(0, dot) : originalName;
  const extension = hasExtension ? originalName.slice(dot) : ".pdf";
  return `${stem} (Protected)${extension}`;
}
