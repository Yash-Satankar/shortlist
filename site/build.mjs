// Builds the GitHub Pages site into _site/: the landing page, the demo wake-up page, and the
// Markdown docs (docs/*.md, docs/adr/*.md, PRIVACY.md) as HTML pages. No framework: one template.
//   node site/build.mjs            (DEMO_URL / REPO_URL from site/config.json, or the environment)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '_site');
const config = JSON.parse(readFileSync(path.join(ROOT, 'site/config.json'), 'utf8'));
const DEMO_URL = (process.env.DEMO_URL || config.demoUrl || '').replace(/\/+$/, '');
const REPO_URL = (process.env.REPO_URL || config.repoUrl).replace(/\/+$/, '');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, 'docs/adr'), { recursive: true });

const fill = (s) => s.replaceAll('%DEMO_URL%', DEMO_URL).replaceAll('%REPO_URL%', REPO_URL);
for (const f of ['index.html', 'demo.html', 'styles.css']) writeFileSync(path.join(OUT, f), fill(readFileSync(path.join(ROOT, 'site', f), 'utf8')));
cpSync(path.join(ROOT, 'apps/web/public/favicon.svg'), path.join(OUT, 'favicon.svg'));
cpSync(path.join(ROOT, 'docs/images'), path.join(OUT, 'images'), { recursive: true });
writeFileSync(path.join(OUT, '.nojekyll'), '');

/** Docs pages in the sidebar, in order. */
const NAV = [
  ['docs/self-hosting.md', 'Self-hosting'],
  ['docs/free-hosting.md', 'Free hosting'],
  ['docs/UPGRADING.md', 'Upgrading'],
  ['docs/features.md', 'Optional features'],
  ['docs/extension.md', 'Chrome extension'],
  ['docs/deployment.md', 'Deploying on Railway'],
  ['docs/demo.md', 'The public demo'],
  ['docs/development.md', 'Development and API'],
  ['docs/adr/README.md', 'Design decisions'],
  ['PRIVACY.md', 'Privacy'],
];

/** Where a source Markdown file is published (relative to _site). */
const target = (src) => {
  if (src === 'PRIVACY.md') return 'privacy.html';
  if (src === 'docs/adr/README.md') return 'docs/adr/index.html';
  return src.replace(/\.md$/, '.html');
};

/** Relative link from one published page to another. */
const rel = (fromOut, toOut) => {
  const r = path.posix.relative(path.posix.dirname(fromOut), toOut);
  return r === '' ? path.posix.basename(toOut) : r;
};

function page(src, title, body) {
  const out = target(src);
  const up = rel(out, 'index.html').replace(/index\.html$/, '');
  const nav = NAV.map(([s, label]) => `<a href="${rel(out, target(s))}"${s === src ? ' aria-current="page"' : ''}>${label}</a>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · ShortList</title>
<link rel="icon" href="${up}favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="${up}styles.css" /></head>
<body>
<header class="wrap nav"><a class="brand" href="${up || './'}"><img src="${up}favicon.svg" class="mark" alt="" />ShortList</a><span class="sp"></span>
<a class="link" href="${up}demo.html">Demo</a><a class="link" href="${REPO_URL}">GitHub</a></header>
<div class="wrap doc"><nav class="toc" aria-label="Docs">${nav}</nav><article class="prose">${body}</article></div>
<footer><div class="wrap"><span>ShortList · AGPL-3.0</span><a href="${REPO_URL}/blob/main/${src}">Edit this page</a></div></footer>
</body></html>`;
}

/** Markdown → HTML, with links between docs pointing at their published pages. */
function render(src) {
  const md = readFileSync(path.join(ROOT, src), 'utf8');
  const out = target(src);
  const renderer = new marked.Renderer();
  const baseLink = renderer.link.bind(renderer);
  renderer.link = (token) => {
    let href = token.href;
    if (!/^[a-z]+:|^#|^\//i.test(href)) {
      const [p, hash] = href.split('#');
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(src), p));
      if (resolved.endsWith('.md') && existsSync(path.join(ROOT, resolved))) href = rel(out, target(resolved)) + (hash ? `#${hash}` : '');
      else if (!existsSync(path.join(ROOT, resolved)) || !resolved.startsWith('docs/images')) href = `${REPO_URL}/blob/main/${resolved}${hash ? `#${hash}` : ''}`;
      else href = rel(out, resolved.replace(/^docs\//, ''));
    }
    return baseLink({ ...token, href });
  };
  const html = marked.parse(md, { renderer, gfm: true });
  const title = /^#\s+(.+)$/m.exec(md)?.[1]?.replace(/[`*]/g, '') ?? 'ShortList';
  return { out, html: page(src, title, html) };
}

const sources = [...NAV.map(([s]) => s), ...readdirSync(path.join(ROOT, 'docs/adr')).filter((f) => f !== 'README.md' && f.endsWith('.md')).map((f) => `docs/adr/${f}`), 'docs/demo-video-script.md'];
for (const src of new Set(sources)) {
  if (!existsSync(path.join(ROOT, src))) continue;
  const { out, html } = render(src);
  mkdirSync(path.dirname(path.join(OUT, out)), { recursive: true });
  writeFileSync(path.join(OUT, out), html);
}
// /docs/ itself → the self-hosting guide
writeFileSync(path.join(OUT, 'docs/index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=self-hosting.html"><a href="self-hosting.html">Docs</a>`);
console.log(`Built _site/ (demo: ${DEMO_URL || 'not set'}, repo: ${REPO_URL})`);
