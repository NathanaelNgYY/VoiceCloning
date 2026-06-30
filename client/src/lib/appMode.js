const APP_MODES = new Set(['combined', 'training', 'live-fast', 'chatbot']);

export function normalizeAppMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'livefast' || normalized === 'live') return 'live-fast';
  if (normalized === 'train') return 'training';
  if (normalized === 'dean' || normalized === 'kiosk') return 'chatbot';
  return APP_MODES.has(normalized) ? normalized : 'combined';
}

export function getAppModeConfig(value) {
  const mode = normalizeAppMode(value);
  const kiosk = mode === 'chatbot';
  const showTraining = mode === 'combined' || mode === 'training';
  const showLiveFast = mode === 'combined' || mode === 'live-fast' || mode === 'chatbot';
  const showTextToSpeech = mode === 'combined' || mode === 'live-fast';
  const navItems = [];

  if (!kiosk) {
    if (showTraining) {
      navItems.push({ label: 'Training', to: '/', end: true });
    }

    if (showLiveFast) {
      navItems.push({ label: 'Live Fast', to: showTraining ? '/live-fast' : '/', end: !showTraining });
    }

    if (showTextToSpeech) {
      navItems.push({ label: 'Text to Speech', to: showTraining ? '/text-to-speech' : '/?tab=text-to-speech', end: true });
    }
  }

  return {
    mode,
    kiosk,
    defaultLiveEngine: kiosk ? 'full' : 'fast',
    showTraining,
    showLiveFast,
    showTextToSpeech,
    navItems,
    defaultPath: '/',
    subtitle: showTraining && showLiveFast
      ? 'GPT-SoVITS Training & Live Fast'
      : showTraining
        ? 'GPT-SoVITS Training'
        : 'Live Fast Chatbot',
  };
}

const viteEnv = import.meta.env || {};

export const APP_MODE_CONFIG = getAppModeConfig(viteEnv.VITE_APP_MODE);
