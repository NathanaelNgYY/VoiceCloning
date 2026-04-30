import React, { useEffect, useRef, useState } from 'react';
import { getVoices, tts, setSelectedVoiceId } from '../services/api.js';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Volume2 } from 'lucide-react';

export default function InferencePage() {
  const [voices, setVoices] = useState([]);
  const [voiceId, setVoiceIdState] = useState(
    () => localStorage.getItem('elevenlabs-selected-voice') || ''
  );
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    getVoices()
      .then(res => setVoices(res.data))
      .catch(() => setError('Failed to load voices. Is the server running?'));
  }, []);

  function handleVoiceChange(id) {
    setVoiceIdState(id);
    setSelectedVoiceId(id);
  }

  async function handleGenerate() {
    if (!voiceId || !text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const blob = await tts(voiceId, text.trim());
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (err) {
      setError(err.message || 'Generation failed.');
    } finally {
      setLoading(false);
    }
  }

  const selectedVoiceName = voices.find(v => v.voiceId === voiceId)?.name || '';

  return (
    <div className="animate-fade-in space-y-6">
      <Card className="rounded-[22px] border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
              <Volume2 size={18} />
            </div>
            <div>
              <CardTitle className="text-base">Text to Speech</CardTitle>
              <CardDescription className="text-xs">
                Select a cloned voice and synthesize text
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>Voice</Label>
            <Select value={voiceId} onValueChange={handleVoiceChange}>
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="Select a cloned voice" />
              </SelectTrigger>
              <SelectContent>
                {voices.map(v => (
                  <SelectItem key={v.voiceId} value={v.voiceId}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {voiceId && selectedVoiceName && (
              <p className="text-xs text-muted-foreground">
                This voice will also be used in Live Chat.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tts-text">Text</Label>
            <Textarea
              id="tts-text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Enter text to synthesize..."
              rows={5}
              className="resize-none rounded-xl"
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={!voiceId || !text.trim() || loading}
            className="w-full rounded-xl"
          >
            {loading ? 'Generating...' : 'Generate'}
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {audioUrl && (
            <audio ref={audioRef} src={audioUrl} controls className="w-full" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
