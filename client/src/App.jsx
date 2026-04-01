import React from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import TrainingPage from './pages/TrainingPage.jsx';
import InferencePage from './pages/InferencePage.jsx';

const WaveformIcon = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ display: 'block' }}>
    <rect x="2" y="10" width="2.5" height="8" rx="1.25" fill="#E8654A" opacity="0.4" />
    <rect x="7" y="6" width="2.5" height="16" rx="1.25" fill="#E8654A" opacity="0.6" />
    <rect x="12" y="3" width="2.5" height="22" rx="1.25" fill="#E8654A" />
    <rect x="17" y="7" width="2.5" height="14" rx="1.25" fill="#D94E7A" opacity="0.7" />
    <rect x="22" y="9" width="2.5" height="10" rx="1.25" fill="#D94E7A" opacity="0.5" />
  </svg>
);

const TrainIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2v12M4 6l4-4 4 4" />
    <rect x="2" y="12" width="12" height="2" rx="1" fill="currentColor" stroke="none" opacity="0.2" />
  </svg>
);

const MicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="1" width="6" height="9" rx="3" />
    <path d="M3 7a5 5 0 0 0 10 0" />
    <path d="M8 12v3M6 15h4" />
  </svg>
);

export default function App() {
  const location = useLocation();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#F8F6F3' }}>
      {/* Header */}
      <header style={{
        background: 'rgba(255, 255, 255, 0.85)',
        borderBottom: '1px solid #E8E4DE',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}>
        <div style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '0 32px',
        }}>
          {/* Title row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 0 0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <WaveformIcon />
              <div>
                <h1 style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: '#1A1614',
                  letterSpacing: '-0.02em',
                  lineHeight: 1.2,
                  fontFamily: '"Space Grotesk", sans-serif',
                }}>
                  Voice Cloning Studio
                </h1>
                <p style={{
                  fontSize: '12px',
                  color: '#9B938A',
                  fontWeight: 400,
                  letterSpacing: '0.02em',
                  marginTop: '1px',
                }}>
                  GPT-SoVITS Training & Inference
                </p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav style={{
            display: 'flex',
            gap: '4px',
            marginTop: '12px',
          }}>
            <NavLink
              to="/"
              end
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '10px 18px',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#E8654A' : '#9B938A',
                borderBottom: isActive ? '2px solid #E8654A' : '2px solid transparent',
                transition: 'all 0.2s ease',
                letterSpacing: '0.01em',
              })}
            >
              <TrainIcon />
              Training
            </NavLink>
            <NavLink
              to="/inference"
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '10px 18px',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#E8654A' : '#9B938A',
                borderBottom: isActive ? '2px solid #E8654A' : '2px solid transparent',
                transition: 'all 0.2s ease',
                letterSpacing: '0.01em',
              })}
            >
              <MicIcon />
              Inference
            </NavLink>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main style={{
        flex: 1,
        padding: '28px 32px 48px',
        maxWidth: '1280px',
        width: '100%',
        margin: '0 auto',
      }}>
        <Routes>
          <Route path="/" element={<TrainingPage />} />
          <Route path="/inference" element={<InferencePage />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer style={{
        padding: '16px 32px',
        borderTop: '1px solid #E8E4DE',
        textAlign: 'center',
        fontSize: '11px',
        color: '#B8B0A6',
        letterSpacing: '0.03em',
      }}>
        Voice Cloning Studio — Built with GPT-SoVITS
      </footer>
    </div>
  );
}
