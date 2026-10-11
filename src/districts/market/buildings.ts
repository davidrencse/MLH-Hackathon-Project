// Floors of Market Tower, listed top → bottom. Each floor = one feature + one robot operator.
import type { BuildingId } from './types';
import type { RobotVariant } from './components/Robot';

export interface FloorDef {
  id: BuildingId;
  level: number;
  label: string; // "5F"
  name: string;
  subtitle: string;
  role: string;
  neon: string;
  robot: string;
  bot: RobotVariant;
}

export const FLOORS: FloorDef[] = [
  { id: 'exchange', level: 5, label: '5F', name: 'Quant Exchange', subtitle: 'Market Data Floor', role: 'Market feed for BTC / ETH / SOL with 7-day charts.', neon: '#29f0ff', robot: 'QX-5', bot: 'trader' },
  { id: 'signal', level: 4, label: '4F', name: 'Signal Lab', subtitle: 'Strategy Signal Lab', role: 'Rule-based SMA signal engine. LLM agent slot reserved.', neon: '#ff4fd8', robot: 'SIG-4', bot: 'scientist' },
  { id: 'trading', level: 3, label: '3F', name: 'Paper Trading Hub', subtitle: 'Simulated Trading Desk', role: 'Local simulated orders on a $10,000 paper account.', neon: '#3dff9a', robot: 'PT-3', bot: 'worker' },
  { id: 'risk', level: 2, label: '2F', name: 'Risk Office', subtitle: 'Risk Management', role: 'Pre-trade limits: max order size and max single-asset weight.', neon: '#ffb84f', robot: 'RSK-2', bot: 'guard' },
  { id: 'backtest', level: 1, label: '1F', name: 'Backtest Vault', subtitle: 'Historical Backtesting', role: 'Replays the SMA strategy on historical bars (no look-ahead).', neon: '#b061ff', robot: 'BT-1', bot: 'archivist' },
];
export const floorById = (id: BuildingId) => FLOORS.find((f) => f.id === id)!;
