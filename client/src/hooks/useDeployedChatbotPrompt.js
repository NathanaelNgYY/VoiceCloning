import { useEffect, useState } from 'react';
import { setDeployedChatbotSystemPrompt } from '@/lib/chatbotSystemPrompt';
import { setDeployedChatbotDocuments } from '@/lib/chatbotDocuments';
import { fetchDeployedChatbotSystemPrompt } from '@/services/chatbotPrompt';

/**
 * Loads the deployed assistant instructions and reference documents once per mount.
 *
 * Returns a counter that increments when a deployed configuration arrives. Callers
 * that resolve the prompt inside a useMemo must list it as a dependency: the fetch
 * lands after first render, and without it the memo keeps the bundled default
 * forever — which is exactly how the GI build ignored every deploy.
 */
export function useDeployedChatbotPrompt() {
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { prompt, documents } = await fetchDeployedChatbotSystemPrompt();
      if (cancelled) return;
      // Documents count as a deployed configuration on their own. Gating the
      // whole update on a non-empty prompt would strand them whenever the
      // deployed prompt is empty and the bundled default is in play.
      if (!prompt.trim() && documents.length === 0) return;
      setDeployedChatbotSystemPrompt(prompt);
      setDeployedChatbotDocuments(documents);
      setLoadedCount((count) => count + 1);
    })();
    return () => { cancelled = true; };
  }, []);

  return loadedCount;
}
