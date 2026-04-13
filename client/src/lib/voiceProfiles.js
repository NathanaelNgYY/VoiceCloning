function normalizePersonKey(name) {
  return (name || '').toLowerCase().replace(/[\s_-]+/g, '');
}

function getBasename(filePath) {
  return (filePath || '').replace(/\\/g, '/').split('/').pop() || '';
}

function parseModelCandidate(model, type) {
  const basename = model?.name || getBasename(model?.path);
  const pattern = type === 'gpt'
    ? /^(.+?)[-_]e(\d+)\.ckpt$/i
    : /^(.+?)[-_]e(\d+)(?:[_-]s(\d+))?\.pth$/i;
  const match = basename.match(pattern);

  if (!match) {
    const fallbackName = basename.replace(/\.[^.]+$/, '');
    return {
      model,
      basename,
      personName: fallbackName,
      personKey: normalizePersonKey(fallbackName),
      epoch: -1,
      step: -1,
    };
  }

  return {
    model,
    basename,
    personName: match[1],
    personKey: normalizePersonKey(match[1]),
    epoch: Number(match[2] || 0),
    step: Number(match[3] || 0),
  };
}

function compareModelCandidates(a, b) {
  if ((b?.epoch || -1) !== (a?.epoch || -1)) {
    return (b?.epoch || -1) - (a?.epoch || -1);
  }
  if ((b?.step || -1) !== (a?.step || -1)) {
    return (b?.step || -1) - (a?.step || -1);
  }
  return (a?.basename || '').localeCompare(b?.basename || '');
}

export function buildVoiceProfiles(gptModels, sovitsModels) {
  const profiles = new Map();

  function ensureProfile(candidate) {
    const existing = profiles.get(candidate.personKey) || {
      key: candidate.personKey,
      displayName: candidate.personName,
      gptCandidates: [],
      sovitsCandidates: [],
    };

    if (!existing.displayName || candidate.personName.length > existing.displayName.length) {
      existing.displayName = candidate.personName;
    }

    profiles.set(candidate.personKey, existing);
    return existing;
  }

  for (const model of gptModels) {
    const candidate = parseModelCandidate(model, 'gpt');
    ensureProfile(candidate).gptCandidates.push(candidate);
  }

  for (const model of sovitsModels) {
    const candidate = parseModelCandidate(model, 'sovits');
    ensureProfile(candidate).sovitsCandidates.push(candidate);
  }

  return Array.from(profiles.values())
    .map((profile) => {
      const sortedGPTCandidates = [...profile.gptCandidates].sort(compareModelCandidates);
      const sortedSoVITSCandidates = [...profile.sovitsCandidates].sort(compareModelCandidates);
      const bestGPT = sortedGPTCandidates[0] || null;
      const bestSoVITS = sortedSoVITSCandidates[0] || null;

      return {
        key: profile.key,
        displayName: bestSoVITS?.personName || bestGPT?.personName || profile.displayName,
        expName: bestSoVITS?.personName || bestGPT?.personName || profile.displayName,
        gptModel: bestGPT?.model || null,
        gptEpoch: bestGPT?.epoch ?? null,
        sovitsModel: bestSoVITS?.model || null,
        sovitsEpoch: bestSoVITS?.epoch ?? null,
        gptCandidates: sortedGPTCandidates,
        sovitsCandidates: sortedSoVITSCandidates,
        complete: Boolean(bestGPT?.model && bestSoVITS?.model),
      };
    })
    .sort((a, b) => {
      if (a.complete !== b.complete) {
        return Number(b.complete) - Number(a.complete);
      }
      return a.displayName.localeCompare(b.displayName);
    });
}

export function extractExpName(modelPath) {
  const basename = getBasename(modelPath);
  const match = basename.match(/^(.+?)[-_]e\d+(?:[_-]s\d+)?\.(?:ckpt|pth)$/i);
  return match ? match[1] : null;
}
