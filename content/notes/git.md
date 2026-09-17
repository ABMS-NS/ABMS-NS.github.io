---
title: "Git — Notas rápidas"
description: "Comandos e conceitos do Git que uso frequentemente."
pubDate: 2026-09-17
tags:
  - git
  - ferramentas
---

# Git — Notas rápidas

## Comandos básicos

```bash
# Criar branch
git branch nome-da-branch

# Mudar para branch
git checkout nome-da-branch

# Ver status
git status

# Ver histórico
git log --oneline -10
```

## Conceitos importantes

- **Working directory** — onde estou editando
- **Staging area** — arquivos que selecionei para commit
- **Repository** — o histórico completo de commits

## Fluxo que uso

1. Edito arquivos
2. `git add` nos arquivos que quero versionar
3. `git commit` com mensagem descritiva
4. `git push` para enviar ao GitHub
