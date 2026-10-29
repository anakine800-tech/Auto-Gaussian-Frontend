import { useEffect, useState } from "react";
import { endpoint, get } from "./api";
import type {
  AutonomyCounts,
  AutonomyPlan,
  AutonomyStatus,
  AutonomySubmissionPolicy,
  AutonomyGaussianMethod,
  AutonomySnapshot,
} from "./api";
import { routeHash } from "./routing";
import { EmptyState, ErrorNotice, FactGrid, Panel, StatusBadge } from "./ui";
import "./ui/autonomy.css";

const phaseLabels = { running: "运行中", paused: "已暂停", ended: "已结束" };
const statusLabels = {
  absent: "未启用",
  ok: "记录可读",
  unsupported: "不支持的版本",
  invalid: "记录损坏或无法核验",
  missing: "记录缺失",
};
const counterLabels: Record<keyof AutonomyCounts, string> = {
  attempt: "Attempt 意图",
  remedy: "修复",
  cancel: "取消",
  reroute: "改派",
};
const eventLabels: Record<string, string> = {
  init: "初始化",
  plan: "保存计划",
  confirm: "确认计划",
  begin: "开始轮次",
  start: "开始唤醒",
  pause: "暂停",
  resume: "恢复",
  finish: "结束唤醒",
  end: "结束轮次",
  update: "更新摘要",
  snapshot: "记录观察快照",
  count: "记录计数",
  recover: "恢复记录",
};
function timestamp(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "未记录";
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return "时间超出可显示范围";
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleString("zh-CN", { hour12: false })}
    </time>
  );
}
function Counts({
  value,
  label,
}: {
  value: AutonomyCounts | null;
  label: string;
}) {
  return (
    <div className="autonomy-counts" aria-label={label}>
      {(Object.keys(counterLabels) as (keyof AutonomyCounts)[]).map((key) => (
        <div key={key}>
          <span>{counterLabels[key]}</span>
          <strong>{value?.[key] ?? "—"}</strong>
        </div>
      ))}
    </div>
  );
}
const methodLabels: Record<keyof AutonomyGaussianMethod, string> = {
  method: "方法",
  basis: "基组",
  basis_function_type: "基函数形式",
  dispersion: "色散",
  solvent_model: "溶剂模型",
  solvent: "溶剂",
  integration_grid: "积分网格",
  opt_convergence: "优化收敛下限",
  scf_convergence: "SCF 收敛下限",
};
function SubmissionPolicy({ policy }: { policy: AutonomySubmissionPolicy }) {
  return (
    <details className="autonomy-policy">
      <summary>计划内提交约束</summary>
      <p className="muted">
        按已保存字段展示；这些约束不是当前动作的授权凭据。
      </p>
      <FactGrid
        facts={[
          { label: "模板", value: policy.templates.join("、") },
          { label: "单作业核数上限", value: policy.max_cores_per_job },
          { label: "单作业时限上限", value: policy.max_walltime },
          {
            label: "计划允许放宽输入",
            value: policy.allow_relaxed
              ? "是（allow_relaxed=true）"
              : "否（allow_relaxed=false）",
          },
          {
            label: "路由 SHA-256",
            value: <code>{policy.routing_sha256}</code>,
          },
        ]}
      />
      <h4>入口与节点范围</h4>
      {Object.entries(policy.clusters).map(([name, limits]) => (
        <section key={name} aria-label={`入口约束 ${name}`}>
          <h5>{name}</h5>
          <FactGrid
            facts={[
              {
                label: "节点范围",
                value: limits.nodes.length
                  ? limits.nodes.join("、")
                  : "仅不指定节点的提交（nodes=[]）",
              },
              {
                label: "运行加排队核数上限",
                value: limits.max_committed_cores,
              },
              { label: "排队核数上限", value: limits.max_queued_cores },
              { label: "作业数量上限", value: limits.max_jobs },
            ]}
          />
        </section>
      ))}
      <h4>明确列出的完整方法组合</h4>
      {Object.entries(policy.methods).map(([template, methods]) => (
        <section key={template} aria-label={`方法约束 ${template}`}>
          <h5>{template}</h5>
          {methods.map((method, index) => (
            <div key={index} className="autonomy-method">
              <h6>组合 {index + 1}</h6>
              {"parameters" in method ? (
                <FactGrid
                  facts={Object.entries(method.parameters).map(
                    ([label, value]) => ({
                      label,
                      value: value || "空字符串（保存值）",
                    }),
                  )}
                />
              ) : (
                <FactGrid
                  facts={(
                    Object.keys(
                      methodLabels,
                    ) as (keyof AutonomyGaussianMethod)[]
                  ).map((key) => ({
                    label: methodLabels[key],
                    value: method[key],
                  }))}
                />
              )}
            </div>
          ))}
        </section>
      ))}
    </details>
  );
}
function SnapshotSummary({ value }: { value: AutonomySnapshot }) {
  return (
    <div className="autonomy-snapshot">
      <p className="muted">运行中观察快照，不是已取回结果或签字证据。</p>
      <FactGrid
        facts={[
          { label: "Attempt", value: value.attempt },
          { label: "唤醒", value: value.run_id },
          { label: "轮次", value: value.round_id },
          { label: "采样时间", value: timestamp(value.captured_at) },
          { label: "保存的快照引用", value: <code>{value.snapshot}</code> },
        ]}
      />
      <details>
        <summary>快照与日志哈希</summary>
        <FactGrid
          facts={[
            {
              label: "快照 SHA-256",
              value: <code>{value.snapshot_sha256}</code>,
            },
            { label: "日志 SHA-256", value: <code>{value.log_sha256}</code> },
          ]}
        />
      </details>
    </div>
  );
}
function Plan({
  plan,
  current,
  at,
}: {
  plan: AutonomyPlan;
  current: boolean;
  at: number;
}) {
  return (
    <article className="autonomy-plan" aria-label={`计划 ${plan.id}`}>
      <h3>
        {plan.id} {current && <StatusBadge>当前计划</StatusBadge>}{" "}
        <StatusBadge>
          {plan.confirmation ? "已有确认记录" : "尚未确认"}
        </StatusBadge>
      </h3>
      <FactGrid
        facts={[
          { label: "目标", value: plan.spec.goal },
          { label: "比较组", value: plan.spec.comparison_groups.join("；") },
          { label: "方法规则", value: plan.spec.method_policy },
          { label: "机理范围", value: plan.spec.mechanism_scope },
          { label: "主要体系规则", value: plan.spec.system_rules.main },
          { label: "小体系规则", value: plan.spec.system_rules.small },
          {
            label: "计划预计用时",
            value: `${plan.spec.estimated_hours} 小时（保存值）`,
          },
          { label: "Attempt 意图上限", value: plan.spec.attempt_limit },
          {
            label: "有效期截止",
            value: (
              <>
                {timestamp(plan.spec.valid_until)}{" "}
                {at >= plan.spec.valid_until && (
                  <StatusBadge tone="warn">已过期</StatusBadge>
                )}
              </>
            ),
          },
          { label: "创建时间", value: timestamp(plan.created_at) },
        ]}
      />
      {plan.spec.submission_policy ? (
        <SubmissionPolicy policy={plan.spec.submission_policy} />
      ) : (
        <p className="muted">
          未记录结构化提交约束；不能据此推定提交范围或允许放宽输入。
        </p>
      )}
      <details>
        <summary>确认依据与版本</summary>
        <FactGrid
          facts={[
            { label: "计划 SHA-256", value: <code>{plan.sha256}</code> },
            { label: "确认时间", value: timestamp(plan.confirmation?.at) },
            { label: "确认原话", value: plan.confirmation?.quote ?? "未记录" },
            {
              label: "确认绑定 SHA-256",
              value: plan.confirmation ? (
                <code>{plan.confirmation.sha256}</code>
              ) : (
                "未记录"
              ),
            },
            { label: "ag", value: plan.versions.ag_version },
            {
              label: "Git 提交",
              value: <code>{plan.versions.git_commit}</code>,
            },
            {
              label: "源码修改标记",
              value: plan.versions.dirty ? "有未提交改动" : "无未提交改动",
            },
            { label: "RDKit", value: plan.versions.rdkit },
            { label: "GoodVibes", value: plan.versions.goodvibes },
          ]}
        />
      </details>
    </article>
  );
}
export function AutonomyView({
  study,
  revision,
}: {
  study: string;
  revision: number;
}) {
  const [data, setData] = useState<AutonomyStatus | null>(null),
    [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now() / 1000), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    get<AutonomyStatus>(endpoint(study, "autonomy"), controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((value) => {
        if (!controller.signal.aborted) setError(value.message);
      });
    return () => controller.abort();
  }, [study, revision]);
  if (error)
    return (
      <section className="autonomy-view">
        <h2>自主运行</h2>
        <ErrorNotice>
          自主状态读取失败：{error}。不能据此认定自主运行未启用。
        </ErrorNotice>
      </section>
    );
  if (!data) return <p role="status">读取自主运行记录…</p>;
  const currentPlan = data.plans.find((plan) => plan.id === data.current_plan);
  const otherPlans = data.plans.filter((plan) => plan.id !== data.current_plan);
  return (
    <section className="autonomy-view" aria-label="自主运行状态">
      <div className="autonomy-heading">
        <div>
          <h2>自主运行</h2>
          <p className="muted">本地保存的轮次、唤醒与计划记录 · 只读</p>
        </div>
        <StatusBadge
          tone={
            data.phase === "running"
              ? "info"
              : data.status !== "ok" && data.status !== "absent"
                ? "warn"
                : "neutral"
          }
        >
          {data.status === "ok" && data.phase
            ? phaseLabels[data.phase]
            : statusLabels[data.status]}
        </StatusBadge>
      </div>
      {data.reason && (
        <p className="notice" role="status">
          {data.reason}
        </p>
      )}
      {data.manual_actions_blocked && (
        <p className="notice" role="status">
          手动新建、提交、取消和取回已阻止。{data.manual_block_reason}
        </p>
      )}
      <p className="muted">
        暂停、恢复和结束轮次由负责人在对话中通过正式 ag
        操作。前端预检不构成动作授权；后端最终动作边界尚待组合验证。
      </p>
      <p className="muted">
        读取时间：{timestamp(data.checked_at)}；记录更新时间：
        {timestamp(data.updated_at)}。刷新页面可重读本地记录。
      </p>
      {data.status === "absent" ? (
        <EmptyState>此 Study 没有自主运行目录。</EmptyState>
      ) : data.status !== "ok" ? (
        <EmptyState>
          无法展示可信的自主记录；保留原文件，交负责人核对。
        </EmptyState>
      ) : (
        <>
          <div className="autonomy-columns">
            <Panel title="当前自主轮次">
              <p className="muted">
                轮次可包含多次唤醒；唤醒间隙仍按轮次状态处理。
              </p>
              {data.current_round ? (
                <>
                  <FactGrid
                    facts={[
                      { label: "轮次", value: data.current_round.id },
                      {
                        label: "轮次状态",
                        value: data.phase ? phaseLabels[data.phase] : "未知",
                      },
                      {
                        label: "开始时间",
                        value: timestamp(data.current_round.started_at),
                      },
                      {
                        label: "结束时间",
                        value: timestamp(data.current_round.ended_at),
                      },
                      {
                        label: "关联计划",
                        value:
                          data.current_round.plan_ids.join("、") || "未记录",
                      },
                    ]}
                  />
                  <Counts value={data.current_round.totals} label="本轮计数" />
                </>
              ) : (
                <EmptyState>尚无自主轮次记录。</EmptyState>
              )}
            </Panel>
            <Panel title="单次唤醒与租约">
              {data.current_run ? (
                <>
                  <FactGrid
                    facts={[
                      { label: "唤醒", value: data.current_run.id },
                      {
                        label: "开始时间",
                        value: timestamp(data.current_run.started_at),
                      },
                      {
                        label: "结束时间",
                        value: timestamp(data.current_run.ended_at),
                      },
                      {
                        label: "记录结果",
                        value: data.current_run.outcome ?? "未记录",
                      },
                      ...(data.current_run.observe_only === undefined
                        ? []
                        : [
                            {
                              label: "仅观察模式",
                              value: data.current_run.observe_only
                                ? "是（保存值）"
                                : "否（保存值）",
                            },
                          ]),
                    ]}
                  />
                  <Counts
                    value={data.current_run.totals}
                    label="单次唤醒计数"
                  />
                </>
              ) : (
                <EmptyState>当前没有持锁唤醒。</EmptyState>
              )}
              {data.lease ? (
                <FactGrid
                  facts={[
                    {
                      label: "租约",
                      value:
                        clock >= data.lease.expires_at
                          ? "已过期（不表示轮次结束）"
                          : "有效（等待当前唤醒释放）",
                    },
                    { label: "持有唤醒", value: data.lease.run_id },
                    { label: "所属轮次", value: data.lease.round_id },
                    {
                      label: "本次运行截止",
                      value: timestamp(data.lease.run_until),
                    },
                    {
                      label: "租约截止",
                      value: timestamp(data.lease.expires_at),
                    },
                  ]}
                />
              ) : (
                <p>当前没有保存的唤醒租约。</p>
              )}
            </Panel>
          </div>
          <Panel title="保存的计划">
            {currentPlan && <Plan plan={currentPlan} current at={clock} />}
            {!currentPlan && <p className="muted">没有当前绑定计划。</p>}
            {otherPlans.length > 0 && (
              <details open={!currentPlan}>
                <summary>其他保存计划（{otherPlans.length}）</summary>
                {otherPlans.map((plan) => (
                  <Plan key={plan.id} plan={plan} current={false} at={clock} />
                ))}
              </details>
            )}
            {data.plans.length === 0 && (
              <EmptyState>尚无保存的计划。</EmptyState>
            )}
          </Panel>
          <Panel title="累计记录">
            <Counts value={data.totals} label="累计计数" />
            <p className="muted">
              计数来自本地意图记录，未核实实际提交次数；计划用时和计数不能推导剩余预算或科学通过。
            </p>
          </Panel>
          <div className="autonomy-columns">
            <Panel title="日志摘要">
              <p className="autonomy-prose">
                {data.summary || "尚无保存的摘要。"}
              </p>
            </Panel>
            <Panel title="待负责人决定">
              {data.pending.length ? (
                <ul className="autonomy-list">
                  {data.pending.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : (
                <EmptyState>没有保存的待决定事项。</EmptyState>
              )}
            </Panel>
          </div>
          <details className="autonomy-events">
            <summary>最近日志事件</summary>
            <p className="muted">
              列出事件类别、时间及已保存的理由或摘要，不打开记录中的引用路径。
            </p>
            {data.events.length ? (
              <ol className="autonomy-list">
                {data.events.map((event) => (
                  <li key={event.seq}>
                    #{event.seq} · {eventLabels[event.op] ?? event.op} ·{" "}
                    {timestamp(event.at)}
                    {event.reason !== undefined && <p>理由：{event.reason}</p>}
                    {event.summary !== undefined && (
                      <p>摘要：{event.summary}</p>
                    )}
                    {event.snapshot && (
                      <SnapshotSummary value={event.snapshot} />
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState>没有可展示事件。</EmptyState>
            )}
            {data.events_truncated && (
              <p className="notice">仅显示最近的有界事件摘要。</p>
            )}
          </details>
        </>
      )}
      <Panel title="放宽输入提醒">
        <p className="muted">
          只汇总 manifest.input_validation
          明确标记的输入；方法未获验证，缺少标记不推定为放宽输入。
        </p>
        {data.relaxed_inputs_warning && (
          <p className="notice" role="status">
            {data.relaxed_inputs_warning}
          </p>
        )}
        {data.relaxed_inputs.length ? (
          <ul className="autonomy-list">
            {data.relaxed_inputs.map((item) => (
              <li key={item.attempt}>
                <a href={routeHash([study, item.attempt])}>{item.attempt}</a> ·
                relaxed · method_verified=false
                <p>跳过检查：{item.skipped_checks.join("、") || "记录为空"}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>已读取记录中没有明确的放宽输入标记。</EmptyState>
        )}
      </Panel>
    </section>
  );
}
