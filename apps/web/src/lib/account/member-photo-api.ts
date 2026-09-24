/*
 * A member's own picture — the reads and the writes behind the account profile's Photo plate.
 *
 * Through the generated client (@magna-carta/api-client, the `me.photo` / `me.setPhoto` /
 * `me.removePhoto` operations), turned back into the three-outcome `ApiOutcome` every failure
 * surface in this app renders from. The reasoning for both halves of that is at the seam,
 * $lib/api/api-client.ts.
 *
 * THE FACTS AND THE BYTES ARE TWO READS, and that is the contract's shape rather than this module's
 * convenience: the facts are a small row a screen holds and compares, and the bytes are an image an
 * `<img>` fetches for itself with the session's own cookie. Handing the bytes back inside the JSON
 * would make every read of "does this member have a picture" cost the picture.
 */
import { mePhoto, meRemovePhoto, meSetPhoto } from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

/** What the platform knows about a member's picture. */
export interface MemberPhoto {
  /** The SHA-256 of the bytes. Also what the content URL is cache-busted by. */
  sha256: string;
  contentType: string;
  sizeBytes: number;
  widthPixels: number;
  heightPixels: number;
  updatedAt: string;
}

/** Null where the member holds no picture — never absent, so a screen has to read it. */
export interface MemberPhotoState {
  photo: MemberPhoto | null;
}

export async function readMemberPhoto(): Promise<ApiOutcome<MemberPhotoState>> {
  try {
    const { data } = await mePhoto({ throwOnError: true });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

export async function writeMemberPhoto(imageBase64: string): Promise<ApiOutcome<MemberPhotoState>> {
  try {
    const { data } = await meSetPhoto({ body: { imageBase64 }, throwOnError: true });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

export async function removeMemberPhoto(): Promise<ApiOutcome<MemberPhotoState>> {
  try {
    const { data } = await meRemovePhoto({ throwOnError: true });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/**
 * Where the bytes are.
 *
 * SPELLED OUT RATHER THAN CALLED, because this is the one thing the generated client cannot give a
 * caller: `<img src>` needs a URL string, and the generated operation is a function that performs
 * the request. Fetching the bytes through the client and handing the element an object URL would
 * cost a copy in memory, a revocation to get wrong, and the browser's own caching of the image.
 *
 * IT CARRIES THE HASH AS A QUERY, which is the whole reason this is a function rather than a
 * constant: the URL is otherwise identical before and after a replacement, and a browser holding
 * the old bytes would go on drawing somebody's previous picture. The hash changes when the bytes
 * do, so the URL does.
 */
export function memberPhotoHref(photo: MemberPhoto): string {
  return `/api/v1/me/photo/content?v=${encodeURIComponent(photo.sha256)}`;
}

/** The formats the server will read. Stated here so the file chooser offers only those. */
export const ACCEPTED_PHOTO_TYPES = "image/png,image/jpeg";

/**
 * The ceiling the server enforces, in the units a refusal speaks.
 *
 * A CLIENT-SIDE BOUND IS A COURTESY, NEVER THE ENFORCEMENT (the password rule's posture): the
 * server refuses an oversized image whatever this says. What it buys is somebody learning that
 * their twelve-megabyte photograph is too large before they wait for it to upload.
 */
export const MAXIMUM_PHOTO_MEGABYTES = 2;
export const MAXIMUM_PHOTO_BYTES = MAXIMUM_PHOTO_MEGABYTES * 1024 * 1024;
