# Library of Babel integration

Ghostgrid connects a project’s library building to the read-only backend of
[davidrencse/news](https://github.com/davidrencse/news). Agents can receive selected
saved notes and paper metadata as shared project context. The library is a separate
Python service; Ghostgrid remains the TypeScript orchestration backend.

The included bridge exposes catalog browsing, search, saved papers, notebook data,
and article notes. It skips the upstream application’s background crawlers and
curation lifecycle, disables its PDF executor, and exposes only selected GET routes.
No library frontend is served. The bridge copies only library metadata, paper
metadata and saved notes into a temporary snapshot before importing upstream code.
This prevents upstream startup migrations and its database writer from modifying
your collection. PDFs are not copied. Ghostgrid stores connection metadata and
explicitly imported context snapshots.

## Run the local bridge

From `ghostgrid-backend`, create a trusted checkout pinned to the inspected revision:

```sh
git clone https://github.com/davidrencse/news.git ../news-library
git -C ../news-library checkout 553a934874d8d11e1b5eac4c7daef5c4dad0eb6c
python3 -m venv ../news-library/.venv
../news-library/.venv/bin/python -m pip install -r ../news-library/requirements.txt
../news-library/.venv/bin/python scripts/run-news-library.py \
  --source ../news-library \
  --data-dir /absolute/path/to/existing/library-root \
  --port 8765
```

`--source` must contain the upstream `app.py` and `pipeline.py`. `--data-dir` is the
library storage root containing `Medium-Library`, rather than the `Medium-Library`
directory itself. Use the root of your existing collection to browse its saved
content; a new empty directory has no existing collection. The bridge forces local
storage against that temporary snapshot and binds only to `127.0.0.1`. Restart the
bridge to see changes made to your original collection. Download-presence fields
may differ because PDF files are not included in the snapshot. Check `http://127.0.0.1:8765/health` for
`readOnly: true` and `backgroundDownloads: false`.

The bridge imports trusted upstream Python code and requires its dependencies.
Keep the checkout pinned: a different upstream revision may change the expected
routes or storage format. Do not expose the bridge directly to remote clients.
Ghostgrid can also connect to an HTTPS deployment of the compatible read API.

## Connect a project

Run Ghostgrid in another terminal with `pnpm start`. Substitute an existing project
UUID for `PROJECT_ID`:

```sh
curl -X PUT http://127.0.0.1:3001/api/v1/projects/PROJECT_ID/library \
  -H 'Content-Type: application/json' \
  -d '{"name":"Library of Babel","buildingId":"library","baseUrl":"http://127.0.0.1:8765"}'
```

The building ID must be unique within the project and cannot belong to an agent.
The library is a context source, not an inference provider. If your remote library
requires bearer authentication, set its credential in the backend environment and
configure `apiKeyEnv` with that environment variable’s name. Credential values are
never stored in SQLite. When Ghostgrid API authentication is enabled, include its
`Authorization: Bearer ...` header on all Ghostgrid requests.

Connection, disconnection, and selected imports emit `library.connected`,
`library.disconnected`, and `context.created` events after their state commits.
They carry the project/building scope and context identifier, without API-key
references, endpoint URLs, or note contents. Retrieve them through
`GET /api/v1/events?projectId=PROJECT_ID` or the SSE stream.

All paths below are relative to `/api/v1/projects/PROJECT_ID/library`:

| Method   | Path                           | Purpose                                                                 |
| -------- | ------------------------------ | ----------------------------------------------------------------------- |
| `PUT`    | `/`                            | Save the connection configuration.                                      |
| `GET`    | `/`                            | Retrieve the saved connection, or `null`.                               |
| `DELETE` | `/`                            | Disconnect; existing imported context remains available.                |
| `GET`    | `/status`                      | Check upstream availability and catalog version.                        |
| `GET`    | `/catalog`                     | Browse with `offset`, `limit`, `topic_id`, `subtopic_id`, and `access`. |
| `GET`    | `/search?q=reasoning&limit=20` | Search the collection.                                                  |
| `GET`    | `/articles/ARTICLE_ID/notes`   | Read saved notes, summary, and highlights.                              |
| `GET`    | `/papers`                      | List saved papers.                                                      |
| `GET`    | `/notebook`                    | Read the notebook.                                                      |
| `POST`   | `/context`                     | Import one selected article’s notes or one saved paper’s metadata.      |

Catalog limits are 1–100, `access` is `all`, `free`, or `locked`, and `subtopic_id`
requires `topic_id`. Article and paper IDs contain letters, digits, underscores, or
hyphens. Library requests have a configurable timeout of up to 60 seconds and a
2 MB response limit. Unavailable upstreams return an API error; an empty local
collection does not synthesize research content.

## Give selected context to an agent

Import exactly one article or paper. An article must have saved notes, a summary,
or highlights. Paper imports contain saved metadata and omit its `raw` field;
this operation does not download or parse a PDF.

```sh
curl -X POST http://127.0.0.1:3001/api/v1/projects/PROJECT_ID/library/context \
  -H 'Content-Type: application/json' \
  -d '{"articleId":"ARTICLE_ID","title":"Selected research notes"}'
```

Alternatively, send `{"paperId":"PAPER_ID"}`. The response is a persistent context
entry with an `id`. Its `source` records the upstream repository URL, project ID,
library building ID, import timestamp, and article or paper ID. Imported snapshots
are limited to 100,000 characters and do not change when upstream notes change.
Re-import to capture a newer snapshot.

Pass the returned context ID explicitly when creating a task:

```sh
curl -X POST http://127.0.0.1:3001/api/v1/tasks \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"PROJECT_ID","agentId":"AGENT_ID","prompt":"Summarize the selected research and explain its relevance.","contextIds":["CONTEXT_ID"]}'
```

Inspect imported entries through `GET /api/v1/projects/PROJECT_ID/context`.
The task receives only explicitly selected entries. Upstream notes are untrusted
reference material; they do not grant tools or execution permissions.

## Verify the bridge

The normal TypeScript suite tests the connector with deterministic responses. To
also validate the bridge against the pinned upstream Python backend, run:

```sh
GHOSTGRID_NEWS_TEST_SOURCE="$(cd ../news-library && pwd)" \
  ../news-library/.venv/bin/python -m unittest discover \
  -s tests -p test_news_bridge.py -v
```

This optional test uses a temporary collection, disables external requests, and
checks the real upstream read routes over loopback HTTP, rejects writes and UI
requests, and verifies the source metadata remains byte-for-byte unchanged. It does not open or modify your collection.
