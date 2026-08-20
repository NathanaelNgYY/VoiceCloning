import { TokenError } from './entraToken.js';

export const SITE_HEADER = 'x-vcs-site';
export const FACULTY_SITE = 'faculty';

export function headerValue(headers, wantedName) {
  const key = Object.keys(headers || {}).find(
    (name) => name.toLowerCase() === wantedName.toLowerCase(),
  );
  return key ? String(headers[key] || '').trim() : '';
}

export function isFacultyRequest(req) {
  return headerValue(req?.headers, SITE_HEADER).toLowerCase() === FACULTY_SITE;
}

export function emailAllowed(email, domains) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  return domains.some((domain) => normalizedEmail.endsWith(`@${String(domain).toLowerCase()}`));
}

export function enforceFacultyAccess(identity, req, allowedDomains) {
  if (!isFacultyRequest(req) || identity?.synthetic) return identity;
  if (!emailAllowed(identity?.email, allowedDomains)) {
    throw new TokenError(
      'domain_not_allowed',
      `Only these Microsoft account domains are allowed for the faculty app: ${allowedDomains.join(', ')}.`,
    );
  }
  return identity;
}
