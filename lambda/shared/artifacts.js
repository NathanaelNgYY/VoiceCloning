export function artifactSource() {
  return (process.env.ARTIFACT_SOURCE || 's3').trim().toLowerCase();
}

export function useGpuWorkerArtifacts() {
  return ['gpu-worker', 'gpu', 'local', 'gpt-sovits'].includes(artifactSource());
}

