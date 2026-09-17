# Blog

Documentação do blog pessoal.

## Início Rápido

```bash
# Instalar dependências
npm install

# Iniciar servidor de desenvolvimento
npm run dev

# Build para produção
npm run build

# Visualizar build
npm run preview
```

## Tecnologias

- **Astro** — gerador de sites estáticos
- **TypeScript** — tipagem estática
- **Markdown/MDX** — formato de conteúdo
- **CSS** — estilos customizados

## Estrutura

```
apps/blog/
├── src/
│   ├── content/     → symlink para ../../content/
│   ├── layouts/     → layouts de página
│   ├── components/  → componentes Astro
│   ├── pages/       → rotas do site
│   └── styles/      → estilos globais
├── public/          → assets estáticos
├── astro.config.ts  → configuração do Astro
└── tsconfig.json    → configuração TypeScript
```

## Páginas

| Rota | Descrição |
|------|-----------|
| `/` | Home — apresentação e conteúdo recente |
| `/posts` | Lista de todos os posts |
| `/posts/[slug]` | Post individual |
| `/projects` | Lista de projetos |
| `/projects/[slug]` | Projeto individual |
| `/notes` | Lista de notas |
| `/archive` | Arquivo cronológico |
| `/tags/[tag]` | Posts por tag |
| `/about` | Sobre |

## Conteúdo

O blog lê arquivos Markdown de `content/`:

```
content/
├── posts/       → artigos e tutoriais
├── projects/    → documentação de projetos
└── notes/       → notas rápidas
```

Cada post pode ser um arquivo `.md` ou uma pasta com `index.md` + imagens.

## Frontmatter

```yaml
---
title: "Título do post"
description: "Descrição curta"
pubDate: 2026-09-17
tags:
  - tag1
  - tag2
draft: false
---
```

- `draft: true` — post não aparece no site público
- `tags` — usadas para agrupar e filtrar conteúdo

## Dark Mode

O site detecta a preferência do sistema e oferece botão para alternar.

- Preferência salva no `localStorage`
- Tema claro e escuro
- Transição suave

## Deploy

O blog é deployado automaticamente via GitHub Actions a cada push.

Veja [DEPLOYMENT.md](./DEPLOYMENT.md) para detalhes.
