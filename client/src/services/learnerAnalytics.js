import { acquireApiToken } from '@/auth/msalClient';
import { config } from '@/config';

function apiUrl(path) {
  return `${String(config.apiBaseUrl || '').replace(/\/+$/u, '')}${path}`;
}

async function authorizedGet(path, fetchImpl = fetch) {
  const token = await acquireApiToken();
  const response = await fetchImpl(apiUrl(path), {
    headers: { 'X-VCS-Entra-Token': token },
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const error = new Error(`Learner analytics returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function authorizedDelete(path, fetchImpl = fetch) {
  const token = await acquireApiToken();
  const response = await fetchImpl(apiUrl(path), {
    method: 'DELETE',
    headers: { 'X-VCS-Entra-Token': token },
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const error = new Error(`Learner analytics returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function getMyLearnerSummary(lessonSlug = 'gi-bleeding') {
  const result = await authorizedGet(`/api/learner/me?lesson=${encodeURIComponent(lessonSlug)}`);
  return result.summary || null;
}

export async function listSupervisorUsers() {
  const result = await authorizedGet('/api/supervisor/users');
  return result.users || [];
}

export function getSupervisorUser(oid) {
  return authorizedGet(`/api/supervisor/users/${encodeURIComponent(oid)}`);
}

export function resetSupervisorConcept(oid, lessonSlug, conceptId) {
  return authorizedDelete(`/api/supervisor/users/${encodeURIComponent(oid)}/lessons/${encodeURIComponent(lessonSlug)}/concepts/${encodeURIComponent(conceptId)}`);
}
