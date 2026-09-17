# Conteúdo

Documentação sobre a estrutura e organização do conteúdo.

## Estrutura

```
content/
├── posts/           → artigos, tutoriais, reflexões
├── projects/        → documentação de projetos
└── notes/           → notas rápidas, referências
```

## Posts

### Arquivo simples

Para posts sem imagens:

```
content/posts/2026-09-20-fedora.md
```

### Pasta com imagens

Para posts com imagens:

```
content/posts/2026-09-17-comecando/
├── index.md
├── banner.png
└── diagrama.png
```

### Frontmatter

```yaml
---
title: "Título do post"
description: "Descrição curta para SEO e cards"
pubDate: 2026-09-17
tags:
  - pessoal
  - programação
draft: false
---
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `title` | string | Sim | Título do post |
| `description` | string | Sim | Descrição curta |
| `pubDate` | date | Sim | Data de publicação |
| `tags` | array | Não | Tags para categorização |
| `draft` | boolean | Não | Se `true`, não é publicado |

## Projetos

### Estrutura

```
content/projects/apeiron.md
```

### Frontmatter

```yaml
---
title: "Nome do Projeto"
description: "Descrição do projeto"
pubDate: 2026-09-17
tags:
  - projeto
  - astro
status: "ativo"
links:
  - label: "GitHub"
    url: "https://github.com/..."
---
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `title` | string | Sim | Nome do projeto |
| `description` | string | Sim | Descrição curta |
| `pubDate` | date | Sim | Data de criação |
| `tags` | array | Não | Tags |
| `status` | string | Não | "ativo", "pausado", "concluido" |
| `links` | array | Não | Links externos |

## Notas

### Estrutura

```
content/notes/git.md
```

### Frontmatter

```yaml
---
title: "Git — Notas rápidas"
description: "Comandos e conceitos do Git"
pubDate: 2026-09-17
tags:
  - git
  - ferramentas
---
```

## Tags

Tags são usadas para agrupar conteúdo relacionado.

- Use letras minúsculas
- Use hífen para múltiplas palavras: `ci-cd`
- Seja consistente

Exemplos de tags:

```
pessoal, programação, linux, git, astro, projeto, faculdade, pesquisa
```

## Drafts

Posts com `draft: true` **não aparecem** no site público.

O Writer mostra claramente se um documento é rascunho ou publicado.

## Imagens

### Regras

1. Imagens ficam na mesma pasta do post
2. Use formatos modernos quando possível (WebP, PNG)
3. Nomes descritivos em minúsculas: `banner.png`, `diagrama-arquitetura.png`
4. Referencie com caminho relativo: `![alt](banner.png)`

### Exemplo

```
content/posts/2026-09-17-comecando/
├── index.md           → post principal
├── banner.png         → imagem de capa
└── screenshot.png     → imagem no conteúdo
```

No Markdown:

```markdown
![Banner do post](banner.png)

# Título

...

![Screenshot](screenshot.png)
```

## Portabilidade

Todo o conteúdo é Markdown puro com frontmatter YAML.

Isso significa:

- Pode ser migrado para qualquer gerador de sites
- Pode ser lido em qualquer editor
- Pode ser versionado com Git
- Não depende de nenhuma plataforma
