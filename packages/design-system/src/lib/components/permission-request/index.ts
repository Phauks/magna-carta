/*
 * PermissionRequest — the one window a member is asked for a permission in. A single component with
 * no parts to compose, for the reason ActionDialog is: a request with composable parts is a request
 * each feature words differently.
 */
export { default } from "./permission-request.svelte";
export { default as PermissionRequest } from "./permission-request.svelte";
export { ALLOW_LABEL, ALLOWING_LABEL, askedByLine } from "./permission-request-model.ts";
export type { PermissionRequestContent } from "./types.ts";
