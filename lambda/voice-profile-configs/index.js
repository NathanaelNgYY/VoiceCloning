import { uploadBuffer, getObject, listObjects, deleteObject } from '../shared/s3.js';
import { ok, err, preflight, parseJsonBody } from '../shared/cors.js';
import { isSafePathSegment } from '../shared/paths.js';

const CONFIGS_PATH = /^\/api\/voice-profile\/configs\/([^/]+)\/?$/u;
const CONFIG_PATH = /^\/api\/voice-profile\/configs\/([^/]+)\/([^/]+)\/?$/u;

function configKey(voiceProfileId, configId) {
  return `voice-profile-configs/${voiceProfileId}/${configId}.json`;
}

function configPrefix(voiceProfileId) {
  return `voice-profile-configs/${voiceProfileId}/`;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateSegment(name, value) {
  const normalized = String(value || '').trim();
  if (!normalized || !isSafePathSegment(normalized)) {
    throw new Error(`${name} must be a safe path segment`);
  }
  return normalized;
}

function normalizeConfig(body = {}, { voiceProfileId, configId, now }) {
  return {
    schemaVersion: 1,
    voiceProfileId,
    configId,
    configName: String(body.configName || configId).trim() || configId,
    rank: Number.isFinite(Number(body.rank)) ? Number(body.rank) : 1,
    selected: body.selected !== false,
    trainingMetadata: isPlainObject(body.trainingMetadata) ? body.trainingMetadata : {},
    inferenceMetadata: isPlainObject(body.inferenceMetadata) ? body.inferenceMetadata : {},
    referenceMetadata: isPlainObject(body.referenceMetadata) ? body.referenceMetadata : {},
    sample: isPlainObject(body.sample) ? body.sample : {},
    updatedAt: now(),
  };
}

async function parseConfig(readObject, object) {
  const body = await readObject(object.key);
  const config = JSON.parse(body.toString('utf-8'));
  return {
    ...config,
    key: object.key,
    updatedAt: config.updatedAt || (
      object.lastModified instanceof Date ? object.lastModified.toISOString() : object.lastModified || ''
    ),
  };
}

export function createHandler({
  readObject = getObject,
  writeObject = uploadBuffer,
  listObjects: listStoredObjects = listObjects,
  deleteObject: deleteStoredObject = deleteObject,
  now = () => new Date().toISOString(),
} = {}) {
  return async function handler(event) {
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return preflight(event);
    }

    const method = event.requestContext?.http?.method || 'GET';
    const routePath = event.rawPath || '';
    const listMatch = routePath.match(CONFIGS_PATH);
    const itemMatch = routePath.match(CONFIG_PATH);

    try {
      if (method === 'GET' && listMatch) {
        const voiceProfileId = validateSegment('voiceProfileId', listMatch[1]);
        const objects = await listStoredObjects(configPrefix(voiceProfileId));
        const configs = await Promise.all(
          objects
            .filter((object) => object.key.endsWith('.json'))
            .map((object) => parseConfig(readObject, object))
        );
        configs.sort((a, b) => {
          const rankDiff = Number(a.rank || 0) - Number(b.rank || 0);
          if (rankDiff !== 0) return rankDiff;
          return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
        return ok({ configs }, {}, event);
      }

      if ((method === 'POST' || method === 'PUT') && itemMatch) {
        const voiceProfileId = validateSegment('voiceProfileId', itemMatch[1]);
        const configId = validateSegment('configId', itemMatch[2]);
        let body;
        try {
          body = parseJsonBody(event);
        } catch {
          return err(400, 'Invalid JSON body', event);
        }
        if (body.delete === true || body._delete === true) {
          await deleteStoredObject(configKey(voiceProfileId, configId));
          return ok({ deleted: true, configId }, {}, event);
        }
        const config = normalizeConfig(body, { voiceProfileId, configId, now });
        await writeObject(
          configKey(voiceProfileId, configId),
          Buffer.from(JSON.stringify(config), 'utf-8'),
          'application/json',
        );
        return ok({ config }, {}, event);
      }

      if (method === 'DELETE' && itemMatch) {
        const voiceProfileId = validateSegment('voiceProfileId', itemMatch[1]);
        const configId = validateSegment('configId', itemMatch[2]);
        await deleteStoredObject(configKey(voiceProfileId, configId));
        return ok({ deleted: true, configId }, {}, event);
      }

      return err(404, 'Not found', event);
    } catch (error) {
      return err(500, error.message, event);
    }
  };
}

export const handler = createHandler();
