import React from 'react';

export const App: React.FC = () => {
  return (
    <div className="app-container">
      <header>
        <div className="logo-badge">Photo-to-Procedural-Art</div>
        <span className="phase-pill">Phase 0 Foundation</span>
      </header>
      <main>
        <div style={{ textAlign: 'center', marginTop: '4rem' }}>
          <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem', fontWeight: 600 }}>
            Procedural Artwork Engine
          </h1>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '600px', margin: '0 auto', lineHeight: 1.6 }}>
            Universal headless architecture established. Core algorithmic engine decoupled from web UI. Ready for Phase 1 feasibility testing.
          </p>
        </div>
      </main>
    </div>
  );
};
