// Lets TypeScript accept the side-effect CSS import in preview.ts. The package deliberately has
// no direct `vite` dependency (Storybook and Tailwind resolve the repo's vite-plus-core override
// through their own peer contexts), so `vite/client` types are not referenceable here.
declare module "*.css";
