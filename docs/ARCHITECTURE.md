# Arquitetura

Visão geral do sistema **Meu Arquivo Pessoal**.

## Conceito

O sistema é composto por dois aplicativos independentes que trabalham com o mesmo conteúdo:

```
┌──────────────────────────────────────────────────────────────┐
│                         CONTENT                              │
│                                                              │
│  content/posts/    → artigos, tutoriais, reflexões           │
│  content/projects/ → documentação de projetos                 │
│  content/notes/    → notas rápidas, referências               │
│                                                              │
│  Arquivos Markdown versionados no Git                        │
│  Esta é a FONTE DA VERDADE                                  │
└────────────────────────┬─────────────────────────────────────┘
                         │
            ┌────────────┴────────────┐
            │                         │
            ▼                         ▼
    ┌───────────────┐         ┌───────────────┐
    │     BLOG      │         │    WRITER     │
    │               │         │               │
    │  Astro        │         │  Hono +       │
    │  lê content/  │         │  CodeMirror   │
    │  gera HTML    │         │  edita        │
    │  publica      │         │  content/     │
    └───────┬───────┘         └───────┬───────┘
            │                         │
            │ build                   │ git push
            ▼                         ▼
    ┌───────────────┐         ┌───────────────┐
    │  GITHUB       │         │  GITHUB       │
    │  PAGES        │         │  (origem)     │
    │               │         │               │
    │  site público │         │  repositório  │
    └───────────────┘         └───────────────┘
```

## Responsabilidades

### Blog

- Ler arquivos Markdown de `content/`
- Gerar páginas HTML estáticas
- Renderizar tags, arquivos, projetos
- Fornecer RSS, sitemap, SEO
- Ser hospedado no GitHub Pages
- **NUNCA** escrever no repositório

### Writer

- Criar, editar e excluir posts
- Gerenciar frontmatter
- Renderizar preview de Markdown
- Executar Git (add, commit, push)
- Ser executado localmente
- **NUNCA** expor credenciais

### Conteúdo

- Viver como arquivos Markdown
- Ser versionado pelo Git
- Ser independente de frameworks
- Funcionar com qualquer gerador de sites

## Fluxo de Publicação

```
1. Abro o Writer (npm run writer)
2. Crio ou edito um post
3. Vejo o preview
4. Clico em "Publicar"
5. Writer executa:
     git add content/
     git commit -m "post: título"
     git push
6. GitHub Actions detecta o push
7. Actions executa:
     npm install
     npm run check
     npm run build
     Deploy para GitHub Pages
8. Site atualizado
```

## Decisões Arquiteturais

### Monorepo

Escolhi monorepo porque:
- Um clone traz tudo
- Blog e Writer acessam o mesmo `content/`
- Deploy usa o mesmo repositório
- Estrutura autoexplicativa

### Writer como app web local

Escolhi Hono + CodeMirror porque:
- Sem dependências nativas (diferente de Electron)
- Experiência de edição excelente
- Roda em qualquer SO com Node.js
- Simples de manter

### Git CLI para publicação

Escolhi usar Git CLI porque:
- Não armazena tokens no Writer
- Usa autenticação já existente no sistema
- Funciona com SSH e HTTPS
- Simples e seguro

### Imagens co-localizadas

Escolhi imagens junto ao post porque:
- Imagens ficam associadas ao post
- Ao excluir post, imagens vão junto
- Writer facilita upload para diretório correto
- Astro copia para `public/` no build
