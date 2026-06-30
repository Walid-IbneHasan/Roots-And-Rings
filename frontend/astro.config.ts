// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://rootsandrings.net',
  // SSR so catalog pages read live data from the backend API (no UI change).
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [],
  vite: {
    plugins: [tailwindcss()],
  },
  image: {
    responsiveStyles: true,
  },
});
