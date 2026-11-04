import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// GitHub Pages project site: https://levshaazz.github.io/okoyom/
export default defineConfig({
  site: 'https://levshaazz.github.io',
  base: '/okoyom',
  trailingSlash: 'never',
  integrations: [preact()],
  vite: {
    server: { host: '127.0.0.1' },
  },
});
