"""Serve a temporary synthetic butane study for browser checks only."""
from pathlib import Path
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.results_fixture import create_results_studies
from autog_frontend.api import create_app
import uvicorn

with tempfile.TemporaryDirectory() as directory:
    root=Path(directory).resolve()
    ui=Path(__file__).resolve().parents[1]/'web/dist'
    if '--actions' in sys.argv:
        from tests.fake_ag import action_studies, make_fake
        studies=root/'studies';action_studies(studies)
        fake=make_fake(root)
        app=create_app(studies,ui,enable_actions=True,ag=fake)
        uvicorn.run(app,host='127.0.0.1',port=18766,access_log=False,proxy_headers=False)
    else:
        create_results_studies(root)
        app=create_app(root,ui)
        uvicorn.run(app,host='127.0.0.1',port=18765,access_log=False,proxy_headers=False)
