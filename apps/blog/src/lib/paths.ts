// Ajudantes para gerar URLs corretas quando o site é publicado em
// um subcaminho (ex.: https://molinete-magico.github.io/blog/).
//
// O Astro injeta o base path em `import.meta.env.BASE_URL` (= "/blog/"
// no nosso caso). Links escritos à mão no template NÃO são prefixados
// automaticamente pelo Astro, então usamos these helpers.
export const BASE = import.meta.env.BASE_URL;

/** Prefixa um caminho raiz-relativo ("/posts") com o base path. */
export function withBase(path: string): string {
  if (path.startsWith(BASE)) return path;
  return `${BASE.replace(/\/$/, '')}${path}`;
}