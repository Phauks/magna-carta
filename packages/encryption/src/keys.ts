// The key hierarchy: the root key-encryption key wraps per-firm data keys; this module derives
// and unwraps them. The root key arrives as the ROOT_KEK runtime secret plumbed in apps/worker.
export {};
