/*
 * $app/forms stub for the non-SvelteKit Storybook (aliased in .storybook/main.ts). superforms drives
 * submission through SvelteKit's `enhance`, so a no-op is not enough — the native submit would
 * navigate (a 404 in the catalog). This mirrors enough of SvelteKit's enhance contract for the
 * client-side (SPA) form stories: preventDefault, hand superforms the submit params, and stop when it
 * cancels the request (which SPA mode always does after validating). No server fetch is ever made.
 */
type SubmitParams = {
  action: URL;
  formData: FormData;
  formElement: HTMLFormElement;
  controller: AbortController;
  submitter: HTMLElement | null;
  cancel: () => void;
  customRequest: (request: unknown) => void;
};

type SubmitCallback = (opts: {
  result: unknown;
  update: () => Promise<void>;
}) => void | Promise<void>;

// superforms' submit handler is async, so the return may be a Promise — typed here so awaiting it
// (and the callback) is justified, not a lint warning.
type SubmitFunction = (
  params: SubmitParams,
) => SubmitCallback | void | Promise<SubmitCallback | void>;

export function enhance(
  formElement: HTMLFormElement,
  submit: SubmitFunction = () => {},
): { destroy: () => void } {
  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    let cancelled = false;
    const params: SubmitParams = {
      action: new URL(formElement.action || window.location.href),
      formData: new FormData(formElement),
      formElement,
      controller: new AbortController(),
      submitter: event.submitter,
      cancel: () => {
        cancelled = true;
      },
      customRequest: () => {},
    };
    const callback = await submit(params);
    // SPA mode validates client-side then cancels the request — nothing more to do (no server).
    if (cancelled) return;
    if (typeof callback === "function") {
      await callback({
        result: { type: "success", status: 200, data: undefined },
        update: async () => {},
      });
    }
  }
  formElement.addEventListener("submit", handleSubmit);
  return {
    destroy: () => formElement.removeEventListener("submit", handleSubmit),
  };
}

export const applyAction = async (): Promise<void> => {};
export const deserialize = <T>(result: string): T => JSON.parse(result) as T;
