import React, { useEffect, useState } from 'react';
import AudioUploader from '../components/AudioUploader.jsx';
import { getVoices, cloneVoice, deleteVoice } from '../services/api.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Mic, Trash2 } from 'lucide-react';

export default function CloningPage() {
  const [voices, setVoices] = useState([]);
  const [name, setName] = useState('');
  const [files, setFiles] = useState([]);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function loadVoices() {
    try {
      const res = await getVoices();
      setVoices(res.data);
    } catch {
      // silently fail on list load
    }
  }

  useEffect(() => { loadVoices(); }, []);

  async function handleClone() {
    if (!name.trim() || files.length === 0) return;
    setCloning(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await cloneVoice(name.trim(), files);
      setSuccess(`Voice "${res.data.name}" cloned successfully.`);
      setName('');
      setFiles([]);
      await loadVoices();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Cloning failed.');
    } finally {
      setCloning(false);
    }
  }

  async function handleDelete(voiceId) {
    try {
      await deleteVoice(voiceId);
      await loadVoices();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Delete failed.');
    }
  }

  return (
    <div className="animate-fade-in space-y-8">
      <Card className="rounded-[22px] border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
              <Mic size={18} />
            </div>
            <div>
              <CardTitle className="text-base">Clone a new voice</CardTitle>
              <CardDescription className="text-xs">
                Upload audio samples — ElevenLabs will create a cloned voice in seconds
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="voice-name">Voice name</Label>
            <Input
              id="voice-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. My Voice"
              disabled={cloning}
            />
          </div>
          <AudioUploader files={files} onFilesChange={setFiles} disabled={cloning} />
          <Button
            onClick={handleClone}
            disabled={cloning || !name.trim() || files.length === 0}
            className="w-full rounded-xl"
          >
            {cloning ? 'Cloning...' : 'Clone Voice'}
          </Button>
          {success && <p className="text-sm text-emerald-600">{success}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-950">Your cloned voices</h2>
        {voices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cloned voices yet. Clone one above.</p>
        ) : (
          <ul className="space-y-2">
            {voices.map(v => (
              <li
                key={v.voiceId}
                className="flex items-center justify-between rounded-[16px] border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <span className="text-sm font-medium text-slate-900">{v.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(v.voiceId)}
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
