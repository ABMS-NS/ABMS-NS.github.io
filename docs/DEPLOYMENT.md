# Deploy

Documentação sobre deploy e hospedagem.

## GitHub Pages

O site é hospedado no GitHub Pages, em um subcaminho do domínio de
usuário:

```
https://abms-ns.github.io/blog/
```

> O repositório é o `ABMS-NS.github.io` (domínio de usuário). O site
> **não** fica na raiz: vive na subpasta `blog/` dele.

### Configuração

1. Vá em **Settings > Pages** no repositório GitHub
2. Em **Source**, selecione **GitHub Actions**
3. O deploy acontece automaticamente a cada push na branch `main`

### Domínio Personalizado

Para usar um domínio próprio:

1. Compre o domínio
2. Configure DNS para apontar para GitHub Pages
3. Crie um arquivo `CNAME` em `apps/blog/public/` com seu domínio
4. Atualize `site` no `astro.config.ts` (o subcaminho `/blog/` continua)

## GitHub Actions

O workflow de deploy está em `.github/workflows/deploy-blog.yml`.

### Fluxo

```
push na branch main
    │
    ▼
GitHub Actions
    │
    ├── Instalar dependências (npm install)
    ├── Verificar tipos (npm run check)
    ├── Calcular URL: base=/blog/ e site=https://abms-ns.github.io
    ├── Build do Astro (npm run build)
    ├── Mover dist/ para dentro de uma pasta blog/
    └── Deploy para GitHub Pages (sobe a pasta blog/ sob a raiz)
```

### Sobre o `/blog/` e o base path

- O Astro usa `base=/blog/` para gerar URLs corretas
  (`/blog/posts/...`, `/blog/rss.xml`, etc.). Links escritos à mão usam
  o helper `withBase()` em `apps/blog/src/lib/paths.ts`.
- O GitHub Pages não tem "base path": o conteúdo do artefato é servido a
  partir da raiz do domínio. Por isso o workflow **move o build para
  dentro de `blog/`** antes do upload, e adiciona `.nojekyll`.
- `import.meta.env.BASE_URL` (injetado pelo Astro) vale `/blog/` no
  build; usamos ele também no RSS e no robots.txt.

### Quando acontece

- A cada push na branch `main`
- A cada PR merging na branch `main`

### O que NÃO acontece

- Posts com `draft: true` não são incluídos no build
- O Writer não é deployado (é ferramenta local)

## Build Local

Para testar o build localmente:

```bash
# Build
npm run build

# Visualizar resultado
npm run preview
```

O build gera a pasta `apps/blog/dist/` com o site estático.

## Problemas Comuns

### Build falha no typecheck

```bash
npm run check
```

Corrija os erros TypeScript antes de push.

### Imagens não aparecem

Verifique se as imagens estão na pasta correta do post e referenciadas corretamente no Markdown.

### Deploy não acontece

1. Verifique se o push foi para a branch correta
2. Verifique as GitHub Actions em **Actions** no repositório
3. Verifique se o Pages está configurado para **GitHub Actions**

### Site aparece 404

1. Verifique o `base` no `astro.config.ts` (padrão: `/blog/`)
2. Confirme que o workflow moveu o build para dentro de uma pasta `blog/`
   antes do upload de páginas
3. Verifique se o Pages está em **GitHub Actions** como source
