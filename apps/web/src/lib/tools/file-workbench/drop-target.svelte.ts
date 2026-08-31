/*
 * Dragging files onto a region that is not a dropzone.
 *
 * The design system's Dropzone is a VISIBLE box: a dashed panel with a prompt and a picker inside
 * it. That is the right shape for an empty upload field and the wrong shape over a table, where the
 * table itself is what a person drags onto and a box would either cover the rows or sit under them
 * taking space. So the region keeps its own contents and gains the behaviour: this is that
 * behaviour, on its own, so the two surfaces cannot disagree about what a drag does.
 *
 * The depth counter is the part worth having in one place. `dragenter` and `dragleave` fire for
 * every descendant the pointer crosses, so a boolean flickers off the moment the pointer passes
 * over a row; counting entries against leaves is what makes "the pointer is somewhere inside this
 * region" a fact rather than a guess.
 */

export class DropTarget {
  #depth = $state(0);
  #onFiles: (files: File[]) => void;

  constructor(onFiles: (files: File[]) => void) {
    this.#onFiles = onFiles;
  }

  /** Whether a drag is currently over the region, for the surface to draw. */
  get over(): boolean {
    return this.#depth > 0;
  }

  /** Spread onto the region's element. Everything the behaviour needs, and nothing about looks. */
  get handlers(): {
    ondragenter: (event: DragEvent) => void;
    ondragover: (event: DragEvent) => void;
    ondragleave: () => void;
    ondrop: (event: DragEvent) => void;
  } {
    return {
      ondragenter: (event) => {
        // Only a drag carrying files counts. Dragging selected text across the table is not an
        // upload, and lighting the region up for it would promise something that will not happen.
        if (!carriesFiles(event)) return;
        event.preventDefault();
        this.#depth += 1;
      },
      ondragover: (event) => {
        if (!carriesFiles(event)) return;
        // Preventing the default on dragover is what marks an element a valid drop target.
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      },
      ondragleave: () => {
        this.#depth = Math.max(0, this.#depth - 1);
      },
      ondrop: (event) => {
        event.preventDefault();
        this.#depth = 0;
        const dropped = event.dataTransfer?.files;
        if (dropped && dropped.length > 0) this.#onFiles([...dropped]);
      },
    };
  }
}

/** Whether the drag is carrying files rather than text or a link. */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}
