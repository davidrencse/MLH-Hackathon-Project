// LIBRARY: the panel for the Library building.
//
// The backend has carried a whole library subsystem for a while — connect a bridge, browse its
// catalogue, search it, read an article's notes, and import those notes as project context the
// agents are given. `src/api/library.ts` wraps every one of those routes. Nothing in the UI ever
// called it: clicking the Library building opened an external website instead, so the connected
// library was unreachable from the app that connects it.
//
// This is that surface. The one action that matters is Import: it turns a library article into a
// context entry on the project, which the engine hands to agents with their tasks.
import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Download, ExternalLink, Link2, Link2Off, Search } from 'lucide-react'
import { library, type LibraryArticle, type LibraryStatus } from '@/api/library'
import { openLibrarySite } from '@/api/config'
import { BTN } from './buttons'
import { SectionTitle } from './parts'

const title = (article: LibraryArticle) =>
  (typeof article.title === 'string' && article.title.trim()) || String(article.id ?? 'Untitled')

export function LibrarySection() {
  const [status, setStatus] = useState<LibraryStatus | null>(null)
  const [articles, setArticles] = useState<LibraryArticle[]>([])
  const [query, setQuery] = useState('')
  const [imported, setImported] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<string | null>(null)

  const report = (reason: unknown, fallback: string) =>
    setError(reason instanceof Error ? reason.message : fallback)

  const load = useCallback(async () => {
    setError(null)
    try {
      const next = await library.status()
      setStatus(next)
      if (!next.connected || !next.available) return
      const [page, contexts] = await Promise.all([library.catalog({ limit: 8 }), library.contexts()])
      setArticles(page.articles)
      setImported(contexts.length)
    } catch (reason) {
      report(reason, 'Could not read the library.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try { await work() } catch (reason) { report(reason, 'That did not work.') } finally { setBusy('') }
  }

  const search = () =>
    void run('search', async () => {
      const term = query.trim()
      setArticles(term ? (await library.search(term, 12)).items : (await library.catalog({ limit: 8 })).articles)
    })

  const importArticle = (article: LibraryArticle) =>
    void run(String(article.id), async () => {
      await library.importContext({ articleId: String(article.id), title: title(article) })
      setImported((count) => count + 1)
    })

  const connected = Boolean(status?.connected)
  const available = Boolean(status?.available)

  return (
    <section>
      <SectionTitle
        right={
          <span
            className="font-pixel text-[8px] leading-none"
            style={{ color: available ? 'var(--gg-green)' : connected ? 'var(--gg-yellow)' : 'var(--gg-mute)' }}
          >
            {available ? 'CONNECTED' : connected ? 'UNREACHABLE' : 'NOT CONNECTED'}
          </span>
        }
      >
        LIBRARY
      </SectionTitle>

      <div className="flex flex-col gap-3">
        <p className="text-[18px] leading-[20px] text-gg-mute">
          {available
            ? `Shared reading for this project. Importing an article puts its notes in the project context, which every agent is given with its task.${imported ? ` ${imported} already imported.` : ''}`
            : connected
              ? `Connected to ${status?.baseUrl ?? 'the bridge'}, but it is not answering. Start it and refresh.`
              : 'No library is connected to this project yet.'}
        </p>

        {error && <p className="text-[16px] leading-5 text-gg-red">{error}</p>}

        <div className="flex gap-2">
          {connected ? (
            <button type="button" className={`${BTN.ghost} flex-1`} disabled={busy !== ''}
              onClick={() => void run('disconnect', async () => { await library.disconnect(); await load() })}>
              <Link2Off size={14} strokeWidth={2.5} /> {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button type="button" className={`${BTN.cyan} flex-1`} disabled={busy !== ''}
              onClick={() => void run('connect', async () => { await library.connect(); await load() })}>
              <Link2 size={14} strokeWidth={2.5} /> {busy === 'connect' ? 'Connecting…' : 'Connect library'}
            </button>
          )}
          <button type="button" className={BTN.ghost} onClick={openLibrarySite} title="Open the library website">
            <ExternalLink size={14} strokeWidth={2.5} />
          </button>
        </div>

        {available && (
          <>
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); search() }}>
              <input
                aria-label="Search the library"
                value={query}
                placeholder="Search the library…"
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 min-w-0 flex-1 border-2 border-gg-haze bg-gg-void px-2 text-[18px] text-gg-ink placeholder:text-gg-mute/70 focus:border-gg-cyan focus:outline-none"
              />
              <button type="submit" className={BTN.cyan} disabled={busy !== ''}>
                <Search size={14} strokeWidth={2.5} /> {busy === 'search' ? '…' : 'Find'}
              </button>
            </form>

            <ul className="flex flex-col gap-2">
              {articles.map((article) => (
                <li key={String(article.id)} className="flex items-start gap-2 border-2 border-gg-haze bg-gg-void p-2">
                  <BookOpen size={14} strokeWidth={2.5} className="mt-1 shrink-0 text-gg-cyan" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[18px] leading-[20px] text-gg-ink">{title(article)}</span>
                    {typeof article.author === 'string' && article.author && (
                      <span className="block truncate text-[16px] leading-5 text-gg-mute">{article.author}</span>
                    )}
                  </span>
                  <button type="button" className={BTN.green} disabled={busy !== ''}
                    title="Import this article's notes as project context"
                    onClick={() => importArticle(article)}>
                    <Download size={13} strokeWidth={2.5} />
                    {busy === String(article.id) ? '…' : 'Import'}
                  </button>
                </li>
              ))}
              {!articles.length && (
                <li className="text-[16px] leading-5 text-gg-mute">
                  {query.trim() ? 'Nothing matched that search.' : 'The catalogue came back empty.'}
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
