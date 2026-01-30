export const indexablePaths = ['/', '/tarif', '/faq', '/contact'];

export function getPublicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://reloke.com').replace(/\/+$/, '');
}

export function isStagingEnvironment() {
  const context = process.env.CONTEXT?.toLowerCase();
  if (process.env.PREVIEW) return true;
  if (process.env.NETLIFY) return true;
  if (context === 'deploy-preview' || context === 'branch-deploy') return true;
  if (process.env.STAGING === '1' || process.env.STAGING === 'true') return true;
  return false;
}

export function shouldGenerateNetlifyRedirects() {
  if (process.env.GENERATE_NETLIFY_REDIRECTS === '1') return true;
  if (process.env.NETLIFY) return true;
  return false;
}

