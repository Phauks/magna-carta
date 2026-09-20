<script lang="ts">
  /*
   * One section of the firm's Trust panel saying its own read failed.
   *
   * EACH READ FAILS ON ITS OWN, and the panel keeps standing around it: a firm whose statements
   * cannot be read still has an approval queue somebody owes an answer to. The sentence is the
   * section's, because what a reader needs to know is which question went unanswered and what is
   * therefore NOT true — never a shared line that would say the same thing about six different
   * reads.
   */
  import * as Alert from "@magna-carta/design-system/alert";

  let {
    sentence,
  }: {
    /** What could not be read, and what is unaffected by that. The section's own words. */
    sentence: string;
  } = $props();
</script>

<Alert.Root variant="warning">
  <Alert.Description>{sentence}</Alert.Description>
</Alert.Root>
