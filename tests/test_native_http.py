import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from auto_g16.core import SQLiteRuntimeStore, Project, WorkflowRun, Task, Attempt
from auto_g16.query import NativeSource
from autog_frontend.api import create_app

class NativeHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name).resolve()/'core.sqlite3'
        with SQLiteRuntimeStore(self.path) as s:
            s.store_project(Project(project_id='project'))
            s.store_workflow_run(WorkflowRun(workflow_run_id='run',project_id='project',workflow_name='offline'))
            s.store_task(Task(task_id='task',workflow_run_id='run',task_kind='opt'))
            s.create_attempt(Attempt(attempt_id='attempt',task_id='task',ordinal=1))
        self.client=TestClient(create_app(self.path,token='a'*32,native_sources=(NativeSource(source_id='one',database=self.path),)),base_url='http://127.0.0.1:18871',headers={'authorization':'Bearer '+'a'*32})
        self.addCleanup(self.client.close)

    def test_versioned_list_detail_and_legacy(self):
        p=self.client.get('/api/v1/native/projects');self.assertEqual(p.status_code,200)
        rows=self.client.get('/api/v1/native/sources/one/projects/project/attempts').json()['data']['items']
        detail=self.client.get('/api/v1/native/sources/one/attempts/attempt').json()['data']
        self.assertEqual(rows,[detail]);self.assertEqual(self.client.get('/api/projects').json()['schema'],'auto-g16-query/1')
        self.assertNotIn(str(self.path),p.text)

    def test_denied_methods_paths_query_origin_and_missing(self):
        cases=[('post','/api/v1/native/projects',405,{}),('get','/api/v1/native/projects?path=private',400,{}),('get','/api/v1/native/sources/no/attempts/attempt',404,{}),('get','/api/v1/native/projects',403,{'origin':'https://evil.invalid'})]
        before=self.path.read_bytes()
        for method,path,status,headers in cases:
            self.assertEqual(getattr(self.client,method)(path,headers=headers).status_code,status)
        self.assertEqual(before,self.path.read_bytes())

    def test_unreadable_source_status_and_error_sanitized(self):
        self.path.rename(self.path.with_suffix('.retained'))
        value=self.client.get('/api/v1/native/projects').json()
        self.assertEqual(value['data']['sources'][0]['reason'],'store-unavailable')
        response=self.client.get('/api/v1/native/sources/one/attempts/attempt')
        self.assertEqual(response.status_code,503);self.assertNotIn(str(self.path),response.text)
