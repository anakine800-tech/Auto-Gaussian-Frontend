import { CrestDiagnostics } from "./crest-diagnostics";
import { display, object } from "./api";
import type { Attempt } from "./api";
import { EmptyState, FactGrid, Panel, StatusBadge, statusTone } from "./ui";

export type FactLocation = {
  query: string;
  start: number;
  end?: number;
  id: number;
  scoped: boolean;
};
const number = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const energy = (v: unknown) =>
  number(v) !== null ? (
    <span title={String(v)}>{(v as number).toFixed(6)}</span>
  ) : (
    "—"
  );
const convergence = (v: unknown) =>
  typeof v === "boolean" ? (
    <StatusBadge tone={v ? "ok" : "bad"}>{v ? "✓" : "✗"}</StatusBadge>
  ) : (
    "—"
  );
const modeCount = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

function InputValidationNotice({
  manifest,
  onInspect,
}: {
  manifest: Attempt["manifest"];
  onInspect: (name: string) => void;
}) {
  const m = object(manifest.data) && !manifest.error ? manifest.data : null;
  if (m && !Object.hasOwn(m, "input_validation")) return null;
  const marker = m?.input_validation;
  const validation = object(marker) ? marker : null;
  const checks = validation?.skipped_checks;
  const validChecks =
    Array.isArray(checks) &&
    checks.length > 0 &&
    checks.every(
      (check) => typeof check === "string" && check.trim().length > 0,
    );
  const valid =
    validation?.mode === "relaxed" &&
    validation.method_verified === false &&
    validChecks;
  const reasons = !m
    ? ["manifest 无法读取，输入检查状态未知。"]
    : !validation
      ? ["输入检查标记不是有效对象。"]
      : [
          ...(validation.mode !== "relaxed" ? ["mode 缺失或无法识别。"] : []),
          ...(validation.method_verified !== false
            ? [
                validation.method_verified === true
                  ? "method_verified=true 与放宽输入的方法未核验标记冲突。"
                  : "method_verified 缺失或无效。",
              ]
            : []),
          ...(!validChecks
            ? ["跳过项须为非空字符串清单；缺失、空清单或无效项无法核实。"]
            : []),
        ];
  return (
    <section className="input-validation-notice" aria-label="输入检查提醒">
      <h3>{valid ? "输入检查已放宽" : "输入检查标记无法核实"}</h3>
      {valid ? (
        <>
          <p>
            <strong>方法口径未核验</strong>；提交或正常结束不代表科学验收通过。
          </p>
          <p>已保存的跳过项：</p>
          <ul>
            {(checks as string[]).map((check, i) => (
              <li key={i}>{check}</li>
            ))}
          </ul>
          <p>
            <code>ag scan-peak</code> 不可用：不能使用此来源。
            <code>ag profile</code> 可能不适用：解析、自定义基组或 SCRF=Read
            等情况可能使结果无法进入分析，须核对来源与适用条件。
          </p>
        </>
      ) : (
        <>
          <p>
            <strong>方法核验状态未知</strong>
            ；不能据此认定输入检查或科学验收通过。
          </p>
          <ul>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p>保留 manifest 原记录，请查看来源核对。</p>
        </>
      )}
      <button type="button" onClick={() => onInspect("manifest.json")}>
        查看输入检查 manifest 来源
      </button>
    </section>
  );
}

function VibrationCompleteness({
  facts,
}: {
  facts: Record<string, unknown> | null;
}) {
  const f = facts ?? {};
  const read = modeCount(f.n_vibrational_modes),
    expected = modeCount(f.expected_vibrational_modes);
  const flag = f.vibrational_modes_complete;
  const label = flag === true ? "完整" : flag === false ? "不完整" : "未知";
  const inconsistent =
    read !== null &&
    expected !== null &&
    typeof flag === "boolean" &&
    flag !== (read === expected);
  const field = (key: string, valid: boolean) =>
    !Object.hasOwn(f, key)
      ? "字段缺失"
      : f[key] === null
        ? "null（未知）"
        : valid
          ? String(f[key])
          : "值无效（未知）";
  const reason = f.frequency_unavailable_reason;
  const hasReason = typeof reason === "string" && reason.trim().length > 0;
  return (
    <details className="vibration-completeness" aria-label="振动模式完整性">
      <summary>
        <span>
          已读 {read ?? "未知"} / 预期 {expected ?? "未知"}
        </span>{" "}
        <StatusBadge tone={flag === false || inconsistent ? "warn" : "neutral"}>
          {label}
        </StatusBadge>
        {inconsistent && (
          <span className="vibration-conflict"> · 计数与标志不一致</span>
        )}
      </summary>
      <p>
        完整性仅显示 facts 标志，不代表 TS
        或科学验收通过；不由原子数推算预期数。
      </p>
      {!facts ? (
        <p>尚无可读 facts；模式数和完整性均未知。</p>
      ) : (
        <>
          {![
            "n_vibrational_modes",
            "expected_vibrational_modes",
            "vibrational_modes_complete",
          ].some((key) => Object.hasOwn(f, key)) && (
            <p>未记录振动完整性字段，可能为旧 facts。</p>
          )}
          <ul>
            <li>
              <code>n_vibrational_modes</code>：
              {field("n_vibrational_modes", read !== null)}
            </li>
            <li>
              <code>expected_vibrational_modes</code>：
              {field("expected_vibrational_modes", expected !== null)}
            </li>
            <li>
              <code>vibrational_modes_complete</code>：
              {field("vibrational_modes_complete", typeof flag === "boolean")}
            </li>
          </ul>
          {(read === null) !== (expected === null) && (
            <p>仅有部分计数；缺少的一项保持未知。</p>
          )}
          {inconsistent && (
            <p>计数与完整性标志不一致；保留 facts 原值，请核对来源。</p>
          )}
          <p>
            <code>frequency_unavailable_reason</code>：
            {hasReason
              ? reason
              : !Object.hasOwn(f, "frequency_unavailable_reason")
                ? "未记录不可用原因（字段缺失）"
                : reason === null
                  ? "未记录不可用原因（null）"
                  : typeof reason === "string"
                    ? "未记录不可用原因（空文本）"
                    : "不可用原因值无效"}
          </p>
        </>
      )}
    </details>
  );
}
export function AttemptFacts({
  study,
  data,
  onLocate,
  onInspect,
  onFull,
}: {
  study: string;
  data: Attempt;
  onFull: (name: string) => void;
  onInspect: (name: string) => void;
  onLocate: (v: Omit<FactLocation, "id">) => void;
}) {
  const f = object(data.facts.data) ? data.facts.data : {},
    m = object(data.manifest.data) ? data.manifest.data : {},
    s = object(data.status.data) ? data.status.data : {},
    input = object(data.input_geometry.data) ? data.input_geometry.data : {},
    science = object(m.science) ? m.science : {},
    e = object(f.energies) ? f.energies : {};
  const sources = object(f.fact_sources) ? f.fact_sources : {},
    sections = Array.isArray(f.job_sections)
      ? f.job_sections.filter(object)
      : [];
  const locate = (key: string, query: string) =>
    data.logs.length
      ? () => {
          const section = sections.find((v) => v.index === sources[key]);
          const start = number(section?.start_line),
            end = number(section?.end_line);
          const scoped =
            start !== null && end !== null && start > 0 && end >= start;
          onLocate({
            query,
            start: scoped ? start - 1 : 0,
            end: scoped ? end - 1 : undefined,
            scoped,
          });
        }
      : undefined;
  const imaginary = Array.isArray(f.frequencies_low)
    ? f.frequencies_low.filter(
        (v): v is number => number(v) !== null && (v as number) < 0,
      )
    : [];
  const route = display(f.route ?? input.route ?? science.route),
    method = display(
      science.method_basis ?? f.route ?? input.route ?? science.route,
    );
  const electronic = m.template === "xtb" ? f.total_energy : e.scf;
  return (
    <Panel title="关键事实" className="attempt-facts">
      <InputValidationNotice manifest={data.manifest} onInspect={onInspect} />
      <FactGrid
        facts={[
          {
            label: "状态",
            value: (
              <StatusBadge tone={statusTone(display(s.state))}>
                {display(s.state)}
              </StatusBadge>
            ),
            onLocate: () => onInspect("status.json"),
          },
          {
            label: "方法 / 基组 / 溶剂",
            value: (
              <span className="fact-method" title={`${method} · ${route}`}>
                {route === "—" ? method : route}
              </span>
            ),
            onLocate: () =>
              onInspect(
                f.route
                  ? "facts.json"
                  : input.route
                    ? "inputs"
                    : "manifest.json",
              ),
          },
          {
            label: "电荷 / 多重度",
            value: `${display(f.charge ?? input.charge ?? science.charge)} / ${display(f.multiplicity ?? input.multiplicity ?? science.multiplicity)}`,
            onLocate: () =>
              onInspect(
                f.charge !== undefined || f.multiplicity !== undefined
                  ? "facts.json"
                  : input.charge !== undefined
                    ? "inputs"
                    : "manifest.json",
              ),
          },
          {
            label: "电子能 / Eh",
            value: energy(electronic),
            emphasis: true,
            onLocate:
              number(electronic) !== null
                ? locate("energies.scf", String(electronic))
                : undefined,
          },
          {
            label: "自由能 / Eh",
            value: energy(e.g),
            emphasis: true,
            onLocate:
              number(e.g) !== null
                ? locate("energies.g", String(e.g))
                : undefined,
          },
          {
            label: "虚频数 / cm⁻¹",
            value: (
              <>
                {display(f.n_imag)}
                {imaginary.length > 0 && (
                  <span className="muted"> · {imaginary.join(", ")}</span>
                )}
              </>
            ),
            onLocate:
              number(f.n_imag) !== null
                ? locate("n_imag", "Frequencies --")
                : undefined,
          },
          {
            label: "振动模式数",
            value: (
              <VibrationCompleteness
                facts={object(data.facts.data) ? data.facts.data : null}
              />
            ),
            onLocate: () => onInspect("facts.json"),
            sourceLabel: "查看振动完整性 facts 来源",
          },
          {
            label: "优化 / 频率收敛",
            value: (
              <>
                {convergence(f.opt_converged)} /{" "}
                {convergence(f.freq_step_converged)}
              </>
            ),
            onLocate: () => onInspect("facts.json"),
          },
          {
            label: "已用 / walltime",
            value: `${display(s.elapsed)} / ${display(m.walltime)}`,
            onLocate: () => onInspect("status.json"),
          },
        ]}
      />
      {!data.facts.data && (
        <EmptyState>尚无可读 facts；未取回的结果不推算。</EmptyState>
      )}
      <div className="fact-warnings">
        <button className="fact-source" onClick={() => onInspect("facts.json")}>
          记录与警告 ↗
        </button>
        <StatusBadge tone="warn">工具记录，待人工审阅</StatusBadge>
        {[
          f.parser_warning,
          data.crest_diagnostics?.available ? null : f.error_hint,
          f.frequency_unavailable_reason,
          science.stereochemistry_warning,
        ]
          .filter((v) => typeof v === "string" && v)
          .map((v, i) => (
            <p key={i}>{String(v)}</p>
          ))}
      </div>
      {(m.template === "crest" || data.crest_diagnostics) && (
        <CrestDiagnostics
          key={study + "/" + data.id}
          study={study}
          attempt={data.id}
          diagnostic={data.crest_diagnostics}
          onFull={onFull}
        />
      )}
    </Panel>
  );
}
