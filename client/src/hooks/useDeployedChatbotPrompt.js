import { useEffect, useState } from 'react';
import { setDeployedChatbotSystemPrompt } from '@/lib/chatbotSystemPrompt';
import { fetchDeployedChatbotSystemPrompt } from '@/services/chatbotPrompt';

/**
 * Loads the deployed assistant instructions once per mount.
 *
 * Returns a counter that increments when a deployed prompt arrives. Callers that
 * resolve the prompt inside a useMemo must list it as a dependency: the fetch
 * lands after first render, and without it the memo keeps the bundled default
 * forever — which is exactly how the GI build ignored every deploy.
 */
export function useDeployedChatbotPrompt() {
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { prompt } = await fetchDeployedChatbotSystemPrompt();
      if (cancelled || !prompt.trim()) return;
      setDeployedChatbotSystemPrompt(prompt);
      setLoadedCount((count) => count + 1);
    })();
    return () => { cancelled = true; };
  }, []);

  return loadedCount;
}
