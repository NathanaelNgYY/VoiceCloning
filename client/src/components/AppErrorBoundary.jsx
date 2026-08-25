import { Component } from 'react';

import { describeRenderCrash } from '@/lib/renderCrash';

// Inline styles, not Tailwind classes or the palette variables, on purpose.
// This renders precisely when the app is broken, and a stylesheet that failed
// to load is one of the things that can break it. The fallback must not depend
// on anything the crash might have taken with it.
//
// The colours are fixed light rather than theme-aware for the same reason:
// `.gi-root` is applied by GiApp, which is inside the boundary and may never
// have mounted, so there is no reliable theme to follow here.
const styles = {
  screen: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: '#f5f6f8',
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  card: {
    maxWidth: '520px',
    width: '100%',
    background: '#ffffff',
    borderRadius: '12px',
    border: '1px solid #e4e6ea',
    padding: '32px',
    color: '#14161a',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
  },
  heading: { margin: '0 0 12px', fontSize: '20px', fontWeight: 600 },
  body: { margin: '0 0 24px', fontSize: '15px', lineHeight: 1.55, color: '#4a4f57' },
  button: {
    appearance: 'none',
    border: 'none',
    borderRadius: '8px',
    background: '#14161a',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 500,
    padding: '10px 20px',
    cursor: 'pointer',
  },
  details: { marginTop: '24px', fontSize: '13px', color: '#6b7280' },
  detail: {
    margin: '8px 0 0',
    padding: '12px',
    background: '#f5f6f8',
    borderRadius: '8px',
    fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: '#14161a',
  },
};

/**
 * Catches anything thrown while rendering and shows it, instead of letting
 * React unmount the tree into a white screen.
 *
 * This exists because that white screen has now shipped to students twice: a
 * render loop in useVideoTopicThumbnails (2026-08-21) and a temporal dead zone
 * in useGiChatEngine (2026-08-25). Both were one-line mistakes, and both were
 * invisible — the page was blank, the network tab was clean, and the cause was
 * only ever legible in a console nobody had open. Neither is prevented by a
 * boundary, but with one the student sees a message and we get the error name
 * on sight instead of reconstructing it in a headless browser.
 *
 * Deliberately mounted above the router: a crash inside AppProviders (MSAL
 * bootstrap, for one) happens before any route renders, and a boundary under
 * the router would never see it.
 */
export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crash: null };
  }

  static getDerivedStateFromError(error) {
    return { crash: describeRenderCrash(error) };
  }

  componentDidCatch(error, info) {
    // Tagged so it is greppable from a CDP console dump, which is how a runtime
    // failure on the deployed site actually gets read — the client suite never
    // renders React, so nothing of this class shows up in tests.
    console.error('[app] render crashed:', error, info?.componentStack ?? '');
  }

  render() {
    const { crash } = this.state;
    if (!crash) return this.props.children;

    return (
      <div style={styles.screen} role="alert">
        <div style={styles.card}>
          <h1 style={styles.heading}>This page didn&rsquo;t load</h1>
          <p style={styles.body}>
            Something went wrong while displaying it. Reloading usually fixes it. If it
            keeps happening, send whoever maintains this site the details below.
          </p>
          <button
            type="button"
            style={styles.button}
            onClick={() => window.location.reload()}
          >
            Reload the page
          </button>
          <details style={styles.details}>
            <summary>Technical details</summary>
            <p style={styles.detail}>{crash}</p>
          </details>
        </div>
      </div>
    );
  }
}
