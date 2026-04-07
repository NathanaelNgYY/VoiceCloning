import { useState, useEffect, useRef, useCallback } from 'react';
import { connectInferenceSSE } from '../services/sse.js';

export function useInferenceSSE() {
  const [status, setStatus] = useState('idle'); // idle | generating | complete | error | cancelled
  const [totalChunks, setTotalChunks] = useState(0);
  const [completedChunks, setCompletedChunks] = useState(0);
  const [currentChunkText, setCurrentChunkText] = useState('');
  const [error, setError] = useState(null);
  const esRef = useRef(null);

  const connect = useCallback((sessionId) => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setStatus('generating');
    setTotalChunks(0);
    setCompletedChunks(0);
    setCurrentChunkText('');
    setError(null);

    esRef.current = connectInferenceSSE(sessionId, {
      onStart(data) {
        setTotalChunks(data.totalChunks);
      },
      onChunkStart(data) {
        setCurrentChunkText(data.text);
      },
      onChunkComplete(data) {
        setCompletedChunks(data.index + 1);
      },
      onComplete() {
        setStatus('complete');
        setCurrentChunkText('');
      },
      onError(data) {
        const isCancelled = data?.message?.includes('cancelled');
        setStatus(isCancelled ? 'cancelled' : 'error');
        setError(data?.message || 'Unknown error');
        setCurrentChunkText('');
      },
    });
  }, []);

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    disconnect();
    setStatus('idle');
    setTotalChunks(0);
    setCompletedChunks(0);
    setCurrentChunkText('');
    setError(null);
  }, [disconnect]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return { status, totalChunks, completedChunks, currentChunkText, error, connect, disconnect, reset };
}
