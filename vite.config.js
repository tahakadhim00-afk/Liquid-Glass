import { resolve } from 'node:path';

/**
 * Two entry points: the shader playground (index.html) and the library
 * demo (lib-demo.html). The library itself is consumed from source via
 * the package's `exports` field, so it needs no separate build step.
 */
export default {
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        lib: resolve(process.cwd(), 'lib-demo.html'),
      },
    },
  },
};
