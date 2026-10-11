import './market.css';
import { MarketContext, useMarketDistrictState, useMarket } from './state/useMarketDistrict';
import './tower.css';
import { useEffect } from 'react';
import { Tower3D } from './components/Tower3D';
import { FloorInterior } from './components/FloorInterior';
import { EventLog } from './components/EventLog';
import { MarketErrorBoundary } from './components/ErrorBoundary';
import { fmtCents } from './services/money';
import type { CityBlock } from './types';

export interface MarketDistrictProps {
  /** Called by the "back" button in the HUD; omit to hide it. */
  onExit?: () => void;
  /** Decorative buildings around Market Tower, supplied by the city shell. */
  cityBlocks?: CityBlock[];
}

/** Self-contained district. Drop into any GhostGrid city view: <MarketDistrict onExit={...} />. */
export function MarketDistrict(props: MarketDistrictProps) {
  return (
    <MarketErrorBoundary onExit={props.onExit}>
      <MarketDistrictInner {...props} />
    </MarketErrorBoundary>
  );
}

function MarketDistrictInner({ onExit, cityBlocks }: MarketDistrictProps) {
  const state = useMarketDistrictState();
  const { view, setView, setOpenBuilding } = state;

  // ESC walks back out: floor → all floors → exterior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (view === 'floor') setOpenBuilding(null);
      else if (view === 'tower') setView('exterior');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, setView, setOpenBuilding]);

  return (
    <MarketContext.Provider value={state}>
      <div className={`mk-root mk-root--${view}`}>
        <Hud onExit={onExit} />
        <Scene cityBlocks={cityBlocks} />
        {view !== 'floor' && (
          <div className="mk-footer-log">
            <EventLog />
          </div>
        )}
      </div>
    </MarketContext.Provider>
  );
}

function Hud({ onExit }: MarketDistrictProps) {
  const { valuation, histories, symbols, loading, view } = useMarket();
  const sources = new Set(symbols.map((s) => histories[s]?.source).filter(Boolean));
  const demo = sources.has('DEMO');
  return (
    <header className="mk-hud">
      {onExit && <button className="mk-btn mk-btn--ghost" onClick={onExit}>◀ CITY</button>}
      <div className="mk-hud__title">
        <span className="mk-glitch" data-text="GHOSTGRID">GHOSTGRID</span>
        <span className="mk-dim">{view === 'exterior' ? 'NEON CITY · Click Market Tower to enter the Market District' : 'MARKET TOWER · Market District'}</span>
      </div>
      <div className="mk-hud__right">
        {loading ? (
          <span className="mk-badge">CONNECTING…</span>
        ) : (
          <span className={`mk-badge mk-badge--${demo ? 'demo' : 'live'}`}>{demo ? '▲ DEMO DATA' : '● LIVE FEED'}</span>
        )}
        <span className="mk-badge mk-badge--paper">PAPER ACCOUNT</span>
        <span className="mk-hud__eq">
          EQUITY <b>{fmtCents(valuation.equityCents)}</b>
          <span className={valuation.unrealizedCents >= 0 ? 'mk-up' : 'mk-down'}> {fmtCents(valuation.unrealizedCents)}</span>
        </span>
      </div>
    </header>
  );
}

function Scene({ cityBlocks }: { cityBlocks?: CityBlock[] }) {
  const { view, setView } = useMarket();
  return (
    <main className="mk-scene">
      <div className="mk-sky">
        <div className="mk-moon" />
        <div className="mk-skyline mk-skyline--far" />
        <div className="mk-skyline mk-skyline--near" />
      </div>
      <Tower3D cityBlocks={cityBlocks} />
      {view === 'tower' && (
        <div className="mk-scene__bar">
          <button className="mk-btn mk-btn--ghost" onClick={() => setView('exterior')}>◀ CITY</button>
          <span className="mk-hint">CLICK A FLOOR TO STEP INSIDE · ESC TO GO BACK</span>
        </div>
      )}
      {/* always mounted so entering a floor is just a reveal, not a heavy first render */}
      <FloorInterior active={view === 'floor'} />
    </main>
  );
}
