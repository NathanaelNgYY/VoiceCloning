import React from 'react';

export default function ModelSelector({ label, models, value, onChange, disabled }) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: '12px',
        color: '#9B938A',
        marginBottom: '6px',
        fontWeight: 500,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>
        {label}
      </label>
      <select
        style={{
          width: '100%',
          padding: '10px 14px',
          background: '#F8F6F3',
          border: '1px solid #E8E4DE',
          borderRadius: '10px',
          color: value ? '#1A1614' : '#9B938A',
          fontSize: '13px',
          outline: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          fontFamily: '"DM Sans", sans-serif',
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        onFocus={(e) => { e.target.style.borderColor = '#E8654A'; e.target.style.boxShadow = '0 0 0 3px rgba(232, 101, 74, 0.1)'; }}
        onBlur={(e) => { e.target.style.borderColor = '#E8E4DE'; e.target.style.boxShadow = 'none'; }}
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
