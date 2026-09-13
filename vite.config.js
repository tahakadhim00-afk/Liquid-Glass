import { resolve } from 'node:path';

/**
 * Dev/demo config.
 *
 * The published library is built separately by vite.lib.config.js - this
 * one only serves and builds the pages under demo/, so they can never be
 * mistaken for the package itself.
 *
 *   demo/playground.html  the shader with every parameter on a slider
 *   demo/harness.html     no UI - loads the library for the test suite
 */
const root = resolve(process.cwd(), 'demo');

export default {
  root,
  // Serve the repo root too, so the demos can import ../src directly
  // rather than through a copy or an alias.
  // strictPort: the test suite targets 5173 by URL, and silently sliding
  // to another port turns a port clash into a confusing test failure.
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [resolve(process.cwd())] },
  },
  build: {
    outDir: resolve(process.cwd(), 'dist-demo'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        playground: resolve(root, 'playground.html'),
        harness: resolve(root, 'harness.html'),
      },
    },
  },
};
