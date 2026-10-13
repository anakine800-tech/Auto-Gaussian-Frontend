"""Same-origin, loopback-only HTTP reads. No write or execution endpoints."""
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse, Response

from .studies import Studies, StudyError
from .static_ui import load_ui

LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1'}


def create_app(studies_root, ui_directory=None):
    store = Studies(studies_root)
    ui = load_ui(Path(ui_directory)) if ui_directory else {}
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware('http')
    async def local_readonly(request: Request, call_next):
        try:
            host = urlsplit('http://' + request.headers.get('host', '')).hostname
            origin = request.headers.get('origin')
            local = host in LOCAL_HOSTS and request.client is not None and request.client.host in LOCAL_HOSTS
            # Blocks DNS rebinding and cross-site reads of unpublished local data.
            if not local or (origin and origin != str(request.base_url).rstrip('/')) or request.headers.get('sec-fetch-site') == 'cross-site':
                return JSONResponse({'detail': 'Local same-origin access only'}, status_code=403)
            if request.method not in ('GET', 'HEAD'):
                return JSONResponse({'detail': 'Study viewer is read-only'}, status_code=405)
            response = await call_next(request)
        except ValueError:
            return JSONResponse({'detail': 'Invalid local request'}, status_code=400)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
        return response

    @app.exception_handler(StudyError)
    async def study_error(_request, exc):
        return JSONResponse({'detail': str(exc)}, status_code=exc.status)

    @app.exception_handler(OSError)
    async def io_error(_request, _exc):
        return JSONResponse({'detail': 'Local file changed or is unreadable; refresh to retry'}, status_code=409)

    @app.get('/api/studies')
    def list_studies():
        return store.list_studies()

    @app.get('/api/studies/{study}')
    def study(study: str):
        return store.study(study)

    @app.get('/api/studies/{study}/attempts/{attempt}')
    def attempt(study: str, attempt: str):
        return store.attempt(study, attempt)

    @app.get('/api/studies/{study}/attempts/{attempt}/logs/{log}')
    def log(study: str, attempt: str, log: str, start: int = Query(0, ge=0), limit: int = Query(120, ge=1, le=500)):
        return store.log_page(study, attempt, log, start, limit)

    @app.get('/api/studies/{study}/attempts/{attempt}/vibrations/{log}')
    def vibrations(study: str, attempt: str, log: str):
        return store.vibrations(study, attempt, log)

    @app.get('/api/studies/{study}/attempts/{attempt}/inputs/{name}')
    def input_file(study: str, attempt: str, name: str):
        return store.input_file(study, attempt, name)

    @app.get('/api/studies/{study}/attempts/{attempt}/input-diff/{name}')
    def input_diff(study: str, attempt: str, name: str, parent: str, parent_file: str):
        return store.input_diff(study, attempt, name, parent, parent_file)

    @app.get('/api/studies/{study}/structures/{group}/{name}')
    def structure_frame(study: str, group: str, name: str, frame: int = Query(0, ge=0, le=4999)):
        return store.structure_frame(study, ('structures', group, name), frame)

    @app.get('/api/studies/{study}/analyses/{name}')
    def analysis_frame(study: str, name: str, frame: int = Query(0, ge=0, le=4999)):
        return store.structure_frame(study, ('analyses', name), frame)

    @app.get('/api/studies/{study}/attempts/{attempt}/log-search/{log}')
    def log_search(study: str, attempt: str, log: str, query: str = Query(min_length=1, max_length=256),
                   start: int = Query(0, ge=0), last: bool = False):
        return store.log_search(study, attempt, log, query, start, last)

    @app.get('/{asset:path}', include_in_schema=False)
    def static(asset: str):
        found = ui.get('/' + asset)
        if found is None:
            return JSONResponse({'detail': 'Not found'}, status_code=404)
        return Response(found[0], media_type=found[1])

    return app
