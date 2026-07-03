// The deployment CORS_ORIGIN is a comma-separated list of allowed browser
// origins (the frontend CloudFront distributions). The `cors` package does not
// split a comma-joined string — it exact-matches — so we parse it into the
// array form `cors` understands. `*` (or empty) means allow any origin.
export function parseCorsOrigin(value) {
  if (!value || value === '*') {
    return '*';
  }
  const list = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length === 0) {
    return '*';
  }
  return list.length === 1 ? list[0] : list;
}
