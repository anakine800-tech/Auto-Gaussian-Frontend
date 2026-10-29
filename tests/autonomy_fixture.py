"""Synthetic saved autonomy records; no ag invocation or research inputs."""
from copy import deepcopy
from hashlib import sha256
import json
import time
from pathlib import Path

NOW = 2_000_000_000
FAKE_TOKEN = 'synthetic-run-credential-never-for-display'


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(',', ':'), allow_nan=False) + '\n').encode()


def create_autonomy(study, phase='running', *, lease='active', now=None):
    now = time.time() if now is None else now
    folder = Path(study) / 'autonomy'
    folder.mkdir(exist_ok=True)
    (folder / 'store.lock').write_text('Synthetic local mutex\n')
    totals = dict(attempt=1, remedy=0, cancel=0, reroute=0)
    versions = dict(ag_version='4.8.0', git_commit='a' * 40, dirty=False,
                    rdkit='2026.03.3', goodvibes='3.3.0')
    body = dict(id='plan-demo', created_at=now - 10000, versions=versions,
                spec=dict(goal='合成只读演示', comparison_groups=['合成对照一', '合成对照二'],
                          method_policy='合成方法依据', mechanism_scope='仅展示，不是科学通过',
                          system_rules=dict(main='合成主体系', small='合成小体系'),
                          estimated_hours=2, attempt_limit=4, valid_until=now + 10000))
    plan_hash = sha256(encoded(body)).hexdigest()
    confirmation = dict(at=now - 9999, quote='合成计划确认', sha256=plan_hash)
    started = now - (6000 if lease == 'expired' else 100)
    active_lease = None if lease == 'none' or phase == 'ended' else dict(
        run_id='wake-demo', round_id='round-demo', owner='synthetic-session',
        token_sha256=sha256(FAKE_TOKEN.encode()).hexdigest(),
        started_at=started, run_until=started + 3600, expires_at=started + 5400)
    state = dict(schema='ag-autonomy/1', phase=phase, paused=phase == 'paused',
                 plans={'plan-demo': dict(body=body, sha256=plan_hash, confirmation=confirmation)},
                 current_plan='plan-demo', current_round='round-demo',
                 rounds={'round-demo': dict(started_at=now - 9000,
                         ended_at=now - 1 if phase == 'ended' else None,
                         quote='合成轮次确认', plan_ids=['plan-demo'], initial_plan_sha256=plan_hash,
                         totals=deepcopy(totals))},
                 lease=active_lease,
                 runs={'wake-demo': dict(owner='synthetic-session', plan_id='plan-demo',
                       round_id='round-demo', started_at=started,
                       ended_at=None if active_lease else now - 1,
                       outcome=None if active_lease else 'finished', totals=deepcopy(totals))},
                 summary='合成摘要：等待负责人核对。', pending=['核对合成输入的依据'],
                 objects={'object-demo': {'token': FAKE_TOKEN, 'arbitrary_reference': 'not-opened'}},
                 totals=totals, counts={'count-demo': dict(token_sha256=sha256(FAKE_TOKEN.encode()).hexdigest())},
                 updated_at=now - 1)
    journal = encoded(dict(seq=1, prev_sha256=None, op='init', at=now - 10001, data={}))
    event = dict(seq=2, prev_sha256=sha256(journal).hexdigest(), op='update', at=now - 1,
                 data=dict(summary=state['summary'], token=FAKE_TOKEN))
    line = encoded(event)
    journal += line
    snapshot = dict(seq=2, journal_sha256=sha256(line).hexdigest(), state=state)
    (folder / 'journal.jsonl').write_bytes(journal)
    (folder / 'state.json').write_bytes(encoded(snapshot))
    (folder / 'plan-plan-demo.json').write_bytes(encoded(body))
    return snapshot


def write_snapshot(study, snapshot):
    (Path(study) / 'autonomy' / 'state.json').write_bytes(encoded(snapshot))
