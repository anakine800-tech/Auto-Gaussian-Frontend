import { useMemo, useRef, useState } from "react";
import { object } from "./api";
import { DataTableView, TableAttempts } from "./data-table-view";
import { studyHash } from "./routing";

type RecordValue = Record<string, unknown>;
type CSVCell = string | number;
const record = (value: unknown): RecordValue => (object(value) ? value : {});
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value : "未知";
const savedJSON = (value: unknown, space?: number) =>
  JSON.stringify(
    value,
    (_key, item) =>
      typeof item === "number" && !Number.isFinite(item)
        ? `未知（非有限数值：${String(item)}）`
        : item,
    space,
  );
const saved = (value: unknown): string =>
  value === undefined ? "未知（字段未保存）" : savedJSON(value);
const numericReason = (value: unknown) =>
  value === undefined || value === null
    ? "relative_G_kcal 未保存"
    : "relative_G_kcal 不是有限数值";
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

type ProfileSource = {
  species: string;
  coefficient: unknown;
  index: number | null;
  conformer: RecordValue;
  context: RecordValue;
  reason: string;
};
type ProfileState = {
  index: number;
  id: string;
  kind: string;
  species: string;
  energy: number | null;
  reason: string;
  sources: ProfileSource[];
};
export type ProfileSnapshot = {
  raw: RecordValue;
  path: string;
  states: ProfileState[];
  warnings: string[];
};

function warningsFor(value: unknown, label: string): string[] {
  if (!Array.isArray(value))
    return [`${label}：未知（警告字段未保存或格式无效）`];
  return value.map(
    (item) => `${label}：${typeof item === "string" ? item : saved(item)}`,
  );
}

// Copy once on report load. Every view and export below reads only this frozen
// copy, never current facts, G_kcal arithmetic, or a second file request.
export function profileSnapshot(
  value: RecordValue,
  path: string,
): ProfileSnapshot {
  const raw = structuredClone(value);
  const species = record(raw.species);
  const states = (Array.isArray(raw.states) ? raw.states : []).map(
    (entry, index): ProfileState => {
      const row = record(entry);
      const members = object(row.species) ? Object.entries(row.species) : [];
      const sources = members.flatMap(
        ([name, coefficient]): ProfileSource[] => {
          const context = record(species[name]);
          const conformers = Array.isArray(context.conformers)
            ? context.conformers
            : [];
          if (!conformers.length)
            return [
              {
                species: name,
                coefficient,
                index: null,
                context,
                conformer: {},
                reason: "物种来源或 conformers 未保存 / 为空",
              },
            ];
          return conformers.map((item, i) => {
            const conformer = record(item);
            const reasons = [];
            if (!validAttempt(conformer.attempt_id))
              reasons.push("attempt_id 未保存或无效");
            if (
              conformer.spc_attempt_id !== null &&
              !validAttempt(conformer.spc_attempt_id)
            )
              reasons.push("spc_attempt_id 未保存或无效");
            return {
              species: name,
              coefficient,
              index: i + 1,
              conformer,
              context,
              reason: reasons.join("；"),
            };
          });
        },
      );
      return {
        index: index + 1,
        id: text(row.id),
        kind: text(row.kind),
        species: members.length
          ? members
              .map(
                ([name, coefficient]) =>
                  `${name} × ${finite(coefficient) ? coefficient : "未知"}`,
              )
              .join(" + ")
          : "未知（species 未保存或为空）",
        energy: finite(row.relative_G_kcal) ? row.relative_G_kcal : null,
        reason: [
          finite(row.relative_G_kcal) ? "" : numericReason(row.relative_G_kcal),
          !members.length ? "状态 species 未保存或为空" : "",
        ]
          .filter(Boolean)
          .join("；"),
        sources,
      };
    },
  );
  return freeze({
    raw,
    path,
    states,
    warnings: [
      ...warningsFor(raw.warnings, "报告"),
      ...warningsFor(record(raw.symmetry).warnings, "对称性"),
      ...Object.entries(species).flatMap(([name, item]) =>
        warningsFor(record(item).warnings, `物种 ${name}`),
      ),
    ],
  });
}

// Quoting alone does not prevent spreadsheet formula execution. Treat only
// finite JS numbers as numeric cells; protect text before RFC 4180 escaping.
export function profileCSVCell(value: CSVCell): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const source = String(value);
  const safe =
    /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(source) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(source)
      ? "'" + source
      : source;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export function profileCSV(snapshot: ProfileSnapshot): string {
  const { raw, states, path, warnings } = snapshot;
  const headers = [
    "report",
    "schema",
    "units",
    "reference",
    "temperature_K",
    "standard_state",
    "explicit_solvent_concentrations_M",
    "warnings",
    "note",
    "state_order",
    "state_id",
    "kind",
    "state_species",
    "relative_G_kcal",
    "missing_reason",
    "species",
    "coefficient",
    "conformer_order",
    "attempt_id",
    "spc_attempt_id",
    "source_missing_reason",
    "species_settings",
    "single_conformer_reason",
    "conformer_json",
  ];
  const common: CSVCell[] = [
    path,
    text(raw.schema),
    text(raw.units),
    text(raw.reference),
    finite(raw.temperature_K)
      ? raw.temperature_K
      : "未知（temperature_K 未保存或不是有限数值）",
    text(raw.standard_state),
    saved(raw.explicit_solvent_concentrations_M),
    warnings.join("\n"),
    text(raw.note),
  ];
  const rows: CSVCell[][] = states.flatMap((state) =>
    (state.sources.length ? state.sources : [null]).map((source) => [
      ...common,
      state.index,
      state.id,
      state.kind,
      state.species,
      state.energy ?? "",
      state.reason,
      source?.species ?? "",
      source && finite(source.coefficient) ? source.coefficient : "",
      source?.index ?? "",
      source ? text(source.conformer.attempt_id) : "",
      source?.conformer.spc_attempt_id === null
        ? "未采用独立单点（报告为 null）"
        : source
          ? text(source.conformer.spc_attempt_id)
          : "",
      source?.reason ?? "状态未保存物种来源",
      saved(source?.context.settings),
      saved(source?.context.single_conformer_reason),
      source ? saved(source.conformer) : "",
    ]),
  );
  return (
    "\uFEFF" +
    [headers, ...rows]
      .map((row) => row.map(profileCSVCell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}
function validAttempt(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}
function AttemptLink({ study, value }: { study: string; value: unknown }) {
  return validAttempt(value) ? (
    <a href={studyHash(study, "a", value)}>Attempt {value}</a>
  ) : (
    <span>未知（编号未保存或无效）：{saved(value)}</span>
  );
}

export function ProfilePanel({
  value,
  study,
  path,
}: {
  value: RecordValue;
  study: string;
  path: string;
}) {
  const snapshot = useMemo(() => profileSnapshot(value, path), [value, path]);
  const [selected, setSelected] = useState<number | null>(null);
  const sourceHeading = useRef<HTMLHeadingElement>(null);
  const { raw, states, warnings } = snapshot;
  const unit = text(raw.units);
  const select = (index: number) => {
    setSelected(index);
    sourceHeading.current?.focus();
  };
  const energies = states.flatMap((state) =>
    state.energy === null ? [] : [state.energy],
  );
  // Scale only for drawing, avoiding overflow even for extreme finite values.
  const magnitude = energies.reduce(
    (largest, energy) => Math.max(largest, Math.abs(energy)),
    1,
  );
  const scaled = energies.map((energy) => energy / magnitude);
  const min = scaled.reduce(
    (smallest, energy) => Math.min(smallest, energy),
    Infinity,
  );
  const max = scaled.reduce(
    (largest, energy) => Math.max(largest, energy),
    -Infinity,
  );
  const top = (energy: number) =>
    max === min ? 50 : 10 + ((max - energy / magnitude) / (max - min)) * 80;
  const active = selected === null ? null : states[selected];
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([profileCSV(snapshot)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "saved-profile.csv";
    link.click();
    // Keep the blob alive until the browser has accepted the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="profile-panel" aria-label="已保存自由能剖面">
      <h3>已保存自由能剖面</h3>
      <p className="muted">
        图、表和 CSV
        使用本次读取的同一份报告。仅展示保存值；来源文件之后的变化不会更新本页数值。
      </p>
      <dl className="profile-conditions">
        <div>
          <dt>单位</dt>
          <dd>{unit}</dd>
        </div>
        <div>
          <dt>参考态</dt>
          <dd>{text(raw.reference)}</dd>
        </div>
        <div>
          <dt>温度</dt>
          <dd>
            {finite(raw.temperature_K)
              ? `${raw.temperature_K} K`
              : "未知（temperature_K 未保存或不是有限数值）"}
          </dd>
        </div>
        <div>
          <dt>标准态</dt>
          <dd>{text(raw.standard_state)}</dd>
        </div>
        <div>
          <dt>显式溶剂浓度 / mol·L⁻¹</dt>
          <dd>
            {object(raw.explicit_solvent_concentrations_M) ? (
              Object.keys(raw.explicit_solvent_concentrations_M).length ? (
                <ul>
                  {Object.entries(raw.explicit_solvent_concentrations_M).map(
                    ([name, concentration]) => (
                      <li key={name}>
                        {name}：
                        {finite(concentration)
                          ? concentration
                          : "未知（不是有限数值）"}
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                "报告未指定额外显式浓度（{}）"
              )
            ) : (
              "未知（字段未保存或格式无效）"
            )}
          </dd>
        </div>
      </dl>
      {typeof raw.note === "string" && <p>{raw.note}</p>}
      <details className="profile-warnings" open={warnings.length > 0}>
        <summary>保存的警告（{warnings.length}）</summary>
        {warnings.length ? (
          <ul>
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        ) : (
          <p>报告的警告列表为空。</p>
        )}
      </details>
      {states.length ? (
        <>
          <figure className="profile-figure">
            <figcaption>相对自由能 / {unit} · 按报告 states 顺序</figcaption>
            <p className="muted">
              选择能级或状态名称查看全部来源。横向位置只表示报告顺序；未绘制机理连线。
            </p>
            {unit !== "kcal/mol" && (
              <p role="status">
                单位未知或不支持，未绘制能级；保存数值仍列于表格。
              </p>
            )}
            <div
              className="profile-plot-scroll"
              role="region"
              aria-label="能级图（可横向滚动）"
              tabIndex={0}
            >
              <ol className="profile-levels">
                {states.map((state, index) => (
                  <li key={index} className="profile-level-column">
                    <div className="profile-lane">
                      {state.energy !== null && unit === "kcal/mol" ? (
                        <svg
                          className="profile-level-svg"
                          viewBox="0 0 150 240"
                        >
                          <g
                            className={`profile-level ${state.kind === "ts" ? "profile-ts" : ""}`}
                            transform={`translate(0 ${top(state.energy) * 2.4})`}
                            role="button"
                            tabIndex={0}
                            aria-label={`选择能级 ${state.index}：${state.id}；${state.energy} ${unit}`}
                            aria-pressed={selected === index}
                            onClick={() => select(index)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                select(index);
                              }
                            }}
                          >
                            <rect
                              className="profile-hit"
                              x={4}
                              y={-18}
                              width={142}
                              height={40}
                              rx={6}
                            />
                            <text
                              x={75}
                              y={-2}
                              textAnchor="middle"
                              textLength={
                                String(state.energy).length > 16
                                  ? 130
                                  : undefined
                              }
                              lengthAdjust="spacingAndGlyphs"
                            >
                              {state.energy}
                            </text>
                            <line
                              className="profile-level-bar"
                              x1={10}
                              x2={140}
                              y1={8}
                              y2={8}
                            />
                          </g>
                        </svg>
                      ) : (
                        <span className="profile-unknown">
                          未知
                          <br />
                          {state.reason || "单位未知或不支持"}
                        </span>
                      )}
                    </div>
                    <button
                      className="profile-state-name"
                      onClick={() => select(index)}
                      aria-pressed={selected === index}
                    >
                      {state.index}. {state.id}
                      <small>{state.kind}</small>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </figure>
          <button onClick={download}>下载当前剖面 CSV</button>
          <TableAttempts.Provider value={null}>
            <DataTableView
              label="已保存剖面数值"
              headers={[
                "顺序",
                "状态",
                "kind",
                "species",
                `相对自由能 / ${unit}`,
                "缺失原因",
              ]}
              rows={states.map((state, index) => [
                state.index,
                <button onClick={() => select(index)}>{state.id}</button>,
                state.kind,
                state.species,
                state.energy ?? "未知",
                state.reason || "—",
              ])}
            />
          </TableAttempts.Provider>
        </>
      ) : (
        <p role="status">
          states 未保存、格式无效或为空；请查看完整原始 JSON。
        </p>
      )}
      <section className="profile-sources" aria-label="状态来源">
        <h4 ref={sourceHeading} tabIndex={-1}>
          {active
            ? `状态 ${active.index}：${active.id} 的保存来源`
            : "状态来源"}
        </h4>
        <p className="muted">
          逐项列出报告保存的全部物种与构象；未指定唯一代表。Attempt
          链接打开本地记录，缺失记录会显示读取错误。
        </p>
        {!active ? (
          <p>请选择能级或状态名称。</p>
        ) : !active.sources.length ? (
          <p>未知：该状态未保存物种来源。</p>
        ) : (
          active.sources.map((source, i) => (
            <article key={i} className="profile-source">
              <h5>
                {source.species} ×{" "}
                {finite(source.coefficient) ? source.coefficient : "未知"} ·{" "}
                {source.index === null ? "构象未知" : `构象 ${source.index}`}
              </h5>
              {source.reason && <p className="tone-warn">{source.reason}</p>}
              {source.index !== null && (
                <>
                  <p>
                    频率 / 热化学来源：
                    <AttemptLink
                      study={study}
                      value={source.conformer.attempt_id}
                    />
                  </p>
                  <p>
                    单点来源：
                    {source.conformer.spc_attempt_id === null ? (
                      "未采用独立单点（报告为 null）"
                    ) : (
                      <AttemptLink
                        study={study}
                        value={source.conformer.spc_attempt_id}
                      />
                    )}
                  </p>
                  <details>
                    <summary>保存的构象与来源字段</summary>
                    <pre>{savedJSON(source.conformer, 2)}</pre>
                  </details>
                </>
              )}
              <details>
                <summary>物种设置与单构象说明</summary>
                <pre>
                  {savedJSON(
                    {
                      settings: source.context.settings ?? "未知（未保存）",
                      single_conformer_reason:
                        source.context.single_conformer_reason === undefined
                          ? "未知（未保存）"
                          : source.context.single_conformer_reason,
                    },
                    2,
                  )}
                </pre>
              </details>
            </article>
          ))
        )}
      </section>
      <details className="profile-raw">
        <summary>完整原始 JSON（本次读取）</summary>
        <pre>{savedJSON(raw, 2)}</pre>
      </details>
    </section>
  );
}
