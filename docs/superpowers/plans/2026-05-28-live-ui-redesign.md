# Live UI Redesign & Mobile Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Live Fast and Live Full page UIs to match the separate-containers branch design, and make all pages mobile responsive.

**Architecture:** Port the separate-containers `LivePage.jsx` design (gradient mic button, auto-loading model selector, reference clip auto-selection, inference sliders collapsible) to work with the current branch's existing API. Skip voice profile save/sync since the current server has no `/voice-profile/active` endpoint. Add two missing lib files (`liveFastSetup.js`, `modelLoading.js`), add `shouldAutoApplyBestReferenceSet` to the existing `referenceSelection.js`, and make mobile-responsive fixes to App.jsx, TrainingPage, and InferencePage.

**Tech Stack:** React 18, Vite, Tailwind CSS, shadcn/ui (Button, Select, Checkbox, Collapsible, Slider, Textarea, Label), Lucide icons, existing hooks (`useLiveSpeech`, `liveConversation`), existing API (`getModels`, `selectModels`, `getTrainingAudioFiles`, `getTrainingAudioUrl`, `getInferenceStatus`)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `client/src/lib/referenceSelection.js` | Add `shouldAutoApplyBestReferenceSet` export |
| Create | `client/src/lib/liveFastSetup.js` | Default settings, `buildLiveFastRefParams`, `buildLiveFastReferencePreviewItems` |
| Create | `client/src/lib/modelLoading.js` | `shouldLoadSelectedProfile` guard |
| Rewrite | `client/src/pages/LivePage.jsx` | Full redesign matching separate-containers, both modes |
| Modify | `client/src/App.jsx` | Add `flex flex-col` to `<main>`, mobile-responsive header nav |
| Modify | `client/src/pages/TrainingPage.jsx` | Responsive title text |
| Modify | `client/src/pages/InferencePage.jsx` | Responsive card padding |

---

## Task 1: Add `shouldAutoApplyBestReferenceSet` to referenceSelection.js

**Files:**
- Modify: `client/src/lib/referenceSelection.js`

- [ ] **Step 1: Append the export to the end of the file**

Open `client/src/lib/referenceSelection.js` and append this block at the very end (after the closing brace of `chooseBestReferenceSet`):

```js
export function shouldAutoApplyBestReferenceSet({
  selectedSourceKey = '',
  loadedSourceKey = '',
  loading = false,
  fileCount = 0,
  lastAppliedSourceKey = '',
} = {}) {
  return Boolean(
    selectedSourceKey
      && loadedSourceKey
      && selectedSourceKey === loadedSourceKey
      && !loading
      && Number(fileCount) > 0
      && lastAppliedSourceKey !== selectedSourceKey
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/referenceSelection.js
git commit -m "feat: add shouldAutoApplyBestReferenceSet to referenceSelection"
```

---

## Task 2: Create liveFastSetup.js

**Files:**
- Create: `client/src/lib/liveFastSetup.js`

- [ ] **Step 1: Create the file with full content**

Create `client/src/lib/liveFastSetup.js`:

```js
export const DEFAULT_LIVE_FAST_SETTINGS = {
  speed: 1.0,
  topK: 5,
  topP: 0.85,
  temperature: 0.7,
  repPenalty: 1.35,
};

function numberInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function integerInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

export function normalizeLiveFastSettings(settings = {}) {
  return {
    speed: numberInRange(settings.speed, 0.5, 2.0, DEFAULT_LIVE_FAST_SETTINGS.speed),
    topK: integerInRange(settings.topK, 1, 50, DEFAULT_LIVE_FAST_SETTINGS.topK),
    topP: numberInRange(settings.topP, 0, 1, DEFAULT_LIVE_FAST_SETTINGS.topP),
    temperature: numberInRange(settings.temperature, 0, 1, DEFAULT_LIVE_FAST_SETTINGS.temperature),
    repPenalty: numberInRange(settings.repPenalty, 1.0, 2.0, DEFAULT_LIVE_FAST_SETTINGS.repPenalty),
  };
}

export function buildLiveFastRefParams({
  primaryPath = '',
  promptText = '',
  promptLang = 'en',
  auxRefAudios = [],
  settings = DEFAULT_LIVE_FAST_SETTINGS,
} = {}) {
  if (!primaryPath) return null;

  const normalized = normalizeLiveFastSettings(settings);
  return {
    ref_audio_path: primaryPath,
    prompt_text: promptText || '',
    prompt_lang: promptLang || 'en',
    aux_ref_audio_paths: Array.from(auxRefAudios || [])
      .map((file) => file?.path)
      .filter(Boolean)
      .slice(0, 5),
    speed_factor: normalized.speed,
    top_k: normalized.topK,
    top_p: normalized.topP,
    temperature: normalized.temperature,
    repetition_penalty: normalized.repPenalty,
  };
}

function fallbackReferenceFilename(filePath) {
  return String(filePath || '').replace(/\\/g, '/').split('/').pop() || 'reference.wav';
}

function normalizeReferencePreviewItem(file, role, transcriptFallback = '') {
  if (!file?.path) return null;
  return {
    role,
    path: file.path,
    filename: file.filename || file.name || fallbackReferenceFilename(file.path),
    transcript: file.transcript || transcriptFallback || '',
  };
}

export function buildLiveFastReferencePreviewItems({
  primaryPath = '',
  promptText = '',
  trainingAudioFiles = [],
  auxRefAudios = [],
} = {}) {
  const trainingByPath = new Map(
    Array.from(trainingAudioFiles || [])
      .filter((file) => file?.path)
      .map((file) => [file.path, file])
  );
  const items = [];

  if (primaryPath) {
    const primaryFile = trainingByPath.get(primaryPath) || { path: primaryPath };
    const primaryItem = normalizeReferencePreviewItem(primaryFile, 'primary', promptText);
    if (primaryItem) items.push(primaryItem);
  }

  for (const auxFile of Array.from(auxRefAudios || []).slice(0, 5)) {
    if (!auxFile?.path || auxFile.path === primaryPath) continue;
    const sourceFile = trainingByPath.get(auxFile.path) || auxFile;
    const auxItem = normalizeReferencePreviewItem(sourceFile, 'auxiliary');
    if (auxItem) items.push(auxItem);
  }

  return items;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/liveFastSetup.js
git commit -m "feat: add liveFastSetup lib for reference params and preview items"
```

---

## Task 3: Create modelLoading.js

**Files:**
- Create: `client/src/lib/modelLoading.js`

- [ ] **Step 1: Create the file**

Create `client/src/lib/modelLoading.js`:

```js
export function shouldLoadSelectedProfile({
  selectedProfile,
  loadedGPTPath,
  loadedSoVITSPath,
  isConversationActive,
  loadingModel,
}) {
  const gptPath = selectedProfile?.gptModel?.path || '';
  const sovitsPath = selectedProfile?.sovitsModel?.path || '';

  return Boolean(
    selectedProfile?.complete
      && gptPath
      && sovitsPath
      && !isConversationActive
      && !loadingModel
      && (loadedGPTPath !== gptPath || loadedSoVITSPath !== sovitsPath)
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/modelLoading.js
git commit -m "feat: add modelLoading lib for auto-load guard"
```

---

## Task 4: Rewrite LivePage.jsx

**Files:**
- Rewrite: `client/src/pages/LivePage.jsx`

This is the main design change. The new component:
- Has a top bar with voice model selector + language selector + model status + refresh button
- Has a full-height chat card with gradient mic button, pulsing ring animation, waveform meter centered above mic
- Has an advanced settings collapsible with reference clips panel (primary + auxiliary) and inference sliders
- Works for both `replyMode="phrases"` (Live Fast) and `replyMode="full"` (Live Full)
- Auto-loads the selected model, auto-picks best reference clips from training audio

- [ ] **Step 1: Replace the entire file content**

Overwrite `client/src/pages/LivePage.jsx` with:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getInferenceStatus,
  getModels,
  getTrainingAudioUrl,
  getTrainingAudioFiles,
  selectModels,
} from '../services/api.js';
import { useLiveSpeech } from '../hooks/useLiveSpeech.js';
import {
  LIVE_LANGUAGE_OPTIONS,
  getLiveLanguageConfig,
  normalizeLiveLanguage,
} from '../hooks/liveConversation.js';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { MicLevelMeter } from '@/components/MicLevelMeter';
import {
  chooseBestReferenceSet,
  shouldAutoApplyBestReferenceSet,
} from '@/lib/referenceSelection';
import { buildVoiceProfiles } from '@/lib/voiceProfiles';
import {
  DEFAULT_LIVE_FAST_SETTINGS,
  buildLiveFastReferencePreviewItems,
  buildLiveFastRefParams,
} from '@/lib/liveFastSetup';
import { shouldLoadSelectedProfile } from '@/lib/modelLoading';
import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  Loader2,
  Mic,
  MicOff,
  PlayCircle,
  RefreshCw,
  Square,
  UserRound,
  Volume2,
  VolumeX,
} from 'lucide-react';

function messageStatusText(message) {
  if (message.role === 'user') {
    return { listening: 'Listening', transcribing: 'Transcribing', done: 'Sent' }[message.status] || 'Sent';
  }
  return {
    thinking: 'Writing',
    generating_voice: 'Generating voice',
    ready: 'Voice ready',
    played: 'Played',
    interrupted: 'Interrupted',
    error: 'Failed',
  }[message.status] || 'Reply';
}

function fallbackName(filePath) {
  return (filePath || '').replace(/\\/g, '/').split('/').pop() || 'reference.wav';
}

function normalizeReferenceLanguage(lang) {
  const value = String(lang || '').trim().toLowerCase();
  return ['en', 'zh', 'ja', 'ko', 'auto'].includes(value) ? value : 'en';
}

function ChatBubble({ message, selected, onPlay }) {
  const isUser = message.role === 'user';
  const readyParts = (message.audioParts || []).filter((part) => part.audioUrl);
  const hasVoice = !isUser && (Boolean(message.audioUrl) || readyParts.length > 0);
  const isBusy = ['thinking', 'generating_voice', 'transcribing', 'listening'].includes(message.status);

  return (
    <div className={cn('flex gap-2.5', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Bot size={14} />
        </div>
      )}

      <div className={cn(
        'max-w-[76%] rounded-2xl px-4 py-3',
        isUser
          ? 'rounded-br-md bg-slate-900 text-white'
          : 'rounded-bl-md border border-slate-100 bg-slate-50 text-slate-900'
      )}>
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-60">
          {isBusy && <Loader2 size={10} className="animate-spin" />}
          {messageStatusText(message)}
        </div>

        <p className={cn('whitespace-pre-wrap text-sm leading-6', isBusy && !message.text && 'italic opacity-60')}>
          {message.text || (isUser ? 'Listening...' : 'Thinking...')}
        </p>

        {message.error && (
          <p className="mt-2 flex items-center gap-1 text-xs text-red-500">
            <CircleAlert size={12} />{message.error}
          </p>
        )}

        {!isUser && message.audioParts?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.audioParts.map((part) => (
              <span key={part.id} className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] capitalize',
                part.status === 'ready' || part.status === 'played'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : part.status === 'generating'
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : part.status === 'error'
                      ? 'border-red-200 bg-red-50 text-red-600'
                      : 'border-slate-200 bg-white text-slate-400'
              )}>
                {part.index}: {part.status}
              </span>
            ))}
          </div>
        )}

        {hasVoice && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onPlay(message.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                selected
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300'
              )}
            >
              {selected ? <Volume2 size={11} /> : <PlayCircle size={11} />}
              {selected ? 'Playing' : 'Play voice'}
            </button>
            {message.audioUrl && (
              <a
                href={message.audioUrl}
                download={`live_reply_${message.id}.wav`}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 hover:border-slate-300"
              >
                <Download size={11} />WAV
              </a>
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
          <UserRound size={14} />
        </div>
      )}
    </div>
  );
}

export default function LivePage({ replyMode = 'phrases' }) {
  const isFastMode = replyMode === 'phrases';

  const [gptModels, setGptModels] = useState([]);
  const [sovitsModels, setSovitsModels] = useState([]);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [modelError, setModelError] = useState('');
  const [selectedPersonKey, setSelectedPersonKey] = useState('');
  const [loadedGPTPath, setLoadedGPTPath] = useState('');
  const [loadedSoVITSPath, setLoadedSoVITSPath] = useState('');
  const [serverReady, setServerReady] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);

  const [trainingAudioFiles, setTrainingAudioFiles] = useState([]);
  const [loadedTrainingAudioSourceKey, setLoadedTrainingAudioSourceKey] = useState('');
  const [loadingTrainingAudio, setLoadingTrainingAudio] = useState(false);
  const [refAudioPath, setRefAudioPath] = useState('');
  const [promptText, setPromptText] = useState('');
  const [promptLang, setPromptLang] = useState('en');
  const [auxRefAudios, setAuxRefAudios] = useState([]);
  const [referenceMessage, setReferenceMessage] = useState('');
  const [previewReference, setPreviewReference] = useState({ path: '', url: null, filename: '', role: '' });
  const [referenceAudioUrls, setReferenceAudioUrls] = useState({});
  const [loadingPreviewPath, setLoadingPreviewPath] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const [speed, setSpeed] = useState(DEFAULT_LIVE_FAST_SETTINGS.speed);
  const [topK, setTopK] = useState(DEFAULT_LIVE_FAST_SETTINGS.topK);
  const [topP, setTopP] = useState(DEFAULT_LIVE_FAST_SETTINGS.topP);
  const [temperature, setTemperature] = useState(DEFAULT_LIVE_FAST_SETTINGS.temperature);
  const [repPenalty, setRepPenalty] = useState(DEFAULT_LIVE_FAST_SETTINGS.repPenalty);

  const [selectedLanguage, setSelectedLanguage] = useState('en');

  const audioRef = useRef(null);
  const messagesEndRef = useRef(null);
  const referencePreviewAudioRef = useRef(null);
  const autoReferenceKeyRef = useRef('');
  const autoLoadAttemptKeyRef = useRef('');
  const urlVoiceKeyRef = useRef('');
  const previewRequestRef = useRef(0);

  const voiceProfiles = useMemo(() => buildVoiceProfiles(gptModels, sovitsModels), [gptModels, sovitsModels]);
  const availableProfiles = useMemo(() => voiceProfiles.filter((p) => p.complete), [voiceProfiles]);
  const selectedProfile = availableProfiles.find((p) => p.key === selectedPersonKey) || null;
  const selectedGPT = selectedProfile?.gptModel?.path || '';
  const selectedSoVITS = selectedProfile?.sovitsModel?.path || '';
  const selectedExpName = selectedProfile?.expName || '';
  const loadedProfile = availableProfiles.find(
    (p) => p.gptModel?.path === loadedGPTPath && p.sovitsModel?.path === loadedSoVITSPath
  ) || null;

  const liveLanguage = normalizeLiveLanguage(selectedLanguage);
  const liveLanguageConfig = getLiveLanguageConfig(liveLanguage);

  const liveRefParams = useMemo(() => buildLiveFastRefParams({
    primaryPath: refAudioPath,
    promptText,
    promptLang,
    auxRefAudios,
    settings: { speed, topK, topP, temperature, repPenalty },
  }), [refAudioPath, promptText, promptLang, auxRefAudios, speed, topK, topP, temperature, repPenalty]);

  const selectedReferenceItems = useMemo(() => buildLiveFastReferencePreviewItems({
    primaryPath: refAudioPath,
    promptText,
    trainingAudioFiles,
    auxRefAudios,
  }), [refAudioPath, promptText, trainingAudioFiles, auxRefAudios]);

  const liveSpeech = useLiveSpeech({ refParams: liveRefParams, replyMode, language: liveLanguage });
  const playbackReady = liveSpeech.shouldPlayAudio && Boolean(liveSpeech.audioSrc);
  const isConversationActive = liveSpeech.phase !== 'idle';

  async function fetchModels() {
    setModelsFetched(false);
    try {
      const res = await getModels();
      setGptModels(res.data.gpt || []);
      setSovitsModels(res.data.sovits || []);
      setModelError('');
    } catch (err) {
      setModelError(err.response?.data?.error || err.message || 'Failed to load models.');
    } finally {
      setModelsFetched(true);
    }
  }

  async function checkStatus() {
    try {
      const res = await getInferenceStatus();
      setServerReady(Boolean(res.data.ready));
      setLoadedGPTPath(res.data.loaded?.gptPath || '');
      setLoadedSoVITSPath(res.data.loaded?.sovitsPath || '');
    } catch {
      setServerReady(false);
      setLoadedGPTPath('');
      setLoadedSoVITSPath('');
    }
  }

  function clearReferenceSelection() {
    const audio = referencePreviewAudioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    setRefAudioPath('');
    setPromptText('');
    setPromptLang('en');
    setAuxRefAudios([]);
    setReferenceMessage('');
    setPreviewReference({ path: '', url: null, filename: '', role: '' });
    setReferenceAudioUrls({});
    setLoadingPreviewPath('');
  }

  function applyBestReference(files = trainingAudioFiles) {
    const selection = chooseBestReferenceSet(files);
    if (!selection.primary) {
      clearReferenceSelection();
      setReferenceMessage(selection.reason);
      return;
    }
    const nextPromptLang = normalizeReferenceLanguage(selection.primary.lang);
    setRefAudioPath(selection.primary.path);
    setPromptText(selection.primary.transcript || '');
    setPromptLang(nextPromptLang);
    setAuxRefAudios(selection.aux);
    setReferenceMessage(
      `${selection.primary.filename} selected with ${selection.aux.length} auxiliary clip${selection.aux.length === 1 ? '' : 's'}.`
    );
  }

  async function loadSelectedModel() {
    if (!selectedProfile || isConversationActive) return;
    setLoadingModel(true);
    setModelError('');
    try {
      await selectModels(selectedGPT, selectedSoVITS);
      setLoadedGPTPath(selectedGPT);
      setLoadedSoVITSPath(selectedSoVITS);
      setServerReady(true);
      setReferenceMessage('Voice model loaded.');
    } catch (err) {
      setModelError(err.response?.data?.error || err.message || 'Could not load this voice model.');
    } finally {
      setLoadingModel(false);
    }
  }

  function handlePrimaryReferenceChange(path) {
    const file = trainingAudioFiles.find((item) => item.path === path);
    if (!file) return;
    setRefAudioPath(file.path);
    setPromptText(file.transcript || '');
    setPromptLang(normalizeReferenceLanguage(file.lang));
    setAuxRefAudios((cur) => cur.filter((item) => item.path !== file.path).slice(0, 5));
    setReferenceMessage(`${file.filename} is now the primary reference.`);
  }

  function handleAuxToggle(file, checked) {
    if (!file?.path || file.path === refAudioPath) return;
    setAuxRefAudios((cur) => {
      const without = cur.filter((item) => item.path !== file.path);
      return checked ? [...without, file].slice(0, 5) : without;
    });
  }

  async function handlePreviewReference(item) {
    if (!item?.path || !selectedExpName) return;
    const filename = item.filename || fallbackName(item.path);
    const url = referenceAudioUrls[item.path];
    if (!url) { setReferenceMessage(`${filename} is still loading. Try again.`); return; }
    setPreviewReference({ path: item.path, url, filename, role: item.role });
    setReferenceMessage('');
    const audio = referencePreviewAudioRef.current;
    if (!audio) return;
    if (audio.getAttribute('src') !== url) { audio.src = url; audio.load(); }
    audio.play().catch(() => setReferenceMessage(`Use the audio controls below to play ${filename}.`));
  }

  useEffect(() => {
    if (!selectedExpName || trainingAudioFiles.length === 0) {
      setReferenceAudioUrls({});
      setLoadingPreviewPath('');
      return;
    }
    let ignore = false;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setLoadingPreviewPath('all');
    Promise.all(
      trainingAudioFiles.map(async (item) => {
        try {
          const url = await getTrainingAudioUrl(selectedExpName, item.filename || fallbackName(item.path));
          return [item.path, url];
        } catch {
          return [item.path, null];
        }
      })
    ).then((entries) => {
      if (ignore || previewRequestRef.current !== requestId) return;
      setReferenceAudioUrls(Object.fromEntries(entries.filter(([, url]) => Boolean(url))));
    }).finally(() => {
      if (!ignore && previewRequestRef.current === requestId) setLoadingPreviewPath('');
    });
    return () => { ignore = true; };
  }, [selectedExpName, trainingAudioFiles]);

  useEffect(() => {
    if (!previewReference.path) return;
    if (!trainingAudioFiles.some((item) => item.path === previewReference.path)) {
      const audio = referencePreviewAudioRef.current;
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      setPreviewReference({ path: '', url: null, filename: '', role: '' });
    }
  }, [trainingAudioFiles, previewReference.path]);

  useEffect(() => {
    if (!previewReference.path) return;
    const nextUrl = referenceAudioUrls[previewReference.path];
    if (!nextUrl) {
      const audio = referencePreviewAudioRef.current;
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      setPreviewReference({ path: '', url: null, filename: '', role: '' });
      return;
    }
    setPreviewReference((cur) => cur.url === nextUrl ? cur : { ...cur, url: nextUrl });
  }, [referenceAudioUrls, previewReference.path]);

  useEffect(() => {
    if (!previewReference.url) {
      const audio = referencePreviewAudioRef.current;
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      return;
    }
    const audio = referencePreviewAudioRef.current;
    if (audio && audio.getAttribute('src') !== previewReference.url) {
      audio.src = previewReference.url;
      audio.load();
    }
  }, [previewReference.url]);

  useEffect(() => {
    if (trainingAudioFiles.length > 0) return;
    const audio = referencePreviewAudioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    setPreviewReference({ path: '', url: null, filename: '', role: '' });
    setReferenceAudioUrls({});
    setLoadingPreviewPath('');
  }, [trainingAudioFiles.length]);

  useEffect(() => { return () => { referencePreviewAudioRef.current?.pause(); }; }, []);

  useEffect(() => {
    if (loadingPreviewPath !== 'all') return;
    const id = window.setTimeout(() => { if (loadingPreviewPath === 'all') setLoadingPreviewPath(''); }, 8000);
    return () => window.clearTimeout(id);
  }, [loadingPreviewPath]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const voiceParam = params.get('voice');
    if (voiceParam) urlVoiceKeyRef.current = voiceParam.toLowerCase().replace(/[\s_-]+/g, '');
    fetchModels();
    checkStatus();
  }, []);

  useEffect(() => {
    if (!modelsFetched || availableProfiles.length === 0) return;
    if (urlVoiceKeyRef.current) {
      const match = availableProfiles.find((p) => p.key === urlVoiceKeyRef.current);
      if (match) { urlVoiceKeyRef.current = ''; setSelectedPersonKey(match.key); autoLoadAttemptKeyRef.current = ''; return; }
    }
    if (availableProfiles.some((p) => p.key === selectedPersonKey)) return;
    setSelectedPersonKey(availableProfiles[0].key);
  }, [modelsFetched, availableProfiles, selectedPersonKey]);

  useEffect(() => {
    if (!shouldLoadSelectedProfile({
      serverReady, selectedProfile, loadedGPTPath, loadedSoVITSPath, isConversationActive, loadingModel,
    })) return;
    const loadKey = `${selectedProfile.gptModel.path}::${selectedProfile.sovitsModel.path}`;
    if (autoLoadAttemptKeyRef.current === loadKey) return;
    autoLoadAttemptKeyRef.current = loadKey;
    loadSelectedModel();
  }, [serverReady, selectedProfile, loadedGPTPath, loadedSoVITSPath, isConversationActive, loadingModel]);

  useEffect(() => {
    if (!selectedExpName) { setTrainingAudioFiles([]); setLoadedTrainingAudioSourceKey(''); return; }
    let ignore = false;
    setTrainingAudioFiles([]);
    setLoadedTrainingAudioSourceKey('');
    setLoadingTrainingAudio(true);
    getTrainingAudioFiles(selectedExpName)
      .then((res) => { if (!ignore) { setTrainingAudioFiles(res.data.files || []); setLoadedTrainingAudioSourceKey(selectedExpName); } })
      .catch(() => { if (!ignore) { setTrainingAudioFiles([]); setLoadedTrainingAudioSourceKey(''); setReferenceMessage('Could not load reference clips.'); } })
      .finally(() => { if (!ignore) setLoadingTrainingAudio(false); });
    return () => { ignore = true; };
  }, [selectedExpName]);

  useEffect(() => {
    if (!shouldAutoApplyBestReferenceSet({
      selectedSourceKey: selectedExpName,
      loadedSourceKey: loadedTrainingAudioSourceKey,
      loading: loadingTrainingAudio,
      fileCount: trainingAudioFiles.length,
      lastAppliedSourceKey: autoReferenceKeyRef.current,
    })) return;
    autoReferenceKeyRef.current = selectedExpName;
    applyBestReference(trainingAudioFiles);
  }, [selectedExpName, loadedTrainingAudioSourceKey, loadingTrainingAudio, trainingAudioFiles]);

  useEffect(() => {
    function handleGpuReady() { fetchModels(); checkStatus(); }
    window.addEventListener('voice-cloning-gpu-ready', handleGpuReady);
    return () => window.removeEventListener('voice-cloning-gpu-ready', handleGpuReady);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [liveSpeech.messages.length, liveSpeech.phase]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!playbackReady) { audio.pause(); audio.removeAttribute('src'); audio.load(); return; }
    if (audio.getAttribute('src') !== liveSpeech.audioSrc) { audio.src = liveSpeech.audioSrc; audio.load(); }
    audio.play().catch(() => {});
  }, [liveSpeech.audioSrc, liveSpeech.selectedReplyId, playbackReady]);

  const selectedModelLoaded = Boolean(
    serverReady && selectedGPT && selectedSoVITS &&
    selectedGPT === loadedGPTPath && selectedSoVITS === loadedSoVITSPath
  );
  const isReady = selectedModelLoaded && Boolean(liveRefParams);
  const isListening = liveSpeech.isMicInputEnabled &&
    (liveSpeech.phase === 'listening' || liveSpeech.phase === 'thinking');
  const canBargeIn = liveSpeech.isMicInputEnabled || liveSpeech.isBargeInArmed;
  const meterActive =
    (liveSpeech.isMicInputEnabled && (liveSpeech.phase === 'listening' || liveSpeech.phase === 'thinking'))
    || (canBargeIn && liveSpeech.phase === 'speaking');
  const buttonDisabled = !isReady || liveSpeech.phase === 'connecting' || liveSpeech.phase === 'stopping';

  const phaseLabel = {
    idle: 'Start',
    connecting: 'Connecting',
    listening: liveSpeech.isMicInputEnabled ? 'Mic on' : 'Mic off',
    thinking: liveSpeech.isMicInputEnabled ? 'Mic on' : 'Mic off',
    speaking: liveSpeech.isMicInputEnabled ? 'Mic on' : 'Mic off',
    stopping: 'Stopping',
  }[liveSpeech.phase] || 'Start';

  const statusText = liveSpeech.notice
    || (!liveSpeech.isMicInputEnabled && isConversationActive && liveSpeech.phase !== 'speaking'
      ? 'Mic off — voice chat still open.' : '')
    || {
      idle: 'Tap the mic to start.',
      connecting: 'Connecting...',
      listening: liveSpeech.isMicInputEnabled ? 'Listening...' : 'Mic off — voice chat still open.',
      thinking: 'Thinking...',
      speaking: liveSpeech.audioSrc
        ? (canBargeIn ? 'Speaking — speak to interrupt.' : 'Playing voice...')
        : 'Preparing voice...',
      stopping: 'Stopping...',
    }[liveSpeech.phase] || 'Tap the mic to start.';

  return (
    <div className="animate-fade-in flex min-h-0 flex-1 flex-col gap-3">

      {/* Top bar: title + selectors + status */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          <span className="bg-gradient-to-br from-slate-900 via-slate-800 to-primary/80 bg-clip-text text-transparent">
            {isFastMode ? 'Live Fast Voice Chat' : 'Live Voice Chat'}
          </span>
        </h1>

        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Voice</span>
            <Select
              value={selectedPersonKey}
              onValueChange={(v) => {
                setSelectedPersonKey(v);
                setModelError('');
                autoReferenceKeyRef.current = '';
                autoLoadAttemptKeyRef.current = '';
                setTrainingAudioFiles([]);
                setLoadedTrainingAudioSourceKey('');
                clearReferenceSelection();
              }}
              disabled={isConversationActive || availableProfiles.length === 0}
            >
              <SelectTrigger className="h-9 w-40 rounded-xl border-slate-200 bg-white text-sm shadow-none sm:w-44">
                <SelectValue placeholder={modelsFetched ? 'Select model' : 'Loading...'} />
              </SelectTrigger>
              <SelectContent>
                {availableProfiles.map((p) => (
                  <SelectItem key={p.key} value={p.key}>{p.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Lang</span>
            <Select value={liveLanguage} onValueChange={setSelectedLanguage} disabled={isConversationActive}>
              <SelectTrigger className="h-9 w-28 rounded-xl border-slate-200 bg-white text-sm shadow-none sm:w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIVE_LANGUAGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className={cn(
              'flex items-center gap-1.5 text-xs',
              selectedModelLoaded ? 'text-emerald-600' : loadingModel ? 'text-blue-500' : 'text-slate-400'
            )}>
              {loadingModel
                ? <Loader2 size={11} className="animate-spin" />
                : <span className={cn('h-2 w-2 rounded-full', selectedModelLoaded ? 'bg-emerald-500' : 'bg-slate-300')} />
              }
              {selectedModelLoaded ? 'Ready' : loadingModel ? 'Loading...' : 'No model'}
            </span>
            <button
              type="button"
              onClick={() => { autoLoadAttemptKeyRef.current = ''; fetchModels(); checkStatus(); }}
              disabled={isConversationActive || loadingModel}
              title="Refresh models"
              className="text-slate-400 transition-colors hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
      </div>

      {modelError && (
        <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-600">{modelError}</p>
      )}

      {!isReady && !modelError && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          {availableProfiles.length === 0
            ? 'No trained models found. Train a voice first, then return here.'
            : !selectedModelLoaded
              ? 'Select a trained model — it will load automatically.'
              : 'Reference clips loading — the best clip will be selected automatically.'}
        </div>
      )}

      {!liveSpeech.speechApiAvailable && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-600">
          This browser does not support live audio processing.
        </div>
      )}

      {/* Chat card — fills remaining height */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_4px_32px_-8px_rgba(0,0,0,0.09)]">

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-5">
          {liveSpeech.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <p className="text-base font-semibold text-slate-800">Ready to listen</p>
              <p className="mt-1.5 max-w-xs text-sm text-slate-400">
                {isReady
                  ? `Press the mic and speak in ${liveLanguageConfig.label}.`
                  : 'Select a voice model above to get started.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {liveSpeech.messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  selected={liveSpeech.selectedReply?.id === message.id && liveSpeech.phase === 'speaking'}
                  onPlay={liveSpeech.playReply}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {liveSpeech.error && (
          <div className="border-t border-red-100 bg-red-50 px-5 py-2.5 text-sm text-red-600">
            {liveSpeech.error}
          </div>
        )}

        {/* Bottom control bar */}
        <div className="border-t border-slate-100 px-4 pb-5 pt-4 sm:px-6 sm:pb-6">
          <div className="mb-3 flex h-7 items-end justify-center">
            <MicLevelMeter level={liveSpeech.audioLevel} active={meterActive} />
          </div>

          <div className="flex items-center justify-center gap-4 sm:gap-5">
            <div className="flex w-24 justify-end sm:w-28">
              {playbackReady && (
                <button
                  type="button"
                  onClick={liveSpeech.interruptPlayback}
                  title="Stop voice"
                  className="flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-800"
                >
                  <VolumeX size={13} />Stop
                </button>
              )}
            </div>

            <div className="relative flex items-center justify-center">
              {isListening && (
                <span className="absolute h-20 w-20 animate-ping rounded-full bg-red-400/20" />
              )}
              {!isListening && !buttonDisabled && !isConversationActive && (
                <span className="absolute h-[84px] w-[84px] rounded-full bg-gradient-to-br from-primary/15 to-violet-400/15" />
              )}
              <button
                type="button"
                className={cn(
                  'relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full transition-all duration-200 active:scale-95',
                  buttonDisabled
                    ? 'cursor-not-allowed bg-slate-100 text-slate-300'
                    : isListening
                      ? 'text-white shadow-lg shadow-red-300/60 [background:linear-gradient(135deg,hsl(0,84%,60%)_0%,hsl(340,82%,55%)_100%)]'
                      : isConversationActive
                        ? 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                        : 'text-white shadow-lg shadow-primary/35 hover:opacity-90 [background:linear-gradient(135deg,hsl(224,85%,58%)_0%,hsl(250,80%,62%)_100%)]'
                )}
                onClick={liveSpeech.toggle}
                disabled={buttonDisabled}
                aria-pressed={liveSpeech.isMicInputEnabled}
                title={phaseLabel}
              >
                <span className="sr-only">{phaseLabel}</span>
                {liveSpeech.isMicInputEnabled || liveSpeech.phase === 'idle'
                  ? <Mic size={22} />
                  : <MicOff size={22} />}
              </button>
            </div>

            <div className="flex w-24 justify-start sm:w-28">
              {isConversationActive && (
                <button
                  type="button"
                  onClick={liveSpeech.stop}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-800"
                >
                  <Square size={11} />End
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 text-center">
            <p className="text-sm font-medium text-slate-700">{statusText}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {loadedProfile?.displayName || '—'} · {liveLanguageConfig.label}
            </p>
          </div>
        </div>
      </div>

      {/* Advanced settings collapsible */}
      <Collapsible open={showSettings} onOpenChange={setShowSettings}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-slate-700"
          >
            <ChevronDown size={14} className={cn('transition-transform', showSettings && 'rotate-180')} />
            {showSettings ? 'Hide' : 'Show'} advanced settings
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-4 grid gap-5 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:p-5 lg:grid-cols-2">

            {/* Reference clips */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">Reference clips</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-xl border-slate-200 bg-white shadow-none"
                  onClick={() => applyBestReference()}
                  disabled={loadingTrainingAudio || trainingAudioFiles.length === 0 || isConversationActive}
                >
                  <Check size={13} />Use best
                </Button>
              </div>

              <div>
                <Label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  Primary reference
                </Label>
                <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2">
                  <Select
                    value={refAudioPath}
                    onValueChange={handlePrimaryReferenceChange}
                    disabled={loadingTrainingAudio || trainingAudioFiles.length === 0 || isConversationActive}
                  >
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white shadow-none">
                      <SelectValue placeholder={loadingTrainingAudio ? 'Loading...' : 'Select primary'} />
                    </SelectTrigger>
                    <SelectContent>
                      {trainingAudioFiles.map((f) => (
                        <SelectItem key={f.path} value={f.path}>{f.filename}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(() => {
                    const pi = selectedReferenceItems.find((item) => item.role === 'primary');
                    const pUrl = pi ? referenceAudioUrls[pi.path] : null;
                    const pLoading = Boolean(pi) && loadingPreviewPath === 'all' && !pUrl;
                    return (
                      <button
                        type="button"
                        onClick={() => handlePreviewReference(pi)}
                        disabled={!pi || !pUrl || pLoading}
                        className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 disabled:cursor-wait disabled:opacity-50',
                          previewReference.path === pi?.path && 'border-slate-300 bg-slate-50'
                        )}
                      >
                        {pLoading
                          ? <Loader2 size={14} className="animate-spin" />
                          : <PlayCircle size={15} />}
                      </button>
                    );
                  })()}
                </div>
              </div>

              <div>
                <Label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  Auxiliary clips
                </Label>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                  {trainingAudioFiles.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-slate-400">
                      {loadingTrainingAudio ? 'Loading...' : 'No clips found.'}
                    </p>
                  ) : (
                    trainingAudioFiles.filter((f) => f.path !== refAudioPath).map((f) => {
                      const checked = auxRefAudios.some((item) => item.path === f.path);
                      const fUrl = referenceAudioUrls[f.path];
                      const loading = (loadingPreviewPath === 'all' && !fUrl) || loadingPreviewPath === f.path;
                      const pi2 = {
                        role: checked ? 'auxiliary' : 'preview',
                        path: f.path,
                        filename: f.filename,
                        transcript: f.transcript || '',
                      };
                      return (
                        <div key={f.path} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => handleAuxToggle(f, Boolean(v))}
                            disabled={isConversationActive || (!checked && auxRefAudios.length >= 5)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-xs text-slate-700">{f.filename}</span>
                            {f.transcript && (
                              <span className="mt-0.5 block truncate text-xs text-slate-400">{f.transcript}</span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => handlePreviewReference(pi2)}
                            disabled={!selectedExpName || !fUrl || loading}
                            className={cn(
                              'mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-700 disabled:cursor-wait disabled:opacity-50',
                              previewReference.path === f.path && 'border-slate-300 text-slate-700'
                            )}
                          >
                            {loading
                              ? <Loader2 size={11} className="animate-spin" />
                              : <PlayCircle size={12} />}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  {auxRefAudios.length}/5 auxiliary · Primary: {refAudioPath ? fallbackName(refAudioPath) : 'none'}
                </p>
              </div>

              <div className={cn(!previewReference.url && 'hidden')}>
                {previewReference.url && (
                  <p className="mb-1 truncate text-[11px] text-slate-400">
                    Previewing {previewReference.role}: {previewReference.filename}
                  </p>
                )}
                <audio
                  ref={referencePreviewAudioRef}
                  className="w-full"
                  controls
                  preload="metadata"
                  onError={() => {
                    if (previewReference.filename) {
                      setReferenceMessage(`Could not play ${previewReference.filename}.`);
                    }
                  }}
                  onPlay={() => setReferenceMessage('')}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
                <div>
                  <Label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                    Primary transcript
                  </Label>
                  <Textarea
                    className="min-h-[90px] rounded-xl border-slate-200 bg-white leading-6 shadow-none"
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    disabled={isConversationActive}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                    Ref language
                  </Label>
                  <Select value={promptLang} onValueChange={setPromptLang} disabled={isConversationActive}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white shadow-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="zh">Chinese</SelectItem>
                      <SelectItem value="ja">Japanese</SelectItem>
                      <SelectItem value="ko">Korean</SelectItem>
                      <SelectItem value="auto">Auto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {referenceMessage && (
                <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                  {referenceMessage}
                </p>
              )}
            </div>

            {/* Inference controls */}
            <div className="space-y-4">
              <p className="text-sm font-semibold text-slate-800">Inference controls</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: 'Speed', display: speed.toFixed(1) + 'x', min: 0.5, max: 2.0, step: 0.1, val: speed, set: setSpeed },
                  { label: 'Top K', display: String(topK), min: 1, max: 50, step: 1, val: topK, set: setTopK },
                  { label: 'Top P', display: topP.toFixed(2), min: 0, max: 1, step: 0.05, val: topP, set: setTopP },
                  { label: 'Temperature', display: temperature.toFixed(2), min: 0, max: 1, step: 0.05, val: temperature, set: setTemperature },
                ].map(({ label, display, min, max, step, val, set }) => (
                  <div key={label} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</Label>
                      <span className="font-mono text-sm font-semibold text-slate-700">{display}</span>
                    </div>
                    <Slider
                      min={min} max={max} step={step}
                      value={[val]} onValueChange={([v]) => set(v)}
                      disabled={isConversationActive}
                    />
                  </div>
                ))}
                <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                      Repetition Penalty
                    </Label>
                    <span className="font-mono text-sm font-semibold text-slate-700">{repPenalty.toFixed(2)}</span>
                  </div>
                  <Slider
                    min={1.0} max={2.0} step={0.05}
                    value={[repPenalty]} onValueChange={([v]) => setRepPenalty(v)}
                    disabled={isConversationActive}
                  />
                </div>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <audio ref={audioRef} className="hidden" onEnded={liveSpeech.onAudioEnded} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/LivePage.jsx
git commit -m "feat: redesign LivePage to match separate-containers UI"
```

---

## Task 5: Fix App.jsx — flex layout for height-fill + mobile nav

**Files:**
- Modify: `client/src/App.jsx`

The `<main>` element needs `flex flex-col` so the `flex-1` on LivePage fills height correctly. The header needs mobile-friendly navigation (horizontally scrollable, compact padding on small screens). The logo area should shrink on mobile.

- [ ] **Step 1: Update `<main>` className to add `flex flex-col` and mobile padding**

In `client/src/App.jsx`, find:
```jsx
<main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
```
Replace with:
```jsx
<main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6 sm:py-10">
```

- [ ] **Step 2: Make the nav horizontally scrollable on mobile and compact**

Find:
```jsx
<nav className="mt-4 flex items-center gap-7 border-b border-slate-200/80">
```
Replace with:
```jsx
<nav className="-mb-px mt-4 flex items-center gap-4 overflow-x-auto scrollbar-none sm:gap-7">
```

- [ ] **Step 3: Reduce header padding on mobile**

Find:
```jsx
<div className="flex items-center justify-between pt-5">
```
Replace with:
```jsx
<div className="flex items-center justify-between pt-3 sm:pt-5">
```

- [ ] **Step 4: Shrink logo icon on mobile**

Find:
```jsx
<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-primary shadow-[0_18px_35px_-24px_rgba(14,165,233,0.85)]">
  <Activity className="h-6 w-6 text-primary" />
</div>
```
Replace with:
```jsx
<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-primary shadow-[0_18px_35px_-24px_rgba(14,165,233,0.85)] sm:h-12 sm:w-12 sm:rounded-2xl">
  <Activity className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
</div>
```

- [ ] **Step 5: Make app title text smaller on mobile**

Find:
```jsx
<h1 className="text-xl font-semibold tracking-tight text-foreground">
  Voice Cloning Studio
</h1>
<p className="text-xs text-muted-foreground">
  AI Voice Cloning Studio
</p>
```
Replace with:
```jsx
<h1 className="text-base font-semibold tracking-tight text-foreground sm:text-xl">
  Voice Cloning Studio
</h1>
<p className="hidden text-xs text-muted-foreground sm:block">
  AI Voice Cloning Studio
</p>
```

- [ ] **Step 6: Make GPU control button compact on mobile**

Find:
```jsx
className="inline-flex h-10 cursor-wait items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-500"
```
Replace with:
```jsx
className="inline-flex h-8 cursor-wait items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-500 sm:h-10 sm:rounded-2xl sm:font-semibold"
```

Find (the "not configured" button):
```jsx
className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-500"
```
Replace with:
```jsx
className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-500 sm:h-10 sm:rounded-2xl sm:font-semibold"
```

Find (the main GPU control button):
```jsx
className={cn(
  'inline-flex h-10 items-center gap-2 rounded-2xl border px-3 text-xs font-semibold transition-colors',
```
Replace with:
```jsx
className={cn(
  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors sm:h-10 sm:rounded-2xl sm:font-semibold',
```

- [ ] **Step 7: Reduce header outer padding on mobile**

Find:
```jsx
<div className="mx-auto max-w-6xl px-6">
```
Replace with:
```jsx
<div className="mx-auto max-w-6xl px-4 sm:px-6">
```

- [ ] **Step 8: Make footer padding responsive**

Find:
```jsx
<footer className="mx-auto w-full max-w-6xl px-6">
```
Replace with:
```jsx
<footer className="mx-auto w-full max-w-6xl px-4 sm:px-6">
```

- [ ] **Step 9: Commit**

```bash
git add client/src/App.jsx
git commit -m "fix: make app header and layout mobile responsive"
```

---

## Task 6: Mobile responsiveness — TrainingPage

**Files:**
- Modify: `client/src/pages/TrainingPage.jsx`

- [ ] **Step 1: Shrink page title on mobile**

Find:
```jsx
<h1 className="text-4xl font-bold tracking-tight">
```
Replace with:
```jsx
<h1 className="text-2xl font-bold tracking-tight sm:text-4xl">
```

- [ ] **Step 2: Reduce title section bottom margin on mobile**

Find:
```jsx
<div className="mb-10">
```
Replace with:
```jsx
<div className="mb-6 sm:mb-10">
```

- [ ] **Step 3: Reduce grid gap on mobile**

Find:
```jsx
<div className="grid items-start gap-12 lg:grid-cols-[minmax(0,8fr)_minmax(0,11fr)]">
```
Replace with:
```jsx
<div className="grid items-start gap-8 lg:grid-cols-[minmax(0,8fr)_minmax(0,11fr)] lg:gap-12">
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/TrainingPage.jsx
git commit -m "fix: make TrainingPage title and grid mobile responsive"
```

---

## Task 7: Mobile responsiveness — InferencePage

**Files:**
- Modify: `client/src/pages/InferencePage.jsx`

- [ ] **Step 1: Reduce hero card padding on mobile**

Find:
```jsx
<section className="relative overflow-hidden rounded-[32px] border border-sky-200/50 bg-[linear-gradient(135deg,#0f172a_0%,#082f49_42%,#115e59_100%)] px-6 py-7 text-white shadow-[0_32px_90px_-45px_rgba(15,23,42,0.85)] sm:px-8 lg:px-10">
```
Replace with:
```jsx
<section className="relative overflow-hidden rounded-[24px] border border-sky-200/50 bg-[linear-gradient(135deg,#0f172a_0%,#082f49_42%,#115e59_100%)] px-4 py-5 text-white shadow-[0_32px_90px_-45px_rgba(15,23,42,0.85)] sm:rounded-[32px] sm:px-8 sm:py-7 lg:px-10">
```

- [ ] **Step 2: Reduce hero heading size on mobile**

Find:
```jsx
<h2 className="mt-5 max-w-3xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
```
Replace with:
```jsx
<h2 className="mt-4 max-w-3xl font-display text-xl font-semibold tracking-tight text-white sm:mt-5 sm:text-3xl lg:text-4xl">
```

- [ ] **Step 3: Reduce Card content padding on mobile**

There are multiple `<CardContent className="... p-6">`. Replace all of them to use responsive padding:

Find all occurrences of:
```jsx
<CardContent className="space-y-5 p-6">
```
Replace with:
```jsx
<CardContent className="space-y-5 p-4 sm:p-6">
```

Find all occurrences of:
```jsx
<CardContent className="space-y-6 p-6">
```
Replace with:
```jsx
<CardContent className="space-y-6 p-4 sm:p-6">
```

Find all occurrences of:
```jsx
<CardContent className="space-y-8 p-6">
```
Replace with:
```jsx
<CardContent className="space-y-8 p-4 sm:p-6">
```

- [ ] **Step 4: Reduce CardHeader padding on mobile**

Find all occurrences of `CardHeader className` that do NOT already have responsive padding. They use `className="border-b border-slate-100/80 bg-[...]"` without a `p-*`. The shadcn CardHeader component adds default padding internally — check `client/src/components/ui/card.jsx` first.

Open `client/src/components/ui/card.jsx` and find the `CardHeader` component. If it uses a static `p-6`, update to `p-4 sm:p-6`. If it already has responsive padding, skip this step.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/InferencePage.jsx client/src/components/ui/card.jsx
git commit -m "fix: make InferencePage hero and cards mobile responsive"
```

---

## Self-Review Checklist

- **Task 1**: `shouldAutoApplyBestReferenceSet` is consumed in Task 4's LivePage — import and call match the exported signature ✓
- **Task 2**: `buildLiveFastRefParams` returns `null` when `primaryPath` is empty — this is the correct `isReady` guard in Task 4 ✓
- **Task 3**: `shouldLoadSelectedProfile` takes `{ serverReady, selectedProfile, loadedGPTPath, loadedSoVITSPath, isConversationActive, loadingModel }` — called exactly this way in Task 4 ✓
- **Task 4**: `buildVoiceProfiles` is imported from `@/lib/voiceProfiles` which already exists ✓; `useLiveSpeech` hook signature unchanged ✓; `LIVE_LANGUAGE_OPTIONS` + `getLiveLanguageConfig` + `normalizeLiveLanguage` from `liveConversation.js` match existing exports ✓
- **Task 5, Step 2**: `scrollbar-none` is a Tailwind utility — verify it works or use `[&::-webkit-scrollbar]:hidden` if the project doesn't have the scrollbar plugin.
- **Gap check**: The `<audio>` ref for playback (`audioRef`) in Task 4 uses `liveSpeech.onAudioEnded` — this prop must exist on the `useLiveSpeech` return value. Verify before committing Task 4.

> **Note on Task 5 Step 2**: If `scrollbar-none` does not work (requires `tailwind-scrollbar-hide` plugin), replace the nav className with:
> ```jsx
> <nav className="-mb-px mt-4 flex items-center gap-4 overflow-x-auto [&::-webkit-scrollbar]:hidden sm:gap-7">
> ```
