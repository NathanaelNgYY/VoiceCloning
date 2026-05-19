import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getInferenceStatus,
  getModels,
  getTrainingAudioUrl,
  getTrainingAudioFiles,
  activateVoiceProfile,
  getActiveVoiceProfile,
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
import { chooseBestReferenceSet } from '@/lib/referenceSelection';
import { buildVoiceProfiles } from '@/lib/voiceProfiles';
import { findActiveWordIndex } from '@/lib/wordTimestamps';
import {
  DEFAULT_LIVE_FAST_SETTINGS,
  buildLiveFastReferencePreviewItems,
  buildLiveFastRefParams,
} from '@/lib/liveFastSetup';
import { shouldLoadSelectedProfile } from '@/lib/modelLoading';
import { formatActiveVoiceProfileSummary } from '@/lib/activeVoiceProfile';
import { getStorageMode } from '@/lib/runtimeConfig';
import { buildVoiceProfilePayload } from '@/lib/voiceProfilePayload';
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

function ChatBubble({ message, selected, selectedPart, onPlay, audioRef }) {
  const isUser = message.role === 'user';
  const readyParts = (message.audioParts || []).filter((part) => part.audioUrl);
  const hasVoice = !isUser && (Boolean(message.audioUrl) || readyParts.length > 0);
  const isBusy = ['thinking', 'generating_voice', 'transcribing', 'listening'].includes(message.status);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const wordTimestamps = !isUser ? (selectedPart?.wordTimestamps || message.wordTimestamps || null) : null;

  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio || !selected || !Array.isArray(wordTimestamps) || wordTimestamps.length === 0) {
      setActiveWordIndex(-1);
      return undefined;
    }

    const handleTimeUpdate = () => {
      setActiveWordIndex(findActiveWordIndex(wordTimestamps, audio.currentTime));
    };
    const handleReset = () => setActiveWordIndex(-1);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleReset);
    audio.addEventListener('pause', handleReset);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleReset);
      audio.removeEventListener('pause', handleReset);
    };
  }, [audioRef, selected, wordTimestamps]);

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

        {!isUser && Array.isArray(wordTimestamps) && wordTimestamps.length > 0 && (
          <div className="mt-2 rounded-xl bg-slate-100/80 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-end gap-x-1 gap-y-2">
              {wordTimestamps.map((item, index) => (
                <div key={`${item.word}-${item.start}-${index}`} className="inline-flex flex-col items-center gap-0.5">
                  <span className={cn('font-mono text-[9px]', index === activeWordIndex ? 'text-amber-600' : 'text-slate-400')}>
                    {(typeof item.start === 'number' && isFinite(item.start) ? item.start : 0).toFixed(2)}
                  </span>
                  <span className={index === activeWordIndex ? 'rounded-sm bg-yellow-200 px-0.5 text-slate-950' : undefined}>
                    {item.word}
                  </span>
                </div>
              ))}
            </div>
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

  const [trainingAudioFiles, setTrainingAudioFiles] = useState([]);
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
  const loadedProfile = availableProfiles.find((p) =>
    p.gptModel?.path === loadedGPTPath && p.sovitsModel?.path === loadedSoVITSPath
  ) || null;

  const liveLanguage = normalizeLiveLanguage(selectedLanguage);
  const liveLanguageConfig = getLiveLanguageConfig(liveLanguage);
  const liveRefParams = useMemo(() => buildLiveFastRefParams({
    primaryPath: refAudioPath, promptText, promptLang, auxRefAudios,
    settings: { speed, topK, topP, temperature, repPenalty },
  }), [refAudioPath, promptText, promptLang, auxRefAudios, speed, topK, topP, temperature, repPenalty]);
  const selectedReferenceItems = useMemo(() => buildLiveFastReferencePreviewItems({
    primaryPath: refAudioPath, promptText, trainingAudioFiles, auxRefAudios,
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

  async function loadActiveVoiceProfile() {
    setLoadingActiveVoiceProfile(true);
    try {
      const res = await getActiveVoiceProfile();
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

  function applyBestReference(files = trainingAudioFiles) {
    const selection = chooseBestReferenceSet(files);
    if (!selection.primary) {
      setRefAudioPath(''); setPromptText(''); setPromptLang('en'); setAuxRefAudios([]);
      setReferenceMessage(selection.reason); return;
    }
    setRefAudioPath(selection.primary.path);
    setPromptText(selection.primary.transcript || '');
    setPromptLang(normalizeReferenceLanguage(selection.primary.lang));
    setAuxRefAudios(selection.aux);
    setReferenceMessage(`${selection.primary.filename} selected with ${selection.aux.length} auxiliary clip${selection.aux.length === 1 ? '' : 's'}.`);
  }

  async function loadSelectedModel() {
    if (!selectedProfile || isConversationActive) return;
    setLoadingModel(true); setModelError('');
    try {
      await selectModels(selectedGPT, selectedSoVITS);
      setLoadedGPTPath(selectedGPT); setLoadedSoVITSPath(selectedSoVITS); setServerReady(true);
      setReferenceMessage('Voice model loaded.');
    } catch (err) {
      setModelError(err.response?.data?.error || err.message || 'Could not load this voice model.');
    } finally {
      setLoadingModel(false);
    }
  }

  async function saveSelectedVoiceProfile() {
    if (!selectedProfile || !selectedGPT || !selectedSoVITS || !liveRefParams) return;

    setSavingProfile(true);
    setModelError('');

    try {
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
        storageMode,
      });

      const response = await activateVoiceProfile(payload);
      const summary = response.data || {};
      setActiveVoiceProfile(summary.voiceProfileId ? summary : null);
      setActiveVoiceProfileError('');
      setLoadingActiveVoiceProfile(false);
      setReferenceMessage(
        `Saved voice profile ${summary.displayName || selectedProfile.displayName} (${summary.voiceProfileId || payload.voiceProfileId}).`,
      );
    } catch (err) {
      setModelError(err.response?.data?.error || err.message || 'Could not save this voice profile.');
    } finally {
      setSavingProfile(false);
    }
  }

  function handlePrimaryReferenceChange(path) {
    const file = trainingAudioFiles.find((item) => item.path === path);
    if (!file) return;
    setRefAudioPath(file.path); setPromptText(file.transcript || '');
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
    if (audio && audio.getAttribute('src') !== previewReference.url) { audio.src = previewReference.url; audio.load(); }
  }, [previewReference.url]);

  useEffect(() => {
    if (trainingAudioFiles.length > 0) return;
    const audio = referencePreviewAudioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    setPreviewReference({ path: '', url: null, filename: '', role: '' });
    setReferenceAudioUrls({}); setLoadingPreviewPath('');
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
    fetchModels(); checkStatus(); loadActiveVoiceProfile();
  }, []);

  useEffect(() => {
    if (!modelsFetched || availableProfiles.length === 0) return;
    if (urlVoiceKeyRef.current) {
      const match = availableProfiles.find((p) => p.key === urlVoiceKeyRef.current);
      if (match) { urlVoiceKeyRef.current = ''; setSelectedPersonKey(match.key); autoLoadAttemptKeyRef.current = ''; return; }
    }
    if (availableProfiles.some((p) => p.key === selectedPersonKey)) return;
    setSelectedPersonKey(availableProfiles[0].key);
  }, [modelsFetched, availableProfiles, selectedPersonKey, loadedGPTPath, loadedSoVITSPath]);

  useEffect(() => {
    if (!shouldLoadSelectedProfile({ serverReady, selectedProfile, loadedGPTPath, loadedSoVITSPath, isConversationActive, loadingModel })) return;
    const loadKey = `${selectedProfile.gptModel.path}::${selectedProfile.sovitsModel.path}`;
    if (autoLoadAttemptKeyRef.current === loadKey) return;
    autoLoadAttemptKeyRef.current = loadKey;
    loadSelectedModel();
  }, [serverReady, selectedProfile, loadedGPTPath, loadedSoVITSPath, isConversationActive, loadingModel]);

  useEffect(() => {
    if (!selectedExpName) { setTrainingAudioFiles([]); return; }
    let ignore = false;
    setLoadingTrainingAudio(true);
    getTrainingAudioFiles(selectedExpName)
      .then((res) => { if (!ignore) setTrainingAudioFiles(res.data.files || []); })
      .catch(() => { if (!ignore) { setTrainingAudioFiles([]); setReferenceMessage('Could not load reference clips.'); } })
      .finally(() => { if (!ignore) setLoadingTrainingAudio(false); });
    return () => { ignore = true; };
  }, [selectedExpName]);

  useEffect(() => {
    if (!selectedExpName || loadingTrainingAudio || trainingAudioFiles.length === 0) return;
    if (autoReferenceKeyRef.current === selectedExpName) return;
    autoReferenceKeyRef.current = selectedExpName;
    applyBestReference(trainingAudioFiles);
  }, [selectedExpName, loadingTrainingAudio, trainingAudioFiles]);

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
            Live Voice Chat
          </span>
        </h1>

        <div className="flex flex-1 flex-wrap items-center gap-3">
          {/* Voice model selector */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Voice</span>
            <Select
              value={selectedPersonKey}
              onValueChange={(v) => { setSelectedPersonKey(v); setModelError(''); autoReferenceKeyRef.current = ''; autoLoadAttemptKeyRef.current = ''; }}
              disabled={isConversationActive || availableProfiles.length === 0}
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

      {!liveSpeech.speechApiAvailable && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-600">
          This browser does not support live audio processing.
        </div>
      )}

      {/* ── Chat card — fills remaining height ── */}
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
                      {trainingAudioFiles.map((f) => <SelectItem key={f.path} value={f.path}>{f.filename}</SelectItem>)}
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
                            <span className="block truncate font-mono text-xs text-slate-700">{f.filename}</span>
                            {f.transcript && <span className="mt-0.5 block truncate text-xs text-slate-400">{f.transcript}</span>}
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
        </CollapsibleContent>
      </Collapsible>

      <audio ref={audioRef} className="hidden" onEnded={liveSpeech.onAudioEnded} />
    </div>
  );
}
