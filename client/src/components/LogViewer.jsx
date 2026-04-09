import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function LogViewer({ logs }) {
  const contentRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleScroll() {
    if (!contentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      {/* Terminal header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Output
          </span>
          {logs.length > 0 && (
            <span className="font-mono text-[10px] text-slate-600">
              {logs.length} lines
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 px-2.5 font-mono text-[10px] uppercase tracking-wider",
            autoScroll
              ? "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
              : "text-slate-500 hover:bg-slate-800 hover:text-slate-400"
          )}
          onClick={() => setAutoScroll(!autoScroll)}
        >
          Auto-scroll {autoScroll ? 'on' : 'off'}
        </Button>
      </div>

      {/* Log content */}
      <div
        ref={contentRef}
        className="h-[300px] overflow-y-auto whitespace-pre-wrap break-all px-4 py-3.5 font-mono text-xs leading-relaxed"
        onScroll={handleScroll}
      >
        {logs.map((log, i) => (
          <div
            key={i}
            className={log.stream === 'stderr' ? 'text-red-400' : 'text-slate-400'}
          >
            {log.data}
          </div>
        ))}
        {logs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-600">
            <span>Waiting for output...</span>
          </div>
        )}
      </div>
    </div>
  );
}
