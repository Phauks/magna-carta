/*
 * Ask the browser for files from a button that is not itself a file field (the scan slot on a
 * line, a menu item). A detached input is created, clicked and dropped; nothing is added to the page.
 */
export function chooseFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener("change", () => resolve(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}
