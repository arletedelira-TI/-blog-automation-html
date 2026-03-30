#!/usr/bin/env node
/**
 * inject.js — Pipeline de publicação no Blogger
 *
 * Mantém a autenticação OAuth (CLIENT_ID + CLIENT_SECRET + REFRESH_TOKEN)
 * do publish.js original e adiciona injeção de CSS+JS do template.
 *
 * Uso:
 *   node scripts/inject.js posts/meu-post.html
 *   node scripts/inject.js posts/meu-post.html --draft
 *   node scripts/inject.js posts/meu-post.html --watch
 *   node scripts/inject.js posts/meu-post.html --id=POST_ID
 *   node scripts/inject.js --all
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

// Carrega .env automaticamente (desenvolvimento local)
try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
      const [key, ...val] = line.split('=');
      if (key && val.length) {
        process.env[key.trim()] = val.join('=').trim().replace(/^"|"$/g, '');
      }
    });
  }
} catch (_) {}

// Configuração — mesmas variáveis do publish.js original
const CONFIG = {
  templatePath : path.resolve(__dirname, '../template/base.html'),
  distDir      : path.resolve(__dirname, '../dist'),
  blogId       : process.env.BLOG_ID               || '',
  clientId     : process.env.GOOGLE_CLIENT_ID      || '',
  clientSecret : process.env.GOOGLE_CLIENT_SECRET  || '',
  refreshToken : process.env.BLOGGER_REFRESH_TOKEN || '',
};

// Gera access token via refresh token (sem axios, sem dependências externas)
function getAccessToken() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      client_id     : CONFIG.clientId,
      client_secret : CONFIG.clientSecret,
      refresh_token : CONFIG.refreshToken,
      grant_type    : 'refresh_token',
    });
    const options = {
      hostname: 'oauth2.googleapis.com',
      path    : '/token',
      method  : 'POST',
      headers : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          json.access_token ? resolve(json.access_token) : reject(new Error('OAuth falhou: ' + JSON.stringify(json)));
        } catch (e) { reject(new Error('Resposta OAuth inválida: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Extrai <title> do HTML
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : 'Sem título';
}

// Extrai conteúdo do <body>
function extractBody(html) {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1].trim() : html.trim();
}

// Injeta corpo do post no template base
function buildFinalHtml(postHtml, templateHtml) {
  const title = extractTitle(postHtml);
  const body  = extractBody(postHtml);
  const html  = templateHtml.replace('{{POST_TITLE}}', title).replace('{{POST_BODY}}', body);
  return { title, html };
}

// Publica ou atualiza post no Blogger
function postToBlogger({ token, title, content, isDraft, postId }) {
  return new Promise((resolve, reject) => {
    const bodyData = JSON.stringify({
      kind: 'blogger#post',
      title,
      content,
      ...(isDraft ? { status: 'DRAFT' } : {}),
    });
    const method  = postId ? 'PUT' : 'POST';
    const urlPath = postId
      ? `/blogger/v3/blogs/${CONFIG.blogId}/posts/${postId}`
      : `/blogger/v3/blogs/${CONFIG.blogId}/posts/`;
    const options = {
      hostname: 'www.googleapis.com',
      path    : urlPath,
      method,
      headers : {
        'Content-Type'  : 'application/json',
        'Authorization' : `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(bodyData),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          res.statusCode >= 400
            ? reject(new Error(`Blogger API ${res.statusCode}: ${json.error?.message || data}`))
            : resolve(json);
        } catch (e) { reject(new Error('Resposta inválida da API: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(bodyData);
    req.end();
  });
}

// Processa um arquivo de post
async function processFile(postPath, { isDraft, postId, token }) {
  console.log(`\n📄  Processando: ${path.basename(postPath)}`);

  if (!fs.existsSync(postPath)) {
    console.error(`    ❌  Arquivo não encontrado: ${postPath}`); return;
  }
  if (!fs.existsSync(CONFIG.templatePath)) {
    console.error(`    ❌  Template não encontrado. Crie: template/base.html`); return;
  }

  const postHtml     = fs.readFileSync(postPath, 'utf-8');
  const templateHtml = fs.readFileSync(CONFIG.templatePath, 'utf-8');
  const { title, html: finalHtml } = buildFinalHtml(postHtml, templateHtml);
  console.log(`    Título: "${title}"`);

  // Salva HTML final em dist/
  if (!fs.existsSync(CONFIG.distDir)) fs.mkdirSync(CONFIG.distDir, { recursive: true });
  const distFile = path.join(CONFIG.distDir, path.basename(postPath, '.html') + '.final.html');
  fs.writeFileSync(distFile, finalHtml, 'utf-8');
  console.log(`    ✅  HTML salvo em: dist/${path.basename(distFile)}`);

  // Publica no Blogger
  const temCredenciais = CONFIG.blogId && CONFIG.clientId && CONFIG.clientSecret && CONFIG.refreshToken;
  if (temCredenciais) {
    try {
      const accessToken = token || await getAccessToken();
      const result = await postToBlogger({ token: accessToken, title, content: finalHtml, isDraft, postId });
      console.log(`    🚀  Post ${isDraft ? 'rascunho' : 'publicado'} no Blogger!`);
      if (result.url) console.log(`    🔗  URL: ${result.url}`);
      if (result.id)  console.log(`    🆔  ID: ${result.id}  → use --id=${result.id} para atualizar`);
    } catch (err) {
      console.error(`    ❌  Erro ao publicar: ${err.message}`);
    }
  } else {
    console.log(`    ⚠️   Credenciais não configuradas — HTML local gerado apenas.`);
    console.log(`        Configure no .env: BLOG_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BLOGGER_REFRESH_TOKEN`);
  }
}

// Main
async function run(args) {
  const isDraft = args.includes('--draft');
  const isWatch = args.includes('--watch');
  const isAll   = args.includes('--all');
  const postId  = (args.find(a => a.startsWith('--id=')) || '').split('=')[1];
  const postArg = args.find(a => !a.startsWith('--'));

  if (isAll) {
    const postsDir = path.resolve(__dirname, '../posts');
    const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.html'));
    if (!files.length) { console.log('\n⚠️   Nenhum .html em posts/\n'); return; }
    console.log(`\n📦  Publicando ${files.length} post(s)...\n`);
    const temCredenciais = CONFIG.blogId && CONFIG.clientId && CONFIG.clientSecret && CONFIG.refreshToken;
    const token = temCredenciais ? await getAccessToken() : null;
    for (const file of files) await processFile(path.join(postsDir, file), { isDraft, token });
    console.log('\n✅  Concluído!\n');
    return;
  }

  if (!postArg) {
    console.error('\n❌  Uso:');
    console.error('    node scripts/inject.js posts/meu-post.html');
    console.error('    node scripts/inject.js posts/meu-post.html --draft');
    console.error('    node scripts/inject.js posts/meu-post.html --watch');
    console.error('    node scripts/inject.js posts/meu-post.html --id=POST_ID');
    console.error('    node scripts/inject.js --all\n');
    process.exit(1);
  }

  const postPath = path.resolve(postArg);
  await processFile(postPath, { isDraft, postId });

  if (isWatch) {
    console.log(`\n👁️   Watch mode — aguardando alterações em ${path.basename(postPath)}...\n`);
    fs.watch(postPath, async (event) => {
      if (event === 'change') {
        console.log(`🔄  Alteração detectada — reprocessando...`);
        await processFile(postPath, { isDraft, postId });
      }
    });
  }
}

run(process.argv.slice(2)).catch(err => {
  console.error('\n❌  Erro fatal:', err.message);
  process.exit(1);
});