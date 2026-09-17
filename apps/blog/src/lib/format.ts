// Utilitários de formatação de data.
//
// Os frontmatter usam datas apenas (YYYY-MM-DD), que o Zod interpreta
// como meia-noite em UTC. Se formatarmos no fuso local do servidor,
// o dia pode "andar" um para trás (ex.: mostra 16/09 para 2026-09-17).
// Por isso fixamos `timeZone: 'UTC'`: o dia exibido é exatamente o
// que foi escrito no arquivo Markdown.
export const shortDate = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export const longDate = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});