import {defineConfig} from 'vite';

// The compositor uses React, isolated from the Preact desk in its own frame.
export default defineConfig({
  root: '../studio/preview',
  base: '/live-preview/',
  publicDir: '../public',
  oxc: {jsx: {runtime: 'automatic', importSource: 'react'}},
  build: {outDir: '../../desk/web-dist/live-preview', emptyOutDir: true, sourcemap: false},
});
