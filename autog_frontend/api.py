"""Same-origin loopback HTTP; actions require explicit local startup opt-in."""

import json
import secrets
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from .studies import Studies, StudyError, decode_document
from .static_ui import load_ui
from .search_index import SearchIndex
from .study_summary import study_type

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def create_app(studies_root, ui_directory=None, *, enable_actions=False, ag=None):
    store = Studies(studies_root)
    search_index = SearchIndex(store)
    ui = load_ui(Path(ui_directory)) if ui_directory else {}
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    actions = None
    if enable_actions:
        from .actions import Actions

        actions = Actions(store, ag)
        if "/" in ui:
            body, mime = ui["/"]
            meta = f'<meta name="ag-token" content="{actions.token}">'
            ui["/"] = (body.replace(b"</head>", meta.encode() + b"</head>"), mime)

    @app.middleware("http")
    async def local_readonly(request: Request, call_next):
        try:
            host = urlsplit("http://" + request.headers.get("host", "")).hostname
            origin = request.headers.get("origin")
            local = (
                host in LOCAL_HOSTS
                and request.client is not None
                and request.client.host in LOCAL_HOSTS
            )
            # Blocks DNS rebinding and cross-site reads of unpublished local data.
            if (
                not local
                or (origin and origin != str(request.base_url).rstrip("/"))
                or request.headers.get("sec-fetch-site") == "cross-site"
            ):
                return JSONResponse(
                    {"detail": "Local same-origin access only"}, status_code=403
                )
            if request.method not in ("GET", "HEAD"):
                if request.method != "POST" or actions is None:
                    return JSONResponse(
                        {"detail": "Study viewer is read-only"}, status_code=405
                    )
                if not secrets.compare_digest(
                    request.headers.get("x-ag-token", "").encode(),
                    actions.token.encode(),
                ):
                    return JSONResponse(
                        {"detail": "Invalid action token"}, status_code=403
                    )
            response = await call_next(request)
        except ValueError:
            return JSONResponse({"detail": "Invalid local request"}, status_code=400)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
        )
        return response

    @app.exception_handler(StudyError)
    async def study_error(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=exc.status)

    @app.exception_handler(OSError)
    async def io_error(_request, _exc):
        return JSONResponse(
            {"detail": "Local file changed or is unreadable; refresh to retry"},
            status_code=409,
        )

    if actions is not None:

        @app.get("/api/actions/{study}/{attempt}")
        def action_context(study: str, attempt: str):
            return actions.context(study, attempt)

        @app.post("/api/actions")
        async def action(request: Request):
            from .actions import MAX_BODY

            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > MAX_BODY:
                    raise StudyError("Action request exceeds 1 MiB", 413)
            try:
                payload = json.loads(body)
            except (ValueError, UnicodeError, RecursionError):
                raise StudyError("Invalid JSON request", 400) from None
            return await run_in_threadpool(actions.execute, payload)

        @app.post("/api/attempt-capacity")
        async def attempt_capacity(request: Request):
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 4096:
                    raise StudyError("Capacity request exceeds 4 KiB", 413)
            try:
                payload = json.loads(body)
            except (ValueError, UnicodeError, RecursionError):
                raise StudyError("Invalid JSON request", 400) from None
            return await run_in_threadpool(actions.capacity, payload)

        @app.post("/api/monitor/retry")
        async def retry_monitor(request: Request):
            from .actions import MAX_BODY

            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > MAX_BODY:
                    raise StudyError("Monitor retry request exceeds 1 MiB", 413)
            try:
                payload = json.loads(body)
            except (ValueError, UnicodeError, RecursionError):
                raise StudyError("Invalid JSON request", 400) from None
            return await run_in_threadpool(actions.retry_monitor, payload)

    @app.get("/api/monitor")
    def monitor():
        return store.monitors(actions.clusters if actions else ())

    @app.get("/api/studies")
    def list_studies():
        result = store.list_studies()
        for item in result["studies"]:
            item["type"] = study_type(
                item["id"], store.document((item["id"], "study.md"))["data"]
            )
        return result

    @app.get("/api/search")
    def search(
        q: str = Query("", max_length=256),
        study: str | None = Query(None, min_length=1, max_length=255),
    ):
        return search_index.search(q, study)

    @app.get("/api/studies/{study}")
    def study(study: str):
        return store.study(study)

    @app.get("/api/studies/{study}/evidence")
    def evidence(study: str):
        return store.evidence(study)

    @app.get("/api/studies/{study}/files/{path:path}")
    def file(study: str, path: str, document: bool = False):
        raw, mime = store.file(study, path)
        if document:
            return decode_document(raw, mime == "application/json")
        headers = {"X-Content-Type-Options": "nosniff"}
        if mime in ("text/html", "image/svg+xml"):
            headers["Content-Security-Policy"] = (
                "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'"
            )
        return Response(raw, media_type=mime, headers=headers)

    @app.get("/api/studies/{study}/reports/{name}")
    def report(study: str, name: str):
        return store.report(study, (name,))

    @app.get("/api/studies/{study}/reports/{group}/{name}")
    def grouped_report(study: str, group: str, name: str):
        return store.report(study, (group, name))

    @app.get("/api/studies/{study}/reports/ts-labels/{name}/{filename}")
    def ts_label_report(study: str, name: str, filename: str):
        return store.report(study, ("ts-labels", name, filename))

    @app.get("/api/studies/{study}/attempts/{attempt}/snapshots")
    def snapshots(study: str, attempt: str):
        return store.snapshots(study, attempt)

    @app.get("/api/studies/{study}/attempts/{attempt}/comparison-structure")
    def comparison_structure(study: str, attempt: str):
        return store.comparison_structure(study, attempt)

    @app.get("/api/studies/{study}/attempts/{attempt}")
    def attempt(study: str, attempt: str):
        return store.attempt(study, attempt)

    @app.get("/api/studies/{study}/attempts/{attempt}/logs/{log}")
    def log(
        study: str,
        attempt: str,
        log: str,
        start: int = Query(0, ge=0),
        limit: int = Query(120, ge=1, le=500),
    ):
        return store.log_page(study, attempt, log, start, limit)

    @app.get("/api/studies/{study}/attempts/{attempt}/crest-diagnostics/{index}")
    def crest_excerpt(
        study: str,
        attempt: str,
        index: int,
        token: str = Query(pattern="^[0-9a-f]{64}$"),
    ):
        return store.crest_excerpt(study, attempt, index, token)

    @app.get("/api/studies/{study}/attempts/{attempt}/optimization/{log}")
    def optimization(study: str, attempt: str, log: str):
        return store.optimization(study, attempt, log)

    @app.get("/api/studies/{study}/attempts/{attempt}/vibrations/{log}")
    def vibrations(study: str, attempt: str, log: str):
        return store.vibrations(study, attempt, log)

    @app.get("/api/studies/{study}/attempts/{attempt}/mode-reports/{log}")
    def mode_reports(study: str, attempt: str, log: str):
        from .mode_reports import list_reports

        return list_reports(store, study, attempt, log)

    @app.get("/api/studies/{study}/attempts/{attempt}/inputs/{name}")
    def input_file(study: str, attempt: str, name: str):
        return store.input_file(study, attempt, name)

    @app.get("/api/studies/{study}/attempts/{attempt}/input-diff/{name}")
    def input_diff(study: str, attempt: str, name: str, parent: str, parent_file: str):
        return store.input_diff(study, attempt, name, parent, parent_file)

    @app.get("/api/studies/{study}/structures/{group}/{name}")
    def structure_frame(
        study: str, group: str, name: str, frame: int = Query(0, ge=0, le=4999)
    ):
        return store.structure_frame(study, ("structures", group, name), frame)

    @app.get("/api/studies/{study}/analyses/{group}/{name}")
    def analysis_structure(
        study: str, group: str, name: str, frame: int = Query(0, ge=0, le=4999)
    ):
        return store.structure_frame(study, ("analyses", group, name), frame)

    @app.get("/api/studies/{study}/analyses/{name}")
    def analysis_frame(study: str, name: str, frame: int = Query(0, ge=0, le=4999)):
        return store.structure_frame(study, ("analyses", name), frame)

    @app.get("/api/studies/{study}/attempts/{attempt}/log-search/{log}")
    def log_search(
        study: str,
        attempt: str,
        log: str,
        query: str = Query(min_length=1, max_length=256),
        start: int = Query(0, ge=0),
        last: bool = False,
    ):
        return store.log_search(study, attempt, log, query, start, last)

    @app.get("/api/studies/{study}/irc-reviews")
    def irc_reviews(study: str):
        from .irc_reviews import list_reviews

        return list_reviews(store, study)

    @app.get("/api/studies/{study}/irc-reviews/{name}")
    def irc_review(study: str, name: str):
        from .irc_reviews import read_review

        return read_review(store, study, name)

    @app.get("/api/studies/{study}/irc-reviews/{group}/{name}")
    def grouped_irc_review(study: str, group: str, name: str):
        from .irc_reviews import read_review

        return read_review(store, study, name, group)

    @app.get("/api/studies/{study}/ensembles")
    def ensembles(study: str):
        from .ensembles import list_ensembles

        return list_ensembles(store, study)

    @app.get("/api/studies/{study}/ensembles/{name}")
    def ensemble(study: str, name: str):
        from .ensembles import read_ensemble

        return read_ensemble(store, study, name)

    @app.get("/api/studies/{study}/ensembles/{group}/{name}")
    def grouped_ensemble(study: str, group: str, name: str):
        from .ensembles import read_ensemble

        return read_ensemble(store, study, name, group)

    @app.get("/api/studies/{study}/attempts/{attempt}/crest-frames/{name}")
    def crest_frames(
        study: str, attempt: str, name: str, frame: int = Query(0, ge=0, le=999)
    ):
        return store.crest_frames(study, attempt, name, frame)

    @app.get("/{asset:path}", include_in_schema=False)
    def static(asset: str):
        found = ui.get("/" + asset)
        if found is None:
            return JSONResponse({"detail": "Not found"}, status_code=404)
        return Response(found[0], media_type=found[1])

    return app
