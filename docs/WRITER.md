# Writer

Ferramenta pessoal para escrever, editar e publicar conteúdo.

## O que é

O Writer é um **app web que roda localmente** no seu computador:

- um servidor Hono (Node.js) que manipula os arquivos Markdown e executa Git;
- uma interface com editor CodeMirror, preview e biblioteca de posts.

Ele não é uma página `/admin` do blog — é uma aplicação independente em
`apps/writer/`, executada à parte do site.

```
npm run writer
# abre em http://localhost:4322
```

## Arquitetura

```
Navegador (localhost:4322)
   │  API JSON (fetch)
   ▼
Hono (server)
   ├── content.ts   → lê/escreve arquivos em content/
   └── git.ts       → executa git add/commit/push via CLI
                        │
                        ▼
               Git instalado na sua máquina
               (usa as credenciais do sistema)
```

### Tecnologias

| Parte      | Escolha            | Por quê                                    |
|------------|--------------------|---------------------------------------------|
| Servidor   | Hono + TypeScript  | leve, sem build manual (tsx)                |
| Editor     | CodeMirror 6       | markdown, realce de sintaxe, atalhos        |
| Preview    | marked + DOMPurify | renderização no navegador + sanitização     |
| Bundle cli | esbuild (memória)  | cliente TS compilado na hora, sem passo de build |

### Arquivos

```
apps/writer/
├── src/
│   ├── server/
│   │   ├── index.ts    → rotas HTTP (posts, git)
│   │   ├── content.ts  → CRUD dos posts + frontmatter
│   │   ├── git.ts      → operações Git
│   │   └── fs.ts       → caminhos (content/, repo)
│   ├── client/
│   │   ├── main.ts     → interface (editor, preview, lista)
│   │   └── styles.css  → visual
│   └── shared/
│       └── types.ts    → tipos Post, GitStatus, etc.
├── package.json
└── tsconfig.json
```

## Como usar

### Criar um post

1. Clique em **+ Novo**.
2. Digite o título (gera a pasta `content/posts/YYYY-MM-DD-titulo/`).
3. Escreva em Markdown no painel esquerdo.
4. Veja o resultado no **Preview**.
5. Adicione tags (Enter para confirmar).
6. Clique em **Salvar** (grava no disco) ou **Publicar**.

### Publicar

"Publicar" faz, em sequência:

1. grava o arquivo (com `draft: false`);
2. `git add content/`;
3. `git commit -m "post: <título>"`;
4. `git push`.

Depois disso o GitHub Actions reconstrói o site automaticamente.

> O Writer não "envia para um banco": ele registra uma nova versão dos
> arquivos Markdown no Git. O site é derivado desses arquivos.

### Rascunhos

- Post criado nasce como rascunho (`draft: true`).
- Rascunhos **não aparecem** no site.
- O painel do Git mostra alterações locais pendentes.

### Duplicar / Excluir

Passe o mouse sobre um post na lista para ver os botões de duplicar (⧉) e
excluir (×). Excluir remove arquivos e imagens da pasta do post.

### Imagens

1. Clique em **+ imagem** no painel Markdown.
2. Escolha um arquivo.
3. O Writer salva a imagem na **pasta do post** e insere
   `![nome](imagem.png)` no Markdown.

Imagens viajam junto com o post no Git.

### Atalhos

| Atalho      | Ação         |
|-------------|--------------|
| `Ctrl+S`    | Salvar no disco |
| `Ctrl+B`    | Negrito (CodeMirror) |
| `Ctrl+K`    | Link (CodeMirror) |
| `Ctrl+Z/Y`  | Desfazer/refazer |

### Autosave

Enquanto você digita, o conteúdo é guardado no `localStorage` do navegador
(debounce de 1.5s). Se a janela fechar sem salvar, o Writer oferece o conteúdo
de volta ao reabrir.

## Git

O Writer **não guarda credenciais**. Ele apenas executa o Git CLI:

- **SSH** → usa sua chave SSH (`~/.ssh`).
- **HTTPS** → usa o credential helper do Git (ex.: `gh auth`).

Para autenticar o repositório pela primeira vez:

```bash
# se ainda não tem o GitHub CLI:
gh auth login

# ou configure um remote HTTPS/SSH
git remote add origin git@github.com:seu-usuario/seu-repositorio.git
```

### Garantia de segurança

- Nenhum token entra no código, no frontend ou no repositório.
- `git push --dry-run` é usado para checar a autenticação sem enviar nada.
- Se o push falhar (sem remote, sem login), o erro do Git aparece na
  interface, sem quebra do app.

### O que o painel Git mostra

- branch atual;
- quantos arquivos de `content/` estão modificados;
- commits à frente/atrás do remoto;
- último commit.

## Porta e configuração

- Padrão: `4322`.
- Para mudar: `WRITER_PORT=5000 npm run writer`.

## Build de produção

```bash
npm run build --workspace=apps/writer   # gera apps/writer/dist/writer.js
WRITER_PORT=4322 node apps/writer/dist/writer.js
```

## Como alterar o editor

- Tema do editor: `editorTheme` em `src/client/main.ts`.
- Extensões do CodeMirror: lista em `extensions` dentro de `createEditor()`.
- Estilo da interface: `src/client/styles.css` (variáveis de claro/escuro).

## Limitações conhecidas

- O Writer gerencia a coleção **posts** — que é todo o conteúdo do site.
- É uma ferramenta local: não há login, multi-usuário nem backup em nuvem
  fora do Git.