// Configuração da ferramenta.
//
// Em vez de depender de uma pasta fixa, o Writer localiza a raiz do
// monorepo subindo até encontrar a pasta `content/` — a "marca" do
// arquivo. Isso funciona em desenvolvimento e após o build, porque
// em ambos os casos a subida termina na mesma pasta.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// Sobe a árvore de diretórios desde o módulo atual até achar quem
// contém `content/`. Se não achar, para na raiz do filesystem.
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, 'content'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Não encontrei a pasta content/: rode o Writer dentro do monorepo.');
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot(moduleDir);

// Onde os arquivos Markdown vivem. É nesta pasta que o Writer
// trabalha e é ela que o Git versiona.
export const CONTENT_ROOT = path.resolve(REPO_ROOT, 'content');

// Porta do servidor local. Pode ser substituída por env var.
export const PORT = Number(process.env.WRITER_PORT ?? 4322);

// Pastas de cada coleção, relativas a CONTENT_ROOT.
export const COLLECTIONS = {
  posts: 'posts',
  projects: 'projects',
  notes: 'notes',
} as const;