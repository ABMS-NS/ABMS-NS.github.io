import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// O site é publicado sob um subcaminho: https://abms-ns.github.io/blog/.
// O GitHub Actions reescreve o valor durante o build com a mesma URL.
const base = process.env.BASE_PATH ?? '/blog/';

// https://astro.build/config
export default defineConfig({
  // Substitua se um dia mudar de domínio. O GitHub Actions sobrescreve
  // com a URL real do Pages durante o deploy.
  site: (process.env.SITE_URL ?? 'https://abms-ns.github.io').replace(/\/$/, ''),
  base,

  // Gera sitemap.xml automaticamente (SEO)
  integrations: [sitemap()],

  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },
});