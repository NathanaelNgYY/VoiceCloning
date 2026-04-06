import React from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import TrainingPage from './pages/TrainingPage.jsx';
import InferencePage from './pages/InferencePage.jsx';

export default function App() {
  const location = useLocation();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      {/* Masthead */}
      <header style={{
        borderBottom: '1px solid var(--border-strong)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'var(--bg-base)',
      }}>
        <div style={{
          maxWidth: '960px',
          margin: '0 auto',
          padding: '0 40px',
        }}>
          {/* Title row */}
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            padding: '28px 0 0',
          }}>
            <div>
              <h1 style={{
                fontSize: '28px',
                fontWeight: 400,
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
                fontFamily: 'var(--font-display)',
              }}>
                Voice Cloning Studio
              </h1>
              <p style={{
                fontSize: '12px',
                color: 'var(--text-tertiary)',
                fontWeight: 400,
                letterSpacing: '0.08em',
                marginTop: '6px',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-body)',
              }}>
                GPT-SoVITS Training & Inference
              </p>
            </div>
            {/* Red dot — a subtle brand mark */}
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--accent)',
              flexShrink: 0,
            }} />
          </div>

          {/* Navigation */}
          <nav style={{
            display: 'flex',
            gap: '0',
            marginTop: '20px',
          }}>
            <NavLink
              to="/"
              end
              style={({ isActive }) => ({
                display: 'inline-block',
                padding: '10px 0',
                marginRight: '32px',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 0.15s ease',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-body)',
              })}
            >
              Training
            </NavLink>
            <NavLink
              to="/inference"
              style={({ isActive }) => ({
                display: 'inline-block',
                padding: '10px 0',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 0.15s ease',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-body)',
              })}
            >
              Inference
            </NavLink>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main style={{
        flex: 1,
        padding: '48px 40px 80px',
        maxWidth: '960px',
        width: '100%',
        margin: '0 auto',
      }}>
        <Routes>
          <Route path="/" element={<TrainingPage />} />
          <Route path="/inference" element={<InferencePage />} />
        </Routes>
      </main>

      {/* Footer — a single hairline and quiet credit */}
      <footer style={{
        borderTop: '1px solid var(--border-hairline)',
        padding: '20px 40px',
        maxWidth: '960px',
        width: '100%',
        margin: '0 auto',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-body)',
        }}>
          Voice Cloning Studio
        </span>
        <span style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          letterSpacing: '0.02em',
          fontFamily: 'var(--font-body)',
        }}>
          Built with GPT-SoVITS
        </span>
      </footer>
    </div>
  );
}
