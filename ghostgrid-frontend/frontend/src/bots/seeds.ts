// Turns the backend's demo bot catalog into city buildings the store seeds on load.
// Every catalog bot gets its own tower with the `trading` bot art (K-line billboard),
// so the city reads as a row of trading towers; the bot's real catalog kind is kept in
// `bot.source.catalogKind` and shown in the side panel.
//
// Lots 14 and 7–11 are used, so lot 12 stays free for the build menu.
// Lots 5, 6 and 13 hold the Library, Groq and Cursor respectively.
// Nothing here starts a process or makes a request: the scripts live in the backend repo and
// `/api/v1/bots` does not exist yet, so each tower's endpoint is empty ("waiting for backend").
import type { BotConfig, BuildingId } from '../types'
import { CATALOG_BOTS, scheduleLabel, type CatalogBot } from './catalog'

export interface BotSeed {
  id: BuildingId
  lot: number
  name: string // building name shown on the tower and in the panel header
  short: string // pixel-font label, keep to 10 characters
  bot: BotConfig
}

// Lots in the order the catalog lists its bots. Spread across the N, S, W and E blocks.
const LOTS = [14, 7, 8, 9, 10, 11]

// Distinct neon per tower so six trading towers stay readable side by side.
const COLORS: Record<string, string> = {
  'paper-trader': '#39ff14',
  'market-signal': '#00f0ff',
  'log-watchtower': '#ff3355',
  'http-healthcheck': '#ffd400',
  'rss-watcher': '#ff2bd6',
  'repo-commit-watcher': '#4d7cff',
}

// Hand-set because the generated truncation of the building name reads badly in the pixel font.
const SHORTS: Record<string, string> = {
  'paper-trader': 'QUANT',
  'market-signal': 'SIGNAL',
  'log-watchtower': 'WATCHTOWER',
  'http-healthcheck': 'RELAY',
  'rss-watcher': 'RESEARCH',
  'repo-commit-watcher': 'GARAGE',
}

const shortFor = (bot: CatalogBot) => SHORTS[bot.id] ?? bot.building.toUpperCase().slice(0, 10)

export function seedFor(bot: CatalogBot, lot: number): BotSeed {
  return {
    id: `bot_${bot.id}`,
    lot,
    name: bot.building,
    short: shortFor(bot),
    bot: {
      kind: 'trading', // every catalog bot gets the trading tower art
      endpoint: '', // no bot runner on the backend yet → the antenna blinks "waiting"
      schedule: scheduleLabel(bot.everySeconds),
      notes: `${bot.name} · ${bot.runtime} · ${bot.entry}\n${bot.description}`,
      color: COLORS[bot.id] ?? '#ff2bd6',
      source: {
        botId: bot.id,
        catalogKind: bot.kind,
        runtime: bot.runtime,
        entry: bot.entry,
        args: bot.args,
        district: bot.district,
        paperMode: bot.paperMode,
        networkRequired: bot.networkRequired,
        emits: bot.emits,
        inspiredBy: bot.inspiredBy,
      },
    },
  }
}

/** One seed per catalog bot, capped by the lots reserved for them. */
export const BOT_SEEDS: BotSeed[] = CATALOG_BOTS.slice(0, LOTS.length).map((bot, i) => seedFor(bot, LOTS[i]))
