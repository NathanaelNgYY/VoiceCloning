export function buildCorsOriginOption(value = '*') {
  const origins = String(value || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0 || origins.includes('*')) {
    return '*';
  }

  return origins.length === 1 ? origins[0] : origins;
}
