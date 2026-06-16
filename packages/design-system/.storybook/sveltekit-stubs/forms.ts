/* $app/forms stub for the non-SvelteKit Storybook (aliased in .storybook/main.ts). The catalog form
   stories validate client-side (SPA + validationMethod), so these only need to resolve; enhance is a
   no-op action. */
export const enhance = (): { destroy: () => void } => ({ destroy: (): void => {} });
export const applyAction = async (): Promise<void> => {};
export const deserialize = <T>(result: string): T => JSON.parse(result) as T;
