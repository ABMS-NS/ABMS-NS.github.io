import type { APIRoute } from 'astro';

// Endpoint /robots.txt — instruções para crawlers de busca.
// O sitemap vive no mesmo caminho que o site (base), ex.:
// /blog/sitemap-index.xml quando o site é publicado sob /blog/.
export const GET: APIRoute = ({ site }) => {
  const BASE = import.meta.env.BASE_URL;
  const origin = site ?? new URL('http://localhost:4321');
  const sitemap = new URL(`${BASE}sitemap-index.xml`, origin).href;
  return new Response(
    `User-agent: *
Allow: /

Sitemap: ${sitemap}
`,
    { headers: { 'Content-Type': 'text/plain' } },
  );
};