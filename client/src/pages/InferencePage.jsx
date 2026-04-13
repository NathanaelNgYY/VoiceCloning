import React, { useState, useEffect, useRef } from 'react';
import AudioPlayer from '../components/AudioPlayer.jsx';
import RefAudioPlayer from '../components/RefAudioPlayer.jsx';
import Spinner from '../components/Spinner.jsx';
import VoiceProfileSelector from '../components/VoiceProfileSelector.jsx';
import { getModels, selectModels, uploadRefAudio, transcribeAudio, getInferenceStatus, startGeneration, getGenerationResult, cancelGeneration, getTrainingAudioFiles, getTrainingAudioUrl, getCurrentInference, getUploadedRefAudioUrl } from '../services/api.js';
import { useInferenceSSE } from '../hooks/useInferenceSSE.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, ChevronRight, RefreshCw, Upload, Play, X, Check, Pencil, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildVoiceProfiles, extractExpName } from '@/lib/voiceProfiles';

const INFERENCE_DRAFT_KEY = 'voice-cloning-inference-draft';

function revokeIfBlobUrl(url) {
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

export default function InferencePage() {
  const [gptModels, setGptModels] = useState([]);
  const [sovitsModels, setSovitsModels] = useState([]);
  const [selectedPersonKey, setSelectedPersonKey] = useState('');
  const [selectedGPTPath, setSelectedGPTPath] = useState('');
  const [selectedSoVITSPath, setSelectedSoVITSPath] = useState('');
  const [modelsFetched, setModelsFetched] = useState(false);
  const [loadedGPTPath, setLoadedGPTPath] = useState('');
  const [loadedSoVITSPath, setLoadedSoVITSPath] = useState('');
  const [serverReady, setServerReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modelError, setModelError] = useState(null);

  const [refAudioPath, setRefAudioPath] = useState('');
  const [refAudioFile, setRefAudioFile] = useState(null);
  const [refAudioUrl, setRefAudioUrl] = useState(null);
  const [promptText, setPromptText] = useState('');
  const [promptLang, setPromptLang] = useState('en');
  const [transcribing, setTranscribing] = useState(false);

  const [uploadedRefFiles, setUploadedRefFiles] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const [trainingAudioFiles, setTrainingAudioFiles] = useState([]);
  const [auxRefAudios, setAuxRefAudios] = useState([]);
  const [loadingTrainingAudio, setLoadingTrainingAudio] = useState(false);
  const [refLocked, setRefLocked] = useState(false);
  const [previewAudioPath, setPreviewAudioPath] = useState('');
  const [previewAudioUrl, setPreviewAudioUrl] = useState(null);
  const [previewAudioName, setPreviewAudioName] = useState('');
  const [previewAudioRole, setPreviewAudioRole] = useState('primary');

  const [text, setText] = useState('');
  const [textLang, setTextLang] = useState('en');

  const [showSettings, setShowSettings] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [topK, setTopK] = useState(5);
  const [topP, setTopP] = useState(0.85);
  const [temperature, setTemperature] = useState(0.7);
  const [repPenalty, setRepPenalty] = useState(1.35);

  const [audioBlob, setAudioBlob] = useState(null);
  const [inferError, setInferError] = useState(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const sessionIdRef = useRef(null);
  const restoredSessionRef = useRef(null);

  const inference = useInferenceSSE();
  const voiceProfiles = buildVoiceProfiles(gptModels, sovitsModels);
  const selectedProfile = voiceProfiles.find(profile => profile.key === selectedPersonKey) || null;
  const selectedGPTCandidate = selectedProfile?.gptCandidates?.find(candidate => candidate.model.path === selectedGPTPath)
    || selectedProfile?.gptCandidates?.[0]
    || null;
  const selectedSoVITSCandidate = selectedProfile?.sovitsCandidates?.find(candidate => candidate.model.path === selectedSoVITSPath)
    || selectedProfile?.sovitsCandidates?.[0]
    || null;
  const selectedGPT = selectedGPTCandidate?.model?.path || '';
  const selectedSoVITS = selectedSoVITSCandidate?.model?.path || '';
  const currentExpName = selectedProfile?.expName || null;
  const selectionLoaded = Boolean(
    serverReady
      && selectedGPT
      && selectedSoVITS
      && loadedGPTPath === selectedGPT
      && loadedSoVITSPath === selectedSoVITS
  );
  const availableProfiles = voiceProfiles.filter(profile => profile.complete);
  const loadedProfileName = extractExpName(loadedSoVITSPath) || extractExpName(loadedGPTPath);

  useEffect(() => {
    restoreDraft();
    fetchModels();
    checkStatus();
    restoreInferenceState();
  }, []);

  async function fetchModels() {
    try {
      const res = await getModels();
      setGptModels(res.data.gpt || []);
      setSovitsModels(res.data.sovits || []);
      setModelError(null);
    } catch (err) {
      setModelError(err.response?.data?.error || err.message || 'Failed to load model library');
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

  function restoreDraft() {
    try {
      const raw = window.localStorage.getItem(INFERENCE_DRAFT_KEY);
      if (!raw) return;

      const draft = JSON.parse(raw);
      setSelectedPersonKey(draft.selectedPersonKey || '');
      setSelectedGPTPath(draft.selectedGPTPath || '');
      setSelectedSoVITSPath(draft.selectedSoVITSPath || '');
      setRefAudioPath(draft.refAudioPath || '');
      setRefAudioFile(draft.refAudioFile || null);
      setPromptText(draft.promptText || '');
      setPromptLang(draft.promptLang || 'en');
      setUploadedRefFiles(
        Array.isArray(draft.uploadedRefFiles)
          ? draft.uploadedRefFiles.map((file) => ({
              ...file,
              localUrl: getUploadedRefAudioUrl(file.serverPath),
            }))
          : []
      );
      setAuxRefAudios(Array.isArray(draft.auxRefAudios) ? draft.auxRefAudios : []);
      setRefLocked(Boolean(draft.refLocked));
      setText(draft.text || '');
      setTextLang(draft.textLang || 'en');
      setSpeed(Number.isFinite(draft.speed) ? draft.speed : 1.0);
      setTopK(Number.isFinite(draft.topK) ? draft.topK : 5);
      setTopP(Number.isFinite(draft.topP) ? draft.topP : 0.85);
      setTemperature(Number.isFinite(draft.temperature) ? draft.temperature : 0.7);
      setRepPenalty(Number.isFinite(draft.repPenalty) ? draft.repPenalty : 1.35);
      setShowSettings(Boolean(draft.showSettings));
      setPreviewAudioPath(draft.previewAudioPath || '');
      setPreviewAudioName(draft.previewAudioName || '');
      setPreviewAudioRole(draft.previewAudioRole || 'primary');
    } catch {
      /* ignore invalid draft */
    } finally {
      setDraftRestored(true);
    }
  }

  async function restoreInferenceState() {
    try {
      const res = await getCurrentInference();
      const current = res.data;
      if (!current?.sessionId) return;

      sessionIdRef.current = current.sessionId;

      if (current.params) {
        const primaryRefPath = current.params.ref_audio_path || '';
        setText(current.params.text || '');
        setTextLang(current.params.text_lang || 'en');
        setRefAudioPath(primaryRefPath);
        if (primaryRefPath) {
          const fallbackName = primaryRefPath.replace(/\\/g, '/').split('/').pop();
          setRefAudioFile({ name: fallbackName });
          if (/TEMP[\\/]+ref_audio/i.test(primaryRefPath)) {
            setRefAudioUrl(getUploadedRefAudioUrl(primaryRefPath));
          }
        }
        setPromptText(current.params.prompt_text || '');
        setPromptLang(current.params.prompt_lang || 'en');
        setSpeed(Number.isFinite(current.params.speed_factor) ? current.params.speed_factor : 1.0);
        setTopK(Number.isFinite(current.params.top_k) ? current.params.top_k : 5);
        setTopP(Number.isFinite(current.params.top_p) ? current.params.top_p : 0.85);
        setTemperature(Number.isFinite(current.params.temperature) ? current.params.temperature : 0.7);
        setRepPenalty(Number.isFinite(current.params.repetition_penalty) ? current.params.repetition_penalty : 1.35);
        setRefLocked(Boolean(current.params.ref_audio_path));
      }

      if (current.sessionId === restoredSessionRef.current) return;

      const nextState = {
        initialStatus: current.status || 'idle',
        initialTotalChunks: current.totalChunks || 0,
        initialCompletedChunks: current.completedChunks || 0,
        initialCurrentChunkText: current.currentChunkText || '',
        initialError: current.error || null,
      };

      if (current.status === 'waiting' || current.status === 'generating') {
        inference.connect(current.sessionId, nextState);
      } else {
        inference.disconnect();
        inference.hydrate(nextState);
      }

      if (current.status === 'complete' && current.resultReady) {
        const blob = await getGenerationResult(current.sessionId);
        setAudioBlob(blob);
      }

      restoredSessionRef.current = current.sessionId;
    } catch (err) {
      console.error('Failed to restore inference state:', err);
    }
  }

  useEffect(() => {
    if (!modelsFetched) return;

    const profiles = buildVoiceProfiles(gptModels, sovitsModels);

    if (profiles.length === 0) {
      if (selectedPersonKey) {
        setSelectedPersonKey('');
      }
      return;
    }

    const selectionStillValid = profiles.some(
      profile => profile.key === selectedPersonKey && profile.complete
    );

    if (!selectionStillValid) {
      const loadedMatch = profiles.find(
        profile => profile.complete
          && profile.gptModel?.path === loadedGPTPath
          && profile.sovitsModel?.path === loadedSoVITSPath
      );
      const fallback = loadedMatch || profiles.find(profile => profile.complete) || profiles[0];
      if (fallback?.key && fallback.key !== selectedPersonKey) {
        setSelectedPersonKey(fallback.key);
      }
    }
  }, [modelsFetched, gptModels, sovitsModels, selectedPersonKey, loadedGPTPath, loadedSoVITSPath]);

  useEffect(() => {
    if (!modelsFetched) return;

    if (!selectedProfile) {
      setSelectedGPTPath('');
      setSelectedSoVITSPath('');
      return;
    }

    const gptPathIsValid = selectedProfile.gptCandidates?.some(candidate => candidate.model.path === selectedGPTPath);
    const sovitsPathIsValid = selectedProfile.sovitsCandidates?.some(candidate => candidate.model.path === selectedSoVITSPath);

    const nextGPTPath = gptPathIsValid
      ? selectedGPTPath
      : (selectedProfile.gptCandidates?.find(candidate => candidate.model.path === loadedGPTPath)?.model.path
        || selectedProfile.gptCandidates?.[0]?.model.path
        || '');
    const nextSoVITSPath = sovitsPathIsValid
      ? selectedSoVITSPath
      : (selectedProfile.sovitsCandidates?.find(candidate => candidate.model.path === loadedSoVITSPath)?.model.path
        || selectedProfile.sovitsCandidates?.[0]?.model.path
        || '');

    if (nextGPTPath !== selectedGPTPath) {
      setSelectedGPTPath(nextGPTPath);
    }
    if (nextSoVITSPath !== selectedSoVITSPath) {
      setSelectedSoVITSPath(nextSoVITSPath);
    }
  }, [modelsFetched, selectedProfile, selectedGPTPath, selectedSoVITSPath, loadedGPTPath, loadedSoVITSPath]);

  useEffect(() => {
    if (!currentExpName) {
      setTrainingAudioFiles([]);
      setLoadingTrainingAudio(false);
      return;
    }
    setLoadingTrainingAudio(true);
    getTrainingAudioFiles(currentExpName)
      .then(res => setTrainingAudioFiles(res.data.files || []))
      .catch(() => setTrainingAudioFiles([]))
      .finally(() => setLoadingTrainingAudio(false));
  }, [currentExpName]);

  useEffect(() => {
    if (!refAudioPath) return;

    const uploadedMatch = uploadedRefFiles.find(file => file.serverPath === refAudioPath);
    if (uploadedMatch) {
      setRefAudioFile(prev => prev?.name ? prev : { name: uploadedMatch.name });
      setRefAudioUrl(prev => prev || getUploadedRefAudioUrl(uploadedMatch.serverPath));
      if (!previewAudioPath) {
        setPreview({
          path: uploadedMatch.serverPath,
          url: uploadedMatch.localUrl || getUploadedRefAudioUrl(uploadedMatch.serverPath),
          name: uploadedMatch.name,
          role: 'primary',
        });
      }
      return;
    }

    const trainingMatch = trainingAudioFiles.find(file => file.path === refAudioPath);
    if (trainingMatch && currentExpName) {
      setRefAudioFile(prev => prev?.name ? prev : { name: trainingMatch.filename });
      setRefAudioUrl(prev => prev || getTrainingAudioUrl(currentExpName, trainingMatch.filename));
      if (!previewAudioPath) {
        setPreview({
          path: trainingMatch.path,
          url: getTrainingAudioUrl(currentExpName, trainingMatch.filename),
          name: trainingMatch.filename,
          role: 'primary',
        });
      }
    }
  }, [refAudioPath, uploadedRefFiles, trainingAudioFiles, currentExpName, previewAudioPath]);

  useEffect(() => {
    if (!previewAudioPath) return;

    const uploadedMatch = uploadedRefFiles.find(file => file.serverPath === previewAudioPath);
    if (uploadedMatch) {
      setPreview({
        path: uploadedMatch.serverPath,
        url: uploadedMatch.localUrl || getUploadedRefAudioUrl(uploadedMatch.serverPath),
        name: uploadedMatch.name,
        role: previewAudioPath === refAudioPath ? 'primary' : 'auxiliary',
      });
      return;
    }

    const trainingMatch = trainingAudioFiles.find(file => file.path === previewAudioPath);
    if (trainingMatch && currentExpName) {
      setPreview({
        path: trainingMatch.path,
        url: getTrainingAudioUrl(currentExpName, trainingMatch.filename),
        name: trainingMatch.filename,
        role: trainingMatch.path === refAudioPath ? 'primary' : 'auxiliary',
      });
    }
  }, [previewAudioPath, uploadedRefFiles, trainingAudioFiles, currentExpName, refAudioPath]);

  useEffect(() => {
    if (!draftRestored) return;

    const draft = {
      selectedPersonKey,
      selectedGPTPath,
      selectedSoVITSPath,
      refAudioPath,
      refAudioFile,
      promptText,
      promptLang,
      uploadedRefFiles: uploadedRefFiles.map(file => ({
        name: file.name,
        serverPath: file.serverPath,
      })),
      auxRefAudios,
      refLocked,
      text,
      textLang,
      speed,
      topK,
      topP,
      temperature,
      repPenalty,
      showSettings,
      previewAudioPath,
      previewAudioName,
      previewAudioRole,
    };

    window.localStorage.setItem(INFERENCE_DRAFT_KEY, JSON.stringify(draft));
  }, [
    draftRestored,
    selectedPersonKey,
    selectedGPTPath,
    selectedSoVITSPath,
    refAudioPath,
    refAudioFile,
    promptText,
    promptLang,
    uploadedRefFiles,
    auxRefAudios,
    refLocked,
    text,
    textLang,
    speed,
    topK,
    topP,
    temperature,
    repPenalty,
    showSettings,
    previewAudioPath,
    previewAudioName,
    previewAudioRole,
  ]);

  function setPreview({ path, url, name, role = 'primary' }) {
    setPreviewAudioPath(path || '');
    setPreviewAudioUrl(url || null);
    setPreviewAudioName(name || '');
    setPreviewAudioRole(role);
  }

  function handleSelectPerson(nextKey) {
    const primaryIsUploaded = uploadedRefFiles.some(file => file.serverPath === refAudioPath);

    setSelectedPersonKey(nextKey);
    setSelectedGPTPath('');
    setSelectedSoVITSPath('');
    setModelError(null);
    setRefLocked(false);
    setAuxRefAudios([]);

    if (!primaryIsUploaded) {
      revokeIfBlobUrl(refAudioUrl);
      setRefAudioPath('');
      setRefAudioFile(null);
      setRefAudioUrl(null);
      setPromptText('');
      setPreview({ path: '', url: null, name: '', role: 'primary' });
    }
  }

  function handleSelectTrainingAudio(file) {
    setRefAudioPath(file.path);
    setRefAudioFile({ name: file.filename });
    setRefAudioUrl(getTrainingAudioUrl(currentExpName, file.filename));
    setPromptText(file.transcript);
    setPreview({
      path: file.path,
      url: getTrainingAudioUrl(currentExpName, file.filename),
      name: file.filename,
      role: 'primary',
    });
    if (file.lang) {
      const langMap = { ZH: 'zh', EN: 'en', JA: 'ja', KO: 'ko', zh: 'zh', en: 'en', ja: 'ja', ko: 'ko' };
      setPromptLang(langMap[file.lang] || 'en');
    }
    setAuxRefAudios(prev => prev.filter(f => f.filename !== file.filename));
  }

  function handleToggleAuxRef(file) {
    setAuxRefAudios(prev => {
      const exists = prev.some(f => f.filename === file.filename);
      if (exists) return prev.filter(f => f.filename !== file.filename);
      return [...prev, file];
    });
    setPreview({
      path: file.path,
      url: getTrainingAudioUrl(currentExpName, file.filename),
      name: file.filename,
      role: 'auxiliary',
    });
  }

  async function handleLoadModels() {
    if (!selectedGPT || !selectedSoVITS) {
      return alert('Select a person with both GPT and SoVITS checkpoints');
    }
    setLoading(true);
    setModelError(null);
    try {
      const res = await selectModels(selectedGPT, selectedSoVITS);
      setLoadedGPTPath(res.data.loaded?.gptPath || selectedGPT);
      setLoadedSoVITSPath(res.data.loaded?.sovitsPath || selectedSoVITS);
      setServerReady(true);
    } catch (err) {
      setModelError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefUpload(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setUploadingFiles(true);

    const newEntries = [];
    for (const file of files) {
      try {
        const res = await uploadRefAudio(file);
        newEntries.push({
          name: file.name,
          serverPath: res.data.path,
          localUrl: URL.createObjectURL(file),
        });
      } catch (err) {
        alert('Failed to upload ' + file.name + ': ' + (err.response?.data?.error || err.message));
      }
    }

    if (newEntries.length > 0) {
      setUploadedRefFiles(prev => {
        const merged = [...prev, ...newEntries];
        if (!refAudioPath || prev.length === 0) {
          setRefAudioFile({ name: merged[0].name });
          revokeIfBlobUrl(refAudioUrl);
          setRefAudioUrl(merged[0].localUrl);
          setRefAudioPath(merged[0].serverPath);
        }
        return merged;
      });
    }
    setUploadingFiles(false);
    e.target.value = '';
  }

  function handleSetUploadedPrimary(entry) {
    setRefAudioFile({ name: entry.name });
    revokeIfBlobUrl(refAudioUrl);
    setRefAudioUrl(entry.localUrl);
    setRefAudioPath(entry.serverPath);
    setPromptText('');
    setPreview({
      path: entry.serverPath,
      url: entry.localUrl,
      name: entry.name,
      role: 'primary',
    });
  }

  function handleRemoveUploadedFile(entry) {
    setUploadedRefFiles(prev => {
      const remaining = prev.filter(f => f.serverPath !== entry.serverPath);
      if (entry.serverPath === previewAudioPath && entry.serverPath !== refAudioPath) {
        setPreview({ path: '', url: null, name: '', role: 'primary' });
      }
      if (entry.serverPath === refAudioPath) {
        if (remaining.length > 0) {
          setRefAudioFile({ name: remaining[0].name });
          setRefAudioUrl(remaining[0].localUrl);
          setRefAudioPath(remaining[0].serverPath);
          setPreview({
            path: remaining[0].serverPath,
            url: remaining[0].localUrl,
            name: remaining[0].name,
            role: 'primary',
          });
        } else {
          setRefAudioFile(null);
          revokeIfBlobUrl(refAudioUrl);
          setRefAudioUrl(null);
          setRefAudioPath('');
          setPreview({ path: '', url: null, name: '', role: 'primary' });
        }
        setPromptText('');
      }
      revokeIfBlobUrl(entry.localUrl);
      return remaining;
    });
  }

  async function handleTranscribe() {
    if (!refAudioPath) return alert('Upload reference audio first');
    setTranscribing(true);
    try {
      const res = await transcribeAudio(refAudioPath, promptLang);
      setPromptText(res.data.text);
      if (res.data.language) setPromptLang(res.data.language);
    } catch (err) {
      alert('Transcription failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setTranscribing(false);
    }
  }

  async function handleGenerate() {
    if (!text.trim()) return alert('Enter text to synthesize');
    if (!refAudioPath) return alert('Select a reference audio first');
    if (!refLocked) return alert('Confirm your reference audio selection first');
    if (!selectionLoaded) return alert('Load the selected voice profile first');

    setInferError(null);
    setAudioBlob(null);

    try {
      const res = await startGeneration({
        text,
        text_lang: textLang,
        ref_audio_path: refAudioPath,
        prompt_text: promptText,
        prompt_lang: promptLang,
        aux_ref_audio_paths: [
          ...auxRefAudios.map(f => f.path),
          ...uploadedRefFiles.filter(f => f.serverPath !== refAudioPath).map(f => f.serverPath),
        ],
        top_k: topK,
        top_p: topP,
        temperature,
        repetition_penalty: repPenalty,
        speed_factor: speed,
      });
      const { sessionId } = res.data;
      sessionIdRef.current = sessionId;
      restoredSessionRef.current = sessionId;
      inference.connect(sessionId, { initialStatus: 'waiting' });
    } catch (err) {
      setInferError(err.response?.data?.error || err.message);
    }
  }

  async function handleCancel() {
    if (sessionIdRef.current) {
      try {
        await cancelGeneration(sessionIdRef.current);
      } catch { /* ignore */ }
    }
  }

  useEffect(() => {
    if (inference.status === 'complete' && sessionIdRef.current) {
      getGenerationResult(sessionIdRef.current)
        .then(blob => setAudioBlob(blob))
        .catch(err => setInferError(err.message));
    }
    if (inference.status === 'error' || inference.status === 'cancelled') {
      setInferError(inference.error);
    }
  }, [inference.status, inference.error]);

  const auxCount = auxRefAudios.length + uploadedRefFiles.filter(f => f.serverPath !== refAudioPath).length;
  const isGenerationActive = inference.status === 'waiting' || inference.status === 'generating';

  return (
    <div className="animate-fade-in space-y-8">
      <section className="relative overflow-hidden rounded-[32px] border border-sky-200/50 bg-[linear-gradient(135deg,#0f172a_0%,#082f49_42%,#115e59_100%)] px-6 py-7 text-white shadow-[0_32px_90px_-45px_rgba(15,23,42,0.85)] sm:px-8 lg:px-10">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.35),transparent_55%)]" />
        <div className="absolute -left-16 top-8 h-40 w-40 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="absolute bottom-0 right-8 h-48 w-48 rounded-full bg-emerald-300/15 blur-3xl" />

        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.85fr)] lg:items-end">
          <div>
            <Badge className="border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-white shadow-none">
              Inference Studio
            </Badge>
            <h2 className="mt-5 max-w-3xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Pick the person you want, then let the app use their highest checkpoints automatically.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72 sm:text-base">
              The model picker is now speaker-based. Choose the voice, confirm a strong reference clip, and generate with a cleaner, more guided workflow.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Badge className="border border-white/12 bg-white/10 px-3 py-1.5 text-white shadow-none">
                <Activity size={12} className="mr-1.5" />
                {selectionLoaded ? 'Selected voice is loaded' : serverReady ? 'Server online, reload needed' : 'Server offline'}
              </Badge>
              <Badge className="border border-white/12 bg-white/10 px-3 py-1.5 text-white shadow-none">
                {availableProfiles.length} voice {availableProfiles.length === 1 ? 'profile' : 'profiles'} available
              </Badge>
              <Badge className="border border-white/12 bg-white/10 px-3 py-1.5 text-white shadow-none">
                Long text is chunked automatically
              </Badge>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-[24px] border border-white/12 bg-white/10 p-4 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.85)] backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">Selected Person</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight">{selectedProfile?.displayName || 'No profile selected'}</p>
              <p className="mt-2 text-sm leading-6 text-white/72">
                {selectedProfile ? 'GPT and SoVITS are resolved behind the scenes.' : 'Refresh the library if you are missing a voice.'}
              </p>
            </div>

            <div className="rounded-[24px] border border-white/12 bg-white/8 p-4 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.85)] backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">Loaded On Server</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight">{loadedProfileName || 'Nothing loaded'}</p>
              <p className="mt-2 text-sm leading-6 text-white/72">
                {selectionLoaded ? 'Ready for generation.' : 'Loading only happens when you click the load button.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 01 Models */}
      <Card className="overflow-hidden rounded-[28px] border border-sky-100/80 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-sm">
        <CardHeader className="border-b border-slate-100/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.75))]">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-sm font-semibold">
              1
            </Badge>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <CardTitle className="font-display text-2xl">Voice Profile</CardTitle>
                <Badge variant={selectionLoaded ? 'success' : serverReady ? 'outline' : 'secondary'} className="text-[10px] uppercase tracking-[0.2em]">
                  <div className={cn(
                    "mr-1.5 h-1.5 w-1.5 rounded-full",
                    selectionLoaded ? "bg-success-foreground" : serverReady ? "bg-muted-foreground" : "bg-muted-foreground"
                  )} />
                  {selectionLoaded ? 'Loaded' : serverReady ? 'Needs reload' : 'Offline'}
                </Badge>
              </div>
              <CardDescription>Select a person and the highest GPT and SoVITS checkpoints will be chosen automatically.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-6">
          <VoiceProfileSelector
            profiles={voiceProfiles}
            value={selectedPersonKey}
            onChange={handleSelectPerson}
            disabled={loading}
            selectedProfile={selectedProfile}
            selectedGPTPath={selectedGPTPath}
            selectedSoVITSPath={selectedSoVITSPath}
            onGPTChange={setSelectedGPTPath}
            onSoVITSChange={setSelectedSoVITSPath}
            selectedGPTCandidate={selectedGPTCandidate}
            selectedSoVITSCandidate={selectedSoVITSCandidate}
          />

          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-sm text-slate-500">
            {selectedProfile
              ? `Loading ${selectedProfile.displayName} will use GPT ${selectedGPTCandidate?.model?.name || 'not selected'} and SoVITS ${selectedSoVITSCandidate?.model?.name || 'not selected'}.`
              : 'Refresh the library or select a person to continue.'}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleLoadModels} disabled={loading || !selectedProfile?.complete} size="lg" className="rounded-2xl px-6 shadow-[0_18px_45px_-25px_rgba(14,165,233,0.7)]">
              {loading ? <Spinner size={14} className="text-primary-foreground" /> : null}
              {loading ? 'Loading...' : selectionLoaded ? 'Loaded On Server' : 'Load Voice Profile'}
            </Button>

            <Button variant="outline" size="lg" onClick={fetchModels} className="rounded-2xl border-slate-200 px-5">
              <RefreshCw size={14} />
              Refresh Library
            </Button>

            {loadedProfileName && !selectionLoaded && (
              <span className="text-sm text-slate-500">
                Currently loaded: <span className="font-semibold text-slate-700">{loadedProfileName}</span>
              </span>
            )}

            {modelError && (
              <span className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                {modelError}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 02 Reference Audio */}
      <Card className="overflow-hidden rounded-[28px] border border-sky-100/80 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-sm">
        <CardHeader className="border-b border-slate-100/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.75))]">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-sm font-semibold">
              2
            </Badge>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <CardTitle className="font-display text-2xl">Reference Audio</CardTitle>
                {refLocked && (
                  <Badge variant="success" className="text-[10px] uppercase tracking-[0.2em]">
                    <Check size={10} className="mr-1" />
                    Confirmed
                  </Badge>
                )}
              </div>
              <CardDescription>
                {refLocked ? 'Selection locked for generation' : 'Select a primary reference and optional auxiliary audio'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {refLocked ? (
            /* Locked summary */
            <div>
              <div className="rounded-[24px] border border-emerald-100 bg-[linear-gradient(135deg,rgba(236,253,245,0.95),rgba(239,246,255,0.9))] p-5 shadow-sm">
                <div className="mb-2 flex items-center gap-2.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span className="font-mono text-sm text-foreground">
                    {refAudioFile?.name || 'Unknown'}
                  </span>
                  <Badge variant="default" className="text-[10px] uppercase tracking-[0.2em]">Primary</Badge>
                </div>
                {promptText && (
                  <p className="ml-4 text-sm italic leading-7 text-muted-foreground">
                    &ldquo;{promptText}&rdquo;
                  </p>
                )}
                {auxCount > 0 && (
                  <div className="ml-4 mt-1 text-sm text-muted-foreground">
                    + {auxCount} auxiliary reference{auxCount !== 1 ? 's' : ''}
                  </div>
                )}
              </div>

              {refAudioUrl && <RefAudioPlayer src={refAudioUrl} />}

              <Button
                variant="outline"
                size="sm"
                className="mt-4 rounded-xl"
                onClick={() => setRefLocked(false)}
              >
                <Pencil size={12} />
                Edit Reference
              </Button>
            </div>
          ) : (
            /* Unlocked selection UI */
            <div>
              <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.08fr)_minmax(300px,0.92fr)]">
                {/* Left: audio file list */}
                <div className="space-y-4">
                  <div className="mb-2 flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Audio Files</Label>
                    {auxCount > 0 && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {auxCount} aux
                      </Badge>
                    )}
                  </div>

                  {/* Training audio list */}
                  {loadingTrainingAudio ? (
                    <div className="flex items-center gap-2 rounded-[22px] border border-slate-200 bg-slate-50 p-4 text-sm text-muted-foreground">
                      <Spinner /> Loading training audio...
                    </div>
                  ) : trainingAudioFiles.length > 0 ? (
                    <>
                      <div className="max-h-[300px] overflow-y-auto rounded-[22px] border border-slate-200 bg-slate-50/70">
                        {trainingAudioFiles.map((file) => {
                          const isPrimary = file.path === refAudioPath;
                          const isAux = auxRefAudios.some(f => f.filename === file.filename);
                          const isPreviewed = file.path === previewAudioPath;
                          return (
                            <div
                              key={file.filename}
                              className={cn(
                                "flex items-start gap-2.5 border-b px-4 py-3 transition-colors last:border-0",
                                isPrimary && "bg-primary/5",
                                isPreviewed && "ring-1 ring-inset ring-sky-200"
                              )}
                            >
                              <input
                                type="radio"
                                name="primary-ref"
                                checked={isPrimary}
                                onChange={() => handleSelectTrainingAudio(file)}
                                title="Set as primary reference"
                                className="h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                              />
                              <input
                                type="checkbox"
                                checked={isAux}
                                disabled={isPrimary}
                                onChange={() => handleToggleAuxRef(file)}
                                title={isPrimary ? 'Primary ref cannot also be auxiliary' : 'Toggle as auxiliary reference'}
                                className={cn(
                                  "h-4 w-4 shrink-0 accent-[hsl(var(--primary))]",
                                  isPrimary ? "cursor-not-allowed opacity-30" : "cursor-pointer"
                                )}
                              />
                              <button
                                type="button"
                                onClick={() => setPreview({
                                  path: file.path,
                                  url: getTrainingAudioUrl(currentExpName, file.filename),
                                  name: file.filename,
                                  role: isPrimary ? 'primary' : isAux ? 'auxiliary' : 'preview',
                                })}
                                className="min-w-0 flex-1 text-left"
                              >
                                <div className="break-all font-mono text-xs text-foreground">
                                  {file.filename}
                                </div>
                                {file.transcript && (
                                  <div className="mt-1 text-sm leading-6 text-muted-foreground">
                                    {file.transcript}
                                  </div>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-1.5 flex gap-3 text-[10px] text-muted-foreground">
                        <span>Radio = primary ref</span>
                        <span>Checkbox = auxiliary ref</span>
                      </div>
                      {auxRefAudios.length > 0 && (
                        <button
                          onClick={() => setAuxRefAudios([])}
                          className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                        >
                          Clear auxiliary selections
                        </button>
                      )}
                    </>
                  ) : currentExpName ? (
                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4 text-center text-sm text-muted-foreground">
                      No training audio found for &ldquo;{currentExpName}&rdquo;
                    </div>
                  ) : (
                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4 text-center text-sm text-muted-foreground">
                      Load a voice profile to browse matching training audio
                    </div>
                  )}

                  {/* Upload custom files */}
                  <div className="mt-4">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Or Upload Custom Audio</Label>
                    <div className="mt-2 flex items-center gap-2.5 rounded-[22px] border border-dashed border-sky-200 bg-[linear-gradient(135deg,rgba(240,249,255,0.95),rgba(248,250,252,0.95))] px-4 py-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
                        <Upload size={16} />
                      </div>
                      <input
                        type="file"
                        accept=".wav,.mp3,.ogg,.flac"
                        multiple
                        onChange={handleRefUpload}
                        className="flex-1 text-sm text-muted-foreground file:mr-3 file:rounded-xl file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
                      />
                      {uploadingFiles && <Spinner />}
                    </div>
                  </div>

                  {/* Uploaded file list */}
                  {uploadedRefFiles.length > 0 && (
                    <ScrollArea className="mt-2 max-h-[180px] rounded-[22px] border border-slate-200 bg-white">
                      {uploadedRefFiles.map((entry) => {
                        const isPrimary = entry.serverPath === refAudioPath;
                        const isPreviewed = entry.serverPath === previewAudioPath;
                        return (
                          <div
                            key={entry.serverPath}
                            className={cn(
                              "flex items-center gap-2.5 border-b px-4 py-3 transition-colors last:border-0",
                              isPrimary && "bg-primary/5",
                              isPreviewed && "ring-1 ring-inset ring-sky-200"
                            )}
                          >
                            <input
                              type="radio"
                              name="primary-ref"
                              checked={isPrimary}
                              onChange={() => handleSetUploadedPrimary(entry)}
                              title="Set as primary reference"
                              className="h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                            />
                            <button
                              type="button"
                              onClick={() => setPreview({
                                path: entry.serverPath,
                                url: entry.localUrl || getUploadedRefAudioUrl(entry.serverPath),
                                name: entry.name,
                                role: isPrimary ? 'primary' : 'auxiliary',
                              })}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="truncate font-mono text-xs text-foreground">
                                {entry.name}
                              </div>
                              <div className={cn(
                                "mt-1 text-[10px] uppercase tracking-[0.18em]",
                                isPrimary ? "font-semibold text-primary" : "text-muted-foreground"
                              )}>
                                {isPrimary ? 'Primary (uploaded)' : 'Auxiliary (uploaded)'}
                              </div>
                            </button>
                            <button
                              onClick={() => handleRemoveUploadedFile(entry)}
                              title="Remove"
                              className="shrink-0 rounded-xl p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </ScrollArea>
                  )}
                </div>

                {/* Right: transcript + language + player */}
                <div className="space-y-4">
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-5">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Primary Reference Transcript</Label>
                    <Textarea
                      className="mt-3 min-h-[120px] rounded-2xl border-slate-200 bg-white leading-7 shadow-sm"
                        placeholder="What the primary reference audio says..."
                        value={promptText}
                        onChange={(e) => setPromptText(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      className="mt-3 w-full rounded-2xl border-slate-200"
                      onClick={handleTranscribe}
                      disabled={transcribing || !refAudioPath}
                    >
                      {transcribing ? <Spinner size={14} /> : <Mic size={14} />}
                      {transcribing ? 'Working...' : 'Auto-Transcribe'}
                    </Button>
                  </div>

                  <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reference Language</Label>
                    <Select value={promptLang} onValueChange={setPromptLang}>
                      <SelectTrigger className="mt-3 h-12 rounded-2xl border-slate-200 bg-slate-50">
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

                  <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</Label>
                      <Badge variant="outline" className="text-[10px] uppercase tracking-[0.18em]">
                        {previewAudioRole || 'primary'}
                      </Badge>
                    </div>
                    {previewAudioUrl ? (
                      <>
                        <p className="mt-3 truncate font-mono text-xs text-slate-500">
                          {previewAudioName || 'Selected audio'}
                        </p>
                        <RefAudioPlayer src={previewAudioUrl} />
                      </>
                    ) : (
                      <div className="mt-3 rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                        Choose any primary or auxiliary clip to preview it here.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Confirm button */}
              <div className="mt-6">
                <Button
                  className="rounded-2xl px-6"
                  onClick={() => {
                    if (!refAudioPath) return alert('Select a primary reference audio first');
                    setRefLocked(true);
                  }}
                  disabled={!refAudioPath}
                >
                  <Check size={14} />
                  Confirm Selection
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 03 Text Input */}
      <Card className="overflow-hidden rounded-[28px] border border-sky-100/80 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-sm">
        <CardHeader className="border-b border-slate-100/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.75))]">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-sm font-semibold">
              3
            </Badge>
            <div>
              <CardTitle className="font-display text-2xl">Text to Synthesize</CardTitle>
              <CardDescription>Enter the text you want spoken in the cloned voice</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.75fr)]">
            <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-5">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Text</Label>
              <Textarea
                className="mt-3 min-h-[180px] rounded-2xl border-slate-200 bg-white text-[15px] leading-7 shadow-sm"
                placeholder="Enter the text you want to synthesize..."
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {text && (
                <p className="mt-1.5 text-right font-mono text-xs text-muted-foreground">
                  {text.length} chars
                </p>
              )}
            </div>
            <div className="space-y-4">
              <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
                <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Language</Label>
                <Select value={textLang} onValueChange={setTextLang}>
                  <SelectTrigger className="mt-3 h-12 rounded-2xl border-slate-200 bg-slate-50">
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

              <div className="rounded-[22px] border border-slate-200 bg-[linear-gradient(135deg,rgba(248,250,252,0.95),rgba(240,249,255,0.9))] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Current Setup</p>
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <div className="grid grid-cols-[auto,minmax(0,1fr)] items-start gap-3">
                    <span>Voice</span>
                    <span className="min-w-0 text-right font-semibold text-slate-800">{selectedProfile?.displayName || 'None selected'}</span>
                  </div>
                  <div className="grid grid-cols-[auto,minmax(0,1fr)] items-start gap-3">
                    <span>Reference</span>
                    <span className="min-w-0 break-words text-right font-semibold leading-6 text-slate-800">{refAudioFile?.name || 'Not selected'}</span>
                  </div>
                  <div className="grid grid-cols-[auto,minmax(0,1fr)] items-start gap-3">
                    <span>Status</span>
                    <span className="min-w-0 text-right font-semibold text-slate-800">{selectionLoaded ? 'Ready' : 'Load voice first'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 04 Settings */}
      <Card className="overflow-hidden rounded-[28px] border border-sky-100/80 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-sm">
        <CardHeader className="border-b border-slate-100/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.75))]">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-sm font-semibold">
              4
            </Badge>
            <div>
              <CardTitle className="font-display text-2xl">Generation Settings</CardTitle>
              <CardDescription>Fine-tune the synthesis parameters</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <Collapsible open={showSettings} onOpenChange={setShowSettings}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 rounded-2xl border-slate-200 text-muted-foreground">
                <ChevronRight
                  size={14}
                  className={cn("transition-transform", showSettings && "rotate-90")}
                />
                {showSettings ? 'Hide' : 'Show'} parameters
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-x-10">
                {/* Speed */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Speed</Label>
                    <span className="font-mono text-sm font-semibold">{speed.toFixed(1)}x</span>
                  </div>
                  <Slider
                    min={0.5} max={2.0} step={0.1}
                    value={[speed]}
                    onValueChange={([v]) => setSpeed(v)}
                  />
                </div>

                {/* Top K */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Top K</Label>
                    <span className="font-mono text-sm font-semibold">{topK}</span>
                  </div>
                  <Slider
                    min={1} max={50} step={1}
                    value={[topK]}
                    onValueChange={([v]) => setTopK(v)}
                  />
                </div>

                {/* Top P */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Top P</Label>
                    <span className="font-mono text-sm font-semibold">{topP.toFixed(2)}</span>
                  </div>
                  <Slider
                    min={0} max={1} step={0.05}
                    value={[topP]}
                    onValueChange={([v]) => setTopP(v)}
                  />
                </div>

                {/* Temperature */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Temperature</Label>
                    <span className="font-mono text-sm font-semibold">{temperature.toFixed(2)}</span>
                  </div>
                  <Slider
                    min={0} max={1} step={0.05}
                    value={[temperature]}
                    onValueChange={([v]) => setTemperature(v)}
                  />
                </div>

                {/* Repetition Penalty */}
                <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Repetition Penalty</Label>
                    <span className="font-mono text-sm font-semibold">{repPenalty.toFixed(2)}</span>
                  </div>
                  <Slider
                    min={1.0} max={2.0} step={0.05}
                    value={[repPenalty]}
                    onValueChange={([v]) => setRepPenalty(v)}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* 05 Generate */}
      <Card className="overflow-hidden rounded-[28px] border border-sky-100/80 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-sm">
        <CardHeader className="border-b border-slate-100/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.75))]">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-sm font-semibold">
              5
            </Badge>
            <div>
              <CardTitle className="font-display text-2xl">Generate</CardTitle>
              <CardDescription>Synthesize speech from your text</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {!isGenerationActive ? (
            <div className={cn("flex flex-wrap items-center gap-4", audioBlob && "mb-6")}>
              <Button
                size="lg"
                className="rounded-2xl shadow-[0_20px_50px_-28px_rgba(14,165,233,0.75)]"
                disabled={!selectionLoaded || !refLocked || !refAudioPath || !text.trim()}
                onClick={() => { inference.reset(); handleGenerate(); }}
              >
                <Play size={14} />
                Generate Speech
              </Button>

              {inferError && (
                <span className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                  {inferError}
                </span>
              )}
            </div>
          ) : (
            /* Progress UI */
            <div className={cn(audioBlob && "mb-6")}>
              {/* Progress bar */}
              <div className="mb-4 flex items-center gap-4 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                <Progress
                  value={inference.totalChunks > 0 ? (inference.completedChunks / inference.totalChunks) * 100 : 0}
                  className="h-2 flex-1"
                />
                <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                  {inference.completedChunks} / {inference.totalChunks}
                </span>
              </div>

              {inference.status === 'waiting' && !inference.currentChunkText && (
                <div className="mb-4 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Preparing session
                  </span>
                  <p className="text-sm italic text-muted-foreground">
                    Reconnecting the stream and preparing chunk generation...
                  </p>
                </div>
              )}

              {/* Current chunk text */}
              {inference.currentChunkText && (
                <div className="mb-4 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Synthesizing chunk {inference.completedChunks + 1}
                  </span>
                  <p className="text-sm italic text-muted-foreground">
                    {inference.currentChunkText}
                  </p>
                </div>
              )}

              {/* Cancel button */}
              <Button variant="outline" className="rounded-2xl border-slate-200" onClick={handleCancel}>
                <Spinner size={14} />
                Cancel Generation
              </Button>
            </div>
          )}

          <AudioPlayer audioBlob={audioBlob} />
        </CardContent>
      </Card>
    </div>
  );
}
