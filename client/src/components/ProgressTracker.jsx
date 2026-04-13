import React from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

function StepDot({ status }) {
  if (status === 'done') {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success shadow-[0_12px_30px_-18px_rgba(16,185,129,0.85)] transition-all">
        <Check size={15} className="text-white" strokeWidth={2.5} />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive shadow-[0_12px_30px_-18px_rgba(239,68,68,0.85)]">
        <X size={13} className="text-white" strokeWidth={2.5} />
      </div>
    );
  }

  if (status === 'running') {
    return (
      <div className="flex h-8 w-8 animate-pulse-dot items-center justify-center rounded-full bg-primary shadow-[0_12px_30px_-18px_rgba(14,165,233,0.9)]">
        <div className="h-2.5 w-2.5 rounded-full bg-white" />
      </div>
    );
  }

  return (
    <div className="h-8 w-8 rounded-full border-2 border-border bg-white/70 transition-all" />
  );
}

export default function ProgressTracker({ steps }) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-start gap-3">
        {steps.map((step, i) => {
          const isActive = step.status === 'running';
          const isDone = step.status === 'done';
          const statusText = isActive
            ? 'Running'
            : isDone
              ? 'Done'
              : step.status === 'error'
                ? 'Error'
                : 'Pending';

          return (
            <React.Fragment key={step.index}>
              <div
                className={cn(
                  'w-[215px] shrink-0 rounded-[22px] border p-4 transition-all',
                  isDone && 'border-emerald-200 bg-emerald-50/80',
                  isActive && 'border-sky-200 bg-sky-50/85 shadow-[0_18px_35px_-28px_rgba(14,165,233,0.75)]',
                  step.status === 'error' && 'border-rose-200 bg-rose-50/85',
                  step.status === 'pending' && 'border-slate-200 bg-white',
                  step.status === 'skipped' && 'border-slate-200 bg-slate-50/80',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <StepDot status={step.status} />
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]',
                      isDone && 'bg-emerald-100 text-emerald-700',
                      isActive && 'bg-sky-100 text-sky-700',
                      step.status === 'error' && 'bg-rose-100 text-rose-700',
                      (step.status === 'pending' || step.status === 'skipped') && 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {statusText}
                  </span>
                </div>

                <div className="mt-4">
                  <p
                    className={cn(
                      'text-sm font-semibold leading-6 transition-colors',
                      isActive && 'text-primary',
                      isDone && 'text-success',
                      step.status === 'error' && 'text-destructive',
                      (step.status === 'pending' || step.status === 'skipped') && 'text-foreground',
                    )}
                  >
                    {step.name}
                  </p>

                  <p className="mt-2 min-h-[2.75rem] text-sm leading-6 text-slate-500">
                    {step.detail || (isActive
                      ? 'Currently processing this stage.'
                      : isDone
                        ? 'Completed successfully.'
                        : step.status === 'error'
                          ? 'This stage needs attention.'
                          : 'Waiting for earlier stages to finish.')}
                  </p>
                </div>
              </div>

              {i < steps.length - 1 && (
                <div className="flex h-[118px] w-8 shrink-0 items-center justify-center">
                  <div className={cn(
                    'h-0.5 w-full rounded-full',
                    isDone ? 'bg-emerald-300' : 'bg-slate-200',
                  )} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
