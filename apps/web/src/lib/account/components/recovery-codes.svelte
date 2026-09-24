<script lang="ts">
  /*
   * The recovery codes, as issued — shown once, with the two ways to keep them.
   *
   * SHOWN ONCE, AND SAID SO. The server stores the codes encrypted and this surface never reads them
   * back: the only moment they exist in plain text is the answer to the request that minted them.
   * A member who closes the panel without keeping them has to replace them, which is a password
   * away, not a lockout — but the sentence above the list is what stops that being a surprise.
   *
   * SAVE AND COPY, NOT PRINT. Saving goes through the app's one download path
   * ($lib/export/save-target.ts), so a member who chose a downloads folder gets the file there; the
   * file explains itself ($lib/account/two-factor.ts, recoveryCodesDocument). Copy is for a
   * password manager, which is where most people should put them.
   */
  import Button from "@magna-carta/design-system/button";
  import { toast } from "@magna-carta/design-system/toast";
  import { recoveryCodesDocument } from "$lib/account/two-factor.ts";
  import { saveToTarget } from "$lib/export/save-target.ts";

  let {
    codes,
    accountAddress,
  }: {
    codes: readonly string[];
    /** Named in the saved file's heading, so a file found later says whose codes these are. */
    accountAddress: string | null;
  } = $props();

  const RECOVERY_CODES_FILENAME = "magna-carta-recovery-codes.txt";

  async function save(): Promise<void> {
    await saveToTarget(
      recoveryCodesDocument(accountAddress, codes),
      RECOVERY_CODES_FILENAME,
      "text/plain",
    );
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success("Recovery codes copied.");
    } catch {
      // The clipboard is refused in some embedded and locked-down browsers. The codes are still on
      // the screen and Save still works, so the sentence says which way is left.
      toast.error("Your browser would not copy them. Save them as a file instead.");
    }
  }
</script>

<div class="flex flex-col gap-16">
  <p class="text-sm">
    Keep these somewhere safe. Each one signs you in once if you cannot reach your authenticator
    app, and they are not shown again.
  </p>

  <ul class="grid grid-cols-2 gap-x-24 gap-y-8 rounded-md bg-surface-sunken p-16 font-mono text-sm">
    {#each codes as code (code)}
      <li>{code}</li>
    {/each}
  </ul>

  <div class="flex gap-8">
    <Button variant="secondary" onclick={() => void save()}>Save as File</Button>
    <Button variant="secondary" onclick={() => void copy()}>Copy</Button>
  </div>
</div>
