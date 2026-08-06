import { err, ok } from '../shared/cors.js';
import { createLiveAuthGuard } from '../shared/liveAuth.js';
import { createLearnerRepository } from './repository.js';

function pathOf(event) {
  return event?.rawPath || event?.requestContext?.http?.path || event?.path || '';
}

function supervisorAllowed(identity, env = process.env) {
  const requiredRole = env.SUPERVISOR_APP_ROLE || 'Supervisor';
  const allowedOids = new Set((env.SUPERVISOR_OIDS || '').split(',').map((value) => value.trim()).filter(Boolean));
  return identity?.roles?.includes(requiredRole) || allowedOids.has(identity?.oid);
}

export async function handleLearners(event, {
  guard = createLiveAuthGuard(),
  repository = createLearnerRepository(),
  env = process.env,
} = {}) {
  if (!guard || !repository) return err(503, 'Learner analytics is not configured.', event);

  let identity;
  try {
    identity = await guard.authorize(event);
  } catch (error) {
    const forbidden = ['forbidden', 'domain_not_allowed', 'guest_account', 'bad_tenant'];
    return err(forbidden.includes(error?.code) ? 403 : 401, 'Authentication failed.', event);
  }

  const pathname = pathOf(event);
  if (pathname === '/api/learner/me') {
    const lessonSlug = String(event?.queryStringParameters?.lesson || 'gi-bleeding').slice(0, 80);
    const summary = await repository.getSummary(identity.oid, lessonSlug);
    return ok({ summary }, {}, event);
  }

  if (!supervisorAllowed(identity, env)) {
    return err(403, 'Supervisor access is required.', event);
  }

  if (pathname === '/api/supervisor/users') {
    return ok({ users: await repository.listUsers() }, {}, event);
  }

  const match = /^\/api\/supervisor\/users\/([^/]+)$/u.exec(pathname);
  if (match) {
    return ok(await repository.getUserLearningState(decodeURIComponent(match[1])), {}, event);
  }

  return err(404, 'Learner analytics route not found.', event);
}

export async function handler(event) {
  try {
    return await handleLearners(event);
  } catch (error) {
    console.error('Learner analytics request failed', error?.name || 'Error');
    return err(500, 'Learner analytics could not be loaded.', event);
  }
}
