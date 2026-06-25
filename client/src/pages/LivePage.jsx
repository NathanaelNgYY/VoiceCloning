import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getInferenceStatus,
  getModels,
  getTrainingAudioUrl,
  getTrainingAudioFiles,
  getTrainingRunMetadata,
  activateVoiceProfile,
  deleteVoiceProfileConfig,
  getFullActiveVoiceProfile,
  getVoiceProfileConfigs,
  saveVoiceProfileConfig,
  selectModels,
  startGeneration,
  getCurrentInference,
  getGenerationResultSource,
  synthesizeSentence,
  getPronunciationDictionary,
  savePronunciationEntry,
  deletePronunciationEntry,
  startInferenceServer,
  stopInferenceServer,
} from '../services/api.js';
import { useLiveSpeech } from '../hooks/useLiveSpeech.js';
import { useInferenceSSE } from '../hooks/useInferenceSSE.js';
import {
  LIVE_LANGUAGE_OPTIONS,
  getLiveLanguageConfig,
  normalizeLiveLanguage,
  splitLiveReplyPhrases,
  shortenFirstFastPhrase,
} from '../hooks/liveConversation.js';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { MicLevelMeter } from '@/components/MicLevelMeter';
import {
  chooseBestReferenceSet,
  describeReferenceCandidate,
  shouldAutoApplyBestReferenceSet,
} from '@/lib/referenceSelection';
import { buildVoiceProfiles } from '@/lib/voiceProfiles';
import {
  DEFAULT_LIVE_FAST_SETTINGS,
  buildLiveFastReferencePreviewItems,
  buildLiveFastRefParams,
} from '@/lib/liveFastSetup';
import {
  DEFAULT_LIVE_FULL_SETTINGS,
  buildLiveFullConfigPayload,
  buildLiveFullRefParams,
  filterLiveFastConfigs,
  filterLiveFullConfigs,
  normalizeLiveFullSettings,
} from '@/lib/liveFullSetup';
import {
  buildModelSelectWarmPayload,
  extractModelSelectWarmedReferenceSelection,
  resolveInferenceStatusState,
  shouldLoadSelectedProfile,
} from '@/lib/modelLoading';
import { formatActiveVoiceProfileSummary } from '@/lib/activeVoiceProfile';
import { getStorageMode } from '@/lib/runtimeConfig';
import {
  addTtsHistoryItem,
  createTtsHistoryItem,
  getTtsHistoryByRoute,
} from '@/lib/ttsHistory';
import { concatWavBlobs } from '@/lib/wavConcat';
import { generateLiveFastQueuedTts } from '@/lib/liveFastQueuedTts';
import {
  parsePronunciationCsv,
  serializePronunciationCsv,
} from '@/lib/pronunciationCsv';
import { buildVoiceProfileId, buildVoiceProfilePayload } from '@/lib/voiceProfilePayload';
import {
  buildSavedVoiceProfileRestoreKey,
  findSavedVoiceProfileKey,
  hasRestorableSavedVoiceProfile,
  matchesSavedVoiceProfileReferenceSelection,
  matchesSavedVoiceProfileSelection,
} from '@/lib/savedVoiceProfile';
import {
  createVoiceProfileBrowserDebugSummary,
  writeVoiceProfileBrowserDebug,
} from '@/lib/voiceProfileDebug';
import {
  createAutoVoiceProfileSyncFingerprint,
  getAutoSyncRequestFingerprint,
} from '@/lib/autoVoiceProfileSync';
import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  Loader2,
  Mic,
  MicOff,
  Pencil,
  PlayCircle,
  RefreshCw,
  Square,
  Trash2,
  Upload,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

function withCacheBuster(url) {
  if (!url || url.startsWith('blob:')) return url;
  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set('_audioReady', String(Date.now()));
    return parsed.toString();
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_audioReady=${Date.now()}`;
  }
}

function waitForAudioMetadata(url, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (timer) window.clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.oncanplay = null;
      audio.onerror = null;
    };
    const done = (ok) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (ok) resolve();
      else reject(new Error('Audio metadata was not ready yet.'));
    };
    timer = window.setTimeout(() => done(false), timeoutMs);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(true);
    audio.oncanplay = () => done(true);
    audio.onerror = () => done(false);
    audio.src = url;
    audio.load();
  });
}

async function waitForPlayableAudioSource(url, { attempts = 5, delayMs = 700 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const candidateUrl = withCacheBuster(url);
    try {
      await waitForAudioMetadata(candidateUrl);
      return candidateUrl;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError || new Error('Generated audio is not playable yet.');
}

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

const PRONUNCIATION_CATEGORIES = ['general', 'biology', 'chemistry', 'medical', 'names', 'acronyms', 'math'];

function buildConfigId(seed = '') {
  const slug = String(seed || 'config')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'config'}-${Date.now().toString(36)}`;
}

function formatReferenceScore(candidate) {
  if (!candidate) return 'unscored';
  return `${Math.round(candidate.score)} ${candidate.eligible ? 'strict' : 'manual'}`;
}

function ChatBubble({ message, selected, selectedPart, onPlay, audioRef }) {
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
                part.status === 'ready' || part.status === 'played' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : part.status === 'generating' ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : part.status === 'error' ? 'border-red-200 bg-red-50 text-red-600'
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

export default function LivePage({ replyMode = 'phrases', mode = 'chat' }) {
  const [gptModels, setGptModels] = useState([]);
  const [sovitsModels, setSovitsModels] = useState([]);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [modelError, setModelError] = useState('');
  const [selectedPersonKey, setSelectedPersonKey] = useState('');
  const [loadedGPTPath, setLoadedGPTPath] = useState('');
  const [loadedSoVITSPath, setLoadedSoVITSPath] = useState('');
  const [serverReady, setServerReady] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [activeVoiceProfile, setActiveVoiceProfile] = useState(null);
  const [loadingActiveVoiceProfile, setLoadingActiveVoiceProfile] = useState(true);
  const [activeVoiceProfileError, setActiveVoiceProfileError] = useState('');
  const [voiceConfigs, setVoiceConfigs] = useState([]);
  const [loadingVoiceConfigs, setLoadingVoiceConfigs] = useState(false);
  const [voiceConfigError, setVoiceConfigError] = useState('');
  const [loadedConfigId, setLoadedConfigId] = useState('');
  const [trainingRunMetadata, setTrainingRunMetadata] = useState(null);
  const [trainingRunMetadataError, setTrainingRunMetadataError] = useState('');
  const [savingConfigId, setSavingConfigId] = useState('');
  const [generatingSampleConfigId, setGeneratingSampleConfigId] = useState('');
  const [draggingConfigId, setDraggingConfigId] = useState('');
  const [configSampleUrls, setConfigSampleUrls] = useState({});
  const [liveFullConfigs, setLiveFullConfigs] = useState([]);
  const [loadedLiveFullConfigId, setLoadedLiveFullConfigId] = useState('');
  const [savingLiveFullConfigId, setSavingLiveFullConfigId] = useState('');
  const [generatingLiveFullSampleConfigId, setGeneratingLiveFullSampleConfigId] = useState('');
  const [liveFullMessage, setLiveFullMessage] = useState('');

  const [trainingAudioFiles, setTrainingAudioFiles] = useState([]);
  const [loadedTrainingAudioSourceKey, setLoadedTrainingAudioSourceKey] = useState('');
  const [loadingTrainingAudio, setLoadingTrainingAudio] = useState(false);
  const [refAudioPath, setRefAudioPath] = useState('');
  const [promptText, setPromptText] = useState('');
  const [promptLang, setPromptLang] = useState('en');
  const [auxRefAudios, setAuxRefAudios] = useState([]);
  const [referenceMessage, setReferenceMessage] = useState('');
  const [previewReference, setPreviewReference] = useState({ path: '', url: null, filename: '', role: '' });
  const [liveFullPreviewReference, setLiveFullPreviewReference] = useState({ path: '', url: null, filename: '', role: '' });
  const [referenceAudioUrls, setReferenceAudioUrls] = useState({});
  const [loadingPreviewPath, setLoadingPreviewPath] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const [speed, setSpeed] = useState(DEFAULT_LIVE_FAST_SETTINGS.speed);
  const [topK, setTopK] = useState(DEFAULT_LIVE_FAST_SETTINGS.topK);
  const [topP, setTopP] = useState(DEFAULT_LIVE_FAST_SETTINGS.topP);
  const [temperature, setTemperature] = useState(DEFAULT_LIVE_FAST_SETTINGS.temperature);
  const [repPenalty, setRepPenalty] = useState(DEFAULT_LIVE_FAST_SETTINGS.repPenalty);
  const [liveFullRefAudioPath, setLiveFullRefAudioPath] = useState('');
  const [liveFullPromptText, setLiveFullPromptText] = useState('');
  const [liveFullPromptLang, setLiveFullPromptLang] = useState('en');
  const [liveFullAuxRefAudios, setLiveFullAuxRefAudios] = useState([]);
  const [liveFullSpeed, setLiveFullSpeed] = useState(DEFAULT_LIVE_FULL_SETTINGS.speed);
  const [liveFullTopK, setLiveFullTopK] = useState(DEFAULT_LIVE_FULL_SETTINGS.topK);
  const [liveFullTopP, setLiveFullTopP] = useState(DEFAULT_LIVE_FULL_SETTINGS.topP);
  const [liveFullTemperature, setLiveFullTemperature] = useState(DEFAULT_LIVE_FULL_SETTINGS.temperature);
  const [liveFullRepPenalty, setLiveFullRepPenalty] = useState(DEFAULT_LIVE_FULL_SETTINGS.repPenalty);

  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [ttsText, setTtsText] = useState('');
  const [ttsHistory, setTtsHistory] = useState([]);
  const [ttsFastGenerating, setTtsFastGenerating] = useState(false);
  const [ttsFastProgress, setTtsFastProgress] = useState({ total: 0, current: 0, text: '' });
  // Which button (if any) is running the async chunked flow: null | 'fast' | 'full'.
  const [streamingRoute, setStreamingRoute] = useState(null);
  const [ttsError, setTtsError] = useState('');
  const [pronunciationCategory, setPronunciationCategory] = useState('general');
  const [pronunciationWord, setPronunciationWord] = useState('');
  const [pronunciationReadable, setPronunciationReadable] = useState('');
  const [pronunciationArpabet, setPronunciationArpabet] = useState('');
  const [editingPronunciationWord, setEditingPronunciationWord] = useState('');
  const [pronunciationEntries, setPronunciationEntries] = useState([]);
  const [pronunciationMessage, setPronunciationMessage] = useState('');
  const [pronunciationBusy, setPronunciationBusy] = useState(false);
  const [pronunciationTestingWord, setPronunciationTestingWord] = useState('');
  const [pronunciationReloadPending, setPronunciationReloadPending] = useState(false);
  const audioRef = useRef(null);
  const messagesEndRef = useRef(null);
  const referencePreviewAudioRef = useRef(null);
  const liveFullPreviewAudioRef = useRef(null);
  const autoReferenceKeyRef = useRef('');
  const autoLoadAttemptKeyRef = useRef('');
  const urlVoiceKeyRef = useRef('');
  const restoredActiveVoiceProfileKeyRef = useRef('');
  const previewRequestRef = useRef(0);
  const configSampleUrlsRef = useRef({});
  const voiceConfigsRef = useRef([]);
  const autoDefaultConfigKeyRef = useRef('');
  const autoLoadedLiveFastConfigProfileRef = useRef('');
  const liveFullDefaultKeyRef = useRef('');
  const liveFullAutoDefaultSaveKeyRef = useRef('');
  const reorderingConfigRef = useRef(false);
  const pendingAutoSyncFingerprintRef = useRef('');
  const autoSyncRequestFingerprintRef = useRef('');
  const lastAutoSyncedFingerprintRef = useRef('');
  const statusRequestVersionRef = useRef(0);
  const loadedModelStateRef = useRef({ gptPath: '', sovitsPath: '' });
  const ttsHistoryRef = useRef([]);
  const queuedTtsAudioRef = useRef(null);
  const queuedTtsRef = useRef({ clips: [], playingIndex: -1, active: false });
  const pronunciationImportInputRef = useRef(null);
  const ttsInference = useInferenceSSE();
  const pendingFullTtsRef = useRef(null);
  const completingFullTtsSessionRef = useRef('');

  const voiceProfiles = useMemo(() => buildVoiceProfiles(gptModels, sovitsModels), [gptModels, sovitsModels]);
  const availableProfiles = useMemo(() => voiceProfiles.filter((p) => p.complete), [voiceProfiles]);
  const selectedProfile = availableProfiles.find((p) => p.key === selectedPersonKey) || null;
  const selectedGPT = selectedProfile?.gptModel?.path || '';
  const selectedSoVITS = selectedProfile?.sovitsModel?.path || '';
  const selectedExpName = selectedProfile?.expName || '';
  const selectedVoiceProfileId = selectedProfile ? buildVoiceProfileId(selectedProfile.displayName) : '';
  const canRestoreActiveVoiceProfile = matchesSavedVoiceProfileSelection({
    profile: activeVoiceProfile,
    voiceProfileId: selectedVoiceProfileId,
    selectedGPT,
    selectedSoVITS,
  }) && hasRestorableSavedVoiceProfile(activeVoiceProfile);
  const activeVoiceProfileRestoreKey = canRestoreActiveVoiceProfile
    ? buildSavedVoiceProfileRestoreKey(activeVoiceProfile)
    : '';
  const loadedProfile = availableProfiles.find((p) =>
    p.gptModel?.path === loadedGPTPath && p.sovitsModel?.path === loadedSoVITSPath
  ) || null;

  const liveLanguage = normalizeLiveLanguage(selectedLanguage);
  const liveLanguageConfig = getLiveLanguageConfig(liveLanguage);
  const liveRefParams = useMemo(() => buildLiveFastRefParams({
    primaryPath: refAudioPath, promptText, promptLang, auxRefAudios,
    settings: { speed, topK, topP, temperature, repPenalty },
  }), [refAudioPath, promptText, promptLang, auxRefAudios, speed, topK, topP, temperature, repPenalty]);
  const liveFullSettings = useMemo(() => normalizeLiveFullSettings({
    speed: liveFullSpeed,
    topK: liveFullTopK,
    topP: liveFullTopP,
    temperature: liveFullTemperature,
    repPenalty: liveFullRepPenalty,
  }), [liveFullSpeed, liveFullTopK, liveFullTopP, liveFullTemperature, liveFullRepPenalty]);
  const liveFastRankOneReferenceSummary = useMemo(() => {
    const rankOneConfig = voiceConfigs[0] || null;
    const { primaryPath, auxPaths } = getConfigReferencePaths(rankOneConfig);
    return {
      config: rankOneConfig,
      primaryPath,
      auxPaths,
      primaryName: primaryPath ? fallbackName(primaryPath) : 'none',
    };
  }, [voiceConfigs]);
  const liveFullRefParams = useMemo(() => (
    buildLiveFullRefParamsFromLiveFastRankOne(voiceConfigs[0], liveFullSettings)
  ), [voiceConfigs, trainingAudioFiles, liveFullSettings]);
  const currentAutoSyncFingerprint = useMemo(() => createAutoVoiceProfileSyncFingerprint({
    sourceKey: selectedExpName,
    selectedGPT,
    selectedSoVITS,
    refAudioPath,
    promptText,
    promptLang,
    textLang: liveLanguage,
    preferredRoute: 'sentence',
    auxRefAudioPaths: auxRefAudios.map((item) => item.path),
    defaults: {
      top_k: topK,
      top_p: topP,
      temperature,
      repetition_penalty: repPenalty,
      speed_factor: speed,
    },
  }), [
    selectedExpName,
    selectedGPT,
    selectedSoVITS,
    refAudioPath,
    promptText,
    promptLang,
    liveLanguage,
    auxRefAudios,
    topK,
    topP,
    temperature,
    repPenalty,
    speed,
  ]);
  const selectedReferenceItems = useMemo(() => buildLiveFastReferencePreviewItems({
    primaryPath: refAudioPath, promptText, trainingAudioFiles, auxRefAudios,
  }), [refAudioPath, promptText, trainingAudioFiles, auxRefAudios]);
  const selectedLiveFullReferenceItems = useMemo(() => buildLiveFastReferencePreviewItems({
    primaryPath: liveFullRefAudioPath,
    promptText: liveFullPromptText,
    trainingAudioFiles,
    auxRefAudios: liveFullAuxRefAudios,
  }), [liveFullRefAudioPath, liveFullPromptText, trainingAudioFiles, liveFullAuxRefAudios]);
  const referenceCandidateMap = useMemo(() => (
    Object.fromEntries(trainingAudioFiles.map((file) => [file.path, describeReferenceCandidate(file)]))
  ), [trainingAudioFiles]);
  const currentReferenceMetadata = useMemo(() => {
    const sourcePrimary = referenceCandidateMap[refAudioPath];
    const primary = refAudioPath ? describeReferenceCandidate({
      ...(sourcePrimary?.file || {}),
      filename: sourcePrimary?.filename || fallbackName(refAudioPath),
      path: refAudioPath,
      transcript: promptText,
      lang: promptLang,
    }) : null;
    const aux = auxRefAudios.map((file) => referenceCandidateMap[file.path] || describeReferenceCandidate(file));
    return {
      mode: primary?.eligible ? 'strict' : 'manual',
      primary,
      aux,
      selectedPaths: {
        primary: refAudioPath,
        aux: auxRefAudios.map((item) => item.path),
      },
    };
  }, [referenceCandidateMap, refAudioPath, promptText, promptLang, auxRefAudios]);
  const currentLiveFullReferenceMetadata = useMemo(() => {
    const sourcePrimary = referenceCandidateMap[liveFullRefAudioPath];
    const primary = liveFullRefAudioPath ? describeReferenceCandidate({
      ...(sourcePrimary?.file || {}),
      filename: sourcePrimary?.filename || fallbackName(liveFullRefAudioPath),
      path: liveFullRefAudioPath,
      transcript: liveFullPromptText,
      lang: liveFullPromptLang,
    }) : null;
    const aux = liveFullAuxRefAudios.map((file) => referenceCandidateMap[file.path] || describeReferenceCandidate(file));
    return {
      mode: primary?.eligible ? 'strict' : 'manual',
      primary,
      aux,
      selectedPaths: {
        primary: liveFullRefAudioPath,
        aux: liveFullAuxRefAudios.map((item) => item.path),
      },
    };
  }, [referenceCandidateMap, liveFullRefAudioPath, liveFullPromptText, liveFullPromptLang, liveFullAuxRefAudios]);
  const currentLiveFastMetadata = useMemo(() => ({
    configName: selectedProfile?.displayName ? `${selectedProfile.displayName} default` : 'Default',
    selected: true,
    rank: 1,
    language: liveLanguage,
    preferredRoute: 'sentence',
    defaults: {
      top_k: topK,
      top_p: topP,
      temperature,
      repetition_penalty: repPenalty,
      speed_factor: speed,
    },
  }), [selectedProfile, liveLanguage, topK, topP, temperature, repPenalty, speed]);

  const liveSpeech = useLiveSpeech({ refParams: liveRefParams, replyMode, language: liveLanguage });
  const playbackReady = liveSpeech.shouldPlayAudio && Boolean(liveSpeech.audioSrc);
  const isConversationActive = liveSpeech.phase !== 'idle';
  const liveSelectedModelLoaded = Boolean(
    serverReady && selectedGPT && selectedSoVITS &&
    selectedGPT === loadedGPTPath && selectedSoVITS === loadedSoVITSPath
  );
  const autoSyncRequestFingerprint = getAutoSyncRequestFingerprint({
    pendingFingerprint: pendingAutoSyncFingerprintRef.current,
    currentFingerprint: currentAutoSyncFingerprint,
    lastSyncedFingerprint: lastAutoSyncedFingerprintRef.current,
    ready: liveSelectedModelLoaded && Boolean(refAudioPath),
    busy: isConversationActive || loadingModel,
    inFlightFingerprint: autoSyncRequestFingerprintRef.current,
  });

  useEffect(() => {
    voiceConfigsRef.current = voiceConfigs;
  }, [voiceConfigs]);

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

  function applyInferenceStatusState(nextState = {}) {
    loadedModelStateRef.current = {
      gptPath: String(nextState.loadedGPTPath || '').trim(),
      sovitsPath: String(nextState.loadedSoVITSPath || '').trim(),
    };
    setServerReady(Boolean(nextState.serverReady));
    setLoadedGPTPath(loadedModelStateRef.current.gptPath);
    setLoadedSoVITSPath(loadedModelStateRef.current.sovitsPath);
  }

  async function checkStatus() {
    const requestVersion = ++statusRequestVersionRef.current;
    try {
      const res = await getInferenceStatus();
      if (statusRequestVersionRef.current !== requestVersion) {
        return;
      }
      applyInferenceStatusState(resolveInferenceStatusState({
        status: res.data,
        fallbackLoadedGPTPath: loadedModelStateRef.current.gptPath,
        fallbackLoadedSoVITSPath: loadedModelStateRef.current.sovitsPath,
      }));
    } catch {
      if (statusRequestVersionRef.current !== requestVersion) {
        return;
      }
      applyInferenceStatusState(resolveInferenceStatusState({
        status: { ready: false },
        fallbackLoadedGPTPath: loadedModelStateRef.current.gptPath,
        fallbackLoadedSoVITSPath: loadedModelStateRef.current.sovitsPath,
      }));
    }
  }

  async function loadActiveVoiceProfile() {
    setLoadingActiveVoiceProfile(true);
    try {
      const res = await getFullActiveVoiceProfile();
      setActiveVoiceProfile(res.data || null);
      setActiveVoiceProfileError('');
    } catch (err) {
      if (err.response?.status === 404) {
        setActiveVoiceProfile(null);
        setActiveVoiceProfileError('');
      } else {
        setActiveVoiceProfileError(err.response?.data?.error || err.message || 'Could not load saved voice profile.');
      }
    } finally {
      setLoadingActiveVoiceProfile(false);
    }
  }

  async function loadVoiceConfigs(voiceProfileId = selectedVoiceProfileId) {
    if (!voiceProfileId) {
      setVoiceConfigs([]);
      setLiveFullConfigs([]);
      setVoiceConfigError('');
      return;
    }
    setLoadingVoiceConfigs(true);
    try {
      const res = await getVoiceProfileConfigs(voiceProfileId);
      const configs = res.data.configs || [];
      const liveFastConfigs = filterLiveFastConfigs(configs);
      const nextLiveFullConfigs = filterLiveFullConfigs(configs);
      voiceConfigsRef.current = liveFastConfigs;
      setVoiceConfigs(liveFastConfigs);
      setLiveFullConfigs(nextLiveFullConfigs);
      console.info('[voice-configs] loaded configs', {
        voiceProfileId,
        count: configs.length,
        liveFastCount: liveFastConfigs.length,
        liveFullCount: nextLiveFullConfigs.length,
        configs: configs.map((config) => ({
          configId: config.configId,
          configName: config.configName,
          rank: config.rank,
          hasTrainingMetadata: Boolean(config.trainingMetadata && Object.keys(config.trainingMetadata).length > 0),
          trainingMetadata: config.trainingMetadata || null,
          inferenceMetadata: config.inferenceMetadata || null,
          referenceMetadata: config.referenceMetadata || null,
          sample: config.sample || null,
        })),
      });
      if (liveFastConfigs[0] && autoLoadedLiveFastConfigProfileRef.current !== voiceProfileId) {
        autoLoadedLiveFastConfigProfileRef.current = voiceProfileId;
        applyVoiceConfig(liveFastConfigs[0], { silent: true });
        await syncRankOneConfigToVoiceProfile(liveFastConfigs[0], { context: 'startup rank #1 config' });
      }
      setVoiceConfigError('');
    } catch (err) {
      setVoiceConfigs([]);
      setLiveFullConfigs([]);
      setVoiceConfigError(err.response?.data?.error || err.message || 'Could not load saved configs.');
    } finally {
      setLoadingVoiceConfigs(false);
    }
  }

  async function loadTrainingRunMetadata(expName = selectedExpName) {
    if (!expName) {
      setTrainingRunMetadata(null);
      setTrainingRunMetadataError('');
      return;
    }
    try {
      const res = await getTrainingRunMetadata(expName);
      const metadata = res.data.metadata || null;
      setTrainingRunMetadata(metadata);
      setTrainingRunMetadataError('');
      console.info('[voice-configs] loaded training metadata', { expName, metadata });
    } catch (err) {
      const message = err.response?.status === 404
        ? 'No training metadata saved for this model yet.'
        : err.response?.data?.error || err.message || 'Could not load training metadata.';
      setTrainingRunMetadata(null);
      setTrainingRunMetadataError(message);
      console.info('[voice-configs] training metadata unavailable', { expName, message });
    }
  }

  function buildCurrentConfigPayload({ configId = '', configName = '' } = {}) {
    const resolvedConfigName = configName || currentLiveFastMetadata.configName;
    return {
      configName: resolvedConfigName,
      rank: voiceConfigs.length + 1,
      selected: true,
      trainingMetadata: trainingRunMetadata || activeVoiceProfile?.metadata?.training || {},
      inferenceMetadata: {
        ...currentLiveFastMetadata,
        configName: resolvedConfigName,
        ...(configId ? { configId } : {}),
      },
      referenceMetadata: currentReferenceMetadata,
      sample: {},
      ...(configId ? { configId } : {}),
    };
  }

  function resolveReferenceFile(path, fallback = {}) {
    const normalizedPath = String(path || '').trim();
    if (!normalizedPath) return null;
    return trainingAudioFiles.find((file) => file.path === normalizedPath)
      || fallback?.file
      || {
        filename: fallback.filename || fallbackName(normalizedPath),
        path: normalizedPath,
        transcript: fallback.transcript || '',
        lang: fallback.lang || '',
      };
  }

  function referencePromptText(referencePrimary = {}, resolvedFile = {}, fallbackText = '') {
    return String(
      referencePrimary?.file?.transcript
        || referencePrimary?.transcript
        || resolvedFile?.transcript
        || fallbackText
        || ''
    );
  }

  function referencePromptLang(referencePrimary = {}, resolvedFile = {}, fallbackLang = 'en') {
    return normalizeReferenceLanguage(
      referencePrimary?.file?.lang
        || referencePrimary?.lang
        || resolvedFile?.lang
        || fallbackLang
    );
  }

  function buildConfigVoiceProfilePayload(config) {
    if (!config || !selectedProfile || !selectedGPT || !selectedSoVITS) return;
    const reference = config.referenceMetadata || {};
    const inference = config.inferenceMetadata || {};
    const defaults = inference.defaults || {};
    const primaryPath = String(reference.selectedPaths?.primary || reference.primary?.path || '').trim();
    if (!primaryPath) return;
    const primaryFile = resolveReferenceFile(primaryPath, reference.primary) || {};
    const promptTextFromConfig = referencePromptText(reference.primary, primaryFile, promptText);
    const promptLangFromConfig = referencePromptLang(reference.primary, primaryFile, promptLang);
    const auxPaths = Array.isArray(reference.selectedPaths?.aux)
      ? reference.selectedPaths.aux
      : Array.isArray(reference.aux)
        ? reference.aux.map((item) => item?.path).filter(Boolean)
        : [];

    return {
      displayName: selectedProfile.displayName,
      selectedGPT,
      selectedSoVITS,
      refAudioPath: primaryPath,
      promptText: promptTextFromConfig,
      promptLang: normalizeReferenceLanguage(promptLangFromConfig),
      textLang: inference.language || liveLanguage,
      preferredRoute: inference.preferredRoute || 'sentence',
      auxRefAudioPaths: auxPaths,
      defaults: {
        top_k: defaults.top_k ?? topK,
        top_p: defaults.top_p ?? topP,
        temperature: defaults.temperature ?? temperature,
        repetition_penalty: defaults.repetition_penalty ?? repPenalty,
        speed_factor: defaults.speed_factor ?? speed,
      },
      trainingMetadata: config.trainingMetadata || trainingRunMetadata || activeVoiceProfile?.metadata?.training,
      referenceMetadata: reference,
      liveFastMetadata: inference,
    };
  }

  async function syncConfigToVoiceProfile(config) {
    const configPayload = buildConfigVoiceProfilePayload(config);
    if (!configPayload) return;
    const storageMode = await getStorageMode();
    const payload = buildVoiceProfilePayload({
      ...configPayload,
      storageMode,
    });
    const response = await activateVoiceProfile(payload);
    const summary = response.data || {};
    setActiveVoiceProfile(summary.voiceProfileId ? {
      ...payload,
      ...summary,
      voiceProfileId: summary.voiceProfileId || payload.voiceProfileId,
      displayName: summary.displayName || payload.displayName,
    } : null);
    console.info('[voice-configs] synced config to voice profile', {
      voiceProfileId: payload.voiceProfileId,
      configId: config.configId,
      rank: config.rank,
    });
  }

  async function syncRankOneConfigToVoiceProfile(config, { required = false, context = 'rank #1 config' } = {}) {
    if (!config) return false;
    try {
      await syncConfigToVoiceProfile(config);
      setVoiceConfigError('');
      return true;
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'voice profile sync failed';
      const fullMessage = `Could not sync ${context} to voice profile: ${message}`;
      setVoiceConfigError(fullMessage);
      console.warn('[voice-configs] rank #1 voice profile sync failed', {
        voiceProfileId: selectedVoiceProfileId,
        configId: config.configId,
        context,
        message,
      });
      if (required) {
        throw new Error(fullMessage);
      }
      return false;
    }
  }

  function applyConfigAsActiveLiveFastProfile(config) {
    const configPayload = buildConfigVoiceProfilePayload(config);
    if (!configPayload) return;
    setActiveVoiceProfile((current) => ({
      ...(current || {}),
      voiceProfileId: selectedVoiceProfileId,
      displayName: configPayload.displayName,
      gptPath: selectedGPT,
      sovitsPath: selectedSoVITS,
      ref_audio_path: configPayload.refAudioPath,
      prompt_text: configPayload.promptText,
      prompt_lang: configPayload.promptLang,
      text_lang: configPayload.textLang,
      preferredRoute: configPayload.preferredRoute,
      aux_ref_audio_paths: configPayload.auxRefAudioPaths,
      defaults: configPayload.defaults,
      metadata: {
        ...(current?.metadata || {}),
        ...(configPayload.trainingMetadata ? { training: configPayload.trainingMetadata } : {}),
        reference: configPayload.referenceMetadata,
        liveFast: configPayload.liveFastMetadata,
      },
    }));
  }

  function clearReferenceSelection() {
    const audio = referencePreviewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setRefAudioPath('');
    setPromptText('');
    setPromptLang('en');
    setAuxRefAudios([]);
    setReferenceMessage('');
    setPreviewReference({ path: '', url: null, filename: '', role: '' });
    setReferenceAudioUrls({});
    setLoadingPreviewPath('');
  }

  function applyVoiceConfig(config, { silent = false } = {}) {
    const reference = config?.referenceMetadata || {};
    const inference = config?.inferenceMetadata || {};
    const defaults = inference.defaults || {};
    const primaryPath = String(reference.selectedPaths?.primary || reference.primary?.path || '').trim();
    const auxPaths = Array.isArray(reference.selectedPaths?.aux)
      ? reference.selectedPaths.aux
      : Array.isArray(reference.aux)
        ? reference.aux.map((item) => item?.path).filter(Boolean)
        : [];
    if (primaryPath) {
      const primaryFile = resolveReferenceFile(primaryPath, reference.primary) || {};
      setRefAudioPath(primaryPath);
      setPromptText(referencePromptText(reference.primary, primaryFile));
      setPromptLang(referencePromptLang(reference.primary, primaryFile));
    }
    setAuxRefAudios(auxPaths.slice(0, 5).map((path) => (
      trainingAudioFiles.find((file) => file.path === path) || {
        filename: fallbackName(path),
        path,
        transcript: '',
        lang: '',
      }
    )));
    setSelectedLanguage(normalizeLiveLanguage(inference.language || liveLanguage));
    setSpeed(Number.isFinite(defaults.speed_factor) ? defaults.speed_factor : speed);
    setTopK(Number.isFinite(defaults.top_k) ? defaults.top_k : topK);
    setTopP(Number.isFinite(defaults.top_p) ? defaults.top_p : topP);
    setTemperature(Number.isFinite(defaults.temperature) ? defaults.temperature : temperature);
    setRepPenalty(Number.isFinite(defaults.repetition_penalty) ? defaults.repetition_penalty : repPenalty);
    setLoadedConfigId(config?.configId || '');
    if (!silent) {
      setReferenceMessage(`Loaded config ${config.configName || config.configId}.`);
    }
  }

  function applyBestReference(files = trainingAudioFiles, { markForAutoSync = false } = {}) {
    const selection = chooseBestReferenceSet(files);
    if (!selection.primary) {
      clearReferenceSelection();
      if (markForAutoSync) {
        pendingAutoSyncFingerprintRef.current = '';
      }
      setReferenceMessage(selection.reason);
      return selection;
    }
    const nextPromptLang = normalizeReferenceLanguage(selection.primary.lang);
    setRefAudioPath(selection.primary.path);
    setPromptText(selection.primary.transcript || '');
    setPromptLang(nextPromptLang);
    setAuxRefAudios(selection.aux);
    // Only persist a strict pick. A fallback pick means clip scores / ASR
    // transcripts weren't ready yet, so it would freeze a mediocre ref + padded
    // 5 aux into the saved rank #1 config. Show it in the UI but don't save it;
    // a later load with scores present will produce (and persist) the strict set.
    if (markForAutoSync && selection.mode !== 'strict') {
      pendingAutoSyncFingerprintRef.current = '';
    }
    if (markForAutoSync && selection.mode === 'strict') {
      pendingAutoSyncFingerprintRef.current = createAutoVoiceProfileSyncFingerprint({
        sourceKey: selectedExpName,
        selectedGPT,
        selectedSoVITS,
        refAudioPath: selection.primary.path,
        promptText: selection.primary.transcript || '',
        promptLang: nextPromptLang,
        textLang: liveLanguage,
        preferredRoute: 'sentence',
        auxRefAudioPaths: selection.aux.map((item) => item.path),
        defaults: {
          top_k: topK,
          top_p: topP,
          temperature,
          repetition_penalty: repPenalty,
          speed_factor: speed,
        },
      });
    }
    writeVoiceProfileBrowserDebug('live auto-selected references', createVoiceProfileBrowserDebugSummary({
      context: 'live auto-select',
      voiceProfileId: selectedProfile?.key || '',
      displayName: selectedProfile?.displayName || '',
      selectedExpName,
      refAudioPath: selection.primary.path,
      promptText: selection.primary.transcript || '',
      promptLang: nextPromptLang,
      textLang: liveLanguage,
      auxRefAudioPaths: selection.aux.map((item) => item.path),
      defaults: {
        top_k: topK,
        top_p: topP,
        temperature,
        repetition_penalty: repPenalty,
        speed_factor: speed,
      },
    }));
    setReferenceMessage(
      selection.mode === 'strict'
        ? `${selection.primary.filename} selected with ${selection.aux.length} auxiliary clip${selection.aux.length === 1 ? '' : 's'}.`
        : `${selection.primary.filename} selected with ${selection.aux.length} auxiliary clip${selection.aux.length === 1 ? '' : 's'} (clip scores not ready yet — not saved).`,
    );
    return selection;
  }

  function applyBestLiveFullReference(files = trainingAudioFiles) {
    const selection = chooseBestReferenceSet(files);
    if (!selection.primary) {
      setLiveFullRefAudioPath('');
      setLiveFullPromptText('');
      setLiveFullPromptLang('en');
      setLiveFullAuxRefAudios([]);
      setLiveFullMessage(selection.reason);
      return;
    }

    setLiveFullRefAudioPath(selection.primary.path);
    setLiveFullPromptText(selection.primary.transcript || '');
    setLiveFullPromptLang(normalizeReferenceLanguage(selection.primary.lang));
    setLiveFullAuxRefAudios(selection.aux);
    setLiveFullMessage(`${selection.primary.filename} selected for Live Full with ${selection.aux.length} auxiliary clip${selection.aux.length === 1 ? '' : 's'}.`);
  }

  function getConfigReferencePaths(config) {
    const reference = config?.referenceMetadata || {};
    const primaryPath = String(reference.selectedPaths?.primary || reference.primary?.path || '').trim();
    const auxPaths = Array.isArray(reference.selectedPaths?.aux)
      ? reference.selectedPaths.aux
      : Array.isArray(reference.aux)
        ? reference.aux.map((item) => item?.path).filter(Boolean)
        : [];
    return {
      primaryPath,
      auxPaths: auxPaths
        .map((path) => String(path || '').trim())
        .filter(Boolean)
        .filter((path) => path !== primaryPath)
        .slice(0, 5),
    };
  }

  function buildLiveFullRefParamsFromLiveFastRankOne(config = voiceConfigsRef.current[0], settings = liveFullSettings) {
    const reference = config?.referenceMetadata || {};
    const { primaryPath, auxPaths } = getConfigReferencePaths(config);
    if (!primaryPath) return null;

    const primaryFile = resolveReferenceFile(primaryPath, reference.primary) || {};
    const prompt = referencePromptText(reference.primary, primaryFile).trim();
    if (!prompt) return null;

    return buildLiveFullRefParams({
      primaryPath,
      promptText: prompt,
      promptLang: referencePromptLang(reference.primary, primaryFile),
      auxRefAudios: auxPaths.map((path) => resolveReferenceFile(path) || { path }),
      settings,
    });
  }

  function syncLoadedModelReferenceSelection(result = {}) {
    const selection = extractModelSelectWarmedReferenceSelection(result);
    if (!selection) {
      return null;
    }

    const primaryPath = selection.refAudioPath;
    const primaryFile = trainingAudioFiles.find((file) => file.path === primaryPath) || null;
    const selectedActiveProfile = selectedVoiceProfileId
      && activeVoiceProfile?.voiceProfileId === selectedVoiceProfileId
      ? activeVoiceProfile
      : null;
    const auxMatches = selection.auxRefAudioPaths.map((path) => (
      trainingAudioFiles.find((file) => file.path === path) || {
        filename: fallbackName(path),
        path,
        transcript: '',
        lang: '',
      }
    ));

    pendingAutoSyncFingerprintRef.current = '';
    autoSyncRequestFingerprintRef.current = '';
    setRefAudioPath(primaryPath);
    setPromptText(
      selectedActiveProfile
        ? String(selectedActiveProfile.prompt_text || '')
        : String(primaryFile?.transcript || ''),
    );
    setPromptLang(
      selectedActiveProfile
        ? normalizeReferenceLanguage(selectedActiveProfile.prompt_lang)
        : normalizeReferenceLanguage(primaryFile?.lang),
    );
    setAuxRefAudios(auxMatches);
    setPreviewReference({ path: '', url: null, filename: '', role: '' });

    if (selectedActiveProfile) {
      setActiveVoiceProfile((current) => (
        current ? {
          ...current,
          ref_audio_path: primaryPath,
          aux_ref_audio_paths: selection.auxRefAudioPaths,
        } : current
      ));
    }

    return {
      ...selection,
      primaryFilename: primaryFile?.filename || fallbackName(primaryPath),
    };
  }

  async function loadSelectedModel() {
    if (!selectedProfile || isConversationActive) return;
    setLoadingModel(true); setModelError('');
    try {
      const rankOneConfig = voiceConfigsRef.current[0] || null;
      const rankOneReferences = getConfigReferencePaths(rankOneConfig);
      const response = await selectModels(selectedGPT, selectedSoVITS, buildModelSelectWarmPayload({
        voiceProfileId: selectedVoiceProfileId,
        refAudioPath: rankOneReferences.primaryPath,
        auxRefAudioPaths: rankOneReferences.auxPaths,
      }));
      const latestRankOneConfig = voiceConfigsRef.current[0] || rankOneConfig;
      const syncedSelection = latestRankOneConfig
        ? null
        : syncLoadedModelReferenceSelection(response.data || {});
      if (latestRankOneConfig) {
        applyVoiceConfig(latestRankOneConfig, { silent: true });
        await syncRankOneConfigToVoiceProfile(latestRankOneConfig, { context: 'model-load rank #1 config' });
      }
      statusRequestVersionRef.current += 1;
      applyInferenceStatusState({
        serverReady: true,
        loadedGPTPath: selectedGPT,
        loadedSoVITSPath: selectedSoVITS,
      });
      setReferenceMessage(
        latestRankOneConfig
          ? `Loaded rank #1 config ${latestRankOneConfig.configName || latestRankOneConfig.configId} after model load.`
          : syncedSelection
          ? `${syncedSelection.primaryFilename} loaded with ${syncedSelection.auxRefAudioPaths.length} auxiliary clip${syncedSelection.auxRefAudioPaths.length === 1 ? '' : 's'}.`
          : 'Voice model loaded.',
      );
    } catch (err) {
      setModelError(err.response?.data?.error || err.message || 'Could not load this voice model.');
    } finally {
      setLoadingModel(false);
    }
  }

  async function persistSelectedVoiceProfile() {
    if (!selectedProfile || !selectedGPT || !selectedSoVITS || !refAudioPath) {
      throw new Error('Voice profile is not ready to save yet.');
    }

    const storageMode = await getStorageMode();
    const payload = buildVoiceProfilePayload({
      displayName: selectedProfile.displayName,
      selectedGPT,
      selectedSoVITS,
      refAudioPath,
      promptText,
      promptLang,
      textLang: liveLanguage,
      preferredRoute: 'sentence',
      auxRefAudioPaths: auxRefAudios.map((item) => item.path),
      defaults: {
        top_k: topK,
        top_p: topP,
        temperature,
        repetition_penalty: repPenalty,
        speed_factor: speed,
      },
      trainingMetadata: activeVoiceProfile?.metadata?.training,
      referenceMetadata: currentReferenceMetadata,
      liveFastMetadata: currentLiveFastMetadata,
      storageMode,
    });

    const response = await activateVoiceProfile(payload);
    const summary = response.data || {};
    setActiveVoiceProfile(summary.voiceProfileId ? {
      ...payload,
      ...summary,
      voiceProfileId: summary.voiceProfileId || payload.voiceProfileId,
      displayName: summary.displayName || payload.displayName,
    } : null);
    setActiveVoiceProfileError('');
    setLoadingActiveVoiceProfile(false);
    return { summary, payload };
  }

  // Auto-sync of live Live Fast edits. When a rank #1 saved config exists it is the
  // source of truth that reloads (model load) apply, so we must update the saved config
  // itself from the current UI state - not just activate the voice profile. Otherwise the
  // edit lands on the voice profile but the stale config overwrites it on the next refresh.
  async function persistLiveFastAutoSync() {
    const rankOneConfig = voiceConfigsRef.current[0] || null;
    if (!rankOneConfig?.configId || !selectedVoiceProfileId) {
      const { summary, payload } = await persistSelectedVoiceProfile();
      return { displayName: summary.displayName || payload.displayName, voiceProfileId: summary.voiceProfileId || payload.voiceProfileId };
    }

    const payload = {
      ...buildCurrentConfigPayload({
        configId: rankOneConfig.configId,
        configName: rankOneConfig.configName || currentLiveFastMetadata.configName,
      }),
      rank: rankOneConfig.rank || 1,
      sample: rankOneConfig.sample || {},
    };
    const res = await saveVoiceProfileConfig(selectedVoiceProfileId, rankOneConfig.configId, payload);
    const saved = res.data.config;
    setVoiceConfigs((current) => {
      const without = current.filter((item) => item.configId !== saved.configId);
      const next = [...without, saved].sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
      voiceConfigsRef.current = next;
      return next;
    });
    await syncRankOneConfigToVoiceProfile(saved, { required: true, context: 'auto-synced rank #1 config' });
    return { displayName: selectedProfile?.displayName || '', voiceProfileId: selectedVoiceProfileId };
  }

  async function saveSelectedVoiceProfile() {
    if (!selectedProfile || !selectedGPT || !selectedSoVITS || !liveRefParams) return;

    setSavingProfile(true);
    setModelError('');

    try {
      const { summary, payload } = await persistSelectedVoiceProfile();
      lastAutoSyncedFingerprintRef.current = currentAutoSyncFingerprint;
      pendingAutoSyncFingerprintRef.current = '';
      setReferenceMessage(
        `Saved voice profile ${summary.displayName || selectedProfile.displayName} (${summary.voiceProfileId || payload.voiceProfileId}).`,
      );
    } catch (err) {
      setModelError(err.response?.data?.error || err.message || 'Could not save this voice profile.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveCurrentVoiceConfig(existingConfig = null, { applySaved = true } = {}) {
    if (!selectedVoiceProfileId || !refAudioPath) return;
    const configId = existingConfig?.configId || buildConfigId(selectedProfile?.displayName || selectedVoiceProfileId);
    setSavingConfigId(configId);
    setModelError('');
    setVoiceConfigError('');
    try {
      const payload = {
        ...buildCurrentConfigPayload({
          configId,
          configName: existingConfig?.configName || currentLiveFastMetadata.configName,
        }),
        rank: existingConfig?.rank || voiceConfigs.length + 1,
        sample: existingConfig?.sample || {},
      };
      const res = await saveVoiceProfileConfig(selectedVoiceProfileId, configId, payload);
      const saved = res.data.config;
      console.info('[voice-configs] saved config', {
        voiceProfileId: selectedVoiceProfileId,
        configId: saved.configId,
        primaryReference: saved.referenceMetadata?.selectedPaths?.primary || saved.referenceMetadata?.primary?.path || '',
        auxReferences: saved.referenceMetadata?.selectedPaths?.aux || [],
        config: saved,
        hasTrainingMetadata: Boolean(saved.trainingMetadata && Object.keys(saved.trainingMetadata).length > 0),
      });
      setVoiceConfigs((current) => {
        const without = current.filter((item) => item.configId !== saved.configId);
        const next = [...without, saved].sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
        voiceConfigsRef.current = next;
        return next;
      });
      if (Number(saved.rank || 0) === 1) {
        if (applySaved) {
          applyVoiceConfig(saved, { silent: true });
        }
        await syncRankOneConfigToVoiceProfile(saved, { required: true, context: 'saved rank #1 config' });
      } else if (existingConfig?.configId === loadedConfigId) {
        applyConfigAsActiveLiveFastProfile(saved);
        if (applySaved) {
          applyVoiceConfig(saved, { silent: true });
        }
      } else if (applySaved && !existingConfig) {
        applyVoiceConfig(saved, { silent: true });
      }
      setReferenceMessage(`${existingConfig ? 'Updated' : 'Saved'} config ${saved.configName || saved.configId}.`);
      setLoadedConfigId(saved.configId);
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Could not save config.';
      setModelError(message);
      setVoiceConfigError(message);
    } finally {
      setSavingConfigId('');
    }
  }

  function applyLiveFullReferenceDefaultsFromConfig(config) {
    const reference = config?.referenceMetadata || {};
    const primaryPath = String(reference.selectedPaths?.primary || reference.primary?.path || '').trim();
    const auxPaths = Array.isArray(reference.selectedPaths?.aux)
      ? reference.selectedPaths.aux
      : Array.isArray(reference.aux)
        ? reference.aux.map((item) => item?.path).filter(Boolean)
        : [];
    if (!primaryPath) return;

    const primaryFile = resolveReferenceFile(primaryPath, reference.primary) || {};
    setLiveFullRefAudioPath(primaryPath);
    setLiveFullPromptText(referencePromptText(reference.primary, primaryFile));
    setLiveFullPromptLang(referencePromptLang(reference.primary, primaryFile));
    setLiveFullAuxRefAudios(auxPaths.slice(0, 5).map((path) => (
      trainingAudioFiles.find((file) => file.path === path) || {
        filename: fallbackName(path),
        path,
        transcript: '',
        lang: '',
      }
    )));
  }

  function applyLiveFullConfig(config, { silent = false } = {}) {
    const defaults = config?.inferenceMetadata?.defaults || {};
    setLiveFullSpeed(Number.isFinite(defaults.speed_factor) ? defaults.speed_factor : DEFAULT_LIVE_FULL_SETTINGS.speed);
    setLiveFullTopK(Number.isFinite(defaults.top_k) ? defaults.top_k : DEFAULT_LIVE_FULL_SETTINGS.topK);
    setLiveFullTopP(Number.isFinite(defaults.top_p) ? defaults.top_p : DEFAULT_LIVE_FULL_SETTINGS.topP);
    setLiveFullTemperature(Number.isFinite(defaults.temperature) ? defaults.temperature : DEFAULT_LIVE_FULL_SETTINGS.temperature);
    setLiveFullRepPenalty(Number.isFinite(defaults.repetition_penalty) ? defaults.repetition_penalty : DEFAULT_LIVE_FULL_SETTINGS.repPenalty);
    setLoadedLiveFullConfigId(config?.configId || '');
    if (!silent) {
      setLiveFullMessage(`Loaded Live Full config ${config.configName || config.configId}.`);
    }
  }

  function buildCurrentLiveFullConfigPayload({ configId = '', configName = '' } = {}) {
    const rankOneConfig = voiceConfigsRef.current[0] || liveFastRankOneReferenceSummary.config;
    const resolvedConfigName = configName || (selectedProfile?.displayName
      ? `${selectedProfile.displayName} full`
      : 'Live Full default');
    return buildLiveFullConfigPayload({
      configId,
      configName: resolvedConfigName,
      rank: liveFullConfigs.length + 1,
      language: liveLanguage,
      settings: liveFullSettings,
      trainingMetadata: trainingRunMetadata || activeVoiceProfile?.metadata?.training || {},
      referenceMetadata: {
        source: 'liveFastRankOne',
        liveFastConfigId: rankOneConfig?.configId || '',
      },
    });
  }

  async function saveCurrentLiveFullConfig(existingConfig = null, { applySaved = true } = {}) {
    if (!selectedVoiceProfileId) {
      setLiveFullMessage('Load a voice profile before saving Live Full metadata.');
      return;
    }
    if (!voiceConfigsRef.current[0]) {
      setLiveFullMessage('Create Live Fast rank #1 before saving Live Full metadata.');
      return;
    }
    const configId = existingConfig?.configId || buildConfigId(`${selectedProfile?.displayName || selectedVoiceProfileId}-full`);
    setSavingLiveFullConfigId(configId);
    try {
      const payload = {
        ...buildCurrentLiveFullConfigPayload({
          configId,
          configName: existingConfig?.configName || '',
        }),
        rank: existingConfig?.rank || liveFullConfigs.length + 1,
      };
      const res = await saveVoiceProfileConfig(selectedVoiceProfileId, configId, payload);
      const saved = res.data.config;
      setLiveFullConfigs((current) => {
        const without = current.filter((item) => item.configId !== saved.configId);
        return [...without, saved].sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
      });
      if (applySaved) {
        applyLiveFullConfig(saved, { silent: true });
      }
      setLoadedLiveFullConfigId(saved.configId);
      setLiveFullMessage(`${existingConfig ? 'Updated' : 'Saved'} Live Full config ${saved.configName || saved.configId}.`);
    } catch (err) {
      setLiveFullMessage(err.response?.data?.error || err.message || 'Could not save Live Full config.');
    } finally {
      setSavingLiveFullConfigId('');
    }
  }

  async function loadSavedLiveFullConfig(config) {
    if (!config?.configId) return;
    setSavingLiveFullConfigId(config.configId);
    try {
      applyLiveFullConfig(config);
    } finally {
      setSavingLiveFullConfigId('');
    }
  }

  async function deleteSavedLiveFullConfig(configId) {
    if (!selectedVoiceProfileId || !configId) return;
    setSavingLiveFullConfigId(configId);
    try {
      await deleteVoiceProfileConfig(selectedVoiceProfileId, configId);
      setLiveFullConfigs((current) => current.filter((item) => item.configId !== configId));
      if (loadedLiveFullConfigId === configId) setLoadedLiveFullConfigId('');
      setLiveFullMessage(`Deleted Live Full config ${configId}.`);
    } catch (err) {
      setLiveFullMessage(err.response?.data?.error || err.message || 'Could not delete Live Full config.');
    } finally {
      setSavingLiveFullConfigId('');
    }
  }

  async function moveLiveFullConfig(configId, direction) {
    if (!selectedVoiceProfileId || !configId || savingLiveFullConfigId) return;
    const currentIndex = liveFullConfigs.findIndex((item) => item.configId === configId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= liveFullConfigs.length) return;

    const reordered = [...liveFullConfigs];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    const reranked = reordered.map((config, index) => ({ ...config, rank: index + 1 }));

    setSavingLiveFullConfigId(configId);
    try {
      const savedConfigs = [];
      for (const config of reranked) {
        const res = await saveVoiceProfileConfig(selectedVoiceProfileId, config.configId, config);
        savedConfigs.push(res.data.config);
      }
      setLiveFullConfigs(savedConfigs.sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0)));
      setLiveFullMessage(`Moved ${moved.configName || moved.configId} to #${targetIndex + 1}.`);
    } catch (err) {
      setLiveFullMessage(err.response?.data?.error || err.message || 'Could not reorder Live Full configs.');
    } finally {
      setSavingLiveFullConfigId('');
    }
  }

  async function generateLiveFullConfigSample(config) {
    if (!config?.configId || !selectedVoiceProfileId || streamingRoute !== null) return;
    const inference = config.inferenceMetadata || {};
    const defaults = inference.defaults || {};
    const sampleText = 'This is a short full inference voice configuration sample.';
    const params = buildLiveFullRefParamsFromLiveFastRankOne(voiceConfigsRef.current[0], {
      speed: defaults.speed_factor ?? DEFAULT_LIVE_FULL_SETTINGS.speed,
      topK: defaults.top_k ?? DEFAULT_LIVE_FULL_SETTINGS.topK,
      topP: defaults.top_p ?? DEFAULT_LIVE_FULL_SETTINGS.topP,
      temperature: defaults.temperature ?? DEFAULT_LIVE_FULL_SETTINGS.temperature,
      repPenalty: defaults.repetition_penalty ?? DEFAULT_LIVE_FULL_SETTINGS.repPenalty,
    });
    if (!params) {
      setLiveFullMessage('Live Full sample needs Live Fast rank #1 with a primary reference transcript.');
      return;
    }

    setGeneratingLiveFullSampleConfigId(config.configId);
    setStreamingRoute('full');
    setTtsError('');
    try {
      applyLiveFullConfig(config, { silent: true });
      const res = await startGeneration({
        text: sampleText,
        voiceProfileId: selectedVoiceProfileId,
        text_lang: inference.language || liveLanguage,
        ...params,
        inference_mode: 'quality',
      });
      const { sessionId } = res.data;
      pendingFullTtsRef.current = {
        sessionId,
        text: sampleText,
        voiceName: selectedProfile?.displayName || loadedProfile?.displayName || '',
        languageLabel: liveLanguageConfig.label,
        route: 'full',
      };
      ttsInference.connect(sessionId, { initialStatus: 'waiting' });

      const sample = {
        text: sampleText,
        route: 'full',
        generatedAt: new Date().toISOString(),
        sessionId,
      };
      await saveVoiceProfileConfig(selectedVoiceProfileId, config.configId, { ...config, sample });
      setLiveFullConfigs((current) => current.map((item) => (
        item.configId === config.configId ? { ...item, sample } : item
      )));
      setLiveFullMessage(`Generating sample for ${config.configName || config.configId}.`);
    } catch (err) {
      pendingFullTtsRef.current = null;
      setStreamingRoute(null);
      setLiveFullMessage(err.response?.data?.error || err.message || 'Could not generate Live Full sample.');
    } finally {
      setGeneratingLiveFullSampleConfigId('');
    }
  }

  async function loadSavedVoiceConfig(config) {
    if (!config?.configId) return;
    setSavingConfigId(config.configId);
    setModelError('');
    setVoiceConfigError('');
    try {
      applyVoiceConfig(config);
      if (Number(config.rank || 0) === 1) {
        await syncRankOneConfigToVoiceProfile(config, { required: true, context: 'loaded rank #1 config' });
      } else {
        applyConfigAsActiveLiveFastProfile(config);
      }
      setReferenceMessage(`Loaded config ${config.configName || config.configId} into inference.`);
      console.info('[voice-configs] loaded config into inference', {
        voiceProfileId: selectedVoiceProfileId,
        configId: config.configId,
        primaryReference: config.referenceMetadata?.selectedPaths?.primary || config.referenceMetadata?.primary?.path || '',
        auxReferences: config.referenceMetadata?.selectedPaths?.aux || [],
      });
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Could not load config into inference.';
      setModelError(message);
      setVoiceConfigError(message);
    } finally {
      setSavingConfigId('');
    }
  }

  async function deleteSavedVoiceConfig(configId) {
    if (!selectedVoiceProfileId || !configId) return;
    setSavingConfigId(configId);
    setVoiceConfigError('');
    try {
      await deleteVoiceProfileConfig(selectedVoiceProfileId, configId);
      console.info('[voice-configs] deleted config', { voiceProfileId: selectedVoiceProfileId, configId });
      let nextConfigs = [];
      setVoiceConfigs((current) => {
        const next = current.filter((item) => item.configId !== configId);
        voiceConfigsRef.current = next;
        nextConfigs = next;
        return next;
      });
      if (nextConfigs[0]) {
        applyVoiceConfig(nextConfigs[0], { silent: true });
        await syncRankOneConfigToVoiceProfile(nextConfigs[0], { required: true, context: 'new rank #1 config after delete' });
      } else if (loadedConfigId === configId) {
        setLoadedConfigId('');
      }
      setConfigSampleUrls((current) => {
        if (current[configId]) URL.revokeObjectURL(current[configId]);
        const next = { ...current };
        delete next[configId];
        configSampleUrlsRef.current = next;
        return next;
      });
      setReferenceMessage(`Deleted config ${configId}.`);
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Could not delete config.';
      setModelError(message);
      setVoiceConfigError(message);
    } finally {
      setSavingConfigId('');
    }
  }

  async function moveVoiceConfig(configId, direction) {
    if (!selectedVoiceProfileId || !configId || savingConfigId) return;
    const currentIndex = voiceConfigs.findIndex((item) => item.configId === configId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= voiceConfigs.length) return;
    const reordered = [...voiceConfigs];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    const reranked = reordered.map((config, index) => ({ ...config, rank: index + 1 }));
    setSavingConfigId(configId);
    setVoiceConfigError('');
    try {
      const savedConfigs = [];
      for (const config of reranked) {
        const res = await saveVoiceProfileConfig(selectedVoiceProfileId, config.configId, config);
        savedConfigs.push(res.data.config);
      }
      const sorted = savedConfigs.sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
      voiceConfigsRef.current = sorted;
      setVoiceConfigs(sorted);
      if (sorted[0]) {
        applyVoiceConfig(sorted[0], { silent: true });
        await syncRankOneConfigToVoiceProfile(sorted[0], { required: true, context: 'new rank #1 config after reorder' });
      }
      console.info('[voice-configs] reordered configs', {
        voiceProfileId: selectedVoiceProfileId,
        order: sorted.map((config) => ({ configId: config.configId, rank: config.rank })),
      });
      setReferenceMessage(`Moved ${moved.configName || moved.configId} to #${targetIndex + 1}.`);
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Could not reorder configs.';
      setModelError(message);
      setVoiceConfigError(message);
    } finally {
      setSavingConfigId('');
    }
  }

  async function persistConfigOrder(nextOrder, { movedConfigId = '' } = {}) {
    if (!selectedVoiceProfileId || nextOrder.length === 0) return;
    const reranked = nextOrder.map((config, index) => ({ ...config, rank: index + 1 }));
    setSavingConfigId(movedConfigId || reranked[0]?.configId || '');
    setVoiceConfigError('');
    try {
      const savedConfigs = [];
      for (const config of reranked) {
        const res = await saveVoiceProfileConfig(selectedVoiceProfileId, config.configId, config);
        savedConfigs.push(res.data.config);
      }
      const sorted = savedConfigs.sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
      voiceConfigsRef.current = sorted;
      setVoiceConfigs(sorted);
      if (sorted[0]) {
        applyVoiceConfig(sorted[0], { silent: true });
        await syncRankOneConfigToVoiceProfile(sorted[0], { required: true, context: 'new rank #1 config after reorder' });
      }
      console.info('[voice-configs] reordered configs', {
        voiceProfileId: selectedVoiceProfileId,
        order: sorted.map((config) => ({ configId: config.configId, rank: config.rank, configName: config.configName })),
      });
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Could not reorder configs.';
      setModelError(message);
      setVoiceConfigError(message);
    } finally {
      setSavingConfigId('');
      setDraggingConfigId('');
      reorderingConfigRef.current = false;
    }
  }

  function handleConfigDrop(targetConfigId) {
    if (!draggingConfigId || draggingConfigId === targetConfigId) {
      setDraggingConfigId('');
      return;
    }
    const fromIndex = voiceConfigs.findIndex((item) => item.configId === draggingConfigId);
    const toIndex = voiceConfigs.findIndex((item) => item.configId === targetConfigId);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggingConfigId('');
      return;
    }
    const reordered = [...voiceConfigs];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const reranked = reordered.map((config, index) => ({ ...config, rank: index + 1 }));
    reorderingConfigRef.current = true;
    voiceConfigsRef.current = reranked;
    setVoiceConfigs(reranked);
    if (reranked[0]) {
      applyVoiceConfig(reranked[0], { silent: true });
    }
    persistConfigOrder(reranked, { movedConfigId: moved.configId });
  }

  async function renameVoiceConfig(config, nextName) {
    const configName = String(nextName || '').trim() || config.configId;
    if (!selectedVoiceProfileId || !config?.configId || configName === config.configName) return;
    setSavingConfigId(config.configId);
    setVoiceConfigError('');
    try {
      const res = await saveVoiceProfileConfig(selectedVoiceProfileId, config.configId, {
        ...config,
        configName,
      });
      const saved = res.data.config;
      setVoiceConfigs((current) => {
        const next = current.map((item) => (
          item.configId === saved.configId ? saved : item
        ));
        voiceConfigsRef.current = next;
        return next;
      });
      if (Number(saved.rank || 0) === 1) {
        await syncRankOneConfigToVoiceProfile(saved, { required: true, context: 'renamed rank #1 config' });
      }
      console.info('[voice-configs] renamed config', {
        voiceProfileId: selectedVoiceProfileId,
        configId: saved.configId,
        configName: saved.configName,
      });
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Could not rename config.';
      setModelError(message);
      setVoiceConfigError(message);
    } finally {
      setSavingConfigId('');
    }
  }

  async function generateConfigSample(config) {
    if (!config?.configId) return;
    const reference = config.referenceMetadata || {};
    const inference = config.inferenceMetadata || {};
    const defaults = inference.defaults || {};
    const primaryPath = reference.selectedPaths?.primary || reference.primary?.path || refAudioPath;
    const primaryFile = resolveReferenceFile(primaryPath, reference.primary) || {};
    const auxPaths = Array.isArray(reference.selectedPaths?.aux) ? reference.selectedPaths.aux : [];
    const prompt = referencePromptText(reference.primary, primaryFile, promptText).trim();
    const params = {
      text: 'This is a short saved voice configuration sample.',
      text_lang: inference.language || liveLanguage,
      ref_audio_path: primaryPath,
      prompt_text: prompt,
      prompt_lang: referencePromptLang(reference.primary, primaryFile, promptLang),
      aux_ref_audio_paths: auxPaths,
      speed_factor: defaults.speed_factor ?? speed,
      top_k: defaults.top_k ?? topK,
      top_p: defaults.top_p ?? topP,
      temperature: defaults.temperature ?? temperature,
      repetition_penalty: defaults.repetition_penalty ?? repPenalty,
    };
    if (!params.ref_audio_path) {
      setModelError('Config has no primary reference audio.');
      return;
    }
    if (!params.prompt_text) {
      const message = 'Config sample needs a primary reference transcript. Load the config, enter the primary transcript, update the config, then sample again.';
      setModelError(message);
      setVoiceConfigError(message);
      return;
    }
    setGeneratingSampleConfigId(config.configId);
    setModelError('');
    setVoiceConfigError('');
    try {
      const result = await synthesizeSentence(params);
      const url = URL.createObjectURL(result.blob);
      setConfigSampleUrls((current) => {
        if (current[config.configId]) URL.revokeObjectURL(current[config.configId]);
        const next = { ...current, [config.configId]: url };
        configSampleUrlsRef.current = next;
        return next;
      });
      const sample = {
        text: params.text,
        generatedAt: new Date().toISOString(),
        localOnly: true,
      };
      const saved = {
        ...config,
        sample,
      };
      await saveVoiceProfileConfig(selectedVoiceProfileId, config.configId, saved);
      console.info('[voice-configs] generated sample', {
        voiceProfileId: selectedVoiceProfileId,
        configId: config.configId,
        params,
        sample,
      });
      setVoiceConfigs((current) => current.map((item) => (
        item.configId === config.configId ? { ...item, sample } : item
      )));
      setReferenceMessage(`Generated sample for ${config.configName || config.configId}.`);
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Could not generate config sample.';
      setModelError(message);
      setVoiceConfigError(message);
    } finally {
      setGeneratingSampleConfigId('');
    }
  }

  async function generateTextToSpeech(route) {
    const text = ttsText.trim();
    if (!text) {
      setTtsError('Enter text to generate audio.');
      return;
    }
    if (!selectedVoiceProfileId || !isReady) {
      setTtsError('Load a voice profile and config before generating audio.');
      return;
    }

    const baseParams = {
      text,
      voiceProfileId: selectedVoiceProfileId,
      text_lang: liveLanguage,
    };
    const liveFastParams = {
      ...baseParams,
      ...(liveRefParams || {}),
      top_k: topK,
      top_p: topP,
      temperature,
      repetition_penalty: repPenalty,
      speed_factor: speed,
    };
    const voiceName = loadedProfile?.displayName || selectedProfile?.displayName || '';
    const languageLabel = liveLanguageConfig.label;

    setTtsError('');

    if (route === 'fastQueued') {
      setTtsFastGenerating(true);
      setTtsFastProgress({ total: 0, current: 0, text: '' });
      queuedTtsRef.current = { clips: [], playingIndex: -1, active: true };
      try {
        const result = await generateLiveFastQueuedTts({
          text,
          baseParams: liveFastParams,
          synthesizeSentence,
          splitText: (value) => shortenFirstFastPhrase(splitLiveReplyPhrases(value)),
          createObjectUrl: (blob) => URL.createObjectURL(blob),
          onProgress: setTtsFastProgress,
          onClipReady: (clip) => {
            queuedTtsRef.current.clips[clip.index] = clip;
            playNextQueuedTtsClip();
          },
        });
        if (result.clips.length === 0) {
          throw new Error('No audio clips were generated.');
        }
      } catch (err) {
        setTtsError(err.response?.data?.error || err.message || 'Could not generate queued Live Fast audio.');
      } finally {
        setTtsFastGenerating(false);
        setTtsFastProgress({ total: 0, current: 0, text: '' });
      }
      return;
    }

    if (route === 'fast') {
      setTtsFastGenerating(true);
      setTtsFastProgress({ total: 0, current: 0, text: '' });
      try {
        const phrases = shortenFirstFastPhrase(splitLiveReplyPhrases(text));
        const clips = [];
        setTtsFastProgress({ total: phrases.length, current: 0, text: phrases[0] || '' });
        for (let index = 0; index < phrases.length; index += 1) {
          const phrase = phrases[index];
          setTtsFastProgress({ total: phrases.length, current: index + 1, text: phrase });
          const result = await synthesizeSentence({ ...liveFastParams, text: phrase });
          clips.push(result.blob);
        }
        const blob = clips.length > 1 ? await concatWavBlobs(clips, { pauseMs: 120 }) : clips[0];
        recordTtsHistory({ route: 'fast', url: URL.createObjectURL(blob), text, voiceName, languageLabel });
      } catch (err) {
        setTtsError(err.response?.data?.error || err.message || 'Could not generate text to speech audio.');
      } finally {
        setTtsFastGenerating(false);
        setTtsFastProgress({ total: 0, current: 0, text: '' });
      }
      return;
    }

    // Full inference uses the chunked async flow. It avoids the
    // CloudFront ~30s origin timeout / 6MB response limit that a single synchronous
    // request hits. It returns a sessionId immediately, streams progress over SSE, and
    // fetches the finished audio via a presigned URL (bytes never traverse the Lambda).
    if (!liveFullRefParams) {
      setTtsError('Create or load Live Fast rank #1 before generating Full Inference audio.');
      return;
    }
    setStreamingRoute(route);
    try {
      const res = await startGeneration({ ...baseParams, ...liveFullRefParams, inference_mode: 'quality' });
      const { sessionId } = res.data;
      pendingFullTtsRef.current = { sessionId, text, voiceName, languageLabel, route };
      ttsInference.connect(sessionId, { initialStatus: 'waiting' });
    } catch (err) {
      pendingFullTtsRef.current = null;
      setTtsError(err.response?.data?.error || err.message || 'Could not generate text to speech audio.');
      setStreamingRoute(null);
    }
  }

  function playNextQueuedTtsClip() {
    const queue = queuedTtsRef.current;
    const nextIndex = queue.playingIndex + 1;
    const nextClip = queue.clips[nextIndex];
    const audio = queuedTtsAudioRef.current;
    if (!queue.active || !nextClip || !audio || !audio.paused) return;

    queue.playingIndex = nextIndex;
    audio.src = nextClip.url;
    audio.play().catch((err) => {
      setTtsError(err.message || 'Browser blocked queued Live Fast playback.');
    });
  }

  function handleQueuedTtsEnded() {
    playNextQueuedTtsClip();
  }

  function recordTtsHistory({ route, url, text, voiceName, languageLabel }) {
    const item = createTtsHistoryItem({ route, url, text, voiceName, languageLabel });
    setTtsHistory((current) => {
      const next = addTtsHistoryItem(current, item);
      ttsHistoryRef.current = next;
      return next;
    });
  }

  async function completeFullTtsGeneration(sessionId) {
    const pending = pendingFullTtsRef.current;
    if (!pending || pending.sessionId !== sessionId) return;
    if (completingFullTtsSessionRef.current === sessionId) return;

    completingFullTtsSessionRef.current = sessionId;
    try {
      const source = await getGenerationResultSource(sessionId);
      const playableUrl = await waitForPlayableAudioSource(source.url);
      recordTtsHistory({
        route: pending.route,
        url: playableUrl,
        text: pending.text,
        voiceName: pending.voiceName,
        languageLabel: pending.languageLabel,
      });
    } catch (err) {
      setTtsError(err.message || 'Could not fetch the generated audio.');
    } finally {
      if (pendingFullTtsRef.current?.sessionId === sessionId) {
        pendingFullTtsRef.current = null;
      }
      completingFullTtsSessionRef.current = '';
      setStreamingRoute(null);
      ttsInference.reset();
    }
  }

  async function loadPronunciationEntries(category = pronunciationCategory) {
    setPronunciationBusy(true);
    setPronunciationMessage('');
    try {
      const res = await getPronunciationDictionary(category);
      setPronunciationEntries(res.data.entries || []);
    } catch (err) {
      setPronunciationMessage(err.response?.data?.error || err.message || 'Could not load pronunciation dictionary.');
    } finally {
      setPronunciationBusy(false);
    }
  }

  async function savePronunciation() {
    const word = pronunciationWord.trim();
    if (!word) {
      setPronunciationMessage('Enter a word before saving.');
      return;
    }
    if (!pronunciationReadable.trim() && !pronunciationArpabet.trim()) {
      setPronunciationMessage('Add a readable pronunciation or ARPAbet before saving.');
      return;
    }
    setPronunciationBusy(true);
    setPronunciationMessage('');
    try {
      const res = await savePronunciationEntry({
        word,
        category: pronunciationCategory,
        readable: pronunciationReadable,
        arpabet: pronunciationArpabet,
        source: pronunciationArpabet ? 'admin-arpabet' : 'admin-readable',
      });
      setPronunciationEntries(res.data.dictionary?.entries || []);
      if (pronunciationArpabet.trim()) {
        setPronunciationReloadPending(true);
        setPronunciationMessage(`Saved ${word}. Click "Load changes" to apply.`);
      } else {
        setPronunciationMessage(`${editingPronunciationWord ? 'Updated' : 'Saved'} ${word} in ${pronunciationCategory}.`);
      }
      setEditingPronunciationWord('');
    } catch (err) {
      setPronunciationMessage(err.response?.data?.error || err.message || 'Could not save pronunciation entry.');
    } finally {
      setPronunciationBusy(false);
    }
  }

  function editPronunciation(entry) {
    setEditingPronunciationWord(entry.word || '');
    setPronunciationWord(entry.word || '');
    setPronunciationReadable(entry.readable || '');
    setPronunciationArpabet(entry.arpabet || '');
    setPronunciationMessage(`Editing ${entry.word}.`);
  }

  function clearPronunciationForm() {
    setEditingPronunciationWord('');
    setPronunciationWord('');
    setPronunciationReadable('');
    setPronunciationArpabet('');
    setPronunciationMessage('');
  }

  async function deletePronunciation(entry) {
    const word = String(entry.word || '').trim();
    if (!word) return;
    setPronunciationBusy(true);
    setPronunciationMessage('');
    try {
      const res = await deletePronunciationEntry({ word, category: pronunciationCategory });
      setPronunciationEntries(res.data.dictionary?.entries || []);
      if (editingPronunciationWord.toLowerCase() === word.toLowerCase()) clearPronunciationForm();
      if (entry.arpabet) {
        setPronunciationReloadPending(true);
        setPronunciationMessage(`Deleted ${word}. Click "Load changes" to apply.`);
      } else {
        setPronunciationMessage(`Deleted ${word} from ${pronunciationCategory}.`);
      }
    } catch (err) {
      setPronunciationMessage(err.response?.data?.error || err.message || 'Could not delete pronunciation entry.');
    } finally {
      setPronunciationBusy(false);
    }
  }

  function buildPronunciationTestText(entry) {
    const word = String(entry.word || '').trim();
    const readable = String(entry.readable || '').trim();
    const arpabet = String(entry.arpabet || '').trim();
    const spoken = readable && !arpabet ? readable : word;
    return `Pronunciation test. ${spoken}. ${spoken} is used in this sentence.`;
  }

  async function testPronunciation(entry = null) {
    const word = String(entry?.word || pronunciationWord || '').trim();
    const readable = String(entry?.readable || pronunciationReadable || '').trim();
    const arpabet = String(entry?.arpabet || pronunciationArpabet || '').trim();
    if (!word) {
      setPronunciationMessage('Enter a word before testing.');
      return;
    }
    if (arpabet && !entry) {
      setPronunciationMessage('Save ARPAbet first, then load pronunciation changes before testing it.');
      return;
    }
    if (arpabet && pronunciationReloadPending) {
      setPronunciationMessage('Load pending pronunciation changes before testing ARPAbet entries.');
      return;
    }
    if (!selectedVoiceProfileId || !isReady) {
      setPronunciationMessage('Load a voice profile and config before testing pronunciation.');
      return;
    }

    setPronunciationTestingWord(word);
    setPronunciationMessage(`Testing ${word} with Live Fast sentence TTS...`);
    try {
      const text = buildPronunciationTestText({ word, readable, arpabet });
      const result = await synthesizeSentence({
        text,
        voiceProfileId: selectedVoiceProfileId,
        text_lang: liveLanguage,
        ...(liveRefParams || {}),
      });
      recordTtsHistory({
        route: 'fast',
        url: URL.createObjectURL(result.blob),
        text,
        voiceName: loadedProfile?.displayName || selectedProfile?.displayName || '',
        languageLabel: liveLanguageConfig.label,
      });
      setPronunciationMessage(`Generated Live Fast pronunciation test for ${word}.`);
    } catch (err) {
      setPronunciationMessage(err.response?.data?.error || err.message || 'Could not test pronunciation.');
    } finally {
      setPronunciationTestingWord('');
    }
  }

  function exportPronunciationCsv() {
    const csv = serializePronunciationCsv(pronunciationEntries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pronunciation-${pronunciationCategory}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setPronunciationMessage(`Exported ${pronunciationEntries.length} ${pronunciationCategory} entries.`);
  }

  async function importPronunciationCsv(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setPronunciationBusy(true);
    setPronunciationMessage(`Importing ${file.name}...`);
    try {
      const rows = parsePronunciationCsv(await file.text(), pronunciationCategory);
      if (rows.length === 0) {
        setPronunciationMessage('No valid pronunciation rows found. CSV needs word plus readable or ARPAbet.');
        return;
      }

      let hasArpabet = false;
      for (const row of rows) {
        if (row.arpabet) hasArpabet = true;
        await savePronunciationEntry({
          ...row,
          source: row.arpabet ? 'csv-arpabet' : 'csv-readable',
        });
      }

      await loadPronunciationEntries(pronunciationCategory);
      if (hasArpabet) {
        setPronunciationReloadPending(true);
        setPronunciationMessage(`Imported ${rows.length} entries. Click "Load changes" to apply.`);
        return;
      }
      setPronunciationMessage(`Imported ${rows.length} pronunciation entries.`);
    } catch (err) {
      setPronunciationMessage(err.response?.data?.error || err.message || 'Could not import pronunciation CSV.');
    } finally {
      setPronunciationBusy(false);
    }
  }

  async function loadPendingPronunciationChanges() {
    setPronunciationBusy(true);
    setPronunciationMessage('Loading pronunciation changes...');
    try {
      await stopInferenceServer();
      await startInferenceServer();
      autoLoadAttemptKeyRef.current = '';
      setPronunciationReloadPending(false);
      setPronunciationMessage('Loaded pronunciation changes; reloading the selected voice profile...');
      await checkStatus();
    } catch (err) {
      setPronunciationMessage(err.response?.data?.error || err.message || 'Could not load pronunciation changes.');
    } finally {
      setPronunciationBusy(false);
    }
  }

  useEffect(() => {
    const pending = pendingFullTtsRef.current;
    if (!pending) return;

    if (ttsInference.status === 'complete') {
      completeFullTtsGeneration(pending.sessionId);
    } else if (ttsInference.status === 'error' || ttsInference.status === 'cancelled') {
      setTtsError(ttsInference.error || 'Could not generate text to speech audio.');
      pendingFullTtsRef.current = null;
      setStreamingRoute(null);
      ttsInference.reset();
    }
  }, [ttsInference.status, ttsInference.error]);

  useEffect(() => {
    if (!streamingRoute || !pendingFullTtsRef.current) return undefined;

    let stopped = false;
    const poll = async () => {
      const pending = pendingFullTtsRef.current;
      if (!pending || stopped || completingFullTtsSessionRef.current) return;
      try {
        const res = await getCurrentInference();
        const state = res.data || {};
        if (state.sessionId !== pending.sessionId) return;
        if (state.status === 'complete' || state.resultReady) {
          completeFullTtsGeneration(pending.sessionId);
        } else if (state.status === 'error' || state.status === 'cancelled') {
          setTtsError(state.error || 'Could not generate text to speech audio.');
          pendingFullTtsRef.current = null;
          setStreamingRoute(null);
          ttsInference.reset();
        }
      } catch {
        // SSE remains the primary signal; polling is only a best-effort fallback.
      }
    };

    const interval = window.setInterval(poll, 2000);
    poll();
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [streamingRoute, ttsInference.reset]);

  useEffect(() => {
    if (mode !== 'tts') return;
    loadPronunciationEntries(pronunciationCategory);
  }, [mode, pronunciationCategory]);

  // Manual reference edits should persist just like an auto-picked set: mark the
  // new selection as pending so the auto-sync effect saves it to the active voice
  // profile. Without this, manual changes are silently reverted the next time the
  // active profile re-fetches (model reload, gpu-ready) restores the saved set.
  function markReferenceSelectionForAutoSync({
    primaryPath = refAudioPath,
    prompt = promptText,
    lang = promptLang,
    auxFiles = auxRefAudios,
  } = {}) {
    pendingAutoSyncFingerprintRef.current = createAutoVoiceProfileSyncFingerprint({
      sourceKey: selectedExpName,
      selectedGPT,
      selectedSoVITS,
      refAudioPath: primaryPath,
      promptText: prompt,
      promptLang: lang,
      textLang: liveLanguage,
      preferredRoute: 'sentence',
      auxRefAudioPaths: auxFiles.map((item) => item.path),
      defaults: {
        top_k: topK,
        top_p: topP,
        temperature,
        repetition_penalty: repPenalty,
        speed_factor: speed,
      },
    });
  }

  function handlePrimaryReferenceChange(path) {
    const file = trainingAudioFiles.find((item) => item.path === path);
    if (!file) return;
    const nextLang = normalizeReferenceLanguage(file.lang);
    const nextAux = auxRefAudios.filter((item) => item.path !== file.path).slice(0, 5);
    setRefAudioPath(file.path); setPromptText(file.transcript || '');
    setPromptLang(nextLang);
    setAuxRefAudios(nextAux);
    setReferenceMessage(`${file.filename} is now the primary reference.`);
    markReferenceSelectionForAutoSync({
      primaryPath: file.path,
      prompt: file.transcript || '',
      lang: nextLang,
      auxFiles: nextAux,
    });
  }

  function handleAuxToggle(file, checked) {
    if (!file?.path || file.path === refAudioPath) return;
    const without = auxRefAudios.filter((item) => item.path !== file.path);
    const nextAux = checked ? [...without, file].slice(0, 5) : without;
    setAuxRefAudios(nextAux);
    markReferenceSelectionForAutoSync({ auxFiles: nextAux });
  }

  function handleLiveFullPrimaryReferenceChange(path) {
    const file = trainingAudioFiles.find((item) => item.path === path);
    if (!file) return;
    setLiveFullRefAudioPath(file.path);
    setLiveFullPromptText(file.transcript || '');
    setLiveFullPromptLang(normalizeReferenceLanguage(file.lang));
    setLiveFullAuxRefAudios((cur) => cur.filter((item) => item.path !== file.path).slice(0, 5));
    setLiveFullMessage(`${file.filename} is now the Live Full primary reference.`);
  }

  function handleLiveFullAuxToggle(file, checked) {
    if (!file?.path || file.path === liveFullRefAudioPath) return;
    setLiveFullAuxRefAudios((cur) => {
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

  async function handlePreviewLiveFullReference(item) {
    if (!item?.path || !selectedExpName) return;
    const filename = item.filename || fallbackName(item.path);
    const url = referenceAudioUrls[item.path];
    if (!url) { setLiveFullMessage(`${filename} is still loading. Try again.`); return; }
    setLiveFullPreviewReference({ path: item.path, url, filename, role: item.role });
    setLiveFullMessage('');
    const audio = liveFullPreviewAudioRef.current;
    if (!audio) return;
    if (audio.getAttribute('src') !== url) { audio.src = url; audio.load(); }
    audio.play().catch(() => setLiveFullMessage(`Use the audio controls below to play ${filename}.`));
  }

  useEffect(() => {
    if (!selectedExpName || trainingAudioFiles.length === 0) { setReferenceAudioUrls({}); setLoadingPreviewPath(''); return; }
    let ignore = false;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setLoadingPreviewPath('all');
    Promise.all(trainingAudioFiles.map(async (item) => {
      try {
        const url = await getTrainingAudioUrl(selectedExpName, item.filename || fallbackName(item.path));
        return [item.path, url];
      } catch { return [item.path, null]; }
    })).then((entries) => {
      if (ignore || previewRequestRef.current !== requestId) return;
      setReferenceAudioUrls(Object.fromEntries(entries.filter(([, url]) => Boolean(url))));
    }).finally(() => { if (!ignore && previewRequestRef.current === requestId) setLoadingPreviewPath(''); });
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
    if (!liveFullPreviewReference.path) return;
    if (!trainingAudioFiles.some((item) => item.path === liveFullPreviewReference.path)) {
      const audio = liveFullPreviewAudioRef.current;
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      setLiveFullPreviewReference({ path: '', url: null, filename: '', role: '' });
    }
  }, [trainingAudioFiles, liveFullPreviewReference.path]);

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
    if (!liveFullPreviewReference.path) return;
    const nextUrl = referenceAudioUrls[liveFullPreviewReference.path];
    if (!nextUrl) {
      const audio = liveFullPreviewAudioRef.current;
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      setLiveFullPreviewReference({ path: '', url: null, filename: '', role: '' });
      return;
    }
    setLiveFullPreviewReference((cur) => cur.url === nextUrl ? cur : { ...cur, url: nextUrl });
  }, [referenceAudioUrls, liveFullPreviewReference.path]);

  useEffect(() => {
    if (!previewReference.url) {
      const audio = referencePreviewAudioRef.current;
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      return;
    }
    const audio = referencePreviewAudioRef.current;
    if (audio && audio.getAttribute('src') !== previewReference.url) { audio.src = previewReference.url; audio.load(); }
  }, [previewReference.url]);

  useEffect(() => {
    if (!liveFullPreviewReference.url) {
      const audio = liveFullPreviewAudioRef.current;
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      return;
    }
    const audio = liveFullPreviewAudioRef.current;
    if (audio && audio.getAttribute('src') !== liveFullPreviewReference.url) { audio.src = liveFullPreviewReference.url; audio.load(); }
  }, [liveFullPreviewReference.url]);

  useEffect(() => {
    if (trainingAudioFiles.length > 0) return;
    const audio = referencePreviewAudioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    const liveFullAudio = liveFullPreviewAudioRef.current;
    if (liveFullAudio) { liveFullAudio.pause(); liveFullAudio.removeAttribute('src'); liveFullAudio.load(); }
    setPreviewReference({ path: '', url: null, filename: '', role: '' });
    setLiveFullPreviewReference({ path: '', url: null, filename: '', role: '' });
    setReferenceAudioUrls({}); setLoadingPreviewPath('');
  }, [trainingAudioFiles.length]);

  useEffect(() => { return () => { referencePreviewAudioRef.current?.pause(); liveFullPreviewAudioRef.current?.pause(); }; }, []);

  useEffect(() => {
    if (loadingPreviewPath !== 'all') return;
    const id = window.setTimeout(() => { if (loadingPreviewPath === 'all') setLoadingPreviewPath(''); }, 8000);
    return () => window.clearTimeout(id);
  }, [loadingPreviewPath]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const voiceParam = params.get('voice');
    if (voiceParam) urlVoiceKeyRef.current = voiceParam.toLowerCase().replace(/[\s_-]+/g, '');
    fetchModels(); checkStatus(); loadActiveVoiceProfile();
  }, []);

  useEffect(() => {
    if (!modelsFetched || availableProfiles.length === 0) return;
    if (urlVoiceKeyRef.current) {
      const match = availableProfiles.find((p) => p.key === urlVoiceKeyRef.current);
      if (match) { urlVoiceKeyRef.current = ''; setSelectedPersonKey(match.key); autoLoadAttemptKeyRef.current = ''; return; }
    }
    if (loadingActiveVoiceProfile) return;
    if (availableProfiles.some((p) => p.key === selectedPersonKey)) return;
    const activeMatchKey = findSavedVoiceProfileKey(availableProfiles, activeVoiceProfile?.voiceProfileId || '');
    setSelectedPersonKey(activeMatchKey || availableProfiles[0].key);
  }, [
    modelsFetched,
    availableProfiles,
    selectedPersonKey,
    loadedGPTPath,
    loadedSoVITSPath,
    loadingActiveVoiceProfile,
    activeVoiceProfile,
  ]);

  useEffect(() => {
    if (!shouldLoadSelectedProfile({ serverReady, selectedProfile, loadedGPTPath, loadedSoVITSPath, isConversationActive, loadingModel })) return;
    const loadKey = `${selectedProfile.gptModel.path}::${selectedProfile.sovitsModel.path}`;
    if (autoLoadAttemptKeyRef.current === loadKey) return;
    autoLoadAttemptKeyRef.current = loadKey;
    loadSelectedModel();
  }, [serverReady, selectedProfile, loadedGPTPath, loadedSoVITSPath, isConversationActive, loadingModel]);

  useEffect(() => {
    if (!selectedExpName) {
      setTrainingAudioFiles([]);
      setLoadedTrainingAudioSourceKey('');
      return;
    }
    let ignore = false;
    setTrainingAudioFiles([]);
    setLoadedTrainingAudioSourceKey('');
    setLoadingTrainingAudio(true);
    getTrainingAudioFiles(selectedExpName)
      .then((res) => {
        if (!ignore) {
          setTrainingAudioFiles(res.data.files || []);
          setLoadedTrainingAudioSourceKey(selectedExpName);
        }
      })
      .catch(() => {
        if (!ignore) {
          setTrainingAudioFiles([]);
          setLoadedTrainingAudioSourceKey('');
          setReferenceMessage('Could not load reference clips.');
        }
      })
      .finally(() => { if (!ignore) setLoadingTrainingAudio(false); });
    return () => { ignore = true; };
  }, [selectedExpName]);

  useEffect(() => {
    restoredActiveVoiceProfileKeyRef.current = '';
    autoReferenceKeyRef.current = '';
    autoDefaultConfigKeyRef.current = '';
    autoLoadedLiveFastConfigProfileRef.current = '';
    liveFullDefaultKeyRef.current = '';
    liveFullAutoDefaultSaveKeyRef.current = '';
  }, [selectedVoiceProfileId, selectedGPT, selectedSoVITS]);

  useEffect(() => {
    loadVoiceConfigs(selectedVoiceProfileId);
  }, [selectedVoiceProfileId]);

  useEffect(() => {
    liveFullDefaultKeyRef.current = '';
    liveFullAutoDefaultSaveKeyRef.current = '';
    setLoadedLiveFullConfigId('');
    setLiveFullMessage('');
  }, [selectedVoiceProfileId]);

  useEffect(() => {
    loadTrainingRunMetadata(selectedExpName);
  }, [selectedExpName]);

  useEffect(() => {
    if (
      loadingVoiceConfigs
      || voiceConfigs.length > 0
      || !selectedVoiceProfileId
      || !selectedProfile
      || !selectedGPT
      || !selectedSoVITS
      || !refAudioPath
      || loadingTrainingAudio
      || isConversationActive
    ) {
      return;
    }
    const key = `${selectedVoiceProfileId}:${refAudioPath}:${auxRefAudios.map((item) => item.path).join(',')}`;
    if (autoDefaultConfigKeyRef.current === key) return;
    autoDefaultConfigKeyRef.current = key;
    saveCurrentVoiceConfig({
      configId: 'default',
      configName: `${selectedProfile.displayName} default`,
      rank: 1,
      sample: {},
    });
  }, [
    loadingVoiceConfigs,
    voiceConfigs.length,
    selectedVoiceProfileId,
    selectedProfile,
    selectedGPT,
    selectedSoVITS,
    refAudioPath,
    auxRefAudios,
    loadingTrainingAudio,
    isConversationActive,
  ]);

  useEffect(() => {
    if (loadingVoiceConfigs || loadingTrainingAudio || !selectedVoiceProfileId) return;
    const savedLiveFullConfig = liveFullConfigs[0];
    if (!savedLiveFullConfig) return;
    const key = `${selectedVoiceProfileId}:liveFull:${savedLiveFullConfig.configId || 'default'}`;
    if (liveFullDefaultKeyRef.current === key) return;
    liveFullDefaultKeyRef.current = key;
    applyLiveFullConfig(savedLiveFullConfig, { silent: true });
  }, [
    loadingVoiceConfigs,
    loadingTrainingAudio,
    selectedVoiceProfileId,
    liveFullConfigs,
  ]);

  useEffect(() => {
    if (
      loadingVoiceConfigs
      || loadingTrainingAudio
      || liveFullConfigs.length > 0
      || voiceConfigs.length === 0
      || !selectedVoiceProfileId
      || !selectedProfile
      || savingLiveFullConfigId
      || streamingRoute !== null
    ) {
      return;
    }

    const rankOneConfig = voiceConfigs[0];
    const key = `${selectedVoiceProfileId}:${rankOneConfig?.configId || 'default'}`;
    if (liveFullAutoDefaultSaveKeyRef.current === key) return;
    liveFullAutoDefaultSaveKeyRef.current = key;
    saveCurrentLiveFullConfig({
      configId: 'live-full-default',
      configName: `${selectedProfile.displayName} full default`,
      rank: 1,
      sample: {},
    });
  }, [
    loadingVoiceConfigs,
    loadingTrainingAudio,
    liveFullConfigs.length,
    voiceConfigs,
    selectedVoiceProfileId,
    selectedProfile,
    savingLiveFullConfigId,
    streamingRoute,
  ]);

  useEffect(() => {
    return () => {
      Object.values(configSampleUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    return () => {
      ttsHistoryRef.current.forEach((item) => {
        if (item.url) URL.revokeObjectURL(item.url);
      });
    };
  }, []);

  useEffect(() => {
    if (!canRestoreActiveVoiceProfile || !activeVoiceProfileRestoreKey) {
      return;
    }
    if (loadingActiveVoiceProfile || loadingTrainingAudio) {
      return;
    }
    if (selectedExpName && loadedTrainingAudioSourceKey !== selectedExpName) {
      return;
    }
    if (restoredActiveVoiceProfileKeyRef.current === activeVoiceProfileRestoreKey) {
      return;
    }
    if (voiceConfigsRef.current.length > 0) {
      restoredActiveVoiceProfileKeyRef.current = activeVoiceProfileRestoreKey;
      return;
    }

    const primaryPath = String(activeVoiceProfile?.ref_audio_path || '').trim();
    if (!primaryPath) {
      return;
    }

    if (matchesSavedVoiceProfileReferenceSelection({
      profile: activeVoiceProfile,
      refAudioPath,
      auxRefAudioPaths: auxRefAudios.map((item) => item.path),
    })) {
      restoredActiveVoiceProfileKeyRef.current = activeVoiceProfileRestoreKey;
      return;
    }

    restoredActiveVoiceProfileKeyRef.current = activeVoiceProfileRestoreKey;
    pendingAutoSyncFingerprintRef.current = '';
    autoSyncRequestFingerprintRef.current = '';

    const auxMatches = Array.isArray(activeVoiceProfile?.aux_ref_audio_paths)
      ? activeVoiceProfile.aux_ref_audio_paths
        .map((path) => String(path || '').trim())
        .filter(Boolean)
        .filter((path) => path !== primaryPath)
        .slice(0, 5)
        .map((path) => trainingAudioFiles.find((file) => file.path === path) || {
          filename: fallbackName(path),
          path,
          transcript: '',
          lang: '',
        })
      : [];

    setRefAudioPath(primaryPath);
    setPromptText(String(activeVoiceProfile.prompt_text || ''));
    setPromptLang(normalizeReferenceLanguage(activeVoiceProfile.prompt_lang));
    setAuxRefAudios(auxMatches);
    setSelectedLanguage(normalizeLiveLanguage(activeVoiceProfile.text_lang || 'en'));
    setSpeed(Number.isFinite(activeVoiceProfile?.defaults?.speed_factor) ? activeVoiceProfile.defaults.speed_factor : DEFAULT_LIVE_FAST_SETTINGS.speed);
    setTopK(Number.isFinite(activeVoiceProfile?.defaults?.top_k) ? activeVoiceProfile.defaults.top_k : DEFAULT_LIVE_FAST_SETTINGS.topK);
    setTopP(Number.isFinite(activeVoiceProfile?.defaults?.top_p) ? activeVoiceProfile.defaults.top_p : DEFAULT_LIVE_FAST_SETTINGS.topP);
    setTemperature(Number.isFinite(activeVoiceProfile?.defaults?.temperature) ? activeVoiceProfile.defaults.temperature : DEFAULT_LIVE_FAST_SETTINGS.temperature);
    setRepPenalty(Number.isFinite(activeVoiceProfile?.defaults?.repetition_penalty) ? activeVoiceProfile.defaults.repetition_penalty : DEFAULT_LIVE_FAST_SETTINGS.repPenalty);
    setPreviewReference({ path: '', url: null, filename: '', role: '' });
    setReferenceMessage(`Restored saved voice profile ${activeVoiceProfile.displayName || activeVoiceProfile.voiceProfileId}.`);
  }, [
    canRestoreActiveVoiceProfile,
    activeVoiceProfileRestoreKey,
    activeVoiceProfile,
    loadingActiveVoiceProfile,
    loadingTrainingAudio,
    selectedExpName,
    loadedTrainingAudioSourceKey,
    trainingAudioFiles,
    refAudioPath,
    auxRefAudios,
  ]);

  useEffect(() => {
    if (loadingActiveVoiceProfile || loadingVoiceConfigs) return;
    if (canRestoreActiveVoiceProfile && voiceConfigs.length > 0) return;

    if (!shouldAutoApplyBestReferenceSet({
      selectedSourceKey: selectedExpName,
      loadedSourceKey: loadedTrainingAudioSourceKey,
      loading: loadingTrainingAudio,
      fileCount: trainingAudioFiles.length,
      lastAppliedSourceKey: autoReferenceKeyRef.current,
    })) return;
    const selection = applyBestReference(trainingAudioFiles, { markForAutoSync: true });
    // Only treat this source as "auto-applied" once we get a strict pick. A
    // fallback pick (clip scores/transcripts not ready) is left un-locked so a
    // later trainingAudioFiles re-fetch with scores can upgrade and persist it,
    // instead of blindly freezing the fallback set.
    if (selection?.mode === 'strict') {
      autoReferenceKeyRef.current = selectedExpName;
    }
  }, [
    selectedExpName,
    loadedTrainingAudioSourceKey,
    loadingTrainingAudio,
    trainingAudioFiles,
    loadingActiveVoiceProfile,
    loadingVoiceConfigs,
    canRestoreActiveVoiceProfile,
    voiceConfigs.length,
  ]);

  useEffect(() => {
    if (!autoSyncRequestFingerprint) {
      return;
    }

    const requestFingerprint = autoSyncRequestFingerprint;
    const requestDisplayName = selectedProfile?.displayName || '';
    autoSyncRequestFingerprintRef.current = requestFingerprint;
    setSavingProfile(true);
    setModelError('');

    persistLiveFastAutoSync()
      .then(({ displayName, voiceProfileId }) => {
        if (autoSyncRequestFingerprintRef.current !== requestFingerprint) return;
        lastAutoSyncedFingerprintRef.current = requestFingerprint;
        pendingAutoSyncFingerprintRef.current = '';
        setReferenceMessage(
          `Active voice profile synced to ${displayName || requestDisplayName} (${voiceProfileId}).`,
        );
      })
      .catch((err) => {
        if (autoSyncRequestFingerprintRef.current !== requestFingerprint) return;
        pendingAutoSyncFingerprintRef.current = '';
        setModelError(err.response?.data?.error || err.message || 'Could not sync this voice profile.');
      })
      .finally(() => {
        if (autoSyncRequestFingerprintRef.current === requestFingerprint) {
          autoSyncRequestFingerprintRef.current = '';
          setSavingProfile(false);
        }
      });
  }, [
    autoSyncRequestFingerprint,
    selectedProfile,
  ]);

  useEffect(() => {
    function handleGpuReady() { fetchModels(); checkStatus(); loadActiveVoiceProfile(); }
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
  const isTtsMode = mode === 'tts';

  // Pre-warm the inference server once a voice profile is ready on the TTS tab. The
  // first synthesis after a model load is cold (CUDA kernels + reference features),
  // which adds seconds to the first Live Fast clip. Firing one tiny throwaway synth
  // ahead of time warms that path so the user's first real clip starts fast. It is
  // best-effort: errors are swallowed and the result is discarded.
  const ttsWarmKeyRef = useRef('');
  useEffect(() => {
    if (!isTtsMode || !isReady || !liveRefParams || !selectedVoiceProfileId) return;
    const key = `${selectedVoiceProfileId}:${liveRefParams.ref_audio_path || ''}`;
    if (ttsWarmKeyRef.current === key) return;
    ttsWarmKeyRef.current = key;

    let cancelled = false;
    (async () => {
      try {
        await synthesizeSentence({
          text: 'Ready.',
          voiceProfileId: selectedVoiceProfileId,
          text_lang: liveLanguage,
          ...liveRefParams,
        });
      } catch {
        // Warm-up is best-effort; allow another attempt if the profile/ref changes.
        if (!cancelled) ttsWarmKeyRef.current = '';
      }
    })();
    return () => { cancelled = true; };
  }, [isTtsMode, isReady, liveRefParams, selectedVoiceProfileId, liveLanguage]);
  const ttsFastHistory = getTtsHistoryByRoute(ttsHistory, 'fast');
  const ttsFullHistory = getTtsHistoryByRoute(ttsHistory, 'full');
  const isListening = liveSpeech.isMicInputEnabled && (liveSpeech.phase === 'listening' || liveSpeech.phase === 'thinking');
  const canBargeIn = liveSpeech.isMicInputEnabled || liveSpeech.isBargeInArmed;
  const meterActive = (liveSpeech.isMicInputEnabled && (liveSpeech.phase === 'listening' || liveSpeech.phase === 'thinking'))
    || (canBargeIn && liveSpeech.phase === 'speaking');
  const buttonDisabled = !isReady || liveSpeech.phase === 'connecting' || liveSpeech.phase === 'stopping';

  const phaseLabel = {
    idle: 'Start', connecting: 'Connecting',
    listening: liveSpeech.isMicInputEnabled ? 'Mic on' : 'Mic off',
    thinking: liveSpeech.isMicInputEnabled ? 'Mic on' : 'Mic off',
    speaking: liveSpeech.isMicInputEnabled ? 'Mic on' : 'Mic off',
    stopping: 'Stopping',
  }[liveSpeech.phase] || 'Start';

  const statusText = liveSpeech.notice
    || (!liveSpeech.isMicInputEnabled && isConversationActive && liveSpeech.phase !== 'speaking' ? 'Mic off — voice chat still open.' : '')
    || {
      idle: 'Tap the mic to start.',
      connecting: 'Connecting...',
      listening: liveSpeech.isMicInputEnabled ? 'Listening...' : 'Mic off — voice chat still open.',
      thinking: 'Thinking...',
      speaking: liveSpeech.audioSrc ? (canBargeIn ? 'Speaking — speak to interrupt.' : 'Playing voice...') : 'Preparing voice...',
      stopping: 'Stopping...',
    }[liveSpeech.phase] || 'Tap the mic to start.';

  return (
    /* flex-1 + min-h-0 lets this fill the main flex column */
    <div className="animate-fade-in flex min-h-0 flex-1 flex-col gap-3">

      {/* ── Top bar: title + compact controls ── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="bg-gradient-to-br from-slate-900 via-slate-800 to-primary/80 bg-clip-text text-transparent">
            {isTtsMode ? 'Text to Speech' : 'Live Voice Chat'}
          </span>
        </h1>

        <div className="flex flex-1 flex-wrap items-center gap-3">
          {/* Voice model selector */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Voice</span>
                  <Select
                    value={selectedPersonKey}
                    onValueChange={(v) => {
                      setSelectedPersonKey(v);
                      setModelError('');
                      autoReferenceKeyRef.current = '';
                      autoLoadAttemptKeyRef.current = '';
                      pendingAutoSyncFingerprintRef.current = '';
                      autoSyncRequestFingerprintRef.current = '';
                      setTrainingAudioFiles([]);
                      setLoadedTrainingAudioSourceKey('');
                      clearReferenceSelection();
                      writeVoiceProfileBrowserDebug('live voice switched', createVoiceProfileBrowserDebugSummary({
                        context: 'live voice switch',
                        displayName: availableProfiles.find((p) => p.key === v)?.displayName || '',
                        selectedExpName: availableProfiles.find((p) => p.key === v)?.expName || '',
                      }));
                    }}
                    disabled={isConversationActive || savingProfile || availableProfiles.length === 0}
                  >
              <SelectTrigger className="h-9 w-44 rounded-xl border-slate-200 bg-white text-sm shadow-none">
                <SelectValue placeholder={modelsFetched ? 'Select model' : 'Loading...'} />
              </SelectTrigger>
              <SelectContent>
                {availableProfiles.map((p) => (
                  <SelectItem key={p.key} value={p.key}>{p.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Language selector */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Language</span>
            <Select value={liveLanguage} onValueChange={setSelectedLanguage} disabled={isConversationActive}>
              <SelectTrigger className="h-9 w-32 rounded-xl border-slate-200 bg-white text-sm shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIVE_LANGUAGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model status + refresh */}
          <div className="ml-auto flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-3">
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={saveSelectedVoiceProfile}
                disabled={!isReady || isConversationActive || loadingModel || savingProfile}
                className="h-8 rounded-xl border-slate-200 bg-white shadow-none"
              >
                {savingProfile ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {savingProfile ? 'Saving...' : 'Save voice'}
              </Button>
              <button
                type="button"
                onClick={() => { autoLoadAttemptKeyRef.current = ''; fetchModels(); checkStatus(); loadActiveVoiceProfile(); }}
                disabled={isConversationActive || loadingModel || savingProfile || loadingActiveVoiceProfile}
                title="Refresh models"
                className="text-slate-400 transition-colors hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw size={13} />
              </button>
            </div>
            <div className="max-w-full text-right text-[11px]">
              {activeVoiceProfileError ? (
                <span className="text-red-500">{activeVoiceProfileError}</span>
              ) : (
                <span className="inline-flex flex-wrap items-center justify-end gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-500">
                  <span className="uppercase tracking-widest text-slate-400">Active voice profile</span>
                  <span className="font-medium text-slate-700">
                    {loadingActiveVoiceProfile ? 'Loading...' : formatActiveVoiceProfileSummary(activeVoiceProfile)}
                  </span>
                </span>
              )}
            </div>
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

      {!isTtsMode && !liveSpeech.speechApiAvailable && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-600">
          This browser does not support live audio processing.
        </div>
      )}

      {isTtsMode ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_4px_32px_-8px_rgba(0,0,0,0.09)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">Input text</p>
                <p className="mt-1 text-xs text-slate-400">
                  {loadedProfile?.displayName || 'Selected voice'} · {liveLanguageConfig.label} · {loadedConfigId || 'current config'}
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                Browser download only
              </span>
            </div>
            <Textarea
              value={ttsText}
              onChange={(event) => setTtsText(event.target.value)}
              disabled={!isReady || ttsFastGenerating || streamingRoute !== null}
              placeholder={isReady ? 'Type the text to synthesize.' : 'Load a voice profile first.'}
              className="mt-4 min-h-[220px] rounded-xl border-slate-200 bg-white text-sm leading-6 shadow-none"
            />
            {ttsError && (
              <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{ttsError}</p>
            )}
            {ttsFastGenerating && (
              <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <p>
                  {ttsFastProgress.total > 0
                    ? `Synthesizing sentence ${Math.min(ttsFastProgress.current, ttsFastProgress.total)} of ${ttsFastProgress.total}...`
                    : 'Preparing Live Fast sentences...'}
                </p>
                {ttsFastProgress.text && (
                  <p className="mt-1 line-clamp-2 text-xs text-emerald-700/80">{ttsFastProgress.text}</p>
                )}
              </div>
            )}
            {streamingRoute && (
              <p className="mt-3 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-700">
                {ttsInference.totalChunks > 0
                  ? `Synthesizing chunk ${Math.min(ttsInference.completedChunks + 1, ttsInference.totalChunks)} of ${ttsInference.totalChunks}…`
                  : 'Preparing synthesis…'}
              </p>
            )}
            <audio ref={queuedTtsAudioRef} className="hidden" onEnded={handleQueuedTtsEnded} />
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <Button
                type="button"
                onClick={() => generateTextToSpeech('fast')}
                disabled={!isReady || !ttsText.trim() || ttsFastGenerating || streamingRoute !== null}
                className="h-10 rounded-xl"
              >
                {(ttsFastGenerating || streamingRoute === 'fast') ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
                Live Fast TTS
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => generateTextToSpeech('fastQueued')}
                disabled={!isReady || !ttsText.trim() || ttsFastGenerating || streamingRoute !== null}
                className="h-10 rounded-xl border-slate-200 bg-white shadow-none"
              >
                {ttsFastGenerating ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
                Live Fast Queue
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => generateTextToSpeech('full')}
                disabled={!isReady || !ttsText.trim() || ttsFastGenerating || streamingRoute !== null}
                className="h-10 rounded-xl border-slate-200 bg-white shadow-none"
              >
                {streamingRoute === 'full' ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
                Full Inference TTS
              </Button>
            </div>

            <div className="hidden">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Live Full settings</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {loadedLiveFullConfigId || 'default from Live Fast #1 references'} · Full Inference only
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => saveCurrentLiveFullConfig()}
                  disabled={!selectedVoiceProfileId || !voiceConfigs[0] || Boolean(savingLiveFullConfigId)}
                  className="h-8 rounded-lg"
                >
                  {savingLiveFullConfigId && !liveFullConfigs.some((item) => item.configId === savingLiveFullConfigId)
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Check size={13} />}
                  Save new
                </Button>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="space-y-4">
                  <div>
                    <Label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Primary reference</Label>
                    <Select
                      value={liveFullRefAudioPath}
                      onValueChange={handleLiveFullPrimaryReferenceChange}
                      disabled={loadingTrainingAudio || trainingAudioFiles.length === 0 || streamingRoute !== null}
                    >
                      <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white shadow-none">
                        <SelectValue placeholder={loadingTrainingAudio ? 'Loading...' : 'Select primary'} />
                      </SelectTrigger>
                      <SelectContent>
                        {trainingAudioFiles.map((f) => {
                          const candidate = referenceCandidateMap[f.path];
                          return (
                            <SelectItem key={f.path} value={f.path}>
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate">{f.filename}</span>
                                {candidate && <span className="text-[10px] text-slate-400">{Math.round(candidate.score)}</span>}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Auxiliary clips</Label>
                    <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                      {trainingAudioFiles.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-slate-400">{loadingTrainingAudio ? 'Loading...' : 'No clips found.'}</p>
                      ) : (
                        trainingAudioFiles.filter((f) => f.path !== liveFullRefAudioPath).map((f) => {
                          const checked = liveFullAuxRefAudios.some((item) => item.path === f.path);
                          return (
                            <div key={f.path} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => handleLiveFullAuxToggle(f, Boolean(v))}
                                disabled={streamingRoute !== null || (!checked && liveFullAuxRefAudios.length >= 5)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-mono text-xs text-slate-700">{f.filename}</span>
                                {f.transcript && <span className="mt-0.5 block truncate text-xs text-slate-400">{f.transcript}</span>}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400">
                      {liveFullAuxRefAudios.length}/5 auxiliary · Primary: {liveFullRefAudioPath ? fallbackName(liveFullRefAudioPath) : 'none'}
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
                    <div>
                      <Label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Primary transcript</Label>
                      <Textarea
                        className="min-h-[82px] rounded-xl border-slate-200 bg-white shadow-none leading-6"
                        value={liveFullPromptText}
                        onChange={(event) => {
                          setLiveFullPromptText(event.target.value);
                        }}
                        disabled={streamingRoute !== null}
                      />
                    </div>
                    <div>
                      <Label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Ref language</Label>
                      <Select
                        value={liveFullPromptLang}
                        onValueChange={(value) => {
                          setLiveFullPromptLang(value);
                        }}
                        disabled={streamingRoute !== null}
                      >
                        <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white shadow-none"><SelectValue /></SelectTrigger>
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

                  <div className="grid gap-3 md:grid-cols-2">
                    {[
                      { label: 'Speed', display: liveFullSpeed.toFixed(1) + 'x', min: 0.5, max: 2.0, step: 0.1, val: liveFullSpeed, set: setLiveFullSpeed },
                      { label: 'Top K', display: String(liveFullTopK), min: 1, max: 50, step: 1, val: liveFullTopK, set: setLiveFullTopK },
                      { label: 'Top P', display: liveFullTopP.toFixed(2), min: 0, max: 1, step: 0.05, val: liveFullTopP, set: setLiveFullTopP },
                      { label: 'Temperature', display: liveFullTemperature.toFixed(2), min: 0, max: 1, step: 0.05, val: liveFullTemperature, set: setLiveFullTemperature },
                    ].map(({ label, display, min, max, step, val, set }) => (
                      <div key={label} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</Label>
                          <span className="font-mono text-sm font-semibold text-slate-700">{display}</span>
                        </div>
                        <Slider min={min} max={max} step={step} value={[val]} onValueChange={([v]) => set(v)} disabled={streamingRoute !== null} />
                      </div>
                    ))}
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 md:col-span-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Repetition Penalty</Label>
                        <span className="font-mono text-sm font-semibold text-slate-700">{liveFullRepPenalty.toFixed(2)}</span>
                      </div>
                      <Slider min={1.0} max={2.0} step={0.05} value={[liveFullRepPenalty]} onValueChange={([v]) => setLiveFullRepPenalty(v)} disabled={streamingRoute !== null} />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-500">
                    <p className="font-semibold text-slate-700">Current Live Full config</p>
                    <p className="mt-1 truncate">
                      Refs from Live Fast #1: {liveFastRankOneReferenceSummary.primaryName} - speed {liveFullSettings.speed.toFixed(1)} - temp {liveFullSettings.temperature.toFixed(2)}
                    </p>
                    <p className="mt-1 truncate">
                      top k {liveFullSettings.topK} · top p {liveFullSettings.topP.toFixed(2)} · rep {liveFullSettings.repPenalty.toFixed(2)}
                    </p>
                  </div>

                  <div className="rounded-lg border border-slate-100 bg-white p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-700">Saved Live Full configs</p>
                      <button
                        type="button"
                        onClick={() => loadVoiceConfigs(selectedVoiceProfileId)}
                        disabled={loadingVoiceConfigs || !selectedVoiceProfileId}
                        className="text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40"
                      >
                        {loadingVoiceConfigs ? 'Loading...' : 'Refresh'}
                      </button>
                    </div>
                    {liveFullConfigs.length === 0 ? (
                      <p className="rounded-lg border border-amber-100 bg-amber-50 px-2 py-2 text-xs text-amber-700">
                        No saved Live Full configs yet. The current default uses Live Fast #1 references with Full defaults.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {liveFullConfigs.map((config, index) => {
                          const defaults = config.inferenceMetadata?.defaults || {};
                          const busy = savingLiveFullConfigId === config.configId;
                          const loaded = loadedLiveFullConfigId === config.configId;
                          return (
                            <div key={config.configId} className={cn('rounded-lg border bg-slate-50 p-2', loaded ? 'border-blue-200 ring-1 ring-blue-100' : 'border-slate-200')}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-semibold text-slate-800">#{index + 1} {config.configName || config.configId}</p>
                                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                                    Refs from Live Fast #1: {liveFastRankOneReferenceSummary.primaryName} ·
                                    speed {defaults.speed_factor ?? 'n/a'} · temp {defaults.temperature ?? 'n/a'}
                                  </p>
                                </div>
                                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                  <button type="button" onClick={() => loadSavedLiveFullConfig(config)} disabled={busy || streamingRoute !== null} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">Load</button>
                                  <button type="button" onClick={() => saveCurrentLiveFullConfig(config)} disabled={busy || !loaded} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">Update</button>
                                  <button type="button" onClick={() => deleteSavedLiveFullConfig(config.configId)} disabled={busy} className="rounded-md border border-red-100 bg-white px-2 py-1 text-[11px] text-red-500 hover:bg-red-50 disabled:opacity-40">Delete</button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {liveFullMessage && <p className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-500">{liveFullMessage}</p>}
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Pronunciation dictionary</p>
                  <p className="mt-0.5 text-xs text-slate-400">English entries saved by category.</p>
                </div>
                <Select value={pronunciationCategory} onValueChange={setPronunciationCategory}>
                  <SelectTrigger className="h-8 w-[130px] rounded-lg border-slate-200 bg-white text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRONUNCIATION_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr]">
                <Input value={pronunciationWord} onChange={(event) => setPronunciationWord(event.target.value)} placeholder="Word" className="h-9 rounded-lg bg-white" />
                <Input value={pronunciationReadable} onChange={(event) => setPronunciationReadable(event.target.value)} placeholder="Readable pronunciation" className="h-9 rounded-lg bg-white" />
              </div>
              <Input value={pronunciationArpabet} onChange={(event) => setPronunciationArpabet(event.target.value)} placeholder="ARPAbet, e.g. EH1 N Z AY0 M" className="mt-2 h-9 rounded-lg bg-white font-mono text-xs" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={savePronunciation} disabled={pronunciationBusy} className="h-8 rounded-lg">
                  <Check size={13} />
                  {editingPronunciationWord ? 'Update entry' : 'Save entry'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => testPronunciation()}
                  disabled={pronunciationBusy || Boolean(pronunciationTestingWord) || !isReady}
                  className="h-8 rounded-lg border-slate-200 bg-white"
                >
                  {pronunciationTestingWord === pronunciationWord.trim() ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />}
                  Test
                </Button>
                {editingPronunciationWord && (
                  <Button type="button" size="sm" variant="outline" onClick={clearPronunciationForm} disabled={pronunciationBusy} className="h-8 rounded-lg border-slate-200 bg-white">
                    <X size={13} />
                    Cancel
                  </Button>
                )}
                <Button type="button" size="sm" variant="outline" onClick={exportPronunciationCsv} disabled={pronunciationBusy || pronunciationEntries.length === 0} className="h-8 rounded-lg border-slate-200 bg-white">
                  <Download size={13} />
                  Export CSV
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => pronunciationImportInputRef.current?.click()} disabled={pronunciationBusy} className="h-8 rounded-lg border-slate-200 bg-white">
                  <Upload size={13} />
                  Import CSV
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={pronunciationReloadPending ? 'default' : 'outline'}
                  onClick={loadPendingPronunciationChanges}
                  disabled={pronunciationBusy || !pronunciationReloadPending}
                  className={cn(
                    'h-8 rounded-lg',
                    pronunciationReloadPending ? '' : 'border-slate-200 bg-white',
                  )}
                >
                  {pronunciationBusy && pronunciationReloadPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  Load changes
                </Button>
                <input ref={pronunciationImportInputRef} type="file" accept=".csv,text/csv" onChange={importPronunciationCsv} className="hidden" />
              </div>
              {pronunciationMessage && <p className="mt-2 text-xs text-slate-500">{pronunciationMessage}</p>}
              {pronunciationEntries.length > 0 && (
                <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-100 bg-white">
                  {pronunciationEntries.map((entry) => (
                    <div key={entry.id || entry.word} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-50 px-2 py-1.5 text-xs last:border-b-0">
                      <button
                        type="button"
                        onClick={() => editPronunciation(entry)}
                        className="min-w-0 text-left"
                        disabled={pronunciationBusy}
                      >
                        <span className="block truncate font-medium text-slate-700">{entry.word}</span>
                        <span className="block truncate font-mono text-slate-400">{entry.arpabet || entry.readable}</span>
                      </button>
                      <div className="flex items-center gap-1">
                        <Button type="button" size="icon" variant="ghost" onClick={() => testPronunciation(entry)} disabled={pronunciationBusy || Boolean(pronunciationTestingWord) || !isReady} className="h-7 w-7 rounded-lg text-blue-500">
                          {pronunciationTestingWord === entry.word ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />}
                        </Button>
                        <Button type="button" size="icon" variant="ghost" onClick={() => editPronunciation(entry)} disabled={pronunciationBusy} className="h-7 w-7 rounded-lg text-slate-500">
                          <Pencil size={13} />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" onClick={() => deletePronunciation(entry)} disabled={pronunciationBusy} className="h-7 w-7 rounded-lg text-red-500">
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            {[
              {
                title: 'Live Fast output',
                description: '/api/live/tts-sentence',
                items: ttsFastHistory,
              },
              {
                title: 'Full inference output',
                description: '/api/inference',
                items: ttsFullHistory,
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_4px_32px_-12px_rgba(0,0,0,0.08)]">
                <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                <p className="mt-1 text-xs text-slate-400">{item.description}</p>
                {item.items.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {item.items.map((result, index) => (
                      <div key={result.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-700">
                              {index === 0 ? 'Latest' : new Date(result.createdAt).toLocaleTimeString()}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-slate-400">
                              {result.voiceName || 'Selected voice'} · {result.languageLabel || liveLanguageConfig.label}
                            </p>
                          </div>
                          <a
                            href={result.url}
                            download={result.filename}
                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            <Download size={12} /> WAV
                          </a>
                        </div>
                        <audio className="w-full" controls src={result.url} />
                        {result.text && (
                          <p className="mt-2 max-h-10 overflow-hidden text-xs leading-5 text-slate-500">{result.text}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm text-slate-400">
                    No audio generated yet.
                  </p>
                )}
              </div>
            ))}
          </aside>
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_4px_32px_-8px_rgba(0,0,0,0.09)]">

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {liveSpeech.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-16 text-center">
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
                  selectedPart={liveSpeech.selectedReply?.id === message.id ? liveSpeech.selectedAudioPart : null}
                  onPlay={liveSpeech.playReply}
                  audioRef={audioRef}
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

        {/* ── Bottom control bar ── */}
        <div className="border-t border-slate-100 px-6 pb-6 pt-4">
          {/* Waveform — centered, only visible when mic is active */}
          <div className="mb-3 flex h-7 items-end justify-center">
            <MicLevelMeter level={liveSpeech.audioLevel} active={meterActive} />
          </div>

          {/* Mic row: flanking actions + centered large mic button */}
          <div className="flex items-center justify-center gap-5">
            <div className="flex w-28 justify-end">
              {playbackReady && (
                <button
                  type="button"
                  onClick={liveSpeech.interruptPlayback}
                  title="Stop voice"
                  className="flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-800"
                >
                  <VolumeX size={13} />Stop voice
                </button>
              )}
            </div>

            {/* Mic button — primary focal element */}
            <div className="relative flex items-center justify-center">
              {/* Pulsing ring when listening */}
              {isListening && (
                <span className="absolute h-20 w-20 animate-ping rounded-full bg-red-400/20" />
              )}
              {/* Soft glow ring when idle + ready */}
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

            <div className="flex w-28 justify-start">
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

          {/* Status text — centered below mic */}
          <div className="mt-4 text-center">
            <p className="text-sm font-medium text-slate-700">{statusText}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {loadedProfile?.displayName || '—'} · {liveLanguageConfig.label}
            </p>
          </div>
        </div>
      </div>
      )}

      {/* ── Advanced settings collapsible ── */}
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
          <div className="mt-4 grid gap-5 rounded-2xl border border-slate-100 bg-slate-50 p-5 lg:grid-cols-2">

            {/* Reference clips */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">Reference clips</p>
                <Button
                  type="button" variant="outline" size="sm"
                  className="h-8 rounded-xl border-slate-200 bg-white shadow-none"
                  onClick={() => applyBestReference()}
                  disabled={loadingTrainingAudio || trainingAudioFiles.length === 0 || isConversationActive}
                >
                  <Check size={13} />Use best
                </Button>
              </div>

              <div>
                <Label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Primary reference</Label>
                <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2">
                  <Select
                    value={refAudioPath} onValueChange={handlePrimaryReferenceChange}
                    disabled={loadingTrainingAudio || trainingAudioFiles.length === 0 || isConversationActive}
                  >
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white shadow-none">
                      <SelectValue placeholder={loadingTrainingAudio ? 'Loading...' : 'Select primary'} />
                    </SelectTrigger>
                    <SelectContent>
                      {trainingAudioFiles.map((f) => {
                        const candidate = referenceCandidateMap[f.path];
                        return (
                          <SelectItem key={f.path} value={f.path}>
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate">{f.filename}</span>
                              <span className={cn(
                                'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                                candidate?.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                              )}>
                                {formatReferenceScore(candidate)}
                              </span>
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {(() => {
                    const pi = selectedReferenceItems.find((item) => item.role === 'primary');
                    const pUrl = pi ? referenceAudioUrls[pi.path] : null;
                    const pLoading = Boolean(pi) && loadingPreviewPath === 'all' && !pUrl;
                    return (
                      <button
                        type="button" onClick={() => handlePreviewReference(pi)}
                        disabled={!pi || !pUrl || pLoading}
                        className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 disabled:cursor-wait disabled:opacity-50',
                          previewReference.path === pi?.path && 'border-slate-300 bg-slate-50'
                        )}
                      >
                        {pLoading ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={15} />}
                      </button>
                    );
                  })()}
                </div>
              </div>

              <div>
                <Label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Auxiliary clips</Label>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                  {trainingAudioFiles.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-slate-400">{loadingTrainingAudio ? 'Loading...' : 'No clips found.'}</p>
                  ) : (
                    trainingAudioFiles.filter((f) => f.path !== refAudioPath).map((f) => {
                      const checked = auxRefAudios.some((item) => item.path === f.path);
                      const fUrl = referenceAudioUrls[f.path];
                      const loading = (loadingPreviewPath === 'all' && !fUrl) || loadingPreviewPath === f.path;
                      const pi2 = { role: checked ? 'auxiliary' : 'preview', path: f.path, filename: f.filename, transcript: f.transcript || '' };
                      return (
                        <div key={f.path} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => handleAuxToggle(f, Boolean(v))}
                            disabled={isConversationActive || (!checked && auxRefAudios.length >= 5)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="block truncate font-mono text-xs text-slate-700">{f.filename}</span>
                              {referenceCandidateMap[f.path] && (
                                <span className={cn(
                                  'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                                  referenceCandidateMap[f.path].eligible
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-slate-100 text-slate-500'
                                )}>
                                  {Math.round(referenceCandidateMap[f.path].score)}
                                </span>
                              )}
                            </span>
                            {f.transcript && <span className="mt-0.5 block truncate text-xs text-slate-400">{f.transcript}</span>}
                            {referenceCandidateMap[f.path]?.reasons?.[0] && (
                              <span className="mt-0.5 block truncate text-[11px] text-amber-600">{referenceCandidateMap[f.path].reasons[0]}</span>
                            )}
                          </span>
                          <button
                            type="button" onClick={() => handlePreviewReference(pi2)}
                            disabled={!selectedExpName || !fUrl || loading}
                            className={cn(
                              'mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-700 disabled:cursor-wait disabled:opacity-50',
                              previewReference.path === f.path && 'border-slate-300 text-slate-700'
                            )}
                          >
                            {loading ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={12} />}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  {auxRefAudios.length}/5 auxiliary · Primary: {refAudioPath ? fallbackName(refAudioPath) : 'none'}
                </p>
                {currentReferenceMetadata.primary && (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-700">Primary reference score</span>
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        currentReferenceMetadata.primary.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      )}>
                        {Math.round(currentReferenceMetadata.primary.score)} · {currentReferenceMetadata.mode}
                      </span>
                    </div>
                    <p className="mt-1 truncate">
                      {currentReferenceMetadata.primary.eligible
                        ? 'Passed strict duration, sentence, cleanliness, loudness, and steady-tone checks.'
                        : currentReferenceMetadata.primary.reasons.join(' ')}
                    </p>
                  </div>
                )}
              </div>

              <div className={cn(!previewReference.url && 'hidden')}>
                {previewReference.url && (
                  <p className="mb-1 truncate text-[11px] text-slate-400">
                    Previewing {previewReference.role}: {previewReference.filename}
                  </p>
                )}
                <audio ref={referencePreviewAudioRef} className="w-full" controls preload="metadata"
                  onError={() => { if (previewReference.filename) setReferenceMessage(`Could not play ${previewReference.filename}.`); }}
                  onPlay={() => setReferenceMessage('')}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_150px]">
                <div>
                  <Label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Primary transcript</Label>
                  <Textarea
                    className="min-h-[90px] rounded-xl border-slate-200 bg-white shadow-none leading-6"
                    value={promptText} onChange={(e) => setPromptText(e.target.value)} disabled={isConversationActive}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Ref language</Label>
                  <Select value={promptLang} onValueChange={setPromptLang} disabled={isConversationActive}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white shadow-none"><SelectValue /></SelectTrigger>
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
                <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">{referenceMessage}</p>
              )}
            </div>

            {/* Inference controls */}
            <div className="space-y-4">
              <p className="text-sm font-semibold text-slate-800">Inference controls</p>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Current config</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {currentLiveFastMetadata.configName} · {currentReferenceMetadata.primary ? fallbackName(currentReferenceMetadata.selectedPaths.primary) : 'no reference'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => saveCurrentVoiceConfig()}
                    disabled={!selectedProfile || !selectedGPT || !selectedSoVITS || !refAudioPath || isConversationActive || loadingModel || Boolean(savingConfigId)}
                    className="h-8 rounded-xl border-slate-200 bg-white shadow-none"
                  >
                    {savingConfigId && !voiceConfigs.some((item) => item.configId === savingConfigId)
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Check size={13} />}
                    {savingConfigId && !voiceConfigs.some((item) => item.configId === savingConfigId) ? 'Saving...' : 'Save new'}
                  </Button>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                  <p className="rounded-lg bg-slate-50 px-2 py-1.5">
                    Speed {speed.toFixed(1)} · Top K {topK} · Top P {topP.toFixed(2)}
                  </p>
                  <p className="rounded-lg bg-slate-50 px-2 py-1.5">
                    Temp {temperature.toFixed(2)} · Rep {repPenalty.toFixed(2)} · {liveLanguageConfig.label}
                  </p>
                </div>
                <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-2 py-2 text-xs text-slate-500">
                  <p className="font-semibold text-slate-700">Training metadata</p>
                  {trainingRunMetadata ? (
                    <>
                      <p className="mt-1">
                        Engine {trainingRunMetadata.engineVersion || 'unknown'} ·
                        denoise {trainingRunMetadata.training?.skipDenoise ? 'skipped' : 'enabled'} ·
                        batch {trainingRunMetadata.training?.batchSize ?? 'n/a'}
                      </p>
                      <p className="mt-1">
                        SoVITS {trainingRunMetadata.training?.sovitsEpochs ?? 'n/a'} ep ·
                        GPT {trainingRunMetadata.training?.gptEpochs ?? 'n/a'} ep ·
                        raw files {trainingRunMetadata.sourceDatasetStats?.rawFileCount ?? 'n/a'}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-amber-700">
                      {trainingRunMetadataError || 'Training metadata has not loaded yet.'}
                    </p>
                  )}
                </div>
                <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-700">Saved configs for this person</p>
                    <button
                      type="button"
                      onClick={() => loadVoiceConfigs(selectedVoiceProfileId)}
                      disabled={loadingVoiceConfigs || !selectedVoiceProfileId}
                      className="text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40"
                    >
                      {loadingVoiceConfigs ? 'Loading...' : 'Refresh'}
                    </button>
                  </div>
                  {voiceConfigError && <p className="mb-2 text-xs text-red-500">{voiceConfigError}</p>}
                  {voiceConfigs.length === 0 ? (
                    <p className="rounded-lg border border-amber-100 bg-amber-50 px-2 py-2 text-xs text-amber-700">
                      No saved configs yet. Click Save new after choosing references and inference settings.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {voiceConfigs.map((config, index) => {
                        const defaults = config.inferenceMetadata?.defaults || {};
                        const reference = config.referenceMetadata || {};
                        const sampleUrl = configSampleUrls[config.configId];
                        const busy = savingConfigId === config.configId || generatingSampleConfigId === config.configId;
                        const loaded = reorderingConfigRef.current
                          ? index === 0
                          : loadedConfigId === config.configId;
                        return (
                          <div
                            key={config.configId}
                            className={cn(
                              'rounded-lg border bg-white p-2 transition-opacity',
                              loaded ? 'border-blue-200 ring-1 ring-blue-100' : 'border-slate-200',
                              draggingConfigId === config.configId && 'opacity-50'
                            )}
                            draggable={!busy}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', config.configId);
                              setDraggingConfigId(config.configId);
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              handleConfigDrop(config.configId);
                            }}
                            onDragEnd={() => setDraggingConfigId('')}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="shrink-0 cursor-grab text-xs text-slate-400" title="Drag to reorder">#{index + 1}</span>
                                  <input
                                    className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold text-slate-800 outline-none transition-colors hover:border-slate-200 focus:border-blue-200 focus:bg-white"
                                    defaultValue={config.configName || config.configId}
                                    disabled={busy}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') event.currentTarget.blur();
                                      if (event.key === 'Escape') {
                                        event.currentTarget.value = config.configName || config.configId;
                                        event.currentTarget.blur();
                                      }
                                    }}
                                    onBlur={(event) => renameVoiceConfig(config, event.currentTarget.value)}
                                  />
                                  {loaded && <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">loaded</span>}
                                </div>
                                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                                  Ref {fallbackName(reference.selectedPaths?.primary || reference.primary?.path)} ·
                                  speed {defaults.speed_factor ?? 'n/a'} · temp {defaults.temperature ?? 'n/a'}
                                </p>
                                {config.trainingMetadata?.engineVersion && (
                                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                    Trained {config.trainingMetadata.engineVersion} · denoise {config.trainingMetadata.skipDenoise ? 'skipped' : 'enabled'} · batch {config.trainingMetadata.batchSize ?? 'n/a'}
                                  </p>
                                )}
                              </div>
                              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                <button type="button" onClick={() => loadSavedVoiceConfig(config)} disabled={busy || isConversationActive} className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">Load</button>
                                <button type="button" onClick={() => saveCurrentVoiceConfig(config)} disabled={busy || !loaded} className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">Update</button>
                                <button type="button" onClick={() => generateConfigSample(config)} disabled={busy || isConversationActive} className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                                  {generatingSampleConfigId === config.configId ? 'Generating' : 'Sample'}
                                </button>
                                <button type="button" onClick={() => deleteSavedVoiceConfig(config.configId)} disabled={busy} className="rounded-md border border-red-100 px-2 py-1 text-[11px] text-red-500 hover:bg-red-50 disabled:opacity-40">Delete</button>
                              </div>
                            </div>
                            {sampleUrl ? (
                              <audio className="mt-2 w-full" controls src={sampleUrl} />
                            ) : config.sample?.generatedAt ? (
                              <p className="mt-2 text-[11px] text-slate-400">
                                Sample metadata saved {new Date(config.sample.generatedAt).toLocaleString()}, regenerate to listen in this browser.
                              </p>
                            ) : (
                              <p className="mt-2 text-[11px] text-slate-400">No sample recording yet.</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
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
                    <Slider min={min} max={max} step={step} value={[val]} onValueChange={([v]) => set(v)} disabled={isConversationActive} />
                  </div>
                ))}
                <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Repetition Penalty</Label>
                    <span className="font-mono text-sm font-semibold text-slate-700">{repPenalty.toFixed(2)}</span>
                  </div>
                  <Slider min={1.0} max={2.0} step={0.05} value={[repPenalty]} onValueChange={([v]) => setRepPenalty(v)} disabled={isConversationActive} />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">Live Full settings</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {loadedLiveFullConfigId || 'default full config'} · Full Inference only
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => saveCurrentLiveFullConfig()}
                  disabled={!selectedVoiceProfileId || !voiceConfigs[0] || Boolean(savingLiveFullConfigId)}
                  className="h-8 rounded-xl"
                >
                  {savingLiveFullConfigId && !liveFullConfigs.some((item) => item.configId === savingLiveFullConfigId)
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Check size={13} />}
                  Save new
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                <div className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs text-slate-500">
                  <p className="font-semibold text-slate-700">References from Live Fast #1</p>
                  {liveFastRankOneReferenceSummary.primaryPath ? (
                    <>
                      <p className="mt-1 truncate">
                        {liveFastRankOneReferenceSummary.config?.configName || liveFastRankOneReferenceSummary.config?.configId || 'Rank #1'} - {liveFastRankOneReferenceSummary.primaryName}
                      </p>
                      <p className="mt-1 text-slate-400">
                        {liveFastRankOneReferenceSummary.auxPaths.length}/5 auxiliary clips. Full load, sample, and TTS use this reference set.
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-amber-600">
                      No Live Fast rank #1 config yet. The app will auto-save best refs as rank #1 once clips are loaded.
                    </p>
                  )}
                </div>

                <div className="hidden">
                  <Label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Primary reference</Label>
                  <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2">
                    <Select
                      value={liveFullRefAudioPath}
                      onValueChange={handleLiveFullPrimaryReferenceChange}
                      disabled={loadingTrainingAudio || trainingAudioFiles.length === 0 || streamingRoute !== null}
                    >
                      <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white shadow-none">
                        <SelectValue placeholder={loadingTrainingAudio ? 'Loading...' : 'Select primary'} />
                      </SelectTrigger>
                      <SelectContent>
                        {trainingAudioFiles.map((f) => {
                          const candidate = referenceCandidateMap[f.path];
                          return (
                            <SelectItem key={f.path} value={f.path}>
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate">{f.filename}</span>
                                <span className={cn(
                                  'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                                  candidate?.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                                )}>
                                  {formatReferenceScore(candidate)}
                                </span>
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {(() => {
                      const pi = selectedLiveFullReferenceItems.find((item) => item.role === 'primary');
                      const pUrl = pi ? referenceAudioUrls[pi.path] : null;
                      const pLoading = Boolean(pi) && loadingPreviewPath === 'all' && !pUrl;
                      return (
                        <button
                          type="button"
                          onClick={() => handlePreviewLiveFullReference(pi)}
                          disabled={!pi || !pUrl || pLoading}
                          className={cn(
                            'flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 disabled:cursor-wait disabled:opacity-50',
                            liveFullPreviewReference.path === pi?.path && 'border-slate-300 bg-slate-50'
                          )}
                        >
                          {pLoading ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={15} />}
                        </button>
                      );
                    })()}
                  </div>
                </div>

                <div className="hidden">
                  <Label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Auxiliary clips</Label>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                    {trainingAudioFiles.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-slate-400">{loadingTrainingAudio ? 'Loading...' : 'No clips found.'}</p>
                    ) : (
                      trainingAudioFiles.filter((f) => f.path !== liveFullRefAudioPath).map((f) => {
                        const checked = liveFullAuxRefAudios.some((item) => item.path === f.path);
                        const fUrl = referenceAudioUrls[f.path];
                        const loading = (loadingPreviewPath === 'all' && !fUrl) || loadingPreviewPath === f.path;
                        const pi2 = { role: checked ? 'live full auxiliary' : 'live full preview', path: f.path, filename: f.filename, transcript: f.transcript || '' };
                        return (
                          <div key={f.path} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => handleLiveFullAuxToggle(f, Boolean(v))}
                              disabled={streamingRoute !== null || (!checked && liveFullAuxRefAudios.length >= 5)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="block truncate font-mono text-xs text-slate-700">{f.filename}</span>
                                {referenceCandidateMap[f.path] && (
                                  <span className={cn(
                                    'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                                    referenceCandidateMap[f.path].eligible
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : 'bg-slate-100 text-slate-500'
                                  )}>
                                    {Math.round(referenceCandidateMap[f.path].score)}
                                  </span>
                                )}
                              </span>
                              {f.transcript && <span className="mt-0.5 block truncate text-xs text-slate-400">{f.transcript}</span>}
                              {referenceCandidateMap[f.path]?.reasons?.[0] && (
                                <span className="mt-0.5 block truncate text-[11px] text-amber-600">{referenceCandidateMap[f.path].reasons[0]}</span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => handlePreviewLiveFullReference(pi2)}
                              disabled={!selectedExpName || !fUrl || loading}
                              className={cn(
                                'mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-700 disabled:cursor-wait disabled:opacity-50',
                                liveFullPreviewReference.path === f.path && 'border-slate-300 text-slate-700'
                              )}
                            >
                              {loading ? <Loader2 size={11} className="animate-spin" /> : <PlayCircle size={12} />}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">
                    {liveFullAuxRefAudios.length}/5 auxiliary · Primary: {liveFullRefAudioPath ? fallbackName(liveFullRefAudioPath) : 'none'}
                  </p>
                  {currentLiveFullReferenceMetadata.primary && (
                    <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-slate-700">Primary reference score</span>
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          currentLiveFullReferenceMetadata.primary.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                        )}>
                          {Math.round(currentLiveFullReferenceMetadata.primary.score)} · {currentLiveFullReferenceMetadata.mode}
                        </span>
                      </div>
                      <p className="mt-1 truncate">
                        {currentLiveFullReferenceMetadata.primary.eligible
                          ? 'Passed strict duration, sentence, cleanliness, loudness, and steady-tone checks.'
                          : currentLiveFullReferenceMetadata.primary.reasons.join(' ')}
                      </p>
                    </div>
                  )}
                </div>

                <div className="hidden">
                  {liveFullPreviewReference.url && (
                    <p className="mb-1 truncate text-[11px] text-slate-400">
                      Previewing {liveFullPreviewReference.role}: {liveFullPreviewReference.filename}
                    </p>
                  )}
                  <audio ref={liveFullPreviewAudioRef} className="w-full" controls preload="metadata"
                    onError={() => { if (liveFullPreviewReference.filename) setLiveFullMessage(`Could not play ${liveFullPreviewReference.filename}.`); }}
                    onPlay={() => setLiveFullMessage('')}
                  />
                </div>

                <div className="hidden">
                  <div>
                    <Label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Primary transcript</Label>
                    <Textarea
                      className="min-h-[82px] rounded-xl border-slate-200 bg-white shadow-none leading-6"
                      value={liveFullPromptText}
                      onChange={(event) => setLiveFullPromptText(event.target.value)}
                      disabled={streamingRoute !== null}
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Ref language</Label>
                    <Select value={liveFullPromptLang} onValueChange={setLiveFullPromptLang} disabled={streamingRoute !== null}>
                      <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white shadow-none"><SelectValue /></SelectTrigger>
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

                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    { label: 'Speed', display: liveFullSpeed.toFixed(1) + 'x', min: 0.5, max: 2.0, step: 0.1, val: liveFullSpeed, set: setLiveFullSpeed },
                    { label: 'Top K', display: String(liveFullTopK), min: 1, max: 50, step: 1, val: liveFullTopK, set: setLiveFullTopK },
                    { label: 'Top P', display: liveFullTopP.toFixed(2), min: 0, max: 1, step: 0.05, val: liveFullTopP, set: setLiveFullTopP },
                    { label: 'Temperature', display: liveFullTemperature.toFixed(2), min: 0, max: 1, step: 0.05, val: liveFullTemperature, set: setLiveFullTemperature },
                  ].map(({ label, display, min, max, step, val, set }) => (
                    <div key={label} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</Label>
                        <span className="font-mono text-sm font-semibold text-slate-700">{display}</span>
                      </div>
                      <Slider min={min} max={max} step={step} value={[val]} onValueChange={([v]) => set(v)} disabled={streamingRoute !== null} />
                    </div>
                  ))}
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 md:col-span-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Repetition Penalty</Label>
                      <span className="font-mono text-sm font-semibold text-slate-700">{liveFullRepPenalty.toFixed(2)}</span>
                    </div>
                    <Slider min={1.0} max={2.0} step={0.05} value={[liveFullRepPenalty]} onValueChange={([v]) => setLiveFullRepPenalty(v)} disabled={streamingRoute !== null} />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-500">
                  <p className="font-semibold text-slate-700">Current Live Full config</p>
                  <p className="mt-1 truncate">
                    Refs from Live Fast #1: {liveFastRankOneReferenceSummary.primaryName} - speed {liveFullSettings.speed.toFixed(1)} - temp {liveFullSettings.temperature.toFixed(2)}
                  </p>
                  <p className="mt-1 truncate">
                    top k {liveFullSettings.topK} · top p {liveFullSettings.topP.toFixed(2)} · rep {liveFullSettings.repPenalty.toFixed(2)}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-100 bg-white p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-700">Saved Live Full configs</p>
                    <button
                      type="button"
                      onClick={() => loadVoiceConfigs(selectedVoiceProfileId)}
                      disabled={loadingVoiceConfigs || !selectedVoiceProfileId}
                      className="text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40"
                    >
                      {loadingVoiceConfigs ? 'Loading...' : 'Refresh'}
                    </button>
                  </div>
                  {liveFullConfigs.length === 0 ? (
                    <p className="rounded-lg border border-amber-100 bg-amber-50 px-2 py-2 text-xs text-amber-700">
                      No saved Live Full configs yet. A default metadata preset will be saved after Live Fast rank #1 exists.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {liveFullConfigs.map((config, index) => {
                        const defaults = config.inferenceMetadata?.defaults || {};
                        const busy = savingLiveFullConfigId === config.configId
                          || generatingLiveFullSampleConfigId === config.configId;
                        const loaded = loadedLiveFullConfigId === config.configId;
                        return (
                          <div key={config.configId} className={cn('rounded-lg border bg-white p-2', loaded ? 'border-blue-200 ring-1 ring-blue-100' : 'border-slate-200')}>
                            <div className="space-y-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold text-slate-800" title={config.configName || config.configId}>
                                  #{index + 1} {config.configName || config.configId}
                                  {loaded && <span className="ml-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">loaded</span>}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] text-slate-500" title={liveFastRankOneReferenceSummary.primaryName}>
                                  Refs from Live Fast #1: {liveFastRankOneReferenceSummary.primaryName}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                  speed {defaults.speed_factor ?? 'n/a'} · top k {defaults.top_k ?? 'n/a'} · temp {defaults.temperature ?? 'n/a'}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                <button type="button" onClick={() => moveLiveFullConfig(config.configId, -1)} disabled={busy || index === 0} title="Move up" className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">Up</button>
                                <button type="button" onClick={() => moveLiveFullConfig(config.configId, 1)} disabled={busy || index === liveFullConfigs.length - 1} title="Move down" className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">Down</button>
                                <button type="button" onClick={() => loadSavedLiveFullConfig(config)} disabled={busy || streamingRoute !== null} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">Load</button>
                                <button type="button" onClick={() => saveCurrentLiveFullConfig(config)} disabled={busy || !loaded} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">Update</button>
                                <button type="button" onClick={() => generateLiveFullConfigSample(config)} disabled={busy || streamingRoute !== null} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                                  {generatingLiveFullSampleConfigId === config.configId ? 'Generating' : 'Sample'}
                                </button>
                                <button type="button" onClick={() => deleteSavedLiveFullConfig(config.configId)} disabled={busy} className="rounded-md border border-red-100 bg-white px-2 py-1 text-[11px] text-red-500 hover:bg-red-50 disabled:opacity-40">Delete</button>
                              </div>
                            </div>
                            {config.sample?.generatedAt && (
                              <p className="mt-2 text-[11px] text-slate-400">
                                Sample metadata saved {new Date(config.sample.generatedAt).toLocaleString()}.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {liveFullMessage && <p className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-500">{liveFullMessage}</p>}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <audio ref={audioRef} className="hidden" onEnded={liveSpeech.onAudioEnded} />
    </div>
  );
}
