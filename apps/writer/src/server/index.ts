// Servidor local do Writer.
//
// Um app Hono enxuto que expõe:
//   - A interface (HTML/JS/CSS) em /  (cliente servido do disco)
//   - Uma API JSON que manipula content/ e executa Git
//
// Segurança: as rotas /api/* (exceto as de autenticação) exigem uma
// sessão válida. Operações sensíveis — publicar, push, commit, pull,
// excluir, mudar configuração — exigem também a digitação da senha
// (campo `password` no corpo). Tudo roda na sua máquina; o Git é
// delegado ao Git CLI do sistema, que usa as credenciais já
// configuradas pelo usuário (SSH, gh auth, credential helper...).
// O Writer nunca armazena tokens de terceiros.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import {
  listPosts,
  readPost,
  createPost,
  savePost,
  deletePost,
  duplicatePost,
  saveImage,
} from './content.ts';
import { gitStatus, commit, push, canPush, pull } from './git.ts';
import { AuthService } from './auth.ts';
import type { PostMeta } from '../shared/types.ts';
import { PORT, repoRoot, contentRoot, clientDir, setRepoRoot } from './fs.ts';

const auth = new AuthService();

function clientAsset(filename: string, contentType: string) {
  const file = path.join(clientDir(), filename);
  if (!existsSync(file)) {
    throw new Error(
      `Cliente não compilado (falta ${file}). Rode \`npm run build:client\` no apps/writer.`,
    );
  }
  return new Response(readFileSync(file), {
    status: 200,
    headers: { 'Content-Type': contentType },
  });
}

function bearerToken(c: { req: { header(name: string): string | undefined } }): string | null {
  const h = c.req.header('Authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

// Rotas /api/* com senha fresca obrigatória a cada chamada.
const SENSITIVE = new Set([
  '/api/publish',
  '/api/post/delete',
  '/api/git/commit',
  '/api/git/push',
  '/api/git/pull',
  '/api/settings',
  '/api/workspace',
  '/api/auth/password',
]);

// Rotas que não precisam de sessão (descoberta/fluxo de senha).
const PUBLIC_AUTH = new Set([
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/unlock',
  '/api/auth/reset',
]);

const app = new Hono<{ Variables: Record<string, unknown> }>();
app.use('*', cors());

// --- Página e estáticos -------------------------------------------------

function shellHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Meu Writer</title>
  <link rel="stylesheet" href="/client.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/client.js"></script>
  <script>
    // Pequenos aprimoramentos de interface que não precisam participar
    // do bundle principal do editor.
    window.addEventListener('DOMContentLoaded', () => {
      const toolbar = document.createElement('div');
      toolbar.className = 'editor-toolbar';
      toolbar.innerHTML = [
        '<span class="toolbar-label">FORMATAÇÃO</span>',
        '<button type="button" data-md="bold" title="Negrito (Ctrl+B)"><b>B</b></button>',
        '<button type="button" data-md="italic" title="Itálico (Ctrl+I)"><i>I</i></button>',
        '<button type="button" data-md="heading" title="Título">H</button>',
        '<button type="button" data-md="list" title="Lista">•</button>',
        '<button type="button" data-md="quote" title="Citação">❯</button>',
        '<button type="button" data-md="code" title="Código">&lt;/&gt;</button>',
        '<span class="toolbar-spacer"></span>',
        '<span class="toolbar-hint">Ctrl+S salva</span>',
      ].join('');

      const paneLabel = document.querySelector('.pane-label');
      if (paneLabel) paneLabel.after(toolbar);

      const sendShortcut = (key) => {
        const editor = document.querySelector('.cm-content');
        if (!editor) return;
        editor.focus();
        editor.dispatchEvent(new KeyboardEvent('keydown', {
          key,
          code: key,
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }));
      };

      toolbar.querySelectorAll('[data-md]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.getAttribute('data-md');
          if (action === 'bold') sendShortcut('b');
          else if (action === 'italic') sendShortcut('i');
          else if (action === 'heading') sendShortcut('1');
          else if (action === 'list') sendShortcut('l');
          else if (action === 'quote') sendShortcut('q');
          else if (action === 'code') sendShortcut(String.fromCharCode(96));
        });
      });
    });
  </script>
</body>
</html>`;
}

app.get('/', (c) => c.html(shellHtml()));
app.get('/client.js', (c) => {
  try {
    return clientAsset('main.js', 'text/javascript');
  } catch (err) {
    return c.text((err as Error).message, 500);
  }
});
app.get('/client.css', (c) => {
  try {
    return clientAsset('main.css', 'text/css');
  } catch (err) {
    return c.text((err as Error).message, 500);
  }
});

// --- Middleware de autenticação para /api/* ------------------------------

app.use('/api/*', async (c, next) => {
  const p = c.req.path;

  if (PUBLIC_AUTH.has(p)) return next();

  if (!auth.isConfigured()) {
    return c.json({ error: 'Defina a senha principal antes de usar o Writer.', code: 'setup-required' }, 403);
  }

  const token = bearerToken(c);
  const refresh = p === '/api/auth/session' ? false : true;
  if (!token || !auth.touch(token, refresh)) {
    return c.json({ error: 'Sessão encerrada por inatividade ou bloqueio. Digite a senha para continuar.', code: 'locked' }, 401);
  }
  c.set('token', token);

  // Operações sensíveis: exigem senha fresca no corpo da requisição.
  // GETs (leitura) passam apenas com sessão — exceto as listadas.
  if (SENSITIVE.has(p) && c.req.method !== 'GET') {
    const text = await c.req.text().catch(() => '');
    let body: Record<string, unknown> = {};
    if (text) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* corpo inválido vira body vazio → senha ausente → 401 */
      }
    }
    const password = typeof body.password === 'string' ? body.password : '';
    const v = await auth.verifyPassword(password);
    if (!v.ok) {
      return c.json(
        {
          error: v.locked
            ? `Muitas tentativas. Tente novamente em ${v.retryAfterSec}s.`
            : 'Para esta operação, digite a sua senha. Ela parece incorreta.',
          code: 'auth-required',
          ...(v.retryAfterSec ? { retryAfterSec: v.retryAfterSec } : {}),
        },
        401,
      );
    }
    // Força "autenticação recente": a senha acabou de ser verificada.
    auth.marksRecent(token);
    delete body.password;
    c.set('parsedBody', body);
    c.set('verifiedPassword', password);
  }

  await next();
});

function parsedBody(c: { get(key: string): unknown }): Record<string, unknown> {
  return (c.get('parsedBody') as Record<string, unknown>) ?? {};
}

// --- Autenticação --------------------------------------------------------

// Estado da sessão do cliente (publicado): sem detalhes sobre o hash.
app.get('/api/auth/status', (c) => {
  const token = bearerToken(c);
  const status = auth.status();
  return c.json({
    ...status,
    sessionValid: token ? auth.touch(token, false) : false,
  });
});

// Confirmação viva de que a sessão existe/serve como heartbeat.
app.get('/api/auth/session', (c) => c.json({ ok: true }));

app.post('/api/auth/setup', async (c) => {
  try {
    const { password } = (await c.req.json()) as { password?: unknown };
    if (typeof password !== 'string' || !auth.validPassword(password)) {
      return c.json({ error: 'A senha precisa ter ao menos 8 caracteres.' }, 400);
    }
    const token = await auth.setup(password);
    return c.json({ ok: true, token });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post('/api/auth/unlock', async (c) => {
  const { password } = (await c.req.json()) as { password?: unknown };
  const r = await auth.unlock(typeof password === 'string' ? password : '');
  if (!r.ok) {
    return c.json(
      {
        error: r.locked && r.retryAfterSec
          ? `Muitas tentativas. Tente novamente em ${r.retryAfterSec}s.`
          : 'Senha incorreta.',
        code: 'auth-required',
        ...(r.retryAfterSec ? { retryAfterSec: r.retryAfterSec } : {}),
      },
      401,
    );
  }
  return c.json({ ok: true, token: r.token });
});

app.post('/api/auth/lock', (c) => {
  auth.lockAll();
  return c.json({ ok: true });
});

app.post('/api/auth/password', async (c) => {
  const { newPassword } = parsedBody(c) as { newPassword?: unknown };
  const current = c.get('verifiedPassword') as string;
  const r = await auth.changePassword(
    current,
    typeof newPassword === 'string' ? newPassword : '',
  );
  if (r === 'weak') return c.json({ ok: false, error: 'A nova senha precisa ter ao menos 8 caracteres.' }, 400);
  if (r === 'wrong') return c.json({ ok: false, error: 'A senha atual está incorreta.' }, 401);
  return c.json({ ok: true });
});

// Recuperação: apaga a senha (volta à primeira tela de configuração).
app.post('/api/auth/reset', async (c) => {
  await auth.resetRecovery();
  return c.json({ ok: true });
});

app.get('/api/settings', (c) =>
  c.json({
    idleTimeoutMinutes: auth.status().idleTimeoutMinutes,
    recentWindowMinutes: auth.status().recentWindowMinutes,
    workspace: { root: repoRoot(), contentRoot: contentRoot() },
  }),
);

app.post('/api/settings', async (c) => {
  const body = parsedBody(c);
  try {
    return c.json(
      await auth.setSettings({
        idleTimeoutMinutes: body.idleTimeoutMinutes as number | undefined,
        recentWindowMinutes: body.recentWindowMinutes as number | undefined,
      }),
    );
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post('/api/workspace', async (c) => {
  const body = parsedBody(c);
  let target = typeof body.path === 'string' ? body.path : '';
  if (!target) {
    const pick = (globalThis as Record<string, unknown>).__writerWorkspacePicker;
    if (typeof pick === 'function') {
      target = String(await (pick as () => Promise<unknown>)());
    }
  }
  if (!target) return c.json({ ok: false, error: 'Nenhuma pasta informada.' }, 400);
  try {
    const root = setRepoRoot(target);
    return c.json({ ok: true, root, contentRoot: contentRoot() });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 400);
  }
});

// --- Conteúdo -------------------------------------------------------------

app.get('/api/posts', async (c) => c.json(await listPosts()));

app.get('/api/post/:id', async (c) => {
  try {
    return c.json(await readPost(c.req.param('id')));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
});

app.post('/api/post', async (c) => {
  const { title } = await c.req.json();
  return c.json(await createPost(String(title ?? 'Sem título')), 201);
});

app.post('/api/post/save', async (c) => {
  const { id, file, body } = await c.req.json();
  try {
    return c.json(await savePost(id, file, body));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.post('/api/post/delete', async (c) => {
  const body = parsedBody(c);
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return c.json({ error: 'Nenhum post informado.' }, 400);
  await deletePost(id);
  return c.json({ ok: true });
});

app.post('/api/post/duplicate', async (c) => {
  const { id } = await c.req.json();
  return c.json(await duplicatePost(String(id)), 201);
});

// Upload de imagem NÃO é sensível (só adiciona um arquivo à pasta do
// post), mas exige sessão ativa — já garantida pelo middleware.
app.post('/api/post/:id/image', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: 'Nenhuma imagem enviada' }, 400);
  const name = await saveImage(
    c.req.param('id'),
    file.name,
    Buffer.from(await file.arrayBuffer()),
  );
  return c.json({ name, alt: path.basename(name, path.extname(name)) }, 201);
});

// --- Git ------------------------------------------------------------------

app.get('/api/git/status', async (c) => c.json(await gitStatus()));

app.post('/api/git/commit', async (c) => {
  const body = parsedBody(c);
  try {
    const subject = await commit(typeof body.message === 'string' ? body.message : '');
    return c.json({ ok: true, subject });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

app.post('/api/git/push', async (c) => {
  try {
    return c.json({ ok: true, output: await push() });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 501);
  }
});

app.post('/api/git/pull', async (c) => {
  try {
    return c.json({ ok: true, output: await pull() });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 501);
  }
});

app.post('/api/git/check', async (c) => c.json(await canPush()));

// --- Publicação -----------------------------------------------------------

app.post('/api/publish', async (c) => {
  const body = parsedBody(c);
  const id = typeof body.id === 'string' ? body.id : '';
  try {
    await savePost(
      id,
      { ...(body.file as Record<string, unknown>), draft: false } as unknown as PostMeta,
      String(body.body ?? ''),
    );
    const file = (body.file as { title?: unknown }) ?? {};
    const subject = await commit(`post: ${String(file.title ?? id)}`);
    await push();
    return c.json({ ok: true, subject });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export { app, auth };

export async function startWriterServer(
  opts: { port?: number; repoRoot?: string } = {},
) {
  if (opts.repoRoot) setRepoRoot(opts.repoRoot);
  await auth.init(); // carrega/decifra a configuração de senha
  const port = opts.port ?? PORT;
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`\n  ✍  Writer rodando em http://localhost:${info.port}`);
    console.log(`  Conteúdo: ${contentRoot()}`);
    console.log(`  Senha: ${auth.isConfigured() ? 'definida' : 'não definida (primeira tela)'}\n`);
  });
  return server;
}

export default app;