import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { shouldGenerateNetlifyRedirects } from './seo-pages.mjs';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolsDir, '..');
const distDir = path.resolve(projectRoot, 'dist', 'Reloke');

if (!shouldGenerateNetlifyRedirects()) {
  process.exit(0);
}

await fs.mkdir(distDir, { recursive: true });
await fs.writeFile(path.join(distDir, '_redirects'), '/* /index.html 200\n', 'utf8');

console.log(`[seo] _redirects generated -> ${path.relative(projectRoot, distDir)}\\_redirects`);

