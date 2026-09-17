// Servidor local do Writer.
//
// Um app Hono enxuto que expõe:
//   - A interface (HTML/JS/CSS) em /
//   - Uma API JSON que manipula content/ e executa Git
//
// Tudo roda na sua máquina. Nenhuma credencial trafega por aqui:
// as operações de Git são delegadas ao Git CLI do sistema.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { build as esbuild } from 'esbuild';
import path from 'node:path';
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
import { PORT, REPO_ROOT } from './fs.ts';

const clientEntry = path.resolve(REPO_ROOT, 'apps/writer/src/client/main.ts');

const bundle = await esbuild({
  entryPoints: [clientEntry],
  bundle: true,
  format: 'esm',
  outdir: '.esbuild-cache',
  write: false,
  logLevel: 'silent',
  target: 'es2020',
});

function bundleAsset(ext: 'js' | 'css') {
  const file = bundle.outputFiles.find((f) => f.path.endsWith(`.${ext}`));
  if (!file) throw new Error(`Bundle sem arquivo .${ext}`);
  return file;
}

const app = new Hono();
app.use('*', cors());

app.get('/', (c) =>
  c.html(`<!doctype html>
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
      toolbar.innerHTML = `
        <span class="toolbar-label">FORMATAÇÃO</span>
        <button type="button" data-md="bold" title="Negrito (Ctrl+B)"><b>B</b></button>
        <button type="button" data-md="italic" title="Itálico (Ctrl+I)"><i>I</i></button>
        <button type="button" data-md="heading" title="Título">H</button>
        <button type="button" data-md="list" title="Lista">•</button>
        <button type="button" data-md="quote" title="Citação">❯</button>
        <button type="button" data-md="code" title="Código">&lt;/&gt;</button>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-hint">Ctrl+S salva</span>
      `;

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
          else if (action === 'code') sendShortcut('`');
        });
      });

      const publish = document.querySelector('#btn-publish');
      publish?.addEventListener('click', (event) => {
        if (!window.confirm('Publicar este post? Ele será salvo, marcado como publicado e enviado ao GitHub.')) {
          event.stopImmediatePropagation();
        }
      }, true);
    });
  </script>
</body>
</html>`),
);

app.get('/client.js', (c) =>
  c.body(bundleAsset('js').text, 200, { 'Content-Type': 'text/javascript' }),
);
app.get('/client.css', (c) =>
  c.body(bundleAsset('css').text, 200, { 'Content-Type': 'text/css' }),
);

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
  const { id } = await c.req.json();
  await deletePost(String(id));
  return c.json({ ok: true });
});

app.post('/api/post/duplicate', async (c) => {
  const { id } = await c.req.json();
  return c.json(await duplicatePost(String(id)), 201);
});

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

app.get('/api/git/status', async (c) => c.json(await gitStatus()));

app.post('/api/git/commit', async (c) => {
  const { message } = await c.req.json();
  try {
    const subject = await commit(String(message ?? ''));
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

app.post('/api/publish', async (c) => {
  const { id, file, body } = await c.req.json();
  try {
    await savePost(id, { ...file, draft: false }, body);
    const subject = await commit(`post: ${file.title}`);
    await push();
    return c.json({ ok: true, subject });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default app;

if (process.env.NODE_ENV !== 'test') {
  const { serve } = await import('@hono/node-server');
  const srv = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`\n  ✍  Writer rodando em http://localhost:${info.port}`);
    console.log(`  Conteúdo: ${REPO_ROOT}/content\n`);
    (globalThis as any).__writerServer = srv;
  });
}