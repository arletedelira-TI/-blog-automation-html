#!/usr/bin/env node
/**
 * inject.js — Pipeline de publicação no Blogger (LMS Edition)
 *
 * Lê posts/meu-post.html, injeta no template/base.html e publica.
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

const CONFIG = {
  templatePath : path.resolve(__dirname, '../template/base.html'),
  distDir      : path.resolve(__dirname, '../dist'),
  blogId       : process.env.BLOG_ID               || '',
  clientId     : process.env.GOOGLE_CLIENT_ID      || '',
  clientSecret : process.env.GOOGLE_CLIENT_SECRET  || '',
  refreshToken : process.env.BLOGGER_REFRESH_TOKEN || '',
};

// ─── OAuth ────────────────────────────────────────────────────────────────────
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

// ─── Extratores ───────────────────────────────────────────────────────────────

// Extrai <title>
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : 'Sem título';
}

// Lê uma <meta name="X" content="Y"> do post
function extractMeta(html, name, fallback = '') {
  const re = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']`, 'i');
  const m  = html.match(re);
  return m ? m[1].trim() : fallback;
}

// Extrai o conteúdo do <body> e divide nos painéis via comentários <!-- PANEL:xxx -->
function extractPanels(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;

  // Divide o body nos marcadores <!-- PANEL:code -->, <!-- PANEL:diagram -->, <!-- PANEL:quiz -->
  const parts   = body.split(/<!--\s*PANEL:(code|diagram|quiz)\s*-->/i);
  const markers = [...body.matchAll(/<!--\s*PANEL:(code|diagram|quiz)\s*-->/gi)].map(m => m[1].toLowerCase());

  const panels = { doc: parts[0].trim(), code: '', diagram: '', quiz: '' };
  markers.forEach((key, i) => {
    panels[key] = (parts[i + 1] || '').trim();
  });

  return panels;
}

// ─── Builder ──────────────────────────────────────────────────────────────────
function buildFinalHtml(postHtml, templateHtml) {
  const title    = extractTitle(postHtml);
  const subtitle = extractMeta(postHtml, 'post-subtitle', 'Publicado no blog.');
  const category = extractMeta(postHtml, 'post-category', 'Geral');
  const badge1   = extractMeta(postHtml, 'post-badge-1', 'Artigo');
  const badge2   = extractMeta(postHtml, 'post-badge-2', '');
  const time     = extractMeta(postHtml, 'post-time', '~10 min');
  const quiz     = extractMeta(postHtml, 'quiz-count', '0');

  const panels   = extractPanels(postHtml);

  let html = templateHtml;

  // Placeholders de texto
  html = html.replace(/\{\{POST_TITLE\}\}/g,    title);
  html = html.replace(/\{\{POST_SUBTITLE\}\}/g,  subtitle);
  html = html.replace(/\{\{POST_CATEGORY\}\}/g,  category);
  html = html.replace(/\{\{POST_BADGE_1\}\}/g,   badge1);
  html = html.replace(/\{\{POST_BADGE_2\}\}/g,   badge2);
  html = html.replace(/\{\{POST_TIME\}\}/g,      time);
  html = html.replace(/\{\{QUIZ_COUNT\}\}/g,     quiz);
  html = html.replace(/\{\{BLOG_TITLE\}\}/g,     'SYSTEM LMS');

  // Painéis
  html = html.replace(/\{\{POST_BODY\}\}/g,      panels.doc);
  html = html.replace(/\{\{PANEL_CODE\}\}/g,     panels.code);
  html = html.replace(/\{\{PANEL_DIAGRAM\}\}/g,  panels.diagram);
  html = html.replace(/\{\{PANEL_QUIZ\}\}/g,     panels.quiz);

  // Badge 2: só mostra se existir
  if (!badge2) {
    html = html.replace(/<span class="badge badge-yellow">[^<]*\{\{POST_BADGE_2\}\}[^<]*<\/span>/g, '');
  }

  return { title, html };
}

// ─── Blogger API ──────────────────────────────────────────────────────────────
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

// ─── Processar arquivo ────────────────────────────────────────────────────────
async function processFile(postPath, { isDraft, postId, token }) {
  console.log(`\n📄  Processando: ${path.basename(postPath)}`);

  if (!fs.existsSync(postPath)) {
    console.error(`    ❌  Arquivo não encontrado: ${postPath}`); return;
  }
  if (!fs.existsSync(CONFIG.templatePath)) {
    console.error(`    ❌  Template não encontrado. Esperado em: template/base.html`); return;
  }

  const postHtml     = fs.readFileSync(postPath, 'utf-8');
  const templateHtml = fs.readFileSync(CONFIG.templatePath, 'utf-8');
  const { title, html: finalHtml } = buildFinalHtml(postHtml, templateHtml);

  console.log(`    Título:    "${title}"`);

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
      console.log(`    🚀  Post ${isDraft ? 'salvo como rascunho' : 'publicado'} no Blogger!`);
      if (result.url) console.log(`    🔗  URL: ${result.url}`);
      if (result.id)  console.log(`    🆔  ID: ${result.id}  → use --id=${result.id} para atualizar`);
    } catch (err) {
      console.error(`    ❌  Erro ao publicar: ${err.message}`);
    }
  } else {
    console.log(`    ⚠️   Credenciais não configuradas — HTML gerado localmente apenas.`);
    console.log(`        Configure no .env: BLOG_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BLOGGER_REFRESH_TOKEN`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
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