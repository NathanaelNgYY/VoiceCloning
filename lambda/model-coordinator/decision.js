export function chooseCapacityAction({
  workers = [],
  requestedModelKey,
  lastDemandByModel = {},
  now = Date.now(),
  reassignIdleMs = 300_000,
} = {}) {
  const ready = workers.filter((worker) => worker.state === 'READY' && worker.reachable !== false);
  const matching = ready
    .filter((worker) => worker.modelKey === requestedModelKey && worker.active < worker.maxSlots)
    .sort((a, b) => a.active - b.active || a.lastActivityAt - b.lastActivityAt);
  if (matching.length > 0) return { type: 'route', worker: matching[0] };

  const reassignable = ready
    .filter((worker) => {
      if (worker.modelKey === requestedModelKey) return false;
      if (worker.active !== 0 || worker.queued !== 0) return false;
      const modelLastDemand = Number(lastDemandByModel[worker.modelKey] || 0);
      const idleSince = Math.max(Number(worker.lastActivityAt || 0), modelLastDemand);
      return now - idleSince >= reassignIdleMs;
    })
    .sort((a, b) => {
      const aDemand = Number(lastDemandByModel[a.modelKey] || 0);
      const bDemand = Number(lastDemandByModel[b.modelKey] || 0);
      return aDemand - bDemand || a.lastActivityAt - b.lastActivityAt;
    });
  if (reassignable.length > 0) return { type: 'reassign', worker: reassignable[0] };

  return { type: 'scale' };
}

export function matchingFreeSlots(workers = [], requestedModelKey = '') {
  return workers
    .filter((worker) =>
      worker.state === 'READY'
      && worker.reachable !== false
      && worker.modelKey === requestedModelKey)
    .reduce((total, worker) => total + Math.max(
      0,
      Number(worker.maxSlots || 0) - Number(worker.active || 0) - Number(worker.queued || 0),
    ), 0);
}
