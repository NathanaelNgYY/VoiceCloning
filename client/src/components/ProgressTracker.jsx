import React from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

function StepDot({ status }) {
  if (status === 'done') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-success transition-all">
        <Check size={14} className="text-white" strokeWidth={2.5} />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive">
        <X size={12} className="text-white" strokeWidth={2.5} />
      </div>
    );
  }

  if (status === 'running') {
    return (
      <div className="flex h-6 w-6 animate-pulse-dot items-center justify-center rounded-full bg-primary">
        <div className="h-2 w-2 rounded-full bg-white" />
      </div>
    );
  }

  // pending / skipped
  return (
    <div className="h-6 w-6 rounded-full border-2 border-border bg-transparent transition-all" />
  );
}

export default function ProgressTracker({ steps }) {
  return (
    <div className="flex items-start overflow-x-auto py-1">
      {steps.map((step, i) => {
        const isActive = step.status === 'running';
        const isDone = step.status === 'done';

        return (
          <React.Fragment key={step.index}>
            <div className="relative flex min-w-[80px] flex-1 flex-col items-center">
              <StepDot status={step.status} />

              <span
                className={cn(
                  "mt-2.5 max-w-[76px] text-center text-[10px] uppercase tracking-wide transition-colors",
                  isActive && "font-semibold text-primary",
                  isDone && "font-medium text-success",
                  step.status === 'error' && "font-medium text-destructive",
                  step.status === 'pending' && "text-muted-foreground",
                  step.status === 'skipped' && "text-muted-foreground"
                )}
              >
                {step.name}
              </span>
            </div>

            {/* Connector line */}
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "mt-3 min-w-[8px] flex-1 self-start transition-colors",
                  isDone ? "h-0.5 bg-success" : "h-px bg-border"
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
