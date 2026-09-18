// Interface do Writer (cliente, roda no navegador local).
//
// O frontend é TypeScript puro compilado com esbuild — sem framework.
// CodeMirror cuida do editor e `marked` + DOMPurify do preview.
// Quando você salva/publica, o código chama a API local (Hono),
// que escreve os arquivos Markdown e executa o Git.
//
// Segurança no cliente: nada de senha em localStorage — o token de
// sessão vive apenas em memória e operações destrutivas (publicar,
// enviar ao GitHub, excluir, puxar) pedem a senha de novo a cada vez.

import './styles.css';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Prec } from '@codemirror/state';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Post, PostListItem, GitStatus, PostMeta, AuthStatus } from '../shared/types';

// ------------------------------------------------------------------
// Estado global da aplicação.
// ------------------------------------------------------------------
const state: {
  posts: PostListItem[];
  current: Post | null;
  git: GitStatus | null;
  filter: string;
  dirty: { title: boolean; body: boolean; meta: boolean };
  savedAt: Date | null;
  tagsDirty: boolean;
} = {
  posts: [],
  current: null,
  git: null,
  filter: '',
  dirty: { title: false, body: false, meta: false },
  savedAt: null,
  tagsDirty: false,
};

// Token de sessão: apenas em memória. Nunca vai para localStorage.
let token: string | null = null;
let authInfo: AuthStatus = { configured: false, idleTimeoutMinutes: 15, recentWindowMinutes: 5 };

// ------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------
const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel);

function formatDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as { code?: string; error?: string; retryAfterSec?: number };
    if (err.code === 'locked') lockAndShow(err.error);
    else if (err.code === 'setup-required') showAuth('setup', err.error);
    throw new Error(err.error ?? `Falha ${method} ${url}`);
  }
  return data as T;
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ------------------------------------------------------------------
// Renderização da interface (DOM puro)
// ------------------------------------------------------------------
const app = $('#app')!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <strong>Writer</strong>
      <span class="git-badge" id="git-badge">…</span>
    </div>
    <div class="actions">
      <button id="btn-new" class="ghost">+ Novo</button>
      <span id="save-state" class="save-state" role="status"></span>
      <button id="btn-save" class="ghost" disabled>Salvar</button>
      <button id="btn-publish" class="primary" disabled>Publicar</button>
      <span class="topbar-divider"></span>
      <button id="btn-settings" class="ghost" title="Configurações">Config</button>
      <button id="btn-lock" class="ghost" title="Trancar o Writer">Trancar</button>
    </div>
  </header>

  <aside class="sidebar">
    <input id="search" type="search" placeholder="Pesquisar..." aria-label="Pesquisar posts" />
    <div id="git-panel" class="git-panel"></div>
    <ul id="post-list" class="post-list"></ul>
  </aside>

  <main id="editor" class="editor">
    <div class="empty" id="empty-state">
      <p>Selecione um post na lista ou crie um novo.</p>
    </div>
    <div class="editor-view" id="editor-view" hidden>
      <input id="field-title" class="title-input" type="text" placeholder="Título do post" aria-label="Título do post" />

      <div class="meta-row">
        <label>Data
          <input id="field-date" type="date" />
        </label>
        <label class="draft-check">
          <input id="field-draft" type="checkbox" /> Rascunho
        </label>
        <input id="field-tags" type="text" placeholder="Adicionar tag e teclar Enter" aria-label="Adicionar tag" />
        <ul id="tag-chips" class="tag-chips"></ul>
      </div>

      <textarea id="field-description" placeholder="Descrição curta (usada nos cards e SEO)" rows="2" aria-label="Descrição"></textarea>

      <div class="split">
        <div class="pane">
          <div class="pane-label">Markdown <button id="btn-image" class="ghost tiny">+ imagem</button></div>
          <input id="file-image" type="file" accept="image/*" hidden />
          <div id="cm-host" class="cm-host"></div>
        </div>
        <div class="pane">
          <div class="pane-label">Preview</div>
          <article id="preview" class="preview prose"></article>
        </div>
      </div>
    </div>
  </main>
`;

// ---------------------------------------------------------------
// CodeMirror: editor Markdown
// ---------------------------------------------------------------
let cmView: EditorView | null = null;

const editorTheme = EditorView.theme(
  {
    '&': { height: '100%' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '14px', lineHeight: '1.7' },
    '.cm-content': { maxWidth: 'none', padding: '12px 16px' },
    '.cm-line': { padding: '0' },
    '&.cm-focused': { outline: 'none' },
    '.cm-gutters': { display: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
  },
  { dark: true },
);

function currentBody(): string {
  return cmView?.state.doc.toString() ?? '';
}

function createEditor(initialDoc: string, onChange: (doc: string) => void) {
  // `basicSetup` já inclui undo/redo, seleção, busca, numeração etc.
  const cm = new EditorView({
    state: EditorState.create({
      doc: initialDoc,
      extensions: [
        basicSetup,
        // Atalhos de Markdown: Ctrl+B, Ctrl+I, Ctrl+K, etc.
        keymap.of(markdownKeymap),
        // Highlighting de sintaxe Markdown + linguagens para blocos de código
        markdown({ codeLanguages: languages }),
        // Ctrl+S salva direto podem evitar depender dos botões
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                saveCurrent();
                return true;
              },
            },
          ]),
        ),
        keymap.of(defaultKeymap),
        editorTheme,
        // Sincroniza o conteúdo digitado no editor com o estado da app
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            state.dirty.body = true;
            onChange(u.state.doc.toString());
            scheduleAutosave();
          }
        }),
      ],
    }),
    parent: $('#cm-host')!,
  });
  return cm;
}

// ------------------------------------------------------------------
// Preview Markdown (marked + sanitização DOMPurify)
// ------------------------------------------------------------------
const previewEl = $('#preview')!;

marked.setOptions({ gfm: true, breaks: true });

function renderPreview() {
  const raw = marked.parse(currentBody());
  // DOMPurify remove qualquer HTML perigoso antes de injetar no DOM.
  previewEl.innerHTML = DOMPurify.sanitize(
    typeof raw === 'string' ? raw : String(raw),
  );
}

const renderPreviewDebounced = debounce(renderPreview, 250);

// ------------------------------------------------------------------
// Lista de posts
// ------------------------------------------------------------------
const postList = $('#post-list')!;
const search = $('#search')! as HTMLInputElement;

function renderList() {
  const q = state.filter.toLowerCase();
  const shown = state.posts.filter(
    (p) =>
      p.title.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q)),
  );

  postList.innerHTML = shown
    .map(
      (p) => `
        <li class="post-item ${p.id === state.current?.id ? 'active' : ''}">
          <button data-id="${p.id}" class="post-open" title="${p.title}">
            <span class="dot ${p.draft ? 'draft' : 'pub'}" aria-hidden="true"></span>
            <span class="title">${escapeHtml(p.title)}</span>
            <span class="meta">${p.draft ? 'Rascunho' : 'Publicado'} · ${formatDate(p.pubDate)}</span>
          </button>
          <div class="actions">
            <button data-id="${p.id}" data-act="dup" title="Duplicar">⧉</button>
            <button data-id="${p.id}" data-act="del" title="Excluir">×</button>
          </div>
        </li>`,
    )
    .join('') || '<li class="empty-list">Nenhum post</li>';
}

async function loadList() {
  state.posts = await api<PostListItem[]>('GET', '/api/posts');
  renderList();
}

// ------------------------------------------------------------------
// Abrir / salvar / criar posts
// ------------------------------------------------------------------
const fieldTitle = $('#field-title')! as HTMLInputElement;
const fieldDate = $('#field-date')! as HTMLInputElement;
const fieldDraft = $('#field-draft')! as HTMLInputElement;
const fieldDescription = $('#field-description')! as HTMLTextAreaElement;
const fieldTags = $('#field-tags')! as HTMLInputElement;
const emptyState = $('#empty-state')!;
const editorView = $('#editor-view')!;
const tagChips = $('#tag-chips')!;
const saveState = $('#save-state')!;

async function openPost(id: string) {
  state.current = await api<Post>('GET', `/api/post/${encodeURIComponent(id)}`);
  const p = state.current;

  fieldTitle.value = p.file.title;
  fieldDate.value = p.file.pubDate;
  fieldDraft.checked = p.file.draft;
  fieldDescription.value = p.file.description;
  tags = p.file.tags ?? [];
  renderTags();
  renderList();

  // Recria o editor com o conteúdo do post (mais simples do que
  // gerenciar a troca de documento dentro do CodeMirror).
  if (cmView) cmView.destroy();
  cmView = createEditor(p.body, () => {
    renderPreviewDebounced();
  });
  renderPreview();
  state.dirty = { title: false, body: false, meta: false };
  setSaved(true);

  emptyState.hidden = true;
  editorView.hidden = false;
  fieldTitle.focus();
}

function currentMeta(): PostMeta {
  return {
    title: fieldTitle.value.trim() || 'Sem título',
    description: fieldDescription.value.trim(),
    pubDate: fieldDate.value || todayClient(),
    tags: tags,
    draft: fieldDraft.checked,
  };
}

function todayClient() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

async function saveCurrent(): Promise<boolean> {
  if (!state.current) return false;
  const meta = currentMeta();
  try {
    await api('POST', '/api/post/save', {
      id: state.current.id,
      file: meta,
      body: currentBody(),
    });
    state.dirty = { title: false, body: false, meta: false };
    clearAutosave();
    setSaved(true);
    await loadList();
    return true;
  } catch (err) {
    setSaved(false, (err as Error).message);
    return false;
  }
}

async function publishCurrent() {
  if (!state.current) return;
  const meta = { ...currentMeta(), draft: false };
  const pw = await askPassword({
    title: 'Publicar no site',
    message: `O post será salvo, marcado como publicado, commitado e enviado ao GitHub. Autorize com a sua senha.`,
    confirm: 'Publicar e enviar',
    danger: true,
  });
  if (pw === null) return;
  fieldDraft.checked = false;
  setSaving('Publicando...');
  try {
    const res = await api<{ subject: string }>('POST', '/api/publish', {
      id: state.current.id,
      file: meta,
      body: currentBody(),
      password: pw,
    });
    setSaved(true, `Publicado ✓ ${res.subject}`);
    clearAutosave();
    await loadList();
    await refreshGit();
  } catch (err) {
    setSaved(false, (err as Error).message);
  }
}

// ------------------------------------------------------------------
// Tags
// ------------------------------------------------------------------
let tags: string[] = [];

function renderTags() {
  tagChips.innerHTML = tags
    .map(
      (t) => `<li class="chip">${escapeHtml(t)}
        <button data-rm="${escapeHtml(t)}" aria-label="Remover tag ${escapeHtml(t)}">×</button></li>`,
    )
    .join('');
}

fieldTags.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault();
  const t = fieldTags.value.trim().replace(/,/, '');
  if (t && !tags.includes(t)) {
    tags.push(t);
    renderTags();
    state.tagsDirty = true;
  }
  fieldTags.value = '';
});

tagChips.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-rm]') as HTMLElement | null;
  if (!btn) return;
  const label = btn.getAttribute('data-rm');
  tags = tags.filter((t) => t !== label);
  state.tagsDirty = true;
  renderTags();
});

// ------------------------------------------------------------------
// Modais (senha / confirmação)
// ------------------------------------------------------------------
function modal(title: string, body: string) {
  const root = document.createElement('div');
  root.className = 'modal-backdrop';
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="modal-x" aria-label="Fechar">×</button></div>
      <div class="modal-body">
        ${body}
      </div>
    </div>`;
  document.body.appendChild(root);
  const close = () => root.remove();
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  root.querySelector('.modal-x')?.addEventListener('click', close);
  const firstInput = root.querySelector('input, select, button');
  if (firstInput instanceof HTMLElement) setTimeout(() => firstInput.focus(), 0);
  return { root, close };
}

// Pede a senha com confirmação explícita. Resolve com a senha digitada,
// ou `null` se o usuário cancelou.
function askPassword(opts: {
  title: string;
  message: string;
  confirm: string;
  danger?: boolean;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const { root, close } = modal(
      opts.title,
      `
      <p class="modal-message">${escapeHtml(opts.message)}</p>
      <div class="modal-msg" id="pw-msg" role="alert"></div>
      <label class="auth-field">
        <span>Senha</span>
        <input id="pw-input" type="password" autocomplete="off" spellcheck="false" autofocus />
      </label>
      <div class="modal-actions">
        <button class="ghost" id="pw-cancel">Cancelar</button>
        <button class="${opts.danger ? 'danger' : 'primary'}" id="pw-ok">${escapeHtml(opts.confirm)}</button>
      </div>`,
    );
    const pwInput = $('#pw-input', root) as HTMLInputElement;
    const pwMsg = $('#pw-msg', root)!;

    const finish = () => {
      close();
      resolve(pwInput.value);
    };
    $('#pw-cancel', root)?.addEventListener('click', () => {
      close();
      resolve(null);
    });
    $('#pw-ok', root)?.addEventListener('click', (e) => {
      if (pwInput.value) return finish();
      pwMsg.textContent = 'Digite a senha para confirmar.';
      pwInput.focus();
    });
    pwInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (pwInput.value) finish();
        else {
          pwMsg.textContent = 'Digite a senha para confirmar.';
          pwInput.focus();
        }
      }
    });
  });
}

// ------------------------------------------------------------------
// Botões principais
// ------------------------------------------------------------------
$('#btn-new')!.addEventListener('click', async () => {
  const title = window.prompt('Título do novo post:')?.trim();
  if (!title) return;
  const post = await api<Post>('POST', '/api/post', { title });
  await loadList();
  await openPost(post.id);
});

$('#btn-save')!.addEventListener('click', () => saveCurrent());
$('#btn-publish')!.addEventListener('click', () => publishCurrent());
$('#btn-lock')!.addEventListener('click', async () => {
  try {
    await api('POST', '/api/auth/lock');
  } catch {
    /* token já inválido — seguimos para a tela de bloqueio */
  }
  token = null;
  showAuth('lock', 'O Writer foi trancado.');
});
$('#btn-settings')!.addEventListener('click', () => openSettings());

// ------------------------------------------------------------------
// Ações por post (duplicar/excluir) — delegação de eventos
// ------------------------------------------------------------------
postList.addEventListener('click', async (e) => {
  const openBtn = (e.target as HTMLElement).closest('.post-open') as HTMLElement | null;
  if (openBtn) return openPost(openBtn.getAttribute('data-id')!);

  const act = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!act) return;
  const id = act.getAttribute('data-id')!;

  if (act.getAttribute('data-act') === 'dup') {
    const copy = await api<Post>('POST', '/api/post/duplicate', { id });
    await loadList();
    await openPost(copy.id);
  } else if (act.getAttribute('data-act') === 'del') {
    const pw = await askPassword({
      title: 'Excluir post',
      message: `Excluir "${id}"? O arquivo (e as imagens da pasta) serão removidos — não dá para desfazer.`,
      confirm: 'Excluir de vez',
      danger: true,
    });
    if (pw === null) return;
    try {
      await api('POST', '/api/post/delete', { id, password: pw });
      if (state.current?.id === id) {
        emptyState.hidden = false;
        editorView.hidden = true;
        state.current = null;
      }
      await loadList();
    } catch (err) {
      setSaved(false, (err as Error).message);
    }
  }
});

search.addEventListener('input', () => {
  state.filter = search.value;
  renderList();
});

// Marca os campos de metadados como sujos ao editar
fieldTitle.addEventListener('input', () => {
  state.dirty.title = true;
});
fieldDate.addEventListener('input', () => {
  state.dirty.meta = true;
});
fieldDraft.addEventListener('change', () => {
  state.dirty.meta = true;
});
fieldDescription.addEventListener('input', () => {
  state.dirty.meta = true;
});

// ------------------------------------------------------------------
// Imagens
// ------------------------------------------------------------------
$('#btn-image')!.addEventListener('click', () => {
  $('#file-image')!.click();
});

$('#file-image')!.addEventListener('change', async (e) => {
  if (!state.current) return;
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`/api/post/${state.current.id}/image`, {
    method: 'POST',
    headers,
    body: form,
  });
  const data = await res.json();
  if (!res.ok) return setSaved(false, data.error);
  // Insere a referência no Markdown na posição do cursor.
  const snippet = `![${data.alt ?? file.name}](${data.name})`;
  cmView?.dispatch({ changes: { from: cmView.state.selection.main.from, insert: snippet }, selection: { anchor: cmView.state.selection.main.from + snippet.length } });
  (e.target as HTMLInputElement).value = '';
  setSaved(false, '');
});

// ------------------------------------------------------------------
// Painel Git
// ------------------------------------------------------------------
const gitBadge = $('#git-badge')!;
const gitPanel = $('#git-panel')!;

async function refreshGit() {
  try {
    state.git = await api<GitStatus>('GET', '/api/git/status');
  } catch {
    state.git = null;
  }
  const g = state.git;

  if (!g) {
    gitBadge.textContent = 'git';
    gitPanel.innerHTML = '<p class="git-note">Repositório não encontrado.</p>';
    return;
  }

  const clean = g.dirty.length === 0;
  gitBadge.textContent = `git: ${g.branch}`;
  gitBadge.className = `git-badge ${clean ? 'ok' : 'dirty'}`;

  gitPanel.innerHTML = `
    <div class="row ${clean ? 'ok' : 'dirty'}">
      <span>${clean ? '✓ sincronizado' : `${g.dirty.length} alteração(ões) local(ais)`}</span>
    </div>
    ${g.behind > 0 ? `<div class="row warn">→ ${g.behind} commit(s) para puxar</div>` : ''}
    ${g.ahead > 0 ? `<div class="row warn">↑ ${g.ahead} commit(s) não enviados</div>` : ''}
    ${
      g.lastCommit
        ? `<div class="row muted" title="${g.lastCommit.subject}">
             último: ${formatDate(g.lastCommit.date.slice(0, 10))} · ${g.lastCommit.hash}
           </div>`
        : ''
    }
    <div class="row-buttons">
      <button id="btn-pull" class="ghost tiny">Puxar</button>
    </div>`;

  $('#btn-pull')?.addEventListener('click', async () => {
    const pw = await askPassword({
      title: 'Puxar do GitHub',
      message: 'Sincronizar com o repositório remoto exige a sua senha para evitar mudanças não autorizadas.',
      confirm: 'Puxar',
    });
    if (pw === null) return;
    try {
      await api('POST', '/api/git/pull', { password: pw });
      await refreshGit();
      await loadList();
      if (state.current) await openPost(state.current.id);
    } catch (err) {
      setSaved(false, (err as Error).message);
    }
  });
}

// ------------------------------------------------------------------
// Estado "Salvo"
// ------------------------------------------------------------------
function setSaved(ok: boolean, message?: string) {
  state.savedAt = ok ? new Date() : null;
  saveState.textContent = ok
    ? message ?? `Salvo ✓ ${state.savedAt?.toLocaleTimeString() ?? ''}`
    : `${message ?? 'Alterações não salvas'} •`;
  saveState.className = ok ? 'save-state ok' : 'save-state err';
  const hasDirty = state.dirty.title || state.dirty.body || state.dirty.meta;
  ($('#btn-save') as HTMLButtonElement).disabled = !(
    state.current && (hasDirty || state.tagsDirty)
  );
  ($('#btn-publish') as HTMLButtonElement).disabled =
    !state.current || !fieldTitle.value.trim();
}

function setSaving(msg: string) {
  saveState.textContent = msg;
  saveState.className = 'save-state err';
}

// ------------------------------------------------------------------
// Autosave local (localStorage) — proteje contra fechamento acidental
// ------------------------------------------------------------------
const LS_KEY = 'writer:unsaved';
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(writeAutosave, 1500);
}

function writeAutosave() {
  if (!state.current) return;
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        id: state.current.id,
        title: fieldTitle.value,
        date: fieldDate.value,
        draft: fieldDraft.checked,
        description: fieldDescription.value,
        tags,
        body: currentBody(),
      }),
    );
  } catch {
    /* armazenamento indisponível — seguimos normalmente */
  }
}

function clearAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  localStorage.removeItem(LS_KEY);
}

function restoreAutosave() {
  const saved = localStorage.getItem(LS_KEY);
  if (!saved) {
    renderPreviewDebounced();
    return;
  }
  try {
    const s = JSON.parse(saved);
    // Reabre o post e aplica o conteúdo não salvo por cima.
    openPost(s.id)
      .then(() => {
        fieldTitle.value = s.title ?? '';
        fieldDate.value = s.date ?? '';
        fieldDraft.checked = s.draft ?? true;
        fieldDescription.value = s.description ?? '';
        tags = s.tags ?? [];
        renderTags();
        cmView?.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: s.body ?? '' } });
        renderPreview();
        setSaved(false, 'Retomado do autosave');
      })
      .catch(() => localStorage.removeItem(LS_KEY));
  } catch {
    localStorage.removeItem(LS_KEY);
  }
}

// ------------------------------------------------------------------
// Tela de senha (setup / bloqueio)
// ------------------------------------------------------------------
let authScreen!: HTMLElement;
let authForm!: HTMLFormElement;
let authPassword!: HTMLInputElement;
let authConfirm!: HTMLInputElement;
let authError!: HTMLElement;
let authTitle!: HTMLElement;
let authSub!: HTMLElement;
let authSubmit!: HTMLButtonElement;
let authExtra!: HTMLElement;
let authNote!: HTMLElement;
let authReset!: HTMLAnchorElement;
type AuthMode = 'setup' | 'lock';

function mountAuth() {
  const el = document.createElement('div');
  el.id = 'auth-screen';
  el.className = 'auth-screen';
  el.hidden = true;
  el.innerHTML = `
    <form id="auth-form" class="auth-card" autocomplete="on">
      <div class="auth-prompt" aria-hidden="true">&gt;_</div>
      <h1 class="auth-title" id="auth-title">Bem-vindo de volta</h1>
      <p class="auth-sub" id="auth-sub">O Writer está trancado. Digite a senha principal.</p>
      <div class="modal-msg" id="auth-error" role="alert"></div>
      <div class="auth-extra" id="auth-extra" hidden>
        <label class="auth-field">
          <span>Confirme a senha</span>
          <input id="auth-confirm" type="password" autocomplete="new-password" spellcheck="false" />
        </label>
        <p class="auth-note" id="auth-note"></p>
      </div>
      <label class="auth-field">
        <span>Senha</span>
        <input id="auth-password" type="password" autocomplete="current-password" spellcheck="false" />
      </label>
      <button id="auth-submit" class="primary" type="submit">Entrar</button>
      <div class="auth-reset"><a href="#" id="auth-reset">Esqueceu a senha?</a></div>
    </form>`;
  document.body.appendChild(el);

  authForm = $('#auth-form', el) as HTMLFormElement;
  authPassword = $('#auth-password', el) as HTMLInputElement;
  authConfirm = $('#auth-confirm', el) as HTMLInputElement;
  authError = $('#auth-error', el)!;
  authTitle = $('#auth-title', el)!;
  authSub = $('#auth-sub', el)!;
  authSubmit = $('#auth-submit', el) as HTMLButtonElement;
  authExtra = $('#auth-extra', el)!;
  authNote = $('#auth-note', el)!;
  authReset = $('#auth-reset', el) as HTMLAnchorElement;

  authForm.addEventListener('submit', submitAuth);
  authReset.addEventListener('click', (e) => {
    e.preventDefault();
    resetPasswordFlow();
  });
}

function showAuth(mode: AuthMode, message?: string) {
  const isSetup = mode === 'setup';
  authExtra.hidden = !isSetup;
  authTitle.textContent = isSetup ? 'Defina a senha do Writer' : 'Bem-vindo de volta';
  authSub.textContent = isSetup
    ? 'Ela protege as ações que mexem no seu arquivo: publicar, enviar ao GitHub e excluir.'
    : 'O Writer está trancado. Digite a senha principal para continuar.';
  authSubmit.textContent = isSetup ? 'Criar e entrar' : 'Entrar';
  authPassword.autocomplete = isSetup ? 'new-password' : 'current-password';
  authPassword.type = isSetup ? 'password' : 'password';
  authNote.textContent =
    'A senha fica apenas na sua máquina como um hash (scrypt). Sem ela, nada sai ao GitHub.';
  authReset.style.display =
    authInfo.configured || isSetup ? 'block' : 'none';
  authScreen.hidden = false;
  if (message) setAuthError(message);
  else setAuthError('');
  authPassword.value = '';
  authConfirm.value = '';
  setTimeout(() => authPassword.focus(), 0);
}

function hideAuth() {
  authScreen.hidden = true;
  setAuthError('');
}

function setAuthError(msg: string) {
  authError.textContent = msg;
  authError.hidden = !msg;
}

function lockAndShow(message?: string) {
  token = null;
  showAuth('lock', message);
}

async function submitAuth(e: SubmitEvent) {
  e.preventDefault();
  const pw = authPassword.value;
  if (authExtra.hidden) {
    // Bloqueio: destrancar.
    try {
      const r = await api<{ token: string }>('POST', '/api/auth/unlock', { password: pw });
      token = r.token;
      hideAuth();
      await resume();
    } catch (err) {
      setAuthError((err as Error).message);
      authPassword.value = '';
      authPassword.focus();
    }
    return;
  }
  // Configuração inicial: criar a senha.
  if (pw.length < 8) return setAuthError('A senha precisa ter ao menos 8 caracteres.');
  if (pw !== authConfirm.value) return setAuthError('As senhas não conferem.');
  try {
    const r = await api<{ token: string }>('POST', '/api/auth/setup', { password: pw });
    token = r.token;
    authInfo.configured = true;
    hideAuth();
    await resume();
  } catch (err) {
    setAuthError((err as Error).message);
  }
}

async function resetPasswordFlow() {
  const { root, close } = modal('Redefinir senha', `
    <p class="modal-message">
      Isso apaga a senha atual e o Writer volta para a primeira tela de
      configuração, onde você define uma nova. Os posts não são tocados —
      apenas a senha é removida desta máquina.
    </p>
    <div class="modal-actions">
      <button class="ghost" id="reset-cancel">Cancelar</button>
      <button class="danger" id="reset-ok">Redefinir senha</button>
    </div>`);
  $('#reset-cancel', root)?.addEventListener('click', close);
  $('#reset-ok', root)?.addEventListener('click', async () => {
    try {
      await api('POST', '/api/auth/reset');
    } catch (err) {
      setAuthError((err as Error).message);
    }
    token = null;
    authInfo.configured = false;
    close();
    showAuth('setup');
  });
}

// ------------------------------------------------------------------
// Configurações
// ------------------------------------------------------------------
async function openSettings() {
  let settings: {
    idleTimeoutMinutes: number;
    recentWindowMinutes: number;
    workspace: { root: string; contentRoot: string };
  } | null = null;
  try {
    settings = await api('GET', '/api/settings');
  } catch {
    /* sem acesso ainda */
  }
  const { root, close } = modal(
    'Configurações',
    `
    <section class="set-group">
      <h3>Bloqueio por inatividade</h3>
      <label class="auth-field"><span>Travar depois de</span>
        <select id="set-idle"></select>
      </label>
      <label class="auth-field"><span>Exigir senha de novo em operações (publicar/push/excluir) após</span>
        <select id="set-recent"></select>
      </label>
      <label class="auth-field"><span>Senha para aplicar</span>
        <input id="set-pw" type="password" autocomplete="off" spellcheck="false" />
      </label>
      <div class="modal-msg" id="set-msg" role="alert"></div>
      <div class="modal-actions">
        <button class="primary" id="set-apply">Aplicar</button>
      </div>
    </section>
    <section class="set-group">
      <h3>Trocar a senha</h3>
      <label class="auth-field"><span>Senha atual</span>
        <input id="set-cur" type="password" autocomplete="current-password" />
      </label>
      <label class="auth-field"><span>Nova senha (mín. 8)</span>
        <input id="set-new" type="password" autocomplete="new-password" />
      </label>
      <label class="auth-field"><span>Confirme a nova senha</span>
        <input id="set-new2" type="password" autocomplete="new-password" />
      </label>
      <div class="modal-msg" id="set-change-msg" role="alert"></div>
      <div class="modal-actions">
        <button class="ghost" id="set-change">Trocar senha</button>
      </div>
    </section>
    <section class="set-group">
      <h3>Pasta de trabalho</h3>
      <code id="set-workspace" class="set-workspace"></code>
      <div class="modal-actions">
        <button class="ghost" id="set-workspace-choose">Trocar pasta (exige senha)</button>
      </div>
    </section>`,
  );

  const setMsg = $('#set-msg', root)!;
  const setChangeMsg = $('#set-change-msg', root)!;
  const idleSel = $('#set-idle', root) as HTMLSelectElement;
  const recentSel = $('#set-recent', root) as HTMLSelectElement;

  idleSel.innerHTML = [
    [5, '5 minutos'],
    [15, '15 minutos'],
    [30, '30 minutos'],
    [60, '1 hora'],
    [-1, 'Nunca (não recomendado)'],
  ]
    .map(([v, label]) => `<option value="${v}">${label}</option>`)
    .join('');
  recentSel.innerHTML = [
    [1, '1 minuto'],
    [5, '5 minutos'],
    [10, '10 minutos'],
    [30, '30 minutos'],
    [-1, 'Nunca'],
  ]
    .map(([v, label]) => `<option value="${v}">${label}</option>`)
    .join('');

  if (settings) {
    idleSel.value = String(settings.idleTimeoutMinutes);
    recentSel.value = String(settings.recentWindowMinutes);
    $('#set-workspace', root)!.textContent = settings.workspace.root;
  }

  $('#set-workspace-choose', root)?.addEventListener('click', async () => {
    const pw = await askPassword({
      title: 'Trocar pasta de trabalho',
      message: 'Escolha a nova pasta do seu arquivo (a que tem a pasta content/). A senha é pedida para autorizar a mudança.',
      confirm: 'Continuar',
    });
    if (pw === null) return;
    try {
      const r = await api<{ ok: boolean; root?: string; error?: string }>('POST', '/api/workspace', {
        password: pw,
      });
      if (!r.ok || !r.root) {
        setMsgState(setMsg, r.error ?? 'Não foi possível trocar a pasta.', false);
        return;
      }
      $('#set-workspace', root)!.textContent = r.root;
      setMsgState(setMsg, 'Pasta de trabalho trocada. Puxando listagem...', true);
      await loadList();
      await refreshGit();
    } catch (err) {
      setMsgState(setMsg, (err as Error).message, false);
    }
  });

  $('#set-apply', root)?.addEventListener('click', async () => {
    const pw = ($('#set-pw', root) as HTMLInputElement).value;
    if (!pw) return setMsgState(setMsg, 'Digite sua senha.', false);
    try {
      const r = await api<AuthStatus>('POST', '/api/settings', {
        idleTimeoutMinutes: Number(idleSel.value),
        recentWindowMinutes: Number(recentSel.value),
        password: pw,
      });
      authInfo = r;
      ($('#set-pw', root) as HTMLInputElement).value = '';
      setMsgState(setMsg, 'Aplicado.', true);
    } catch (err) {
      setMsgState(setMsg, (err as Error).message, false);
    }
  });

  $('#set-change', root)?.addEventListener('click', async () => {
    const cur = ($('#set-cur', root) as HTMLInputElement).value;
    const nw = ($('#set-new', root) as HTMLInputElement).value;
    const nw2 = ($('#set-new2', root) as HTMLInputElement).value;
    if (!cur) return setMsgState(setChangeMsg, 'Digite a senha atual.', false);
    if (nw.length < 8) return setMsgState(setChangeMsg, 'A nova senha precisa de ao menos 8 caracteres.', false);
    if (nw !== nw2) return setMsgState(setChangeMsg, 'As senhas não conferem.', false);
    try {
      await api('POST', '/api/auth/password', { password: cur, newPassword: nw });
      close();
      token = null;
      showAuth('lock', 'Senha trocada. Use a nova senha para destrancar.');
    } catch (err) {
      setMsgState(setChangeMsg, (err as Error).message, false);
    }
  });
}

function setMsgState(el: HTMLElement, msg: string, ok: boolean) {
  el.textContent = msg;
  el.className = ok ? 'modal-msg ok' : 'modal-msg';
  el.hidden = false;
}

// ------------------------------------------------------------------
// Inicialização / retomada
// ------------------------------------------------------------------
async function resume() {
  state.tagsDirty = false;
  await Promise.all([loadList(), refreshGit()]);
  restoreAutosave();
}

async function pollSession() {
  if (!token) return;
  try {
    await api('GET', '/api/auth/session');
  } catch {
    /* api() mostra a tela de bloqueio quando o servidor devolve 401 */
  }
}

async function init() {
  mountAuth();
  let status: AuthStatus & { sessionValid: boolean };
  try {
    status = await api('GET', '/api/auth/status');
  } catch {
    showAuth('lock', 'Não consegui falar com o servidor local do Writer.');
    return;
  }
  authInfo = status;
  if (!status.configured) {
    showAuth('setup', 'Primeira vez por aqui? Defina uma senha para proteger o seu arquivo.');
    return;
  }
  showAuth('lock');
}

// Atualiza os contadores do Git e o estado da sessão periodicamente.
setInterval(refreshGit, 20000);
setInterval(pollSession, 30000);
init();