import React, { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AudioPlayer({ audioBlob }) {
  const [audioUrl, setAudioUrl] = useState(null);

  useEffect(() => {
    if (!audioBlob) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioBlob]);

  if (!audioUrl) return null;

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

      <audio
        controls
        src={audioUrl}
        className="w-full"
      />

      <div className="mt-3.5">
        <Button variant="outline" size="sm" className="rounded-xl border-slate-200 bg-white/85" onClick={handleDownload}>
          <Download size={14} />
          Download WAV
        </Button>
      </div>
    </div>
  );
}
