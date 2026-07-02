/* $app/navigation stub for the non-SvelteKit Storybook (aliased in .storybook/main.ts). No-ops:
   the catalog never navigates, and superforms only needs these specifiers to resolve. */
export const afterNavigate = (): void => {};
export const beforeNavigate = (): void => {};
export const goto = async (): Promise<void> => {};
export const invalidateAll = async (): Promise<void> => {};
export const invalidate = async (): Promise<void> => {};
