const APP_MODES = new Set(['combined', 'training', 'live-fast']);

export function normalizeAppMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'livefast' || normalized === 'live') return 'live-fast';
  if (normalized === 'train') return 'training';
  return APP_MODES.has(normalized) ? normalized : 'combined';
}

export function getAppModeConfig(value) {
  const mode = normalizeAppMode(value);
  const showTraining = mode === 'combined' || mode === 'training';
  const showLiveFast = mode === 'combined' || mode === 'live-fast';
  const navItems = [];

  if (showTraining) {
    navItems.push({ label: 'Training', to: '/', end: true });
  }

  if (showLiveFast) {
    navItems.push({ label: 'Live Fast', to: '/live-fast', end: false });
  }

  return {
    mode,
    showTraining,
    showLiveFast,
    navItems,
    defaultPath: showTraining ? '/' : '/live-fast',
    subtitle: showTraining && showLiveFast
      ? 'GPT-SoVITS Training & Live Fast'
      : showTraining
        ? 'GPT-SoVITS Training'
        : 'Live Fast Chatbot',
  };
}

const viteEnv = import.meta.env || {};

export const APP_MODE_CONFIG = getAppModeConfig(viteEnv.VITE_APP_MODE);
