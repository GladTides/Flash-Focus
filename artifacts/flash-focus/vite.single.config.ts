import { defineConfig, mergeConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import base from './vite.config';
export default defineConfig(async (env) => {
  const b = typeof base === 'function' ? await base(env) : await base;
  return mergeConfig(b, { plugins: [viteSingleFile()], base: './', build: { outDir: 'dist-single', emptyOutDir: true, assetsInlineLimit: 100000000, cssCodeSplit: false } });
});
