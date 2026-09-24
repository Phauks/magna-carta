<script module lang="ts">
  /*
   * QrCode — Tier 1. A value drawn as a symbol a phone camera reads. One story, because the
   * component has no variant axis: the colours are fixed to the mode-invariant chrome pair so the
   * symbol reads dark on light in every theme and mode, which the catalog's theme toolbar shows.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { expect } from "storybook/test";
  import QrCode from "../lib/components/qr-code/index.ts";

  const { Story } = defineMeta({
    title: "Data Display/QR code",
    component: QrCode,
    args: {
      value:
        "otpauth://totp/Magna%20Carta:joan%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Magna%20Carta&digits=6&period=30",
      label: "QR code for your authenticator app",
    },
  });
</script>

<Story
  name="Authenticator Secret"
  play={async ({ canvas, step }) => {
    await step("Is an image with an accessible name, since the symbol itself says nothing", async () => {
      await expect(canvas.getByRole("img", { name: "QR code for your authenticator app" })).toBeInTheDocument();
    });
  }}
>
  {#snippet template(args)}
    <QrCode {...args} />
  {/snippet}
</Story>
