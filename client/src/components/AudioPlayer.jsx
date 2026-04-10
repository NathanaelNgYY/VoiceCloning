import React, { useState, useEffect } from 'react';
import { Download, Volume2 } from 'lucide-react';
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
    <div className="animate-slide-in border-t pt-5">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="h-2 w-2 rounded-full bg-success" />
        <span className="text-sm font-medium text-foreground">
          Generated Audio
        </span>
      </div>

      <audio
        controls
        src={audioUrl}
        autoPlay
        className="w-full"
      />

      <div className="mt-3.5">
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download size={14} />
          Download WAV
        </Button>
      </div>
    </div>
  );
}
