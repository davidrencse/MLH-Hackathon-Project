// Library of Babel building → the backend's read-only `news` integration.
// Connect the bridge (default http://127.0.0.1:8765, see ghostgrid-backend/docs/LIBRARY.md),
// browse or search it, and import an article's notes as shared project context.
import { backend, type ContextEntry, type LibraryConnection } from './backend.ts'
import { isLive } from './config.ts'
import { bootstrap } from './live.ts'

// Through env.ts, not `import.meta.env` directly: that object only exists under Vite, so reading
// it here threw `Cannot read properties of undefined` the moment anything imported this module
// outside the bundler — a test, a script, any non-browser context. env.ts already falls back to
// `process.env`, and `LIBRARY_SITE_URL` is the same setting with the same default.
import { LIBRARY_SITE_URL } from './env.ts'

export const LIBRARY_BASE_URL = LIBRARY_SITE_URL
export const LIBRARY_BUILDING_ID = 'library'

export interface LibraryArticle {
  id: string
  title?: string
  author?: string
  topic_id?: string
  subtopic_id?: string
  access?: string
  [key: string]: unknown
}

export interface LibraryStatus {
  connected: boolean
  available: boolean
  readOnly: boolean
  repositoryUrl?: string
  catalogVersion?: number | null
  baseUrl?: string
  message?: string
}

async function requireLive(): Promise<string> {
  if (!(await isLive())) throw new Error('The Ghost Grid backend is not reachable; the library needs it')
  return (await bootstrap()).projectId
}

/** Whatever the bridge sent, as an array. A missing or malformed list is an empty one. */
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

export const library = {
  /** Connection record plus a live reachability probe of the bridge. */
  async status(): Promise<LibraryStatus> {
    if (!(await isLive())) return { connected: false, available: false, readOnly: true, message: 'backend offline' }
    const projectId = (await bootstrap()).projectId
    const { connection } = await backend.getLibrary(projectId)
    if (!connection) return { connected: false, available: false, readOnly: true, message: 'not connected' }
    try {
      const status = await backend.libraryStatus(projectId)
      return {
        connected: true,
        available: status.available,
        readOnly: status.readOnly,
        repositoryUrl: status.repositoryUrl,
        catalogVersion: status.catalogVersion,
        baseUrl: connection.baseUrl,
      }
    } catch (error) {
      return {
        connected: true,
        available: false,
        readOnly: true,
        baseUrl: connection.baseUrl,
        message: error instanceof Error ? error.message : 'library unreachable',
      }
    }
  },

  async connect(baseUrl: string = LIBRARY_BASE_URL): Promise<LibraryConnection> {
    const projectId = await requireLive()
    return backend.connectLibrary(projectId, {
      baseUrl,
      name: 'Library',
      buildingId: LIBRARY_BUILDING_ID,
    })
  },

  async disconnect(): Promise<void> {
    const projectId = await requireLive()
    await backend.disconnectLibrary(projectId)
  },

  async catalog(query: { offset?: number; limit?: number; topic_id?: string; subtopic_id?: string; access?: 'all' | 'free' | 'locked' } = {}) {
    const projectId = await requireLive()
    const page = await backend.libraryCatalog(projectId, query)
    // The bridge is a separate service: if it answers 200 with anything lacking `articles`, a
    // bare cast puts `undefined` into component state and the next render throws inside the
    // component, where its own try/catch cannot reach.
    return { articles: list<LibraryArticle>(page.articles), total: page.total ?? 0 }
  },

  async search(q: string, limit = 20) {
    const projectId = await requireLive()
    const page = await backend.librarySearch(projectId, q, limit)
    return { items: list<LibraryArticle>(page.items), total: page.total ?? 0 }
  },

  async papers() {
    const projectId = await requireLive()
    const page = await backend.libraryPapers(projectId)
    return list<LibraryArticle>(page.items)
  },

  async notebook() {
    const projectId = await requireLive()
    const page = await backend.libraryNotebook(projectId)
    return list<Record<string, unknown>>(page.entries)
  },

  async notes(articleId: string) {
    const projectId = await requireLive()
    return backend.libraryNotes(projectId, articleId)
  },

  /** Import one article's notes (or one saved paper) as project context for agents. */
  async importContext(selection: { articleId?: string; paperId?: string; title?: string }): Promise<ContextEntry> {
    const projectId = await requireLive()
    return backend.importLibraryContext(projectId, selection)
  },

  /** Context entries already imported into the project, newest first. */
  async contexts(): Promise<ContextEntry[]> {
    const projectId = await requireLive()
    const { items } = await backend.listContext(projectId)
    return [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  },
}
