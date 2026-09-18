export { default } from "./file-icon.svelte";
export {
  resolveFileIcon,
  resolveFileIconPresentation,
  type FileIconComponent,
  type FileIconInput,
  type FileIconPresentation,
} from "./resolve.ts";
export {
  claimedFileCategory,
  extensionOf,
  extensionsOfCategory,
  resolveFileCategory,
  resolveFileContentCategory,
  sniffedFileCategory,
  resolveFileIconTone,
  resolveFileTypeBadge,
  type FileCategory,
  type FileIconTone,
  type FileTypeBadge,
} from "./file-types.ts";
export { fileIconClasses, type FileIconSize } from "./variants.ts";
