import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-lib',
    lib: { entry: 'src/pack-reveal.js', formats: ['es'], fileName: 'pack-reveal' },
    rollupOptions: { external: ['three', /^three\//] },
  },
});
