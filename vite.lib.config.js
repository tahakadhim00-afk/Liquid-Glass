import { resolve } from 'node:path';

/**
 * Library build - what actually gets published to npm.
 *
 * This exists because the source is NOT directly consumable. `renderer.js`
 * imports its shaders with Vite's `?raw` suffix, which only resolves
 * inside a Vite build; publishing the raw source would ship a package
 * that breaks for anyone on webpack, Rollup, esbuild or plain ESM.
 *
 * So the library is bundled once, with the GLSL inlined as strings, into
 * a single dependency-free ES module. Consumers then need no loader, no
 * plugin and no build configuration of their own - it works the same in a
 * bundler or straight from a <script type="module">.
 *
 * `npm run build:lib`
 */
export default {
  build: {
    lib: {
      entry: resolve(process.cwd(), 'src/lib/index.js'),
      formats: ['es'],
      fileName: () => 'liquid-glass.js',
    },
    outDir: 'dist-lib',
    emptyOutDir: true,
    // Nothing is external: the package has no runtime dependencies, and
    // inlining is what makes a single file drop-in usable.
    rollupOptions: { external: [] },
    // Readable output. The bundle is small enough that the minification
    // saving is not worth making the published code opaque to anyone
    // debugging the effect in their own page.
    minify: false,
    target: 'es2022',
    sourcemap: true,
  },
};
