import { useMarket } from '../state/useMarketDistrict';
import { AssetTabs, SourceBadge, Stat } from './common';
import { PriceChart } from './PriceChart';
import { SMA_LONG, SMA_SHORT } from '../services/signalService';

export function SignalPanel() {
  const { selected, signal, runSignal, histories, statuses, setOpenBuilding } = useMarket();
  const h = histories[selected];
  const sig = signal?.symbol === selected ? signal : null;
  const running = statuses.signal === 'RUNNING';
  return (
    <>
      <AssetTabs />
      <div className="mk-note mk-note--info">
        ENGINE: <b>RULE_SMA</b> — deterministic SMA{SMA_SHORT}/SMA{SMA_LONG} crossover. This is a rule, <b>not AI reasoning</b>.
        LLM agent slot reserved (<code>SignalProvider</code>).
      </div>
      <button className="mk-btn mk-btn--primary" onClick={() => runSignal(selected)} disabled={running || !h}>
        {running ? 'ANALYZING…' : `▶ ANALYZE ${selected}`}
      </button>
      {sig ? (
        <>
          <div className={`mk-signal mk-signal--${sig.action.toLowerCase()}`}>
            <div className="mk-signal__action">{sig.action}</div>
            <div className="mk-signal__meta">
              strength {(sig.strength * 100).toFixed(0)}% · {new Date(sig.generatedAt).toLocaleTimeString()}
              <SourceBadge source={sig.dataSource} />
            </div>
          </div>
          <div className="mk-grid3">
            <Stat label={`SMA${SMA_SHORT}`} value={sig.metrics.smaShort.toFixed(2)} />
            <Stat label={`SMA${SMA_LONG}`} value={sig.metrics.smaLong.toFixed(2)} />
            <Stat label="SPREAD" value={`${sig.metrics.spreadPct.toFixed(2)}%`} tone={sig.metrics.spreadPct >= 0 ? 'up' : 'down'} />
          </div>
          <h4 className="mk-h4">WHY</h4>
          <ul className="mk-list">{sig.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <h4 className="mk-h4">RISKS</h4>
          <ul className="mk-list mk-list--warn">{sig.risks.map((r) => <li key={r}>{r}</li>)}</ul>
          {sig.action !== 'HOLD' && (
            <button className="mk-btn" onClick={() => setOpenBuilding('trading')}>→ Take elevator to 3F Paper Trading</button>
          )}
        </>
      ) : (
        <div className="mk-empty">No signal yet for {selected}. Press ANALYZE.</div>
      )}
      {h && <PriceChart points={h.points} color="auto" smaWindows={[SMA_SHORT, SMA_LONG]} height={180} />}
    </>
  );
}
