import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPublicBaseUrl, indexablePaths } from './seo-pages.mjs';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolsDir, '..');
const distDir = path.resolve(projectRoot, 'dist', 'Reloke');

const publicBaseUrl = getPublicBaseUrl();
const lastmod = new Date().toISOString();

const urls = indexablePaths.map((p) => `${publicBaseUrl}${p === '/' ? '/' : p}`);

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls
    .map((loc) => `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join('\n') +
  `\n</urlset>\n`;

await fs.mkdir(distDir, { recursive: true });
await fs.writeFile(path.join(distDir, 'sitemap.xml'), xml, 'utf8');

console.log(`[seo] sitemap.xml generated (${urls.length} urls) -> ${path.relative(projectRoot, distDir)}\\sitemap.xml`);

