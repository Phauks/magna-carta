import CreateControl from "./create-control.svelte";

export {
  assertCreateNoun,
  CREATE_BARE_LABEL,
  CREATE_NOUN_MAX_LENGTH,
  createLabel,
} from "./create-label.ts";
export type { CreateChoice } from "./types.ts";
export { CreateControl };
export default CreateControl;
