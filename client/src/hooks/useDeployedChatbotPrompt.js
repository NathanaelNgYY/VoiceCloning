import { useCallback, useEffect, useRef, useState } from 'react';
import {
  setDeployedChatbotSystemPrompt,
  getDeployedChatbotSystemPrompt,
} from '@/lib/chatbotSystemPrompt';
import {
  setDeployedChatbotDocuments,
  getDeployedChatbotDocuments,
} from '@/lib/chatbotDocuments';
import { fetchDeployedChatbotSystemPrompt } from '@/services/chatbotPrompt';

/** Cheap identity for a deployed config, so an unchanged poll causes no re-render. */
function fingerprint(prompt, documents) {
  return `${prompt.length}:${documents.map((d) => `${d.name}@${d.text.length}`).join('|')}`;
}

/**
 * Loads the deployed assistant instructions and reference documents.
 *
 * Returns `{ version, refresh }`. `version` increments whenever the deployed
 * config actually changes; callers that resolve the prompt inside a useMemo must
 * list it as a dependency, or the memo keeps the bundled default forever — which
 * is exactly how the GI build ignored every deploy.
 *
 * `refresh` exists because a lecture kiosk can stay open for hours across several
 * deploys. Fetching only at mount meant a lecturer who removed a PDF and deployed
 * still saw the old documents answered from in every later conversation, since
 * starting a new chat re-reads the prompt but never re-fetches it. Only a page
 * reload picked up a deploy, which is not something a student would ever do.
 */
export function useDeployedChatbotPrompt() {
  const [version, setVersion] = useState(0);
  const inFlightRef = useRef(false);
  const fingerprintRef = useRef(null);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const { prompt, documents } = await fetchDeployedChatbotSystemPrompt();
      // The service reports a failed fetch as empty values. Treating that as a
      // real config would drop a working assistant back to the bundled default
      // mid-lecture, so an empty result leaves whatever is already loaded alone.
      if (!prompt.trim() && documents.length === 0) return;

      const next = fingerprint(prompt, documents);
      if (next === fingerprintRef.current) return;
      fingerprintRef.current = next;

      setDeployedChatbotSystemPrompt(prompt);
      setDeployedChatbotDocuments(documents);
      setVersion((count) => count + 1);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Seed the fingerprint from whatever a sibling hook already loaded, so the
    // first fetch of an unchanged config does not force a needless re-render.
    if (fingerprintRef.current === null) {
      fingerprintRef.current = fingerprint(
        getDeployedChatbotSystemPrompt(),
        getDeployedChatbotDocuments(),
      );
    }
    refresh();
  }, [refresh]);

  return { version, refresh };
}
