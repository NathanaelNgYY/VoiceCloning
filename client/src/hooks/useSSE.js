import { useState, useEffect, useRef, useCallback } from 'react';
import { connectSSE } from '../services/sse.js';

const STEP_NAMES = [
  'Slice Audio',
  'Denoise',
  'ASR (Speech Recognition)',
  'Extract Text Features',
  'Extract HuBERT Features',
  'Extract Semantic Features',
  'Train SoVITS',
  'Train GPT',
];

export function useSSE() {
  const [logs, setLogs] = useState([]);
  const [steps, setSteps] = useState(
    STEP_NAMES.map((name, i) => ({ index: i, name, status: 'pending' }))
  );
  const [pipelineStatus, setPipelineStatus] = useState('idle'); // idle | running | complete | error
  const [error, setError] = useState(null);
  const esRef = useRef(null);

  const connect = useCallback((sessionId) => {
    // Reset state
    setLogs([]);
    setSteps(STEP_NAMES.map((name, i) => ({ index: i, name, status: 'pending' })));
    setPipelineStatus('running');
    setError(null);

    esRef.current = connectSSE(sessionId, {
      onLog(data) {
        setLogs(prev => [...prev, data]);
      },
      onStepStart(data) {
        setSteps(prev => prev.map(s =>
          s.index === data.step ? { ...s, status: data.status || 'running' } : s
        ));
      },
      onStepComplete(data) {
        setSteps(prev => prev.map(s =>
          s.index === data.step ? { ...s, status: data.code === 0 ? 'done' : 'error' } : s
        ));
      },
      onComplete() {
        setPipelineStatus('complete');
      },
      onError(data) {
        setError(data.message);
        setPipelineStatus('error');
        // Mark the currently running step as errored
        setSteps(prev => prev.map(s =>
          s.status === 'running' ? { ...s, status: 'error' } : s
        ));
      },
    });
  }, []);

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return { logs, steps, pipelineStatus, error, connect, disconnect };
}

export { STEP_NAMES };
