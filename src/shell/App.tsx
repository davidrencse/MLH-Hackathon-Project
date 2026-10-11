import { MarketDistrict } from '../districts/market';
import { CITY_BLOCKS } from './cityLayout';

/** GhostGrid opens straight into the city; Market Tower is the interactive landmark. */
export function App() {
  return <MarketDistrict cityBlocks={CITY_BLOCKS} />;
}
