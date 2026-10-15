import type { OfficeRuntime } from '@/api/backend'

/**
 * The runtime of a desk comes from the backend, which is a separate project carrying its own
 * copy of this union (ghostgrid-backend/src/providers/types.ts). The day it adds a provider
 * type — or an old session row carries a retired one — a bare `DESK_COMMANDS[runtime]` is
 * `undefined`, and this table is read inside a `useFrame`, where the throw stops the render
 * loop being re-scheduled and no React boundary can catch it. Always go through this.
 */
export function deskCommandsFor(runtime: OfficeRuntime | string | undefined): string[] {
  return DESK_COMMANDS[runtime as OfficeRuntime] ?? DESK_COMMANDS.codex
}

// Ambient desk animation requested for the office; these never execute a command.
export const DESK_COMMANDS: Record<OfficeRuntime, string[]> = {
  codex: ['> codex', '$ read src/App.tsx', 'thinking through changes…', '$ apply patch', '$ npm run build', 'ready for the next idea'],
  claude: ['> claude', '$ inspect workspace', 'planning a small change…', '$ write component', '$ review diff', 'ready for the next idea'],
  'chatgpt-browser': ['chatgpt / new chat', 'reading your question…', 'thinking…', 'writing a reply…', 'adding an example…', 'ready for the next idea'],
  'claude-browser': ['claude / new chat', 'reading the context…', 'thinking…', 'drafting a reply…', 'checking the details…', 'ready for the next idea'],
  deepseek: ['> deepseek', '$ scan test suite', 'batching the work…', '$ refactor module', '$ run tests', 'ready for the next idea'],
  'deepseek-browser': ['deepseek / new chat', 'reading the prompt…', 'thinking…', 'writing a reply…', 'crunching the numbers…', 'ready for the next idea'],
}
