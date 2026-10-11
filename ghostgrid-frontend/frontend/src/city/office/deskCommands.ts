import type { OfficeRuntime } from '@/api/backend'

// Ambient desk animation requested for the office; these never execute a command.
export const DESK_COMMANDS: Record<OfficeRuntime, string[]> = {
  codex: ['> codex', '$ read src/App.tsx', 'thinking through changes…', '$ apply patch', '$ npm run build', 'ready for the next idea'],
  claude: ['> claude', '$ inspect workspace', 'planning a small change…', '$ write component', '$ review diff', 'ready for the next idea'],
  'chatgpt-browser': ['chatgpt / new chat', 'reading your question…', 'thinking…', 'writing a reply…', 'adding an example…', 'ready for the next idea'],
  'claude-browser': ['claude / new chat', 'reading the context…', 'thinking…', 'drafting a reply…', 'checking the details…', 'ready for the next idea'],
}
