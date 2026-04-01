import React from 'react';

export default function ModelSelector({ label, models, value, onChange, disabled }) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: '12px',
        color: '#6b6b70',
        marginBottom: '6px',
        fontWeight: 500,
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
      }}>
        {label}
      </label>
      <select
        style={{
          width: '100%',
          padding: '10px 14px',
          background: '#111115',
          border: '1px solid #2a2a30',
          borderRadius: '8px',
          color: value ? '#e0ddd8' : '#5a5a60',
          fontSize: '13px',
          outline: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'border-color 0.2s ease',
          fontFamily: '"DM Sans", sans-serif',
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        onFocus={(e) => { e.target.style.borderColor = '#d4a053'; }}
        onBlur={(e) => { e.target.style.borderColor = '#2a2a30'; }}
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
