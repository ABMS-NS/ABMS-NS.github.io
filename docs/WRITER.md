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
| Bundle     | esbuild pré-compilado | cliente servido do disco (dist/client), boot sem compilação |

### Arquivos

```
apps/writer/
├── src/
│   ├── server/
│   │   ├── index.ts      → rotas HTTP (posts, git, auth) + middlewares
│   │   ├── auth.ts       → senha principal, sessões, rate limit
│   │   ├── content.ts    → CRUD dos posts + frontmatter
│   │   ├── git.ts        → operações Git
│   │   ├── fs.ts         → caminhos (content/, repo, dataDir)
│   │   └── standalone.ts → entry de execução (npm dev / bundle CJS)
│   ├── client/
│   │   ├── main.ts       → interface (editor, preview, lista, tela de senha)
│   │   └── styles.css    → visual
│   └── shared/
│       └── types.ts      → tipos Post, GitStatus, AuthStatus, etc.
├── electron.d.ts         → tipagem do import dinâmico do safeStorage
├── build.mjs             → build do bundle CJS (writer.cjs)
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

## Segurança

O Writer é **local**, mas protege as ações que mexem no seu arquivo com uma
**senha principal** configurada na primeira execução.

### Modelo

- **Senha nunca vai para o disco em texto puro.** Guardamos só um hash
  `scrypt` com salt próprio. No aplicativo desktop, o arquivo de senha ainda é
  criptografado pelo `safeStorage` do sistema (DPAPI no Windows, Keychain no
  macOS).
- **Sessão em memória.** O token de sessão vive apenas na memória do processo;
  fechou o app ou o navegador, acabou. Ao abrir, o Writer pede a senha de novo.
- **Bloqueio por inatividade.** Após X minutos sem interagir (padrão 15), a
  sessão é encerrada e a tela de senha reaparece. Configurável em
  **Config → Bloqueio por inatividade**.
- **Senha fresca em operações sensíveis.** Publicar, push, commit, pull,
  excluir posts, mudar configuração e trocar de pasta pedem a **digitação da
  senha** a cada vez, mesmo com a sessão aberta.
- **Rate limit com backoff exponencial.** Tentativas erradas dobram o tempo de
  espera (2s → 4s → 8s … até 5 min), travando ataques de força bruta.
- **Reset de recuperação.** "Esqueceu a senha" apaga a configuração local e
  volta à primeira tela — os posts não são tocados.

### Fluxos

| Ação                          | Exige                              |
|-------------------------------|------------------------------------|
| Abrir o Writer                | senha (tela de bloqueio)           |
| Listar/abrir/duplicar posts   | sessão ativa                       |
| Salvar rascunho / enviar imagem | sessão ativa                     |
| **Publicar**                  | sessão + senha na hora             |
| **Puxar/commit/push**         | sessão + senha na hora             |
| **Excluir post**              | sessão + senha na hora             |
| **Configuração / troca de senha / pasta** | sessão + senha na hora    |

### Garantias adicionais

- A senha não aparece em logs nem viaja em URLs (sempre no corpo, sobre loop-
  back local).
- Nenhum token GitHub entra no código: o Git CLI usa as credenciais do sistema.
- `git push --dry-run` checa a autenticação sem enviar nada.
- A janela do app desktop roda com `contextIsolation` + `sandbox` ligados e sem
  `nodeIntegration` — o conteúdo é só a interface HTTP local.

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
npm run build --workspace=apps/writer   # gera dist/client/ + dist/writer.cjs
WRITER_PORT=4322 node apps/writer/dist/writer.cjs
```

O bundle CJS (`writer.cjs`) empacota o servidor inteiro e pode ser tanto
executado com `node` quanto `require()`d pelo app desktop.

## Aplicativo desktop

Em `desktop-writer/` há um embrulho Electron do mesmo servidor (roda o Writer
no seu processo principal, sem janela `node` extra):

```bash
cd desktop-writer
npm install            # baixa o Electron (uma vez)
npm run build --prefix ../apps/writer   # gera o dist do Writer
npm start              # roda em janela própria, sem depender de navegador
```

Para gerar o executável do Windows (portable) ou AppImage do Linux:

```bash
npm run build:win      # precisa do wine/Windows para assinar/empacotar
npm run build:linux
```

Na primeira execução o desktop pede a pasta do seu arquivo (a que tem `content/`).
Você pode trocar depois em **Config → Trocar pasta**.

## Como alterar o editor

- Tema do editor: `editorTheme` em `src/client/main.ts`.
- Extensões do CodeMirror: lista em `extensions` dentro de `createEditor()`.
- Estilo da interface: `src/client/styles.css` (variáveis de claro/escuro).

## Limitações conhecidas

- O Writer gerencia a coleção **posts** — que é todo o conteúdo do site.
- A proteção por senha vale para a interface local; quem já tiver acesso
  físico ao disco pode ler o conteúdo (que é Git, com histórico).
- A senha é recuperável via "Esqueceu a senha" (apaga o hash local).
- Primeira execução exige definir a senha; depois disso, toda abertura o Writer
  começa travado.