import React from 'react';

const statusConfig = {
  pending:  { dotBg: 'transparent', dotBorder: 'var(--border-default)', textColor: 'var(--text-muted)', lineColor: 'var(--border-hairline)' },
  running:  { dotBg: 'var(--accent)', dotBorder: 'var(--accent)', textColor: 'var(--accent)', lineColor: 'var(--border-hairline)' },
  done:     { dotBg: 'var(--text-primary)', dotBorder: 'var(--text-primary)', textColor: 'var(--text-primary)', lineColor: 'var(--text-primary)' },
  error:    { dotBg: 'var(--accent)', dotBorder: 'var(--accent)', textColor: 'var(--accent)', lineColor: 'var(--border-hairline)' },
  skipped:  { dotBg: 'transparent', dotBorder: 'var(--border-default)', textColor: 'var(--text-muted)', lineColor: 'var(--border-hairline)' },
};

function StepDot({ status }) {
  const config = statusConfig[status];

  if (status === 'done') {
    return (
      <div style={{
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        background: config.dotBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.3s ease',
      }}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 5l2.5 2.5L8 3" />
        </svg>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        background: config.dotBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 2l4 4M6 2l-4 4" />
        </svg>
      </div>
    );
  }

  if (status === 'running') {
    return (
      <div style={{
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        background: config.dotBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'pulse-dot 1.5s ease-in-out infinite',
      }}>
        <div style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'white',
        }} />
      </div>
    );
  }

  // pending / skipped
  return (
    <div style={{
      width: '20px',
      height: '20px',
      borderRadius: '50%',
      background: config.dotBg,
      border: `1.5px solid ${config.dotBorder}`,
      transition: 'all 0.3s ease',
    }} />
  );
}

export default function ProgressTracker({ steps }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0',
      overflowX: 'auto',
      padding: '4px 0',
    }}>
      {steps.map((step, i) => {
        const config = statusConfig[step.status];
        const isActive = step.status === 'running';
        const isDone = step.status === 'done';

        return (
          <React.Fragment key={step.index}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              minWidth: '80px',
              flex: 1,
              position: 'relative',
            }}>
              <StepDot status={step.status} />

              {/* Step label */}
              <span style={{
                marginTop: '10px',
                fontSize: '10px',
                fontWeight: isActive ? 600 : 400,
                textAlign: 'center',
                color: config.textColor,
                lineHeight: '1.3',
                maxWidth: '76px',
                transition: 'color 0.3s ease',
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-body)',
              }}>
                {step.name}
              </span>
            </div>

            {/* Connector line */}
            {i < steps.length - 1 && (
              <div style={{
                flex: 1,
                height: '1px',
                alignSelf: 'center',
                marginTop: '-20px',
                minWidth: '8px',
                background: isDone ? 'var(--text-primary)' : 'var(--border-hairline)',
                transition: 'background 0.4s ease',
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
