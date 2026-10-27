# T145 — PBS node selection for new Gaussian Attempts

Status: implementation; paired with backend T145, no deployment/version change.

Allowed paths: autog_frontend/actions.py, web/src/actions.tsx,
web/src/node-targets.ts, web/src/ui/attempt.css, tests/test_actions.py,
web/tests/**, tests/fixtures/**, docs/T145-node-selection.md.

Reuse the existing new-Attempt drawer and server layout. Only entries advertising
node_targeting show a required target selector and half/quarter selector (half
default). Never preselect a recommended node. Show ordered availability reasons,
configured matching tier, requested cores/memory, and target in submit summary.
Generic policy only: real server/node names, priorities and resource values live
in private configuration. Restricted/forbidden nodes remain visible but disabled.
Backend independently checks all rules; old entries retain the existing UI.

Contract: optional clusters node_targeting={default_fraction:"1/2",
fractions:["1/2","1/4"]}; read-only `ag nodes --cluster ENTRY --json` returns
schema ag-node-targets/1, cluster, fresh, sampled_at, valid_until, ordered nodes. Each node:
name,priority,status,reason,options[{fraction,cores,mem_gb,tier|null}]. Statuses:
available,occupied,insufficient,stale,restricted,forbidden,unknown.
Prepare adds target_node and node_fraction only for opted-in entries, passed as
fixed argv to reviewed ag prepare flags. Manifest node_target is display-only.

Tests use synthetic data/fake ag exclusively: validation, explicit selection,
default fraction, stale/errors, keyboard/mobile, old entries, final confirmation.
Screenshots go to testInfo.outputPath(), never overwrite tracked images.
Run Python suite, web build, full Playwright, effective private-term scan and CI.
No live tests, SSH, research writes, merge or release this round; paired backend
and frontend review precede separately approved deployment and compute smoke.
