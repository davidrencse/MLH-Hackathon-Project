import { useMarket } from '../state/useMarketDistrict';
import type { BuildingId } from '../types';

export function EventLog({ building }: { building?: BuildingId }) {
  const { events } = useMarket();
  const list = (building ? events.filter((e) => e.building === building) : events).slice(0, 12);
  return (
    <div className="mk-log">
      <div className="mk-log__title">EVENT LOG</div>
      {list.length === 0 && <div className="mk-dim">No events yet.</div>}
      {list.map((e) => (
        <div key={e.id} className={`mk-log__row mk-log__row--${e.level}`}>
          <span className="mk-dim">{new Date(e.at).toLocaleTimeString()}</span> <span className="mk-log__tag">[{e.building.toUpperCase()}]</span> {e.message}
        </div>
      ))}
    </div>
  );
}
