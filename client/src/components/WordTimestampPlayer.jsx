import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { findActiveWordIndex } from '@/lib/wordTimestamps';

export default function WordTimestampPlayer({
  audioBlob,
  wordTimestamps,
  transcript,
  showDownload = true,
}) {
  const [audioUrl, setAudioUrl] = useState(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const audioRef = useRef(null);

  useEffect(() => {
    if (!audioBlob) {
      setAudioUrl(null);
      setActiveIndex(-1);
      return undefined;
    }

    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    setActiveIndex(-1);
    return () => URL.revokeObjectURL(url);
  }, [audioBlob]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !Array.isArray(wordTimestamps) || wordTimestamps.length === 0) {
      setActiveIndex(-1);
      return undefined;
    }

    const handleTimeUpdate = () => {
      setActiveIndex(findActiveWordIndex(wordTimestamps, audio.currentTime));
    };
    const handleReset = () => setActiveIndex(-1);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleReset);
    audio.addEventListener('pause', handleReset);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleReset);
      audio.removeEventListener('pause', handleReset);
    };
  }, [wordTimestamps, audioUrl]);

  if (!audioUrl) return null;

  const hasTimestamps = Array.isArray(wordTimestamps) && wordTimestamps.length > 0;
  const hasTranscript = Boolean(transcript?.trim());

  function handleDownload() {
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `synthesized_${Date.now()}.wav`;
    a.click();
  }

  return (
    <div className="animate-slide-in rounded-[24px] border border-emerald-100 bg-[linear-gradient(135deg,rgba(236,253,245,0.95),rgba(239,246,255,0.9))] p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="h-2 w-2 rounded-full bg-success" />
        <span className="text-sm font-medium text-foreground">
          Generated Audio
        </span>
      </div>

      {(hasTimestamps || hasTranscript) && (
        <div className="mb-4 rounded-2xl border border-white/80 bg-white/75 px-4 py-3 text-sm text-slate-700 shadow-sm">
          {hasTimestamps ? (
            <div className="flex flex-wrap items-end gap-x-1 gap-y-2">
              {wordTimestamps.map((item, index) => (
                <div
                  key={`${item.word}-${item.start}-${index}`}
                  className="inline-flex flex-col items-center gap-0.5"
                >
                  <span
                    className={cn(
                      'font-mono text-[9px]',
                      index === activeIndex ? 'text-amber-600' : 'text-slate-400'
                    )}
                  >
                    {(typeof item.start === 'number' && isFinite(item.start) ? item.start : 0).toFixed(2)}
                  </span>
                  <span
                    className={cn(
                      'rounded px-0.5 transition-colors',
                      index === activeIndex && 'bg-yellow-200 text-slate-950'
                    )}
                  >
                    {item.word}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">{transcript}</span>
          )}
        </div>
      )}

      <audio
        ref={audioRef}
        controls
        src={audioUrl}
        className="w-full"
      />

      {showDownload && (
        <div className="mt-3.5">
          <Button variant="outline" size="sm" className="rounded-xl border-slate-200 bg-white/85" onClick={handleDownload}>
            <Download size={14} />
            Download WAV
          </Button>
        </div>
      )}
    </div>
  );
}
