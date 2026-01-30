export function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function toAbsoluteUrl(publicBaseUrl: string, maybeAbsolute: string): string {
  if (/^https?:\/\//i.test(maybeAbsolute)) return maybeAbsolute;
  return joinUrl(publicBaseUrl, maybeAbsolute);
}

