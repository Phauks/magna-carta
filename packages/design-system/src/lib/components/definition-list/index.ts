/*
 * DefinitionList — named values, framed, with the words about their emptiness inside the frame.
 * The house namespace shape: `import * as DefinitionList` then <DefinitionList.Root>, or the
 * prefixed names.
 */
import Root from "./definition-list.svelte";
import Row from "./definition-list-row.svelte";
import Empty from "./definition-list-empty.svelte";

export {
  Root,
  Row,
  Empty,
  Root as DefinitionList,
  Row as DefinitionListRow,
  Empty as DefinitionListEmpty,
};
