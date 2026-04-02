import React from 'react';

const statusConfig = {
  pending: { color: '#DDD8D0', iconColor: '#B8B0A6', bg: 'transparent' },
  running: { color: '#E8654A', iconColor: '#FFFFFF', bg: '#E8654A' },
  done: { color: '#2D9D6F', iconColor: '#FFFFFF', bg: '#2D9D6F' },
  error: { color: '#D94545', iconColor: '#FFFFFF', bg: '#D94545' },
  skipped: { color: '#C8C2B8', iconColor: '#B8B0A6', bg: 'transparent' },
};

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7l3 3 5-5" />
  </svg>
);

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M3 3l6 6M9 3l-6 6" />
  </svg>
);

const SpinnerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
    <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
    <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

function StepIcon({ status, index }) {
  const config = statusConfig[status];

  if (status === 'done') return <CheckIcon />;
  if (status === 'error') return <XIcon />;
  if (status === 'running') return <SpinnerIcon />;

  return (
    <span style={{ fontSize: '11px', fontWeight: 600, color: config.iconColor }}>
      {index + 1}
    </span>
  );
}

export default function ProgressTracker({ steps }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0',
      overflowX: 'auto',
      padding: '8px 0',
    }}>
      {steps.map((step, i) => {
        const config = statusConfig[step.status];
        const isActive = step.status === 'running';
        const isDone = step.status === 'done';
        const isError = step.status === 'error';

        return (
          <React.Fragment key={step.index}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              minWidth: '90px',
              flex: 1,
              position: 'relative',
            }}>
              {/* Step circle */}
              <div style={{
                width: '34px',
                height: '34px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: config.bg,
                border: (step.status === 'pending' || step.status === 'skipped')
                  ? `2px solid ${config.color}` : 'none',
                color: config.iconColor,
                transition: 'all 0.3s ease',
                ...(isActive ? {
                  animation: 'pulse-glow 2s ease-in-out infinite',
                  boxShadow: '0 0 12px rgba(232, 101, 74, 0.35)',
                } : {}),
                ...(isDone ? {
                  boxShadow: '0 0 8px rgba(45, 157, 111, 0.25)',
                } : {}),
                ...(isError ? {
                  boxShadow: '0 0 8px rgba(217, 69, 69, 0.25)',
                } : {}),
              }}>
                <StepIcon status={step.status} index={i} />
              </div>

              {/* Step label */}
              <span style={{
                marginTop: '8px',
                fontSize: '11px',
                fontWeight: isActive ? 600 : 400,
                textAlign: 'center',
                color: isActive ? '#E8654A' : isDone ? '#2D9D6F' : isError ? '#D94545' : '#9B938A',
                lineHeight: '1.3',
                maxWidth: '80px',
                transition: 'color 0.3s ease',
              }}>
                {step.name}
              </span>
            </div>

            {/* Connector */}
            {i < steps.length - 1 && (
              <div style={{
                flex: 1,
                height: '2px',
                alignSelf: 'center',
                marginTop: '-18px',
                minWidth: '8px',
                background: isDone ? '#2D9D6F' : '#E8E4DE',
                borderRadius: '1px',
                transition: 'background 0.5s ease',
                ...(isDone ? {
                  boxShadow: '0 0 4px rgba(45, 157, 111, 0.15)',
                } : {}),
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
