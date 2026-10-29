import { useEffect, useState } from "react";
import { endpoint, get } from "./api";
import type {
  AutonomyCounts,
  AutonomyPlan,
  AutonomyStatus,
  AutonomySubmissionPolicy,
  AutonomyGaussianMethod,
  AutonomySnapshot,
  AutonomySubmission,
  AutonomyWaiting,
  AutonomyCancellation,
  AutonomyCancellationResult,
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
  submission_consume: "记录提交消耗",
  submission_dispatch: "进入调度调用边界",
  submission_abort: "调用前中止（保留消耗）",
  submission_boundary_failure: "提交边界失败",
  waiting: "记录无可用提交位置",
  manual_takeover: "人工接管已过期租约",
  cancel_consume: "记录取消消耗",
  cancel_result: "记录取消返回结果",
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
const savedCount = (value: number | null | undefined) =>
  value === undefined
    ? "未知（记录未提供）"
    : value === null
      ? "未知（没有当前轮次）"
      : value;
function SubmissionRecord({ record }: { record: AutonomySubmission }) {
  return (
    <article
      className="autonomy-record"
      aria-label={`提交消耗 ${record.attempt_id}`}
    >
      <details className="autonomy-consumption-record">
        <summary>
          <strong>{record.attempt_id}</strong>{" "}
          <StatusBadge>已记录消耗</StatusBadge>{" "}
          <span>
            {record.aborted_before_dispatch
              ? "调用前中止 · 保留消耗"
              : record.dispatch_started
                ? "已记录调用边界"
                : "未记录调用或中止"}
          </span>
          {record.boundary_failure && (
            <StatusBadge tone="warn">边界失败</StatusBadge>
          )}
        </summary>
        <FactGrid
          facts={[
            { label: "对象", value: record.object_id },
            { label: "轮次", value: record.round_id },
            { label: "唤醒", value: record.run_id },
            { label: "计划", value: record.plan_id },
            { label: "记录时间", value: timestamp(record.at) },
            {
              label: "该规则最多提交次数",
              value: record.max_attempts,
            },
            { label: "失败类别", value: record.failure_class ?? "无保存类别" },
          ]}
        />
        {record.dispatch_started ? (
          <p>
            已记录进入调度调用边界：{timestamp(record.dispatch_started.at)}
            。此记录不证明调度器提交成功。
          </p>
        ) : (
          <p>没有保存的调度调用边界记录。</p>
        )}
        {record.aborted_before_dispatch && (
          <p className="notice">
            调用前已中止（仍计入消耗）：
            {timestamp(record.aborted_before_dispatch.at)} ·{" "}
            {record.aborted_before_dispatch.reason}
          </p>
        )}
        {record.boundary_failure && (
          <p className="notice">
            提交边界失败：{timestamp(record.boundary_failure.at)} ·{" "}
            {record.boundary_failure.dispatched
              ? "已进入提交调用"
              : "未进入提交调用"}{" "}
            · {record.boundary_failure.reason}
          </p>
        )}
        <details>
          <summary>提交消耗绑定哈希</summary>
          <FactGrid
            facts={[
              {
                label: "归属记录 SHA-256",
                value: <code>{record.ownership_sha256}</code>,
              },
              {
                label: "计划 SHA-256",
                value: <code>{record.plan_sha256}</code>,
              },
              {
                label: "规则 SHA-256",
                value: <code>{record.rule_sha256}</code>,
              },
            ]}
          />
        </details>
      </details>
    </article>
  );
}
function WaitingRecord({ record }: { record: AutonomyWaiting }) {
  return (
    <article
      className="autonomy-record"
      aria-label={`等待记录 ${record.object_id}`}
    >
      <h4>{record.object_id}</h4>
      <FactGrid
        facts={[
          { label: "轮次", value: record.round_id },
          { label: "唤醒", value: record.run_id },
          { label: "计划", value: record.plan_id },
          { label: "观察时间", value: timestamp(record.at) },
        ]}
      />
      <details>
        <summary>等待记录绑定哈希</summary>
        <FactGrid
          facts={[
            {
              label: "选择记录 SHA-256",
              value: <code>{record.record_sha256}</code>,
            },
            { label: "计划 SHA-256", value: <code>{record.plan_sha256}</code> },
          ]}
        />
      </details>
    </article>
  );
}
function SubmissionRecords({ data }: { data: AutonomyStatus }) {
  return (
    <>
      <Panel title="已保存提交消耗">
        <p className="muted">
          只汇总本研究已保存的消耗记录，与本地意图计数分开。调用前中止仍保留消耗；进入调用边界不证明调度器提交成功，也不证明全局提交台账已核验。
        </p>
        <FactGrid
          facts={[
            {
              label: "本研究全部轮次已记录消耗",
              value: savedCount(data.submissions_count),
            },
            {
              label: "当前轮次已记录消耗",
              value: savedCount(data.current_round_submission_count),
            },
          ]}
        />
        {data.submissions === undefined ? (
          <EmptyState>
            提交消耗清单未知：记录未提供该字段，不能按零次处理。
          </EmptyState>
        ) : data.submissions.length === 0 ? (
          <EmptyState>保存的提交消耗清单为空。</EmptyState>
        ) : (
          <details className="autonomy-records">
            <summary>最近提交消耗（{data.submissions.length} 条）</summary>
            {data.submissions.map((record) => (
              <SubmissionRecord key={record.attempt_id} record={record} />
            ))}
          </details>
        )}
        {data.submissions_truncated && (
          <p className="notice">
            提交消耗清单已截断；上方数量来自完整记录，不能用当前展示条数替代。
          </p>
        )}
        {data.submission_pause ? (
          <section aria-label="保存的提交暂停记录">
            <h3>保存的提交暂停记录</h3>
            <FactGrid
              facts={[
                { label: "时间", value: timestamp(data.submission_pause.at) },
                { label: "Attempt", value: data.submission_pause.attempt_id },
                { label: "轮次", value: data.submission_pause.round_id },
              ]}
            />
            <p className="autonomy-prose">{data.submission_pause.reason}</p>
            <p className="muted">
              仅显示保存的暂停原因，不据此重算比例、剩余额度或当前容量。
            </p>
          </section>
        ) : (
          <p className="muted">提交暂停记录未知：未提供该字段。</p>
        )}
      </Panel>
      <Panel title="等待可选资源记录">
        <p className="muted">
          等待资源记录表示当次选择未找到可用提交位置，不表示调度器已排队；历史记录不代表当前全局容量。
        </p>
        <FactGrid
          facts={[
            {
              label: "已保存等待记录数",
              value: savedCount(data.waiting_count),
            },
          ]}
        />
        {data.waiting === undefined ? (
          <EmptyState>
            等待记录未知：记录未提供该字段，不能按零次处理。
          </EmptyState>
        ) : data.waiting.length === 0 ? (
          <EmptyState>保存的等待记录清单为空。</EmptyState>
        ) : (
          <details className="autonomy-records">
            <summary>最近等待记录（{data.waiting.length} 条）</summary>
            {data.waiting.map((record, index) => (
              <WaitingRecord
                key={`${record.run_id}/${record.object_id}/${index}`}
                record={record}
              />
            ))}
          </details>
        )}
        {data.waiting_truncated && (
          <p className="notice">
            等待记录清单已截断；上方数量来自完整记录，不能用当前展示条数替代。
          </p>
        )}
      </Panel>
    </>
  );
}
const cancellationKind = { no_progress: "无进展取消", reroute: "改投取消" };
const cancellationOutcome = {
  accepted: "取消请求已受理",
  unknown: "取消结果未知",
};
function CancellationRecord({ record }: { record: AutonomyCancellation }) {
  return (
    <article
      className="autonomy-record"
      aria-label={`取消消耗 ${record.attempt_id}`}
    >
      <details className="autonomy-cancellation-record">
        <summary>
          <strong>{record.attempt_id}</strong>{" "}
          <StatusBadge>已记录消耗</StatusBadge> {cancellationKind[record.kind]}
        </summary>
        <FactGrid
          facts={[
            { label: "轮次", value: record.round_id },
            { label: "唤醒", value: record.run_id },
            { label: "记录时间", value: timestamp(record.at) },
            { label: "日志序号", value: record.seq },
          ]}
        />
        <p>保存理由：{record.reason}</p>
        <details>
          <summary>取消消耗绑定哈希</summary>
          <FactGrid
            facts={[
              {
                label: "消耗记录 SHA-256",
                value: <code>{record.consumption_sha256}</code>,
              },
              {
                label: "归属记录 SHA-256",
                value: <code>{record.ownership_sha256}</code>,
              },
              {
                label: "计划 SHA-256",
                value: <code>{record.plan_sha256}</code>,
              },
              {
                label: "依据 SHA-256",
                value: <code>{record.evidence_sha256}</code>,
              },
              ...(record.lineage_sha256 === null
                ? []
                : [
                    {
                      label: "原计算链 SHA-256",
                      value: <code>{record.lineage_sha256}</code>,
                    },
                  ]),
            ]}
          />
        </details>
      </details>
    </article>
  );
}
function CancellationResult({
  record,
}: {
  record: AutonomyCancellationResult;
}) {
  return (
    <article
      className="autonomy-record"
      aria-label={`取消返回结果 ${record.attempt_id}`}
    >
      <details className="autonomy-cancellation-record">
        <summary>
          <strong>{record.attempt_id}</strong>{" "}
          <StatusBadge tone={record.outcome === "unknown" ? "warn" : "neutral"}>
            {cancellationOutcome[record.outcome]}
          </StatusBadge>{" "}
          <span>任务停止未确认</span>
        </summary>
        <FactGrid
          facts={[
            { label: "唤醒", value: record.run_id },
            { label: "记录时间", value: timestamp(record.at) },
            { label: "日志序号", value: record.seq },
          ]}
        />
        <p>保存说明：{record.reason}</p>
        <p className="muted">
          这里只记录取消调用的返回；当前记录未确认任务停止。
        </p>
        <details>
          <summary>取消结果绑定哈希</summary>
          <FactGrid
            facts={[
              {
                label: "消耗记录 SHA-256",
                value: <code>{record.consumption_sha256}</code>,
              },
              {
                label: "依据 SHA-256",
                value: <code>{record.evidence_sha256}</code>,
              },
            ]}
          />
        </details>
      </details>
    </article>
  );
}
function CancellationRecords({ data }: { data: AutonomyStatus }) {
  return (
    <Panel title="已保存取消与改投记录">
      <p className="muted">
        只汇总本研究已保存的取消消耗、返回结果和原计算链对应关系。请求已受理不等于任务已停止；当前记录未确认终止。
      </p>
      <FactGrid
        facts={[
          {
            label: "已保存取消消耗数",
            value: savedCount(data.cancellations_count),
          },
          {
            label: "已保存取消返回结果数",
            value: savedCount(data.cancellation_results_count),
          },
          {
            label: "已保存改投链数",
            value: savedCount(data.reroute_lineages_count),
          },
        ]}
      />
      {data.cancellations === undefined ? (
        <EmptyState>
          取消消耗未知：记录未提供该字段，不能按零次处理。
        </EmptyState>
      ) : data.cancellations.length === 0 ? (
        <EmptyState>保存的取消消耗清单为空。</EmptyState>
      ) : (
        <details className="autonomy-records">
          <summary>最近取消消耗（{data.cancellations.length} 条）</summary>
          {data.cancellations.map((record) => (
            <CancellationRecord key={record.attempt_id} record={record} />
          ))}
        </details>
      )}
      {data.cancellations_truncated && (
        <p className="notice">
          取消消耗清单已截断；数量来自完整保存表，不能用展示条数替代。
        </p>
      )}
      {data.cancellation_results === undefined ? (
        <EmptyState>取消返回结果未知：记录未提供该字段。</EmptyState>
      ) : data.cancellation_results.length === 0 ? (
        <EmptyState>保存的取消返回结果清单为空。</EmptyState>
      ) : (
        <details className="autonomy-records">
          <summary>
            最近取消返回结果（{data.cancellation_results.length} 条）
          </summary>
          {data.cancellation_results.map((record) => (
            <CancellationResult key={record.attempt_id} record={record} />
          ))}
        </details>
      )}
      {data.cancellation_results_truncated && (
        <p className="notice">
          取消返回结果清单已截断；数量来自完整保存表，不能用展示条数替代。
        </p>
      )}
      {data.reroute_lineages === undefined ? (
        <EmptyState>改投链记录未知：记录未提供该字段。</EmptyState>
      ) : data.reroute_lineages.length === 0 ? (
        <EmptyState>保存的改投链清单为空。</EmptyState>
      ) : (
        <details className="autonomy-records">
          <summary>
            已记录消耗的改投链（{data.reroute_lineages.length} 条）
          </summary>
          <p className="muted">仅显示已保存的对应关系，不推断后续动作。</p>
          {data.reroute_lineages.map((record) => (
            <article
              className="autonomy-record"
              aria-label={`改投链 ${record.attempt_id}`}
              key={record.lineage_sha256}
            >
              <h4>Attempt：{record.attempt_id}</h4>
              <details>
                <summary>原计算链哈希</summary>
                <code>{record.lineage_sha256}</code>
              </details>
            </article>
          ))}
        </details>
      )}
      {data.reroute_lineages_truncated && (
        <p className="notice">
          改投链清单已截断；数量来自完整保存表，不能用展示条数替代。
        </p>
      )}
    </Panel>
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
        操作。前端预检不构成动作授权。具体操作仍须通过当前 ag 的授权和资源核验。
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
              计数来自本地意图记录，与已保存提交消耗分开；不能作为调度器成功提交次数，也不能推导剩余预算或科学通过。
            </p>
          </Panel>
          <SubmissionRecords data={data} />
          <CancellationRecords data={data} />
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
                    {event.submission && (
                      <FactGrid
                        facts={[
                          {
                            label: "Attempt",
                            value: event.submission.attempt_id,
                          },
                          { label: "对象", value: event.submission.object_id },
                          { label: "轮次", value: event.submission.round_id },
                          { label: "唤醒", value: event.submission.run_id },
                          {
                            label: "该规则最多提交次数",
                            value: event.submission.max_attempts,
                          },
                          {
                            label: "失败类别",
                            value:
                              event.submission.failure_class ?? "无保存类别",
                          },
                        ]}
                      />
                    )}
                    {!event.submission && event.attempt_id && (
                      <p>Attempt：{event.attempt_id}</p>
                    )}
                    {event.object_id && <p>对象：{event.object_id}</p>}
                    {!event.submission && event.run_id && (
                      <p>唤醒：{event.run_id}</p>
                    )}
                    {!event.submission && event.round_id && (
                      <p>轮次：{event.round_id}</p>
                    )}
                    {event.cancellation && (
                      <>
                        <p>
                          Attempt：{event.cancellation.attempt_id} ·{" "}
                          {cancellationKind[event.cancellation.kind]}
                        </p>
                        <p>保存理由：{event.cancellation.reason}</p>
                      </>
                    )}
                    {event.cancellation_result && (
                      <>
                        <p>
                          Attempt：{event.cancellation_result.attempt_id} ·{" "}
                          {
                            cancellationOutcome[
                              event.cancellation_result.outcome
                            ]
                          }{" "}
                          · 任务停止未确认
                        </p>
                        <p>保存说明：{event.cancellation_result.reason}</p>
                      </>
                    )}
                    {event.dispatched !== undefined && (
                      <p>
                        已保存提交调用记录：
                        {event.dispatched ? "已进入提交调用" : "未进入提交调用"}
                        ；不表示调度器成功提交。
                      </p>
                    )}
                    {event.record_sha256 && (
                      <details>
                        <summary>选择记录哈希</summary>
                        <code>{event.record_sha256}</code>
                      </details>
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
