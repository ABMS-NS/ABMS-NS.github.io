# Meu Arquivo Pessoal

Um arquivo pessoal na internet: coisas que estou fazendo, aprendendo e construindo.

## O que é

Este repositório contém meu arquivo pessoal digital — um site para documentar:

- faculdade
- pesquisa
- programação
- Linux
- projetos pessoais
- estudos
- ideias
- coisas que aprendi

## Estrutura

```
apps/
├── blog/     → Site público (Astro)
└── writer/   → Ferramenta de escrita (local)

content/
├── posts/    → Artigos e tutoriais
├── projects/ → Documentação de projetos
└── notes/    → Notas rápidas

docs/         → Documentação do projeto
```

## Como usar

### Blog (desenvolvimento)

```bash
npm install
npm run dev
# http://localhost:4321
```

### Writer (local)

```bash
npm install
npm run writer
# http://localhost:4322
```

### Publicar um post

1. Abra o Writer
2. Crie ou edite um post
3. Clique em "Publicar"
4. O site é atualizado automaticamente

## Tecnologias

- **Astro** — site estático
- **Hono** — servidor do Writer
- **CodeMirror** — editor de código
- **GitHub Pages** — hospedagem
- **Git** — versionamento

## License

MIT
