import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getInferenceStatus,
  getModels,
  getTrainingAudioFiles,
  selectModels,
} from '../services/api.js';
import { useLiveSpeech } from '../hooks/useLiveSpeech.js';
import {
  LIVE_LANGUAGE_OPTIONS,
  getLiveLanguageConfig,
  normalizeLiveLanguage,
} from '../hooks/liveConversation.js';
import { Badge } from '@/components/ui/badge';
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
import {
  DEFAULT_LIVE_FAST_SETTINGS,
  buildLiveFastRefParams,
} from '@/lib/liveFastSetup';
import {
  Activity,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  Loader2,
  Mic,
  MicOff,
  PlayCircle,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Square,
  UserRound,
  Volume2,
  VolumeX,
} from 'lucide-react';

function messageStatusText(message) {
  if (message.role === 'user') {
    return {
      listening: 'Listening',
      transcribing: 'Transcribing',
      done: 'Sent',
    }[message.status] || 'Sent';
  }

  return {
    thinking: 'Writing',
    generating_voice: 'Generating cloned voice',
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
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
          <Bot size={16} />
        </div>
      )}

      <div
        className={cn(
          'max-w-[82%] rounded-2xl px-4 py-3 shadow-sm',
          isUser
            ? 'rounded-br-md bg-slate-900 text-white'
            : 'rounded-bl-md border border-slate-200 bg-white text-slate-900'
        )}
      >
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide opacity-70">
          {isBusy && <Loader2 size={12} className="animate-spin" />}
          {messageStatusText(message)}
        </div>

        <p className={cn('whitespace-pre-wrap text-sm leading-6', isBusy && !message.text && 'italic opacity-70')}>
          {message.text || (isUser ? 'Listening...' : 'Thinking...')}
        </p>

        {message.error && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
            <CircleAlert size={13} />
            {message.error}
          </p>
        )}

        {!isUser && message.audioParts?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.audioParts.map((part) => (
              <span
                key={part.id}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] capitalize',
                  part.status === 'ready' || part.status === 'played'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : part.status === 'generating'
                      ? 'border-sky-200 bg-sky-50 text-sky-700'
                      : part.status === 'error'
                        ? 'border-destructive/20 bg-destructive/5 text-destructive'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                )}
              >
                {part.index}: {part.status}
              </span>
            ))}
          </div>
        )}

        {hasVoice && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={selected ? 'default' : 'outline'}
              className="h-8 rounded-xl"
              onClick={() => onPlay(message.id)}
            >
              {selected ? <Volume2 size={14} /> : <PlayCircle size={14} />}
              {selected ? 'Playing' : 'Play voice'}
            </Button>
            {message.audioUrl && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-xl bg-white"
                asChild
              >
                <a href={message.audioUrl} download={`live_reply_${message.id}.wav`}>
                  <Download size={14} />
                  WAV
                </a>
              </Button>
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
          <UserRound size={16} />
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
  const [savingModel, setSavingModel] = useState(false);
  const [pendingAutoLoad, setPendingAutoLoad] = useState(false);

  const [trainingAudioFiles, setTrainingAudioFiles] = useState([]);
  const [loadingTrainingAudio, setLoadingTrainingAudio] = useState(false);
  const [refAudioPath, setRefAudioPath] = useState('');
  const [promptText, setPromptText] = useState('');
  const [promptLang, setPromptLang] = useState('en');
  const [auxRefAudios, setAuxRefAudios] = useState([]);
  const [referenceMessage, setReferenceMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const [speed, setSpeed] = useState(DEFAULT_LIVE_FAST_SETTINGS.speed);
  const [topK, setTopK] = useState(DEFAULT_LIVE_FAST_SETTINGS.topK);
  const [topP, setTopP] = useState(DEFAULT_LIVE_FAST_SETTINGS.topP);
  const [temperature, setTemperature] = useState(DEFAULT_LIVE_FAST_SETTINGS.temperature);
  const [repPenalty, setRepPenalty] = useState(DEFAULT_LIVE_FAST_SETTINGS.repPenalty);

  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const audioRef = useRef(null);
  const messagesEndRef = useRef(null);
  const autoReferenceKeyRef = useRef('');
  const urlVoiceKeyRef = useRef('');

  const voiceProfiles = useMemo(() => buildVoiceProfiles(gptModels, sovitsModels), [gptModels, sovitsModels]);
  const availableProfiles = useMemo(() => voiceProfiles.filter((profile) => profile.complete), [voiceProfiles]);
  const selectedProfile = availableProfiles.find((profile) => profile.key === selectedPersonKey) || null;
  const selectedGPT = selectedProfile?.gptModel?.path || '';
  const selectedSoVITS = selectedProfile?.sovitsModel?.path || '';
  const selectedExpName = selectedProfile?.expName || '';
  const loadedProfile = availableProfiles.find((profile) =>
    profile.gptModel?.path === loadedGPTPath && profile.sovitsModel?.path === loadedSoVITSPath
  ) || null;

  const liveLanguage = normalizeLiveLanguage(selectedLanguage);
  const liveLanguageConfig = getLiveLanguageConfig(liveLanguage);
  const liveRefParams = useMemo(() => buildLiveFastRefParams({
    primaryPath: refAudioPath,
    promptText,
    promptLang,
    auxRefAudios,
    settings: {
      speed,
      topK,
      topP,
      temperature,
      repPenalty,
    },
  }), [refAudioPath, promptText, promptLang, auxRefAudios, speed, topK, topP, temperature, repPenalty]);

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
      setModelError(err.response?.data?.error || err.message || 'Failed to load trained models.');
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

  function applyBestReference(files = trainingAudioFiles) {
    const selection = chooseBestReferenceSet(files);
    if (!selection.primary) {
      setRefAudioPath('');
      setPromptText('');
      setPromptLang('en');
      setAuxRefAudios([]);
      setReferenceMessage(selection.reason);
      return;
    }

    setRefAudioPath(selection.primary.path);
    setPromptText(selection.primary.transcript || '');
    setPromptLang(normalizeReferenceLanguage(selection.primary.lang));
    setAuxRefAudios(selection.aux);
    setReferenceMessage(`${selection.primary.filename} selected with ${selection.aux.length} auxiliary clip${selection.aux.length === 1 ? '' : 's'}.`);
  }

  async function handleSaveModel() {
    if (!selectedProfile || isConversationActive) return;
    setSavingModel(true);
    setModelError('');
    try {
      await selectModels(selectedGPT, selectedSoVITS);
      setLoadedGPTPath(selectedGPT);
      setLoadedSoVITSPath(selectedSoVITS);
      setServerReady(true);
      setReferenceMessage('Voice model saved. Reference clips are selected from this trained model.');
    } catch (err) {
      setModelError(err.response?.data?.error || err.message || 'Could not save this voice model.');
    } finally {
      setSavingModel(false);
    }
  }

  function handlePrimaryReferenceChange(path) {
    const file = trainingAudioFiles.find((item) => item.path === path);
    if (!file) return;
    setRefAudioPath(file.path);
    setPromptText(file.transcript || '');
    setPromptLang(normalizeReferenceLanguage(file.lang));
    setAuxRefAudios((current) => current.filter((item) => item.path !== file.path).slice(0, 5));
    setReferenceMessage(`${file.filename} is now the primary reference.`);
  }

  function handleAuxToggle(file, checked) {
    if (!file?.path || file.path === refAudioPath) return;
    setAuxRefAudios((current) => {
      const withoutFile = current.filter((item) => item.path !== file.path);
      if (!checked) return withoutFile;
      return [...withoutFile, file].slice(0, 5);
    });
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const voiceParam = params.get('voice');
    if (voiceParam) {
      urlVoiceKeyRef.current = voiceParam.toLowerCase().replace(/[\s_-]+/g, '');
    }
    fetchModels();
    checkStatus();
  }, []);

  useEffect(() => {
    if (!modelsFetched || availableProfiles.length === 0) {
      return;
    }

    if (urlVoiceKeyRef.current) {
      const targetKey = urlVoiceKeyRef.current;
      const match = availableProfiles.find((profile) => profile.key === targetKey);
      if (match) {
        urlVoiceKeyRef.current = '';
        setSelectedPersonKey(match.key);
        setPendingAutoLoad(true);
        return;
      }
    }

    const currentStillExists = availableProfiles.some((profile) => profile.key === selectedPersonKey);
    if (currentStillExists) return;

    const loadedMatch = availableProfiles.find((profile) =>
      profile.gptModel?.path === loadedGPTPath && profile.sovitsModel?.path === loadedSoVITSPath
    );
    setSelectedPersonKey((loadedMatch || availableProfiles[0]).key);
  }, [modelsFetched, availableProfiles, selectedPersonKey, loadedGPTPath, loadedSoVITSPath]);

  useEffect(() => {
    if (!pendingAutoLoad || !serverReady || !selectedProfile?.complete || isConversationActive || savingModel) return;
    const gptPath = selectedProfile.gptModel?.path;
    const sovitsPath = selectedProfile.sovitsModel?.path;
    if (!gptPath || !sovitsPath) return;
    if (loadedGPTPath === gptPath && loadedSoVITSPath === sovitsPath) {
      setPendingAutoLoad(false);
      return;
    }
    setPendingAutoLoad(false);
    setSavingModel(true);
    setModelError('');
    selectModels(gptPath, sovitsPath)
      .then(() => {
        setLoadedGPTPath(gptPath);
        setLoadedSoVITSPath(sovitsPath);
        setServerReady(true);
        setReferenceMessage('Voice model loaded. Ready to start a conversation.');
      })
      .catch((err) => {
        setModelError(err.response?.data?.error || err.message || 'Could not auto-load this voice model.');
      })
      .finally(() => {
        setSavingModel(false);
      });
  }, [pendingAutoLoad, serverReady, selectedProfile, loadedGPTPath, loadedSoVITSPath, isConversationActive, savingModel]);

  useEffect(() => {
    if (!selectedExpName) {
      setTrainingAudioFiles([]);
      return;
    }

    let ignore = false;
    setLoadingTrainingAudio(true);
    getTrainingAudioFiles(selectedExpName)
      .then((res) => {
        if (!ignore) {
          setTrainingAudioFiles(res.data.files || []);
        }
      })
      .catch(() => {
        if (!ignore) {
          setTrainingAudioFiles([]);
          setReferenceMessage('Could not load reference clips for this trained model.');
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoadingTrainingAudio(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [selectedExpName]);

  useEffect(() => {
    if (!selectedExpName || loadingTrainingAudio || trainingAudioFiles.length === 0) return;
    if (autoReferenceKeyRef.current === selectedExpName) return;
    autoReferenceKeyRef.current = selectedExpName;
    applyBestReference(trainingAudioFiles);
  }, [selectedExpName, loadingTrainingAudio, trainingAudioFiles]);

  useEffect(() => {
    function handleGpuReady() {
      fetchModels();
      checkStatus();
    }

    window.addEventListener('voice-cloning-gpu-ready', handleGpuReady);
    return () => window.removeEventListener('voice-cloning-gpu-ready', handleGpuReady);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [liveSpeech.messages.length, liveSpeech.interimTranscript, liveSpeech.phase]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!playbackReady) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }

    if (audio.getAttribute('src') !== liveSpeech.audioSrc) {
      audio.src = liveSpeech.audioSrc;
      audio.load();
    }
    audio.play().catch(() => {});
  }, [liveSpeech.audioSrc, liveSpeech.selectedReplyId, playbackReady]);

  const isReady = serverReady && Boolean(liveRefParams);
  const selectedModelSaved = Boolean(serverReady && selectedGPT && selectedSoVITS && selectedGPT === loadedGPTPath && selectedSoVITS === loadedSoVITSPath);
  const isListening = liveSpeech.isMicInputEnabled
    && (liveSpeech.phase === 'listening' || liveSpeech.phase === 'thinking');
  const canBargeIn = liveSpeech.isMicInputEnabled || liveSpeech.isBargeInArmed;
  const meterActive = (liveSpeech.isMicInputEnabled
    && (liveSpeech.phase === 'listening' || liveSpeech.phase === 'thinking'))
    || (canBargeIn && liveSpeech.phase === 'speaking');
  const buttonDisabled =
    !isReady || liveSpeech.phase === 'connecting' || liveSpeech.phase === 'stopping';
  const phaseLabel =
    {
      idle: 'Start',
      connecting: 'Connecting',
      listening: liveSpeech.isMicInputEnabled ? 'Mic on' : 'Mic off',
      thinking: liveSpeech.isMicInputEnabled ? 'Mic on' : 'Mic off',
      speaking: liveSpeech.isMicInputEnabled ? 'Mic on' : 'Mic off',
      stopping: 'Stopping',
    }[liveSpeech.phase] || 'Start';
  const statusText =
    liveSpeech.notice ||
    (!liveSpeech.isMicInputEnabled && isConversationActive && liveSpeech.phase !== 'speaking'
      ? 'Mic off. Voice chat is still open.'
      : '') ||
    {
      idle: `Ready for a ${liveLanguageConfig.label} Live Fast chat.`,
      connecting: 'Connecting to the live assistant...',
      listening: liveSpeech.isMicInputEnabled ? 'Listening...' : 'Mic off. Voice chat is still open.',
      thinking: 'Thinking...',
      speaking: liveSpeech.audioSrc
        ? canBargeIn
          ? 'Playing cloned voice reply. Speak to interrupt.'
          : 'Playing cloned voice reply...'
        : 'Preparing cloned voice phrase...',
      stopping: 'Stopping conversation...',
    }[liveSpeech.phase] ||
    `Ready for a ${liveLanguageConfig.label} Live Fast chat.`;

  return (
    <div className="animate-fade-in space-y-6">
      {!isReady && (
        <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          {availableProfiles.length === 0
            ? 'No complete trained models were found yet. Train a voice first, then return to Live Fast.'
            : !selectedModelSaved
              ? 'Choose a trained model and click Save voice before starting Live Fast.'
              : 'Reference clips are still loading. The best trained clip will be selected automatically.'}
        </div>
      )}

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="flex min-h-[640px] flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                <Bot size={18} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-950">Live Fast Voice Chat</h2>
                <p className="text-xs text-muted-foreground">
                  {liveLanguageConfig.replyLabel}, phrase-by-phrase cloned voice
                </p>
              </div>
            </div>
            <Badge className="border border-slate-200 bg-slate-50 text-slate-700 shadow-none">
              {statusText}
            </Badge>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-5 sm:px-6">
            {liveSpeech.messages.length === 0 ? (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-sky-700 shadow-sm">
                  <Mic size={24} />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">Start speaking when ready.</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  The assistant listens, replies in {liveLanguageConfig.label}, then plays cloned voice phrases as they become ready.
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
            <div className="border-t border-destructive/20 bg-destructive/5 px-5 py-3 text-sm text-destructive">
              {liveSpeech.error}
            </div>
          )}

          <div className="border-t border-slate-200 bg-white px-5 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-950">{statusText}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {canBargeIn && liveSpeech.phase === 'speaking'
                    ? 'Speak over playback to stop it and start your next turn.'
                    : liveSpeech.isMicInputEnabled
                      ? 'Mic input is available when the assistant is listening.'
                      : 'Mic input is off; voice playback can continue.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {playbackReady && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-xl border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                    onClick={liveSpeech.interruptPlayback}
                  >
                    <VolumeX size={14} />
                    Stop voice
                  </Button>
                )}
                {isConversationActive && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-xl border-slate-200 bg-white text-slate-600"
                    onClick={liveSpeech.stop}
                  >
                    <Square size={13} />
                    End
                  </Button>
                )}
                <MicLevelMeter level={liveSpeech.audioLevel} active={meterActive} />
                <button
                  type="button"
                  className={cn(
                    'flex h-16 w-16 shrink-0 select-none items-center justify-center rounded-full border-4 text-xs font-semibold transition-all',
                    buttonDisabled
                      ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                      : isConversationActive && !liveSpeech.isMicInputEnabled
                        ? 'cursor-pointer border-slate-300 bg-slate-50 text-slate-500 shadow-[0_0_0_8px_rgba(100,116,139,0.12)] active:scale-95'
                        : isListening
                          ? 'border-red-400 bg-red-50 text-red-600 shadow-[0_0_0_8px_rgba(239,68,68,0.15)]'
                          : isConversationActive
                            ? 'cursor-pointer border-slate-300 bg-white text-slate-700 shadow-[0_0_0_8px_rgba(100,116,139,0.12)] active:scale-95'
                            : 'cursor-pointer border-sky-300 bg-sky-50 text-sky-700 shadow-[0_18px_50px_-20px_rgba(14,165,233,0.5)] hover:shadow-[0_18px_50px_-20px_rgba(14,165,233,0.7)] active:scale-95'
                  )}
                  onClick={liveSpeech.toggle}
                  disabled={buttonDisabled}
                  aria-pressed={liveSpeech.isMicInputEnabled}
                  title={phaseLabel}
                >
                  <span className="sr-only">{phaseLabel}</span>
                  {liveSpeech.isMicInputEnabled || liveSpeech.phase === 'idle'
                    ? <Mic size={24} />
                    : <MicOff size={24} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Activity size={16} className="text-sky-600" />
              <h3 className="text-sm font-semibold text-slate-950">Voice model</h3>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trained model</Label>
                <Select
                  value={selectedPersonKey}
                  onValueChange={(value) => {
                    setSelectedPersonKey(value);
                    autoReferenceKeyRef.current = '';
                  }}
                  disabled={isConversationActive || availableProfiles.length === 0}
                >
                  <SelectTrigger className="mt-2 h-11 rounded-xl border-slate-200 bg-slate-50">
                    <SelectValue placeholder={modelsFetched ? 'Select a model' : 'Loading models...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableProfiles.map((profile) => (
                      <SelectItem key={profile.key} value={profile.key}>
                        {profile.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="button"
                className="w-full rounded-xl"
                onClick={handleSaveModel}
                disabled={!selectedProfile || savingModel || isConversationActive || selectedModelSaved}
              >
                {savingModel ? <Loader2 size={14} className="animate-spin" /> : selectedModelSaved ? <Check size={14} /> : <Save size={14} />}
                {selectedModelSaved ? 'Voice saved' : savingModel ? 'Saving...' : 'Save voice'}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full rounded-xl border-slate-200"
                onClick={() => {
                  fetchModels();
                  checkStatus();
                }}
                disabled={isConversationActive}
              >
                <RefreshCw size={14} />
                Refresh models
              </Button>

              {modelError && (
                <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {modelError}
                </p>
              )}

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                Loaded: {loadedProfile?.displayName || (serverReady ? 'Existing model' : 'No model loaded')}
              </div>
            </div>
          </div>

          <div className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chat language</Label>
            <Select
              value={liveLanguage}
              onValueChange={setSelectedLanguage}
              disabled={isConversationActive}
            >
              <SelectTrigger className="mt-2 h-11 rounded-xl border-slate-200 bg-slate-50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIVE_LANGUAGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!liveSpeech.speechApiAvailable && (
            <div className="rounded-[20px] border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
              This browser does not support live audio processing.
            </div>
          )}
        </aside>
      </section>

      <Collapsible open={showSettings} onOpenChange={setShowSettings}>
        <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={17} className="text-sky-600" />
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Additional settings</h3>
                <p className="text-xs text-muted-foreground">
                  Reference and inference controls for Live Fast.
                </p>
              </div>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 rounded-xl border-slate-200 text-muted-foreground">
                <ChevronRight
                  size={14}
                  className={cn('transition-transform', showSettings && 'rotate-90')}
                />
                {showSettings ? 'Hide' : 'Open'}
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent>
            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-4 rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Reference from trained clips</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      The best primary and up to five auxiliary clips are selected automatically.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl border-slate-200 bg-white"
                    onClick={() => applyBestReference()}
                    disabled={loadingTrainingAudio || trainingAudioFiles.length === 0 || isConversationActive}
                  >
                    <Check size={14} />
                    Use best
                  </Button>
                </div>

                <div>
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Primary reference</Label>
                  <Select
                    value={refAudioPath}
                    onValueChange={handlePrimaryReferenceChange}
                    disabled={loadingTrainingAudio || trainingAudioFiles.length === 0 || isConversationActive}
                  >
                    <SelectTrigger className="mt-2 h-11 rounded-xl border-slate-200 bg-white">
                      <SelectValue placeholder={loadingTrainingAudio ? 'Loading reference clips...' : 'Select primary reference'} />
                    </SelectTrigger>
                    <SelectContent>
                      {trainingAudioFiles.map((file) => (
                        <SelectItem key={file.path} value={file.path}>
                          {file.filename}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Auxiliary references</Label>
                  <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3">
                    {trainingAudioFiles.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {loadingTrainingAudio ? 'Loading trained clips...' : 'No trained clips found for this model yet.'}
                      </p>
                    ) : (
                      trainingAudioFiles
                        .filter((file) => file.path !== refAudioPath)
                        .map((file) => {
                          const checked = auxRefAudios.some((item) => item.path === file.path);
                          return (
                            <label key={file.path} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(value) => handleAuxToggle(file, Boolean(value))}
                                disabled={isConversationActive || (!checked && auxRefAudios.length >= 5)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-mono text-xs">{file.filename}</span>
                                {file.transcript && (
                                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{file.transcript}</span>
                                )}
                              </span>
                            </label>
                          );
                        })
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Selected {auxRefAudios.length}/5 auxiliary clips. Primary: {refAudioPath ? fallbackName(refAudioPath) : 'none'}.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                  <div>
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Primary transcript</Label>
                    <Textarea
                      className="mt-2 min-h-[110px] rounded-xl border-slate-200 bg-white leading-6"
                      value={promptText}
                      onChange={(event) => setPromptText(event.target.value)}
                      disabled={isConversationActive}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reference language</Label>
                    <Select value={promptLang} onValueChange={setPromptLang} disabled={isConversationActive}>
                      <SelectTrigger className="mt-2 h-11 rounded-xl border-slate-200 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="zh">Chinese</SelectItem>
                        <SelectItem value="ja">Japanese</SelectItem>
                        <SelectItem value="ko">Korean</SelectItem>
                        <SelectItem value="auto">Auto Detect</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {referenceMessage && (
                  <p className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                    {referenceMessage}
                  </p>
                )}
              </div>

              <div className="space-y-4 rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-950">Inference controls</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Speed</Label>
                      <span className="font-mono text-sm font-semibold">{speed.toFixed(1)}x</span>
                    </div>
                    <Slider min={0.5} max={2.0} step={0.1} value={[speed]} onValueChange={([value]) => setSpeed(value)} disabled={isConversationActive} />
                  </div>

                  <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Top K</Label>
                      <span className="font-mono text-sm font-semibold">{topK}</span>
                    </div>
                    <Slider min={1} max={50} step={1} value={[topK]} onValueChange={([value]) => setTopK(value)} disabled={isConversationActive} />
                  </div>

                  <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Top P</Label>
                      <span className="font-mono text-sm font-semibold">{topP.toFixed(2)}</span>
                    </div>
                    <Slider min={0} max={1} step={0.05} value={[topP]} onValueChange={([value]) => setTopP(value)} disabled={isConversationActive} />
                  </div>

                  <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Temperature</Label>
                      <span className="font-mono text-sm font-semibold">{temperature.toFixed(2)}</span>
                    </div>
                    <Slider min={0} max={1} step={0.05} value={[temperature]} onValueChange={([value]) => setTemperature(value)} disabled={isConversationActive} />
                  </div>

                  <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 md:col-span-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Repetition Penalty</Label>
                      <span className="font-mono text-sm font-semibold">{repPenalty.toFixed(2)}</span>
                    </div>
                    <Slider min={1.0} max={2.0} step={0.05} value={[repPenalty]} onValueChange={([value]) => setRepPenalty(value)} disabled={isConversationActive} />
                  </div>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      <audio ref={audioRef} className="hidden" onEnded={liveSpeech.onAudioEnded} />
    </div>
  );
}
