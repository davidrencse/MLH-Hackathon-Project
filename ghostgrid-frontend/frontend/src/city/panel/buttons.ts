// Pixel button class strings for the side panel (see panel.css .gg-sp-btn).
const BTN_BASE =
  'gg-sp-btn font-pixel inline-flex h-10 items-center justify-center gap-2 border-2 px-3 text-[8px] leading-none uppercase'

export const BTN = {
  cyan: `${BTN_BASE} border-gg-cyan bg-gg-void text-gg-cyan hover:bg-gg-cyan hover:text-gg-void`,
  green: `${BTN_BASE} border-gg-green bg-gg-green text-gg-void hover:bg-gg-void hover:text-gg-green`,
  yellow: `${BTN_BASE} border-gg-yellow bg-gg-yellow text-gg-void hover:bg-gg-void hover:text-gg-yellow`,
  red: `${BTN_BASE} border-gg-red bg-gg-red text-gg-void hover:bg-gg-void hover:text-gg-red`,
  redOutline: `${BTN_BASE} border-gg-red bg-gg-void text-gg-red hover:bg-gg-red hover:text-gg-void`,
  ghost: `${BTN_BASE} border-gg-haze bg-gg-void text-gg-mute hover:border-gg-ink hover:text-gg-ink`,
}
