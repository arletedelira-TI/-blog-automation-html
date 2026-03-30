#!/usr/bin/env node
/**
 * new-post.js — Cria um novo arquivo de post a partir do template mínimo
 * Uso: npm run new "titulo-do-post"
 */
const fs   = require('fs');
const path = require('path');

const rawTitle = process.argv[2] || 'novo-post';
const slug     = rawTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
const title    = rawTitle.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
const filename = path.resolve(__dirname, '../posts', `${slug}.html`);

if (fs.existsSync(filename)) {
  console.error(`❌  Arquivo já existe: posts/${slug}.html`);
  process.exit(1);
}

const template = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
</head>
<body>
  <!-- ✏️ Edite apenas aqui. CSS e JS são injetados automaticamente pelo inject.js -->

  <h1>${title}</h1>

  <p>Escreva a introdução do post aqui.</p>

  <h2>Primeiro tópico</h2>
  <p>Conteúdo...</p>

</body>
</html>
`;

fs.mkdirSync(path.dirname(filename), { recursive: true });
fs.writeFileSync(filename, template, 'utf-8');
console.log(`✅  Post criado: posts/${slug}.html`);
console.log(`    Edite o arquivo e depois rode: npm run pub posts/${slug}.html`);