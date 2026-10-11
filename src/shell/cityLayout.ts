// City around Market Tower. Purely decorative for now; future districts can claim a block here.
// World px, tower centred at x=0, z=0, +z towards the camera. Roads run at z=330 and x=±340 — keep blocks off them.
import type { CityBlock } from '../districts/market';

export const CITY_BLOCKS: CityBlock[] = [
  // back row
  { x: -760, z: -420, w: 220, d: 200, h: 300, color: '#ff4fd8', sign: 'NIGHT', roof: 'antenna' },
  { x: -520, z: -380, w: 180, d: 180, h: 340, color: '#29f0ff', roof: 'billboard', billboard: 'GHOSTGRID' },
  { x: -120, z: -470, w: 230, d: 180, h: 380, color: '#b061ff', roof: 'antenna' },
  { x: 170, z: -420, w: 160, d: 160, h: 320, color: '#3dff9a', sign: 'DATA' },
  { x: 520, z: -400, w: 200, d: 200, h: 340, color: '#ffb84f', sign: 'AI', roof: 'antenna' },
  { x: 780, z: -430, w: 180, d: 180, h: 250, color: '#ff4fd8', roof: 'billboard', billboard: 'NEON 24H' },
  // beside the tower
  { x: -570, z: -10, w: 220, d: 200, h: 260, color: '#3dff9a', sign: 'GRID' },
  { x: -830, z: 40, w: 160, d: 180, h: 200, color: '#29f0ff' },
  { x: 570, z: 0, w: 200, d: 220, h: 240, color: '#b061ff', sign: 'SYNC', roof: 'billboard', billboard: 'AGENTS ONLINE' },
  { x: 830, z: 30, w: 160, d: 160, h: 180, color: '#ffb84f', roof: 'antenna' },
  // front row (kept low so the tower stays visible)
  { x: -620, z: 520, w: 240, d: 180, h: 150, color: '#b061ff', sign: 'BAR' },
  { x: -190, z: 540, w: 200, d: 160, h: 100, color: '#29f0ff' },
  { x: 200, z: 540, w: 220, d: 160, h: 120, color: '#ff4fd8', roof: 'billboard', billboard: 'RAMEN' },
  { x: 620, z: 500, w: 220, d: 200, h: 170, color: '#3dff9a', sign: '24H' },
];
