import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { parse } from 'parse5';

const root = process.cwd();
const pages = ['index.html', 'kontakt/index.html', 'richard-senko-en/index.html', '404.html'];
const siteOrigin = 'https://richardsenko.com';
const failures = [];
const checkedResources = new Set();

function attrs(node) { return Object.fromEntries((node.attrs || []).map(({ name, value }) => [name, value])); }
function walk(node, callback) { callback(node); for (const child of node.childNodes || []) walk(child, callback); }
function localPath(url, page) {
  if (!url || /^(?:data:|mailto:|tel:|javascript:)/i.test(url)) return null;
  let parsed;
  try { parsed = new URL(url, `${siteOrigin}/${page.replace(/index\.html$/, '')}`); } catch { return null; }
  if (parsed.origin !== siteOrigin) return null;
  let pathname;
  try { pathname = decodeURIComponent(parsed.pathname); } catch { pathname = parsed.pathname; }
  let candidate = join(root, normalize(pathname).replace(/^[/\\]+/, ''));
  if (pathname.endsWith('/')) candidate = join(candidate, 'index.html');
  if (!extname(candidate) && existsSync(candidate) && statSync(candidate).isDirectory()) candidate = join(candidate, 'index.html');
  return { candidate, fragment: parsed.hash.slice(1), pathname };
}
function recordResource(url, page, kind) {
  const local = localPath(url, page);
  if (!local) return;
  if (!local.candidate.startsWith(root + sep) && local.candidate !== root) failures.push(`${page}: ${kind} escapes the site root: ${url}`);
  else if (!existsSync(local.candidate) || !statSync(local.candidate).isFile()) failures.push(`${page}: missing ${kind}: ${url}`);
  else checkedResources.add(relative(root, local.candidate).replaceAll('\\', '/'));
}
function targetDocument(url, page) {
  const local = localPath(url, page);
  if (!local) return null;
  return local;
}

for (const page of pages) {
  if (!existsSync(page)) { failures.push(`missing retained page: ${page}`); continue; }
  const html = readFileSync(page, 'utf8');
  const document = parse(html, { sourceCodeLocationInfo: true });
  const ids = new Set();
  const links = [];
  const metadata = { htmlLang: '', canonical: '', ogUrl: '', ogImage: '', twitterCard: '', twitterImage: '', robots: '' };
  walk(document, node => {
    const a = attrs(node);
    if (node.tagName === 'html') metadata.htmlLang = a.lang || '';
    if (node.tagName === 'link' && a.rel === 'canonical') metadata.canonical = a.href || '';
    if (node.tagName === 'meta' && a.property === 'og:url') metadata.ogUrl = a.content || '';
    if (node.tagName === 'meta' && a.property === 'og:image') metadata.ogImage = a.content || '';
    if (node.tagName === 'meta' && a.name === 'twitter:card') metadata.twitterCard = a.content || '';
    if (node.tagName === 'meta' && a.name === 'twitter:image') metadata.twitterImage = a.content || '';
    if (node.tagName === 'meta' && a.name === 'robots') metadata.robots = a.content || '';
    if (a.id) ids.add(a.id);
    if (a.href && node.tagName === 'a') links.push(a.href);
    if (node.tagName === 'img') {
      recordResource(a.src, page, 'image');
      for (const item of (a.srcset || '').split(',')) recordResource(item.trim().split(/\s+/)[0], page, 'srcset image');
      if (!a.width || !a.height) failures.push(`${page}: image lacks explicit dimensions: ${a.src || '(no src)'}`);
      if (!Object.hasOwn(a, 'alt')) failures.push(`${page}: image lacks alt attribute: ${a.src || '(no src)'}`);
    }
    if (node.tagName === 'script' && a.src) recordResource(a.src, page, 'script');
    if (node.tagName === 'link' && a.href && /(?:stylesheet|icon|apple-touch-icon)/.test(a.rel || '')) recordResource(a.href, page, 'linked resource');
    if (node.tagName === 'source') {
      recordResource(a.src, page, 'source');
      for (const item of (a.srcset || '').split(',')) recordResource(item.trim().split(/\s+/)[0], page, 'source srcset');
    }
    if (node.tagName === 'video' && a.poster) recordResource(a.poster, page, 'video poster');
  });
  const expectedUrl = `${siteOrigin}/${page.replace(/index\.html$/, '')}`;
  if (!metadata.htmlLang) failures.push(`${page}: html lang attribute is missing`);
  if (page === '404.html') {
    if (!/noindex/i.test(metadata.robots)) failures.push('404.html: noindex robots metadata is missing');
  } else {
    if (metadata.canonical !== expectedUrl) failures.push(`${page}: canonical URL should be ${expectedUrl}`);
    if (metadata.ogUrl !== expectedUrl) failures.push(`${page}: og:url should match the canonical URL`);
    if (!metadata.ogImage.startsWith('https://')) failures.push(`${page}: og:image must be an absolute HTTPS URL`);
    if (!metadata.twitterCard) failures.push(`${page}: Twitter Card metadata is missing`);
    if (!metadata.twitterImage.startsWith('https://')) failures.push(`${page}: twitter:image must be an absolute HTTPS URL`);
  }
  for (const href of links) {
    if (/^(?:mailto:|tel:|javascript:)/i.test(href)) continue;
    const target = targetDocument(href, page);
    if (!target) continue;
    if (!existsSync(target.candidate) || !statSync(target.candidate).isFile()) failures.push(`${page}: broken internal link: ${href}`);
    else if (target.fragment) {
      const targetHtml = readFileSync(target.candidate, 'utf8');
      const targetIds = target.candidate === resolve(page) ? ids : new Set([...targetHtml.matchAll(/\bid=["']([^"']+)["']/gi)].map(match => match[1]));
      if (!targetIds.has(decodeURIComponent(target.fragment))) failures.push(`${page}: broken fragment link: ${href}`);
    }
  }
  for (const match of html.matchAll(/\b(?:src|href|action|content)=["']http:\/\/[^"']+/gi)) failures.push(`${page}: mixed-content URL: ${match[0]}`);
  for (const pattern of [/wp-json/i, /xmlrpc\.php/i, /admin-ajax\.php/i, /rel=["'](?:alternate|shortlink)["'][^>]*(?:feed|oembed|shortlink)/i, /<meta[^>]+name=["']generator["']/i, /wp-emoji/i]) {
    if (pattern.test(html)) failures.push(`${page}: obsolete or server-only WordPress reference matches ${pattern}`);
  }
}

// Check resources referenced by every CSS file reached from retained pages.
const cssQueue = [...checkedResources].filter(file => file.endsWith('.css'));
for (let i = 0; i < cssQueue.length; i++) {
  const css = cssQueue[i];
  const text = readFileSync(css, 'utf8');
  for (const match of text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
    const url = match[2].trim();
    if (/^(?:data:|https?:|\/\/|#)/i.test(url)) continue;
    const pathPart = url.split(/[?#]/)[0];
    const candidate = pathPart.startsWith('/')
      ? join(root, normalize(pathPart).replace(/^[/\\]+/, ''))
      : resolve(dirname(resolve(css)), pathPart);
    if (!existsSync(candidate) || !statSync(candidate).isFile()) failures.push(`${css}: missing CSS resource: ${url}`);
  }
}

const robots = readFileSync('robots.txt', 'utf8');
if (!/^Sitemap: https:\/\/richardsenko\.com\/sitemap\.xml$/m.test(robots)) failures.push('robots.txt: canonical sitemap URL is missing');
const sitemap = readFileSync('sitemap.xml', 'utf8');
for (const page of pages.filter(p => p !== '404.html')) {
  const url = `${siteOrigin}/${page.replace(/index\.html$/, '')}`;
  if (!sitemap.includes(`<loc>${url}</loc>`)) failures.push(`sitemap.xml: missing ${url}`);
}
if (!existsSync('.nojekyll')) failures.push('.nojekyll is missing');

if (failures.length) {
  console.error(`Site integrity check failed (${failures.length}):\n${failures.map(item => `- ${item}`).join('\n')}`);
  process.exit(1);
}
console.log(`Site integrity check passed: ${pages.length} pages and ${checkedResources.size} directly referenced local resources.`);
