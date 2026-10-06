import React, { useEffect, useRef, useState } from 'react';
import { useLiveSpeech } from '../hooks/useLiveSpeech.js';
import { MC_SYSTEM_PROMPT, NOISE_LEVELS, PAUSE_RANGE, mcMicConstraints, mcSessionOptions, mcSessionStatus, mcTranscriptEntries, normalizeCaptureSettings, sameCaptureSettings } from '../lib/mcSession.js';
import { nextAudioErrorAction } from '../hooks/liveConversation.js';
import ntuLogo from '../assets/ntu-logo.png';
import { Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff } from 'lucide-react';

const REFERENCE_PARAMS = {};
const CAPTURE_STORAGE_KEY = 'mc-capture-settings-v2';

function loadCaptureSettings() {
  try {
    return normalizeCaptureSettings(JSON.parse(window.localStorage.getItem(CAPTURE_STORAGE_KEY) || 'null'));
  } catch {
    return normalizeCaptureSettings(null);
  }
}

export default function McSessionPage() {
  const [instructions, setInstructions] = useState(MC_SYSTEM_PROMPT);
  const [listeningMode, setListeningMode] = useState('turns');
  const [captureSettings, setCaptureSettings] = useState(loadCaptureSettings);
  function updateCaptureSettings(change) {
    const next = normalizeCaptureSettings({ ...captureSettings, ...change });
    setCaptureSettings(next);
    try { window.localStorage.setItem(CAPTURE_STORAGE_KEY, JSON.stringify(next)); } catch { /* per-browser convenience only */ }
  }
  // The running session keeps the mode and capture settings it started with;
  // changes made meanwhile wait for the next session.
  const [applied, setApplied] = useState(null);
  const sessionMode = applied ? applied.mode : listeningMode;
  const sessionCapture = applied ? applied.capture : captureSettings;
  const [playbackError, setPlaybackError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  // Browsers that refuse element fullscreen (iOS Safari, embedded views) get the
  // same stage pinned over the window instead of an error.
  const [windowFill, setWindowFill] = useState(false);
  const immersive = fullscreen || windowFill;
  const stageRef = useRef(null);
  const stageTranscriptRef = useRef(null);
  const audioRef = useRef(null);
  const audioRetryRef = useRef({ src: '', retried: false });
  const transcriptRef = useRef(null);
  const live = useLiveSpeech({
    refParams: REFERENCE_PARAMS,
    voiceProfileId: 'deanvoice-v1',
    engine: 'fast', replyMode: 'phrases', language: 'en',
    systemPrompt: instructions, listeningMode: sessionMode, autoReconnect: true, noiseGate: false, fullDuplex: true,
    sessionOptions: mcSessionOptions(sessionCapture), micConstraints: mcMicConstraints(sessionCapture),
  });
  const active = live.isConversationActive;
  const pendingChanges = active && applied
    && (applied.mode !== listeningMode || !sameCaptureSettings(applied.capture, captureSettings));
  // Clears the started-with settings when a session ends on its own (errors,
  // dropped connection); the End button clears them itself so an immediate
  // restart never inherits them.
  useEffect(() => { if (!active) setApplied(null); }, [active]);
  const status = mcSessionStatus({ phase: live.phase, micEnabled: live.isMicInputEnabled, listeningMode: sessionMode, reconnecting: live.isReconnecting, userSpeaking: live.isUserSpeaking, replyAudible: Boolean(live.selectedReplyId && live.audioSrc) });

  useEffect(() => { document.title = 'Live MC | NTU Singapore'; }, []);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    if (!windowFill) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setWindowFill(false); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); };
  }, [windowFill]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!live.shouldPlayAudio || !live.audioSrc) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setPlaybackError('');
      return;
    }
    let cancelled = false;
    audio.src = live.audioSrc;
    audio.load();
    setPlaybackError('');
    audio.play().catch(() => {
      if (!cancelled) setPlaybackError('Your browser paused audio. Press Play reply to continue.');
    });
    return () => { cancelled = true; audio.pause(); };
  }, [live.audioSrc, live.selectedReplyId, live.shouldPlayAudio]);

  useEffect(() => {
    for (const transcript of [transcriptRef.current, stageTranscriptRef.current]) {
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    }
  }, [live.messages, live.interimTranscript, immersive]);

  async function toggleFullscreen() {
    if (document.fullscreenElement === stageRef.current) await document.exitFullscreen().catch(() => {});
    if (immersive) { setWindowFill(false); return; }
    // A refused or never-settling request (embedded views, iOS) pins the stage
    // over the window instead, so the button always does something.
    const request = stageRef.current.requestFullscreen?.() ?? Promise.reject();
    const outcome = await Promise.race([
      request.then(() => 'native', () => 'fill'),
      new Promise((resolve) => setTimeout(() => resolve('fill'), 1500)),
    ]);
    if (outcome === 'fill' && document.fullscreenElement !== stageRef.current) setWindowFill(true);
  }

  function transcriptContent() {
    if (live.messages.length === 0) {
      return <p className="text-sm leading-6 text-slate-500">Your conversation will appear here when the session begins.</p>;
    }
    // Placeholder text from the shared hook becomes a typing indicator; the
    // status line already says what is happening.
    return mcTranscriptEntries(live.messages).map((entry) => (
      <div key={entry.id} className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${entry.role === 'user' ? 'rounded-br-md bg-[#eef0f8] text-[#1d2240]' : 'rounded-bl-md bg-[#f4f3f0]'}`}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{entry.role === 'user' ? 'You' : 'AI MC'}</p>
          {entry.text && <p className="whitespace-pre-wrap break-words text-sm leading-6">{entry.text}{entry.interrupted && <span className="ml-1 text-slate-400">…</span>}</p>}
          {entry.interrupted && <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-amber-700">Interrupted</p>}
          {entry.pending && <p aria-label={entry.role === 'user' ? 'Hearing you' : 'Preparing a reply'} className="flex h-6 items-center gap-1">{[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animation: `mc-dot 1.2s ease-in-out ${dot * 0.18}s infinite` }} />)}</p>}
        </div>
      </div>
    ));
  }

  function onAudioError() {
    if (!live.shouldPlayAudio) return;
    const { action, retryState } = nextAudioErrorAction(audioRetryRef.current, live.audioSrc);
    audioRetryRef.current = retryState;
    if (action === 'retry') {
      audioRef.current.load();
      audioRef.current.play().catch(() => setPlaybackError('Audio could not play. Press Play reply to retry.'));
    } else if (action === 'skip') {
      setPlaybackError('One audio segment could not play. The transcript is available below.');
      live.onAudioEnded();
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#faf9f7] text-[#252b3a]">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 border-b border-[#e5e3df] px-6 py-6 sm:px-10">
        <img src={ntuLogo} alt="Nanyang Technological University Singapore" className="h-auto w-44 sm:w-52" />
        <span className="text-xs font-medium tracking-[0.16em] text-slate-500">LIVE SESSION</span>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-12 pt-12 sm:px-10 sm:pt-16">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#a6192e]">A conversation on stage</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Meet your AI co-host.</h1>
        <p className="mt-4 max-w-lg text-base leading-7 text-slate-600">You lead the moment. Your AI MC joins the conversation, speaking with the Dean voice.</p>

        <section aria-label="Session controls" className="mt-10 rounded-3xl border border-[#e5e3df] bg-white p-3 sm:p-4">
          <style>{'@keyframes mc-wave{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}@keyframes mc-dot{0%,80%,100%{opacity:.25}40%{opacity:1}}'}</style>
          <div ref={stageRef} className={immersive ? `${windowFill ? 'fixed inset-0 z-50' : 'relative'} grid h-[100dvh] w-full grid-rows-[minmax(0,1fr)_minmax(12rem,0.6fr)] bg-white text-[#252b3a] md:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] md:grid-rows-1` : 'relative'}>
            <div className={`relative isolate flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,#2b3157_0%,#151a33_70%)] ${immersive ? '' : 'aspect-video rounded-2xl'}`}>
              {/* Avatar slot: the future avatar video/image goes here with object-contain, centred and never stretched. */}
              <div role="img" aria-label="AI avatar placeholder" className="flex flex-col items-center text-center">
                <div className={`flex items-center justify-center rounded-full border border-white/15 bg-white/5 font-semibold tracking-wide text-white/80 transition-shadow ${immersive ? 'h-40 w-40 text-4xl' : 'h-24 w-24 text-2xl'} ${live.phase === 'speaking' ? 'ring-4 ring-[#a6192e]/70' : ''}`}>AI</div>
                <p className={`mt-5 font-medium text-white/85 ${immersive ? 'text-xl' : 'text-base'}`}>AI MC</p>
                <p className="mt-1 text-xs text-white/50">Avatar coming soon</p>
              </div>
              <p className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium text-white backdrop-blur sm:left-5 sm:top-5">
                <span className={`h-2 w-2 rounded-full ${active ? 'animate-pulse bg-emerald-400' : 'bg-white/40'}`} />{active ? 'Live' : 'Offline'}
              </p>
              <button type="button" aria-label={immersive ? 'Exit fullscreen' : 'Open fullscreen stage'} title={immersive ? 'Exit fullscreen (Esc)' : 'Fullscreen'} onClick={toggleFullscreen} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white sm:right-5 sm:top-5">
                {immersive ? <Minimize2 size={17} strokeWidth={1.75} /> : <Maximize2 size={17} strokeWidth={1.75} />}
              </button>
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-2xl bg-black/55 p-2 text-white shadow-lg backdrop-blur sm:bottom-6 sm:gap-4 sm:px-3">
                {active && <button type="button" aria-label={live.isMicInputEnabled ? 'Mute microphone' : 'Unmute microphone'} title={live.isMicInputEnabled ? 'Mute' : 'Unmute'} disabled={live.phase === 'connecting'} onClick={live.toggle} className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50 ${live.isMicInputEnabled ? 'bg-white/10 hover:bg-white/20' : 'bg-white text-[#151a33]'}`}>
                  {live.isMicInputEnabled ? <Mic size={19} /> : <MicOff size={19} />}
                </button>}
                <div className="hidden h-8 items-center gap-[3px] sm:flex" aria-hidden="true">
                  {Array.from({ length: 22 }, (_, index) => {
                    const shape = 0.35 + 0.65 * Math.sin(index * 1.3) ** 2;
                    const speaking = live.phase === 'speaking';
                    // Flat whenever the mic is not actually being sent (muted, or turn-based while the AI has the floor).
                    const sending = active && live.isMicInputEnabled && (live.phase === 'listening' || (sessionMode !== 'turns' && live.phase === 'thinking'));
                    const level = sending ? Math.min(1, 0.12 + live.audioLevel * 1.6 * shape) : 0.12;
                    return <span key={index} className="h-full w-[3px] rounded-full bg-white/85" style={speaking ? { animation: `mc-wave ${0.7 + (index % 5) * 0.12}s ease-in-out ${index * 0.04}s infinite` } : { transform: `scaleY(${level})`, transition: 'transform 120ms ease-out' }} />;
                  })}
                </div>
                <button type="button" aria-label={active ? 'End session' : 'Start session'} onClick={() => { if (active) { setApplied(null); live.stop(); return; } setApplied({ mode: listeningMode, capture: captureSettings }); live.start(); }} disabled={!active && (!instructions.trim() || !live.speechApiAvailable)} className={`flex h-11 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'w-11 bg-red-500 hover:bg-red-600' : 'bg-[#a6192e] px-5 hover:bg-[#861426]'}`}>
                  {active ? <PhoneOff size={19} /> : <><Phone size={17} />Start session</>}
                </button>
              </div>
            </div>
            {immersive && <aside className="flex min-h-0 flex-col border-t border-[#e5e3df] bg-white md:border-l md:border-t-0" aria-label="Live conversation">
              <div className="flex shrink-0 items-center gap-3 border-b border-[#efeee9] px-6 py-5">
                <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[#151a33] text-sm font-semibold text-white">AI<span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${active ? 'bg-emerald-400' : 'bg-slate-300'}`} /></div>
                <div className="min-w-0 flex-1"><p className="font-semibold leading-5">AI MC</p><p role="status" className="truncate text-xs text-slate-500">{status}</p></div>
                <img src={ntuLogo} alt="NTU Singapore" className="h-auto w-24" />
              </div>
              <div ref={stageTranscriptRef} role="log" aria-label="Live conversation transcript" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">{transcriptContent()}</div>
              {(live.error || playbackError) && <p role="alert" className="mx-6 mb-3 text-sm text-red-800">{live.error || playbackError}</p>}
              <p className="shrink-0 border-t border-[#efeee9] px-6 py-3 text-xs text-slate-400">AI-generated · Cloned Dean voice</p>
            </aside>}
          </div>
          <div className="flex items-center gap-3 px-3 pt-4" role="status" aria-live="polite">
            <span className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-[#a6192e]' : 'bg-slate-300'}`} />
            <span className="text-sm font-medium">{status}</span>
          </div>
          <fieldset className="mx-3 mt-4 border-t border-slate-100 pb-3 pt-5">
            <legend className="sr-only">Listening mode</legend>
            <div className="flex flex-wrap justify-center gap-5 text-sm">
              {[['turns', 'Turn-based'], ['continuous', 'Continuous listening']].map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-center gap-2"><input type="radio" name="listening-mode" value={value} checked={listeningMode === value} onChange={() => setListeningMode(value)} className="accent-[#a6192e]" />{label}</label>
              ))}
            </div>
            <p className="mt-3 text-center text-xs leading-5 text-slate-500">{listeningMode === 'turns'
              ? 'Speak, then pause: the AI MC replies when you finish and always completes its reply. Your mic closes while it replies and reopens after. Mute any time; muting mid-sentence sends what you said.'
              : 'Hands-free: the mic stays open, and talking over the AI MC interrupts it. Keep its speaker away from your mic, or use headphones.'}</p>
          </fieldset>
          {pendingChanges && <p role="status" className="mx-3 mt-4 rounded-xl bg-amber-50 px-4 py-3 text-center text-sm text-amber-900">Changes apply to the next session. End the session to switch to them.</p>}
          {!live.speechApiAvailable && <p role="alert" className="mx-3 mt-5 text-sm text-red-800">This browser does not support microphone audio. Use a current Chrome, Edge, or Safari browser.</p>}
          {live.error && <p role="alert" className="mx-3 mt-5 text-sm leading-6 text-red-800">{live.error}</p>}
          {playbackError && <div role="alert" className="mx-3 mt-5 text-sm text-red-800"><p>{playbackError}</p>{live.shouldPlayAudio && <button className="mt-2 underline" onClick={() => audioRef.current.play().then(() => setPlaybackError('')).catch(() => setPlaybackError('Audio is still unavailable. Check your audio output and retry.'))}>Play reply</button>}</div>}
        </section>

        <details className="mt-7 border-b border-[#e5e3df] pb-5">
          <summary className="cursor-pointer text-sm font-medium">Voice capture settings</summary>
          <div className="mt-5 grid gap-8 sm:grid-cols-2">
            <div>
              <label htmlFor="mc-noise" className="flex items-baseline justify-between text-sm text-slate-600">Background noise filter<span className="font-medium text-[#252b3a]">{NOISE_LEVELS[captureSettings.noiseLevel].label}</span></label>
              <input id="mc-noise" type="range" min={0} max={NOISE_LEVELS.length - 1} step={1} value={captureSettings.noiseLevel} onChange={(event) => updateCaptureSettings({ noiseLevel: Number(event.target.value) })} aria-valuetext={NOISE_LEVELS[captureSettings.noiseLevel].label} className="mt-3 w-full accent-[#a6192e]" />
              <div className="mt-1 flex justify-between text-[11px] text-slate-400" aria-hidden="true">{NOISE_LEVELS.map((level) => <span key={level.label}>{level.label}</span>)}</div>
              <p className="mt-2 text-xs leading-5 text-slate-500">{NOISE_LEVELS[captureSettings.noiseLevel].hint}</p>
            </div>
            <div>
              <label htmlFor="mc-pause" className="flex items-baseline justify-between text-sm text-slate-600">Pause before the AI replies<span className="font-medium text-[#252b3a]">{(captureSettings.pauseMs / 1000).toFixed(1)} s</span></label>
              <input id="mc-pause" type="range" min={PAUSE_RANGE.min} max={PAUSE_RANGE.max} step={PAUSE_RANGE.step} value={captureSettings.pauseMs} onChange={(event) => updateCaptureSettings({ pauseMs: Number(event.target.value) })} aria-valuetext={`${(captureSettings.pauseMs / 1000).toFixed(1)} seconds`} className="mt-3 w-full accent-[#a6192e]" />
              <div className="mt-1 flex justify-between text-[11px] text-slate-400" aria-hidden="true"><span>Faster</span><span>Recommended 0.7 s</span><span>Patient</span></div>
              <p className="mt-2 text-xs leading-5 text-slate-500">Silence that ends your turn. The AI starts replying about {((captureSettings.pauseMs + 600) / 1000).toFixed(1)} s after you stop; a hesitation longer than {(captureSettings.pauseMs / 1000).toFixed(1)} s ends your turn early.</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-500">Saved in this browser. Applied when a session starts{active ? '; this session keeps the settings it started with.' : '.'}</p>
        </details>
        <details className="mt-5 border-b border-[#e5e3df] pb-5">
          <summary className="cursor-pointer text-sm font-medium">System instructions</summary>
          <label htmlFor="mc-instructions" className="mt-5 block text-sm text-slate-600">Guide your AI co-host</label>
          <textarea id="mc-instructions" rows={10} maxLength={12000} value={instructions} disabled={active} onChange={(event) => setInstructions(event.target.value)} className="mt-2 w-full resize-y rounded-xl border border-slate-300 bg-white p-4 text-sm leading-6 focus:outline-[#a6192e] disabled:bg-slate-50" />
          <p className="mt-2 text-xs text-slate-500">{active ? 'End the session to edit. Changes apply to the next session.' : 'Changes stay in this tab. Add event details here before starting.'}</p>
        </details>
        <details className="mt-5 border-b border-[#e5e3df] pb-5">
          <summary className="cursor-pointer text-sm font-medium">Conversation transcript {live.messages.length > 0 && `(${live.messages.length})`}</summary>
          <div ref={transcriptRef} className="mt-5 max-h-80 space-y-5 overflow-y-auto" role="log" aria-label="Conversation transcript">
            {transcriptContent()}
          </div>
        </details>
        <p className="mt-8 text-xs leading-5 text-slate-500">AI-generated conversation · Cloned Dean voice<br />Microphone audio is sent during the session. End session disconnects the microphone and conversation.</p>
      </main>
      <audio ref={audioRef} onEnded={live.onAudioEnded} onError={onAudioError} />
    </div>
  );
}
