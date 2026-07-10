<script module lang="ts">
  /*
   * Dropzone — Inputs. The drag-and-drop upload surface layered over the FileInput primitive. One
   * controllable Primary (accessible name, prompt, accept, multiple, disabled are Controls) plus a
   * hidden "Behaviour" story that drives the drag-over state, a drop, and a keyboard pick — the
   * drop-and-forward contract and the "rejects nothing" rule are not visible on a static showcase.
   * The underlying FileInput is the accessible control (Tab reaches it, its button opens the picker,
   * assistive tech announces it); the drag surface is a pointer enhancement around it. svelte-csf v5.
   */
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import type { ComponentProps } from "svelte";
  import { expect, fireEvent, fn, userEvent, waitFor } from "storybook/test";
  import Dropzone from "../lib/components/dropzone/index.ts";

  const onFiles = fn();

  const { Story } = defineMeta({
    title: "Inputs/Dropzone",
    component: Dropzone,
    args: { label: "Upload files", prompt: "Drag files here, or use the button" },
  });

  type DropzoneStoryArgs = ComponentProps<typeof Dropzone>;
</script>

{#snippet template(args: DropzoneStoryArgs)}
  <div class="w-96">
    <Dropzone {...args} />
  </div>
{/snippet}

<Story
  name="Default"
  {template}
  play={async ({ canvas, step }) => {
    await step("The underlying file input carries the accessible name", async () => {
      await expect(canvas.getByLabelText("Upload files")).toBeInTheDocument();
    });
    await step("The prompt is visible", async () => {
      await expect(canvas.getByText("Drag files here, or use the button")).toBeVisible();
    });
  }}
/>

<!-- The drag-and-drop contract: the drag-over state, a drop handed to onFiles (rejecting nothing),
     and a keyboard pick flowing through the same callback. Hidden from the sidebar and Docs page. -->
<Story
  name="Behaviour"
  args={{ multiple: true, accept: "application/pdf", onFiles }}
  tags={["!dev", "!autodocs"]}
  play={async ({ canvas, canvasElement, step }) => {
    onFiles.mockClear();
    const zone = canvasElement.querySelector<HTMLElement>(".mc-dropzone");
    if (!zone) throw new Error("dropzone surface not found");
    const input = canvas.getByLabelText("Upload files") as HTMLInputElement;

    // Real Chromium resets the DataTransfer passed to a `new DragEvent()` constructor (a security
    // rule — a script-built DataTransfer cannot ride a synthesized drag), so a plain event carrying
    // the DataTransfer as an own property is what delivers the files to the handler under test.
    const dropFiles = (target: HTMLElement, files: File[]) => {
      const dataTransfer = new DataTransfer();
      for (const file of files) dataTransfer.items.add(file);
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      target.dispatchEvent(event);
    };

    await step("Dragging a file over the surface sets the drag-over state", async () => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(["a"], "a.pdf", { type: "application/pdf" }));
      await fireEvent.dragEnter(zone, { dataTransfer });
      await expect(zone).toHaveAttribute("data-dragover", "true");
      await fireEvent.dragLeave(zone, { dataTransfer });
      await waitFor(() => expect(zone).not.toHaveAttribute("data-dragover"));
    });

    await step("Dropping files hands them to onFiles and mirrors them into the input", async () => {
      dropFiles(zone, [
        new File(["one"], "one.pdf", { type: "application/pdf" }),
        new File(["two"], "two.pdf", { type: "application/pdf" }),
      ]);
      await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
      const delivered = (onFiles.mock.calls[0]?.[0] ?? []) as File[];
      await expect(delivered).toHaveLength(2);
      await expect(delivered[0]?.name).toBe("one.pdf");
      await expect(input.files).toHaveLength(2);
    });

    await step("It rejects nothing — a type outside accept is still delivered", async () => {
      onFiles.mockClear();
      dropFiles(zone, [new File(["img"], "photo.png", { type: "image/png" })]);
      await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
      const delivered = (onFiles.mock.calls[0]?.[0] ?? []) as File[];
      await expect(delivered[0]?.name).toBe("photo.png");
    });

    await step("A keyboard pick flows through the same onFiles callback", async () => {
      onFiles.mockClear();
      await userEvent.upload(input, new File(["memo"], "memo.pdf", { type: "application/pdf" }));
      await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
      const picked = (onFiles.mock.calls[0]?.[0] ?? []) as File[];
      await expect(picked[0]?.name).toBe("memo.pdf");
    });
  }}
/>
