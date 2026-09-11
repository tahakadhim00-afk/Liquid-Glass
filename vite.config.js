import { resolve } from 'node:path';

/**
 * Dev/demo config.
 *
 * The published library is built separately by vite.lib.config.js - this
 * one only serves and builds the two demo pages, so the demos can never
 * be mistaken for the package itself.
 *
 *   demo/index.html       the library in use, the way a site would use it
 *   demo/playground.html  the shader with every parameter on a slider
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
        index: resolve(root, 'index.html'),
        playground: resolve(root, 'playground.html'),
      },
    },
  },
};
