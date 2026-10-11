#!/usr/bin/env python3
"""Read-only Library of Babel backend bridge. Never serves its UI or schedules crawls."""
import argparse
from contextlib import asynccontextmanager
import importlib
import os
import shutil
import tempfile
from pathlib import Path
import sys

READ_ROUTES = frozenset({
    '/api/library/first', '/api/library/page', '/api/library/search',
    '/api/papers', '/api/notebook', '/api/articles/{aid}/notes',
})


def create_bridge(source: str, data_dir: str):
    """Load trusted upstream code against an isolated metadata snapshot of local storage."""
    root = Path(source).expanduser().resolve(strict=True)
    if not (root / 'app.py').is_file() or not (root / 'pipeline.py').is_file():
        raise ValueError('Source must contain the Library of Babel app.py and pipeline.py')
    data = Path(data_dir).expanduser().resolve()
    # Upstream Store normalizes and rewrites its database during import. Never point
    # that writer at the user's real collection, even though our HTTP routes are GET-only.
    snapshot = tempfile.TemporaryDirectory(prefix='ghostgrid-library-read-')
    snapshot_root = Path(snapshot.name)
    for relative in ('Medium-Library/library.json', 'Papers/papers.json'):
        original = data / relative
        if original.is_file():
            destination = snapshot_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, destination)
    notes = data / 'notes'
    if notes.is_dir():
        for original in notes.glob('*.json'):
            if original.is_file():
                destination = snapshot_root / 'notes' / original.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(original, destination)
    os.environ['MEDIUM_LIBRARY_STORAGE'] = 'local'
    os.environ['MEDIUM_LIBRARY_DATA'] = str(snapshot_root)
    os.environ['HOST'] = '127.0.0.1'
    sys.path.insert(0, str(root))
    from fastapi import FastAPI
    from fastapi.routing import APIRoute
    # app.py instantiates its PDF executor during import. The read-only bridge has no
    # download/PDF routes, so prevent that executor from starting rather than closing it later.
    pipeline = importlib.import_module('pipeline')
    original_pipeline = pipeline.PdfPipeline
    pipeline.PdfPipeline = lambda *_args, **_kwargs: None
    try:
        upstream = importlib.import_module('app')
    finally:
        pipeline.PdfPipeline = original_pipeline
    if Path(upstream.__file__).resolve() != root / 'app.py':
        raise RuntimeError('Another app module was already loaded; use a fresh bridge process')

    @asynccontextmanager
    async def lifespan(_app):
        # Do not invoke upstream lifespan: it starts crawlers and curation workers.
        try:
            yield
        finally:
            upstream.curator.stop()
            upstream.medium_index.stop()
            upstream.briefing_service.stop()
            upstream.store.stop()
            snapshot.cleanup()

    bridge = FastAPI(title='Ghostgrid Library of Babel read-only bridge', lifespan=lifespan,
                     docs_url=None, redoc_url=None)
    for route in upstream.app.routes:
        if isinstance(route, APIRoute) and route.path in READ_ROUTES and 'GET' in route.methods:
            bridge.add_api_route(route.path, route.endpoint, methods=['GET'],
                                 response_model=route.response_model, name=route.name)
    registered = {route.path for route in bridge.routes if isinstance(route, APIRoute)}
    if registered != READ_ROUTES:
        raise RuntimeError('Upstream API is incompatible: missing required read routes')

    @bridge.get('/health')
    def health():
        return {'status': 'ok', 'integration': 'library-of-babel', 'readOnly': True,
                'backgroundDownloads': False}

    bridge.state.library_snapshot = snapshot  # Keep alive until lifespan shutdown.
    return bridge


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, help='Trusted Library of Babel source checkout')
    parser.add_argument('--data-dir', required=True, help='Local library root to snapshot (contains Medium-Library); original data is never written')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('--port must be between 1 and 65535')
    import uvicorn
    uvicorn.run(create_bridge(args.source, args.data_dir), host='127.0.0.1', port=args.port,
                log_level='info')


if __name__ == '__main__':
    main()
