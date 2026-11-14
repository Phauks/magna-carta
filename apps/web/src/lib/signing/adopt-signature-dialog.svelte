<script lang="ts">
  /*
   * Adopt Your Signature: the signer types, draws or uploads the mark that goes on each signature
   * field, and the initials that go on each initials field.
   *
   * THE INTENT STATEMENT IS THE ACT. The commit is offered only once the signer has ticked the
   * sentence that says the mark is their signature and binds them as signing by hand, which is the
   * intent the record keeps. Nothing is adopted by opening or by choosing a style.
   *
   * The mark is made in the browser and sent as a PNG; the page shows the same picture on each field.
   */
  import Pencil from "@lucide/svelte/icons/pencil";
  import Type from "@lucide/svelte/icons/type";
  import Upload from "@lucide/svelte/icons/upload";
  import * as Alert from "@magna-carta/design-system/alert";
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import FileInput from "@magna-carta/design-system/file-input";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import FieldRow from "@magna-carta/design-system/field-row";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import DrawingPad from "./drawing-pad.svelte";
  import { adoptSignature, type SignerAdoption } from "./signer-api.ts";
  import { initialsFrom } from "./signer-walk.ts";
  import {
    TYPED_STYLES,
    pngBase64,
    trimmedToInk,
    typedFontFamily,
    typedMark,
    uploadedMark,
    type TypedStyle,
  } from "./signature-marks.ts";

  /** The adopted marks, as pictures the page can show on its fields. */
  export interface AdoptedMarks {
    readonly signature: string;
    readonly initials: string | null;
  }

  let {
    open = $bindable(false),
    token,
    signerName,
    needsInitials,
    onAdopted,
  }: {
    open?: boolean;
    token: string;
    signerName: string;
    needsInitials: boolean;
    onAdopted: (marks: AdoptedMarks) => void;
  } = $props();

  type How = SignerAdoption["how"];

  let how = $state<How>("typed");
  let fullName = $state("");
  let initials = $state("");
  let style = $state<TypedStyle>("display");
  let agreed = $state(false);
  let signaturePad = $state<HTMLCanvasElement | null>(null);
  let initialsPad = $state<HTMLCanvasElement | null>(null);
  let signatureDrawn = $state(false);
  let initialsDrawn = $state(false);
  let uploadInput = $state<HTMLInputElement | null>(null);
  let uploaded = $state<File | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let unusable = $state<string | null>(null);

  function reset(): void {
    how = "typed";
    fullName = signerName;
    initials = initialsFrom(signerName);
    style = "display";
    agreed = false;
    signatureDrawn = false;
    initialsDrawn = false;
    uploaded = null;
    failure = null;
    unusable = null;
  }

  const refusal = $derived.by(() => {
    if (how === "typed" && fullName.trim() === "") return "Type your name.";
    if (how === "typed" && needsInitials && initials.trim() === "") return "Type your initials.";
    if (how === "drawn" && !signatureDrawn) return "Draw your signature.";
    if (how === "drawn" && needsInitials && !initialsDrawn) return "Draw your initials.";
    if (how === "uploaded" && uploaded === null) return "Choose a picture of your signature.";
    if (how === "uploaded" && needsInitials && initials.trim() === "") return "Type your initials.";
    if (!agreed) return "Tick the statement to adopt your signature.";
    return undefined;
  });

  async function signatureCanvas(): Promise<HTMLCanvasElement | null> {
    if (how === "typed") return typedMark(fullName, style);
    if (how === "drawn") return signaturePad === null ? null : trimmedToInk(signaturePad);
    return uploaded === null ? null : uploadedMark(uploaded);
  }

  async function initialsCanvas(): Promise<HTMLCanvasElement | null> {
    if (!needsInitials) return null;
    if (how === "drawn") return initialsPad === null ? null : trimmedToInk(initialsPad);
    return typedMark(initials, style);
  }

  async function adopt(): Promise<ActionOutcome> {
    failure = null;
    unusable = null;
    const signature = await signatureCanvas();
    const initialsMark = await initialsCanvas();
    const signaturePng = signature === null ? null : pngBase64(signature);
    const initialsPng = initialsMark === null ? null : pngBase64(initialsMark);
    if (signaturePng === null || (needsInitials && initialsPng === null)) {
      unusable =
        how === "uploaded"
          ? "That picture could not be used. Choose a smaller PNG or JPEG of your signature."
          : "Your mark could not be made. Try again.";
      return "refused";
    }
    const outcome = await adoptSignature(token, { how, signaturePng, initialsPng });
    if (outcome.kind === "failed") {
      failure = stated(outcome.failure, "Your signature was not adopted.");
      return "refused";
    }
    onAdopted({
      signature: `data:image/png;base64,${signaturePng}`,
      initials: initialsPng === null ? null : `data:image/png;base64,${initialsPng}`,
    });
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  heading="Adopt Your Signature"
  commitLabel="Adopt and Sign"
  commitBusyLabel="Adopting"
  commitRefusal={refusal}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={adopt}
>
  {#snippet notice()}
    {#if unusable !== null}
      <Alert.Root variant="warning">
        <Alert.Title>Not Adopted</Alert.Title>
        <Alert.Description>{unusable}</Alert.Description>
      </Alert.Root>
    {:else if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Not Adopted"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <FieldRow>
        <LabelledField label="Full Name">
          {#snippet children({ props })}
            <Input {...props} bind:value={fullName} disabled={busy || how !== "typed"} autocomplete="name" />
          {/snippet}
        </LabelledField>
        {#if needsInitials}
          <LabelledField label="Initials">
            {#snippet children({ props })}
              <Input {...props} bind:value={initials} disabled={busy || how === "drawn"} maxlength={4} />
            {/snippet}
          </LabelledField>
        {/if}
      </FieldRow>

      <Tabs.Root bind:value={how}>
        <Tabs.List>
          <Tabs.Trigger value="typed"><Type aria-hidden="true" />Type</Tabs.Trigger>
          <Tabs.Trigger value="drawn"><Pencil aria-hidden="true" />Draw</Tabs.Trigger>
          <Tabs.Trigger value="uploaded"><Upload aria-hidden="true" />Upload</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="typed" class="pt-16">
          <RadioGroup.Root
            aria-label="Signature style"
            value={style}
            onValueChange={(next) => (style = next as TypedStyle)}
            disabled={busy}
            class="flex flex-col gap-8"
          >
            {#each TYPED_STYLES as entry (entry.key)}
              <label
                class="flex items-center gap-16 rounded-md border px-16 py-12 {style === entry.key ? 'border-accent-default' : 'border-border-default'}"
              >
                <RadioGroup.Item value={entry.key} aria-label="{entry.label} style" />
                <span class="flex-1 truncate text-2xl italic text-text-default" style="font-family: {typedFontFamily(entry.key)}">
                  {fullName.trim() === "" ? signerName : fullName}
                </span>
                {#if needsInitials}
                  <span class="text-2xl italic text-text-default" style="font-family: {typedFontFamily(entry.key)}">
                    {initials}
                  </span>
                {/if}
              </label>
            {/each}
          </RadioGroup.Root>
        </Tabs.Content>

        <Tabs.Content value="drawn" class="flex flex-col gap-16 pt-16">
          <DrawingPad
            label="Draw your signature"
            bind:canvas={signaturePad}
            bind:drawn={signatureDrawn}
            disabled={busy}
          />
          {#if needsInitials}
            <DrawingPad
              label="Draw your initials"
              bind:canvas={initialsPad}
              bind:drawn={initialsDrawn}
              disabled={busy}
              tall={false}
            />
          {/if}
        </Tabs.Content>

        <Tabs.Content value="uploaded" class="flex flex-col gap-8 pt-16">
          <Label for="signature-upload">A picture of your signature</Label>
          <FileInput
            id="signature-upload"
            accept="image/png,image/jpeg"
            disabled={busy}
            bind:ref={uploadInput}
            onchange={() => (uploaded = uploadInput?.files?.[0] ?? null)}
          />
          <p class="text-xs text-text-muted">
            A PNG or JPEG of your signature on a plain light background. The background is removed so the signature sits on the page.
            {#if needsInitials}Your initials are typed in the style above.{/if}
          </p>
        </Tabs.Content>
      </Tabs.Root>

      <label class="flex items-start gap-8 text-sm">
        <Checkbox checked={agreed} onCheckedChange={(checked) => (agreed = checked)} disabled={busy} />
        <span>
          I agree that this mark is my electronic signature{needsInitials ? " and initials" : ""}, and that it is
          as binding as signing by hand.
        </span>
      </label>
    </div>
  {/snippet}
</ActionDialog>
