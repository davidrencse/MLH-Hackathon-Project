"""Read-only bridge validation against a supplied upstream checkout, with synthetic data only.

GHOSTGRID_NEWS_TEST_SOURCE=/path/to/news python -m unittest discover -s tests -p test_news_bridge.py -v
The interpreter needs upstream requirements; tests use loopback HTTP, temporary data,
no browser launch and no external requests.
"""
import importlib.util
import os
import json
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


@unittest.skipUnless(os.environ.get('GHOSTGRID_NEWS_TEST_SOURCE'), 'Supply an upstream news checkout explicitly')
class NewsBridgeTest(unittest.TestCase):
    def test_real_http_is_read_only_and_preserves_source_metadata(self):
        source = Path(os.environ['GHOSTGRID_NEWS_TEST_SOURCE']).resolve()
        script = Path(__file__).parents[1] / 'scripts' / 'run-news-library.py'
        with tempfile.TemporaryDirectory(prefix='ghostgrid-library-http-') as data:
            original = Path(data) / 'Medium-Library' / 'library.json'
            original.parent.mkdir()
            original.write_text(json.dumps({'topics': [], 'articles': []}), encoding='utf-8')
            original_bytes = original.read_bytes()
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                port = reservation.getsockname()[1]
            process = subprocess.Popen([sys.executable, str(script), '--source', str(source),
                '--data-dir', data, '--port', str(port)], stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL)
            base = f'http://127.0.0.1:{port}'
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        self.fail('Bridge process exited before becoming available')
                    try:
                        with urllib.request.urlopen(base + '/health', timeout=1) as response:
                            self.assertTrue(json.load(response)['readOnly'])
                        break
                    except urllib.error.URLError:
                        time.sleep(0.05)
                else:
                    self.fail('Bridge failed to become available')
                for route in ('/api/library/first', '/api/library/page',
                              '/api/library/search?q=test', '/api/notebook', '/api/papers'):
                    with urllib.request.urlopen(base + route, timeout=2) as response:
                        self.assertIsInstance(json.load(response), dict)
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    urllib.request.urlopen(base + '/')
                self.assertEqual(denied.exception.code, 404)
                denied.exception.close()
                request = urllib.request.Request(base + '/api/papers', data=b'{}',
                    headers={'Content-Type': 'application/json'}, method='POST')
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    urllib.request.urlopen(request)
                self.assertEqual(denied.exception.code, 405)
                denied.exception.close()
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                self.assertEqual(original.read_bytes(), original_bytes)

    def test_read_only_library_contract(self):
        source = Path(os.environ['GHOSTGRID_NEWS_TEST_SOURCE']).resolve()
        sys.path.insert(0, str(source))
        import polite
        script = Path(__file__).parents[1] / 'scripts' / 'run-news-library.py'
        spec = importlib.util.spec_from_file_location('news_bridge', script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='ghostgrid-library-test-') as data, \
                patch.object(polite, 'get', side_effect=AssertionError('Unexpected external request')), \
                patch.object(polite, 'get_text', side_effect=AssertionError('Unexpected external request')):
            original = Path(data) / 'Medium-Library' / 'library.json'
            original.parent.mkdir(parents=True)
            # Upstream normally adds default topics and strips fetching flags on startup.
            original.write_text(json.dumps({'topics': [], 'articles': []}), encoding='utf-8')
            original_bytes = original.read_bytes()
            bridge = module.create_bridge(str(source), data)
            upstream = sys.modules['app']
            try:
                routes = {r.path: r for r in bridge.routes}
                self.assertNotIn('/', routes)
                self.assertNotIn('/static', routes)
                self.assertNotIn('/api/articles', routes)
                self.assertIsNone(upstream.pipeline)
                self.assertTrue(all(r.methods <= {'GET', 'HEAD'} for r in bridge.routes))
                first = routes['/api/library/first'].endpoint(limit=2)
                self.assertEqual(first['articles'], [])
                topic = first['topics'][0]
                subtopic = topic['subtopics'][0]
                article = upstream.create_article({'url': 'https://example.org/test-reading',
                    'topic': topic['id'], 'subtopic': subtopic['id'], 'title': 'Ghost Grid library fixture'})
                self.assertEqual(routes['/api/library/search'].endpoint(q='Ghost Grid', limit=2)['total'], 1)
                self.assertEqual(routes['/api/library/page'].endpoint(limit=2)['total'], 1)
                self.assertEqual(routes['/api/articles/{aid}/notes'].endpoint(article['id'])['notes'], '')
                self.assertEqual(routes['/api/notebook'].endpoint()['entries'], [])
                self.assertEqual(routes['/api/papers'].endpoint()['items'], [])
                self.assertTrue(routes['/health'].endpoint()['readOnly'])
                self.assertNotEqual(Path(upstream.DATA_DIR), Path(data))
                self.assertEqual(original.read_bytes(), original_bytes)
                self.assertEqual(sorted(Path(data).iterdir()), [original.parent])
            finally:
                upstream.curator.stop()
                upstream.medium_index.stop()
                upstream.briefing_service.stop()
                upstream.store.stop()
                bridge.state.library_snapshot.cleanup()
                self.assertEqual(original.read_bytes(), original_bytes)


if __name__ == '__main__':
    unittest.main()
