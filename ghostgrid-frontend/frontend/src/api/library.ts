// Library of Babel building → the backend's read-only `news` integration.
// Connect the bridge (default http://127.0.0.1:8765, see ghostgrid-backend/LIBRARY.md),
// browse or search it, and import an article's notes as shared project context.
import { backend, type ContextEntry, type LibraryConnection } from './backend'
import { isLive } from './config'
import { bootstrap } from './live'

const env = import.meta.env as Record<string, string | undefined>
export const LIBRARY_BASE_URL = env.VITE_GG_LIBRARY_URL ?? 'http://127.0.0.1:8765'
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
  if (!(await isLive())) throw new Error('The Ghostgrid backend is not reachable; the library needs it')
  return (await bootstrap()).projectId
}

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
    return { articles: page.articles as LibraryArticle[], total: page.total }
  },

  async search(q: string, limit = 20) {
    const projectId = await requireLive()
    const page = await backend.librarySearch(projectId, q, limit)
    return { items: page.items as LibraryArticle[], total: page.total }
  },

  async papers() {
    const projectId = await requireLive()
    const page = await backend.libraryPapers(projectId)
    return page.items as LibraryArticle[]
  },

  async notebook() {
    const projectId = await requireLive()
    const page = await backend.libraryNotebook(projectId)
    return page.entries
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
