"""Reproducible T96 synthetic HTTP-adapter load; never reads a real study."""
import json
from pathlib import Path
import statistics
import tempfile
import time

from fastapi.testclient import TestClient
from autog_frontend.api import create_app


def main():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory).resolve()
        study = root / 'synthetic-load'
        study.mkdir()
        (study / 'study.md').write_text('# Synthetic load\n')
        body = json.dumps({'schema': 'ag-thermo/1', 'rows': [
            {'attempt_id': 'synthetic', 'E': -157.0025, 'population': .01}] * 44000})
        for index in range(20):
            folder = study / 'analyses' / f'report-{index:02d}'
            folder.mkdir(parents=True)
            (folder / 'report.json').write_text(body)
        with TestClient(create_app(root), base_url='http://localhost',
                        client=('localhost', 50000)) as client:
            durations = []
            for _ in range(3):
                start = time.perf_counter()
                response = client.get('/api/studies/synthetic-load')
                durations.append(time.perf_counter() - start)
                assert response.status_code == 200
            print(json.dumps(dict(directories=20, bytes_per_json=len(body),
                                  response_bytes=len(response.content), seconds=durations,
                                  median=statistics.median(durations), maximum=max(durations))))


if __name__ == '__main__':
    main()
