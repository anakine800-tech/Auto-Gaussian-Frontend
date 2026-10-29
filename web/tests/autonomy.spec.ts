import { test, expect } from "@playwright/test";
import type { AutonomyStatus } from "../src/api";

const counts = { attempt: 3, remedy: 1, cancel: 0, reroute: 0 };
function savedStatus(): AutonomyStatus {
  const now = Date.now() / 1000;
  const sha = "a".repeat(64);
  const captured = now - 2400;
  const reference =
    "snapshots/" +
    new Date(captured * 1000)
      .toISOString()
      .replace(/[-:.]/g, "")
      .replace("Z", "000Z");
  return {
    status: "ok",
    reason: null,
    phase: "running",
    manual_actions_blocked: true,
    manual_block_reason: "自主轮次运行中，请先暂停；唤醒间隙也属于运行。",
    verification: "saved-files-only",
    integration: "pending-backend-action-boundary",
    checked_at: now,
    plans: [
      {
        id: "plan-demo",
        sha256: sha,
        created_at: now - 7200,
        versions: {
          ag_version: "4.8.0",
          git_commit: "b".repeat(40),
          dirty: false,
          rdkit: "synthetic",
          goodvibes: "synthetic",
        },
        spec: {
          goal: "合成示例：比较两组输入",
          comparison_groups: ["对照 A", "对照 B"],
          method_policy: "保存的方法规则示例",
          mechanism_scope: "不作机理结论",
          system_rules: { main: "主要体系规则示例", small: "小体系规则示例" },
          estimated_hours: 2,
          attempt_limit: 6,
          valid_until: now + 7200,
          submission_policy: {
            templates: ["gaussian", "xtb"],
            clusters: {
              default: {
                nodes: [],
                max_committed_cores: 24,
                max_queued_cores: 12,
                max_jobs: 2,
              },
              named: {
                nodes: ["synthetic-a"],
                max_committed_cores: 24,
                max_queued_cores: 12,
                max_jobs: 2,
              },
            },
            max_cores_per_job: 12,
            max_walltime: "02:00:00",
            routing_sha256: "c".repeat(64),
            allow_relaxed: true,
            methods: {
              gaussian: [
                {
                  method: "rhf",
                  basis: "sto-3g",
                  basis_function_type: "basis_default",
                  dispersion: "method_default",
                  solvent_model: "none",
                  solvent: "none",
                  integration_grid: "program_default",
                  opt_convergence: "tight",
                  scf_convergence: 8,
                },
              ],
              xtb: [{ parameters: { "--gfn": "2" } }],
            },
          },
        },
        confirmation: {
          at: now - 7000,
          quote: "合成确认记录，仅用于界面测试。",
          sha256: sha,
        },
      },
    ],
    current_plan: "plan-demo",
    current_round: {
      id: "round-demo",
      started_at: now - 6000,
      ended_at: null,
      totals: counts,
      plan_ids: ["plan-demo"],
    },
    current_run: null,
    lease: null,
    totals: counts,
    updated_at: now - 2200,
    summary: "已保存第一组观察；等待下一次唤醒。",
    pending: ["核对第二组输入的方法依据。"],
    events: [
      { seq: 1, op: "init", at: now - 7200 },
      {
        seq: 7,
        op: "snapshot",
        at: now - 2400,
        snapshot: {
          attempt: "anti",
          run_id: "run-demo",
          round_id: "round-demo",
          snapshot: reference,
          captured_at: captured,
          snapshot_sha256: "d".repeat(64),
          log_sha256: "e".repeat(64),
        },
      },
      {
        seq: 8,
        op: "update",
        at: now - 2300,
        summary: "合成事件摘要：已核对输入。",
      },
      {
        seq: 9,
        op: "finish",
        at: now - 2200,
        reason: "合成结束理由：本次观察完成。",
      },
    ],
    events_truncated: true,
    relaxed_inputs: [
      {
        attempt: "anti",
        mode: "relaxed",
        skipped_checks: ["method-route-check"],
        method_verified: false,
      },
    ],
    relaxed_inputs_warning: null,
  };
}

test("saved autonomy page distinguishes a round from wakeups and stays read only", async ({
  page,
}, info) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url());
  });
  await page.route("**/api/studies/*/autonomy", (route) =>
    route.fulfill({ json: savedStatus() }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "自主运行", exact: true }).click();
  await expect(page).toHaveURL(/#\/s\/[^/]+\/research\/autonomy$/);
  const view = page.getByRole("region", { name: "自主运行状态" });
  await expect(view).toContainText("运行中");
  await expect(
    page.getByRole("region", { name: "当前自主轮次" }),
  ).toContainText("round-demo");
  await expect(
    page.getByRole("region", { name: "单次唤醒与租约" }),
  ).toContainText("当前没有保存的唤醒租约");
  await expect(view).toContainText("唤醒间隙也属于运行");
  await expect(page.getByRole("region", { name: "保存的计划" })).toContainText(
    "合成示例：比较两组输入",
  );
  await expect(
    page.getByRole("region", { name: "待负责人决定" }),
  ).toContainText("核对第二组输入的方法依据");
  await expect(
    page.getByRole("region", { name: "放宽输入提醒" }),
  ).toContainText("method_verified=false");
  await expect(view).not.toContainText("token");
  await expect(
    view.getByRole("button", {
      name: /^(启动|恢复|继续|暂停|结束|编辑)(自主|计划|规则|轮次|运行)/,
    }),
  ).toHaveCount(0);
  await page.getByText("确认依据与版本", { exact: true }).click();
  await expect(view).toContainText("合成确认记录，仅用于界面测试。");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "当前自主轮次" }),
  ).toContainText("round-demo");
  expect(writes).toEqual([]);
  await page.screenshot({
    path: info.outputPath("autonomy-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: info.outputPath("autonomy-mobile.png"),
    fullPage: true,
  });
});

test("running, paused with live lease, and ended states refresh without changing study data", async ({
  page,
}) => {
  let data = savedStatus();
  await page.route("**/api/studies/*/autonomy", (route) =>
    route.fulfill({ json: data }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "自主运行", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "自主运行状态" }),
  ).toContainText("运行中");
  data = {
    ...data,
    phase: "paused",
    manual_block_reason: "等待当前唤醒释放租约。",
    lease: {
      run_id: "run-demo",
      round_id: "round-demo",
      started_at: Date.now() / 1000 - 60,
      run_until: Date.now() / 1000 + 3540,
      expires_at: Date.now() / 1000 + 5340,
      status: "active",
    },
  };
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "自主运行状态" }),
  ).toContainText("已暂停");
  await expect(
    page.getByRole("region", { name: "自主运行状态" }),
  ).toContainText("等待当前唤醒释放租约");
  data = {
    ...data,
    phase: "ended",
    lease: null,
    manual_actions_blocked: false,
    manual_block_reason: null,
  };
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "自主运行状态" }),
  ).toContainText("已结束");
  await expect(
    page.getByRole("region", { name: "自主运行状态" }),
  ).not.toContainText("手动新建、提交、取消和取回已阻止");
});

for (const [status, label] of [
  ["absent", "未启用"],
  ["missing", "记录缺失"],
  ["unsupported", "不支持的版本"],
  ["invalid", "记录损坏或无法核验"],
] as const) {
  test(`autonomy ${status} is explicit`, async ({ page }) => {
    const data = {
      ...savedStatus(),
      status,
      phase: null,
      reason: "合成读取状态说明",
      manual_actions_blocked: status !== "absent",
      manual_block_reason:
        status === "absent" ? null : "状态不可核验，拒绝手动写操作。",
      plans: [],
      current_plan: null,
      current_round: null,
      current_run: null,
      lease: null,
      totals: null,
      summary: null,
      pending: [],
      events: [],
      relaxed_inputs: [],
    };
    await page.route("**/api/studies/*/autonomy", (route) =>
      route.fulfill({ json: data }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "自主运行", exact: true }).click();
    const view = page.getByRole("region", { name: "自主运行状态" });
    await expect(view).toContainText(label);
    await expect(view).not.toContainText("尚无保存的计划");
    if (status !== "absent")
      await expect(view).toContainText("手动新建、提交、取消和取回已阻止");
  });
}

test("plan submission limits and event reasons are displayed without filling missing limits", async ({
  page,
}, info) => {
  let data = savedStatus();
  await page.route("**/api/studies/*/autonomy", (route) =>
    route.fulfill({ json: data }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "自主运行", exact: true }).click();
  await page.getByText("计划内提交约束", { exact: true }).click();
  const policy = page.locator(".autonomy-policy");
  await expect(policy).toContainText("allow_relaxed=true");
  await expect(
    page.getByRole("region", { name: "入口约束 default" }),
  ).toContainText("仅不指定节点的提交（nodes=[]）");
  await expect(
    page.getByRole("region", { name: "入口约束 named" }),
  ).toContainText("synthetic-a");
  await expect(
    page.getByRole("region", { name: "方法约束 gaussian" }),
  ).toContainText("SCF 收敛下限");
  await expect(
    page.getByRole("region", { name: "方法约束 xtb" }),
  ).toContainText("--gfn");
  await page.getByText("最近日志事件", { exact: true }).click();
  await expect(page.locator(".autonomy-events")).toContainText(
    "合成结束理由：本次观察完成。",
  );
  await expect(page.locator(".autonomy-events")).toContainText("记录观察快照");
  const snapshot = page.locator(".autonomy-snapshot");
  await expect(snapshot).toContainText("anti");
  await expect(snapshot).toContainText("run-demo");
  await expect(snapshot).toContainText("snapshots/");
  await expect(snapshot).toContainText("不是已取回结果或签字证据");
  await snapshot.getByText("快照与日志哈希", { exact: true }).click();
  await expect(snapshot).toContainText("d".repeat(64));
  await expect(snapshot).not.toContainText("token");
  await expect(page.locator(".autonomy-events").getByRole("link")).toHaveCount(
    0,
  );
  await expect(page.locator(".autonomy-events")).toContainText(
    "合成事件摘要：已核对输入。",
  );
  await policy.screenshot({ path: info.outputPath("autonomy-policy.png") });
  data.plans[0].spec.submission_policy!.allow_relaxed = false;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByText("计划内提交约束", { exact: true }).click();
  await expect(policy).toContainText("allow_relaxed=false");
  delete data.plans[0].spec.submission_policy;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByRole("region", { name: "保存的计划" })).toContainText(
    "未记录结构化提交约束",
  );
  await expect(page.getByText("计划内提交约束", { exact: true })).toHaveCount(
    0,
  );
});

test("an expired observe-only wakeup does not end its running round", async ({
  page,
}) => {
  const data = savedStatus(),
    at = Date.now() / 1000;
  data.lease = {
    run_id: "run-demo",
    round_id: "round-demo",
    started_at: at - 6000,
    run_until: at - 2400,
    expires_at: at - 600,
    status: "expired",
    observe_only: true,
  };
  data.current_run = {
    id: "run-demo",
    started_at: at - 6000,
    ended_at: null,
    outcome: null,
    totals: counts,
    observe_only: true,
  };
  await page.route("**/api/studies/*/autonomy", (route) =>
    route.fulfill({ json: data }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "自主运行", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "单次唤醒与租约" }),
  ).toContainText("已过期（不表示轮次结束）");
  await expect(
    page.getByRole("region", { name: "单次唤醒与租约" }),
  ).toContainText("仅观察模式");
  await expect(
    page.getByRole("region", { name: "当前自主轮次" }),
  ).toContainText("运行中");
  await expect(
    page.getByRole("region", { name: "自主运行状态" }),
  ).toContainText("手动新建、提交、取消和取回已阻止");
});

test("failed status read does not imply autonomy is disabled", async ({
  page,
}) => {
  await page.route("**/api/studies/*/autonomy", (route) =>
    route.fulfill({ status: 503, json: { detail: "合成读取故障" } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "自主运行", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "不能据此认定自主运行未启用",
  );
});

test.describe("manual action guard", () => {
  test.use({ baseURL: "http://127.0.0.1:18766" });
  for (const phase of [
    "running",
    "paused",
    "invalid",
    "missing-autonomy",
    "missing-status",
    "missing-phase",
    "conflicting-running",
    "conflicting-lease",
  ] as const) {
    test(`${phase} blocks four mutating controls while status stays available`, async ({
      page,
    }) => {
      const posts: string[] = [];
      await page.route("**/api/actions/butane-demo/*", async (route) => {
        const response = await route.fetch(),
          body = await response.json();
        body.autonomy = {
          ...savedStatus(),
          phase: phase === "invalid" ? null : phase,
          status: phase === "invalid" ? "invalid" : "ok",
          manual_actions_blocked: true,
          manual_block_reason:
            phase === "paused"
              ? "等待当前唤醒释放租约。"
              : "自主状态禁止手动写操作。",
        };
        if (phase === "missing-autonomy") delete body.autonomy;
        if (phase === "missing-status") {
          body.autonomy = { manual_actions_blocked: false };
        }
        if (phase === "missing-phase") {
          body.autonomy = { status: "ok", manual_actions_blocked: false };
        }
        if (phase === "conflicting-running") {
          body.autonomy = { ...savedStatus(), manual_actions_blocked: false };
        }
        if (phase === "conflicting-lease") {
          const at = Date.now() / 1000;
          body.autonomy = {
            ...savedStatus(),
            phase: "paused",
            manual_actions_blocked: false,
            lease: {
              run_id: "run-demo",
              round_id: "round-demo",
              started_at: at - 60,
              run_until: at + 3540,
              expires_at: at + 5340,
              status: "active",
            },
          };
        }
        body.can_cancel = true;
        body.state = route.request().url().endsWith("/prepared")
          ? "prepared"
          : "finished";
        await route.fulfill({ json: body });
      });
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request.url().endsWith("/api/actions")
        )
          posts.push(request.postDataJSON().action);
      });
      await page.goto("/#/butane-demo/prepared");
      await expect(
        page.getByRole("button", { name: "基于此新建", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "提交", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "取消计算", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "刷新状态", exact: true }),
      ).toBeEnabled();
      await page.goto("/#/butane-demo/anti");
      await expect(
        page.getByRole("button", { name: "取回结果", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "刷新状态", exact: true }),
      ).toBeEnabled();
      expect(posts).toEqual([]);
    });
  }
});
