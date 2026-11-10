// Lets TypeScript accept the side-effect CSS import in preview.ts. The package deliberately has
// no direct `vite` dependency (Storybook and Tailwind take their `vite` peer from the repository
// root, which declares it as the Vite+ core build), so `vite/client` types are not referenceable here.
declare module "*.css";
