import React from 'react';

export default function ModelSelector({ label, models, value, onChange, disabled }) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: '10px',
        color: 'var(--text-tertiary)',
        marginBottom: '8px',
        fontWeight: 500,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-body)',
      }}>
        {label}
      </label>
      <select
        style={{
          width: '100%',
          padding: '10px 14px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-sm)',
          color: value ? 'var(--text-primary)' : 'var(--text-muted)',
          fontSize: '13px',
          outline: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          transition: 'border-color 0.15s ease',
          fontFamily: 'var(--font-body)',
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        onFocus={(e) => { e.target.style.borderColor = 'var(--text-primary)'; }}
        onBlur={(e) => { e.target.style.borderColor = 'var(--border-default)'; }}
      >
        <option value="">Select a model...</option>
        {models.map((m) => (
          <option key={m.path} value={m.path}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}
