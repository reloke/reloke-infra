import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPublicBaseUrl, isStagingEnvironment } from './seo-pages.mjs';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolsDir, '..');
const distDir = path.resolve(projectRoot, 'dist', 'Reloke');

const publicBaseUrl = getPublicBaseUrl();
const sitemapUrl = `${publicBaseUrl}/sitemap.xml`;

const prod = `User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}\n`;
const staging = `User-agent: *\nDisallow: /\n# Staging / preview: bloque l'indexation\n`;

await fs.mkdir(distDir, { recursive: true });
await fs.writeFile(path.join(distDir, 'robots.txt'), isStagingEnvironment() ? staging : prod, 'utf8');
await fs.writeFile(path.join(distDir, 'robots.staging.txt'), staging, 'utf8');

console.log(`[seo] robots.txt generated -> ${path.relative(projectRoot, distDir)}\\robots.txt`);
