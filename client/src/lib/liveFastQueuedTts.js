import { splitLiveReplyChunks } from '../hooks/liveConversation.js';

export async function generateLiveFastQueuedTts({
  text,
  baseParams,
  synthesizeSentence,
  createObjectUrl,
  onClipReady,
  onProgress,
  splitText = splitLiveReplyChunks,
}) {
  const phrases = splitText(text);
  if (phrases.length === 0) {
    throw new Error('No text to synthesize');
  }

  const clips = [];
  onProgress?.({ total: phrases.length, current: 0, text: phrases[0] || '' });

  for (let index = 0; index < phrases.length; index += 1) {
    const phrase = phrases[index];
    onProgress?.({ total: phrases.length, current: index + 1, text: phrase });
    const result = await synthesizeSentence({ ...baseParams, text: phrase });
    const url = createObjectUrl(result.blob);
    const clip = {
      index,
      total: phrases.length,
      text: phrase,
      blob: result.blob,
      url,
    };
    clips.push(clip);
    onClipReady?.(clip);
  }

  return {
    phrases,
    clips,
  };
}
