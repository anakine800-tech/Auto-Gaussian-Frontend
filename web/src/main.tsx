import { AutonomyView } from "./autonomy-view";
import { ChainsView } from "./chains-view";
import { AnalysisLibrary } from "./analysis-panels";
import "./ui/analysis.css";
import { useEffect, useState } from "react";
import { ActionOutput, actionToken } from "./actions";
import type { ActionResult } from "./actions";
import { createRoot } from "react-dom/client";
import { endpoint, get } from "./api";
import { ComparePage } from "./compare-page";
import { EvidencePage } from "./evidence-page";
import { IRCPage } from "./irc-panels";
import { EnsemblePage } from "./ensemble-panels";
import { routeHash, studyHash } from "./routing";
import type { Study } from "./api";
import { ServerMonitor } from "./server-monitor";
import { Analyses } from "./study-panels";
import { AttemptView } from "./attempt-view";
import { ErrorNotice, StatusBadge, readPreference, savePreference } from "./ui";
import { GlobalSearch } from "./ui/search";
import { StudySwitcher } from "./study-switcher";
import type { StudyOption } from "./study-switcher";
import { CompareTray } from "./compare-tray";
import { HelpPage } from "./help-page";
import {
  goBackToList,
  locationChanged,
  returnLocation,
  useHistoryRoute,
  useScrollRestore,
} from "./navigation";
import "./ui/tokens.css";
import "./style.css";
import "./molecule-layout.css";
import "./ui/shell.css";
import "./ui/overview.css";
import "./ui/attempt.css";
import { StudyOverview } from "./overview";
import { AttemptTable } from "./attempt-table";

const ignoreAttemptLoaded = () => {};
function App() {
  useEffect(() => {
    const bars = [".app-header", ".context-bar"].map((s) =>
      document.querySelector<HTMLElement>(s),
    );
    const observer = new ResizeObserver(() =>
      bars.forEach((bar, i) => {
        if (bar)
          document.documentElement.style.setProperty(
            i ? "--context-height" : "--header-height",
            `${bar.getBoundingClientRect().height}px`,
          );
      }),
    );
    bars.forEach((bar) => bar && observer.observe(bar));
    return () => observer.disconnect();
  }, []);
  const [busy, setBusy] = useState(false),
    [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const route = useHistoryRoute();
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<{
    studies: StudyOption[];
    issues: { path: string; error: string }[];
  } | null>(null);
  const [data, setData] = useState<Study | null>(null),
    [error, setError] = useState("");
  const recent = readPreference("last-study", "");
  const study =
      route.study ||
      list?.studies.find((s) => s.id === recent)?.id ||
      list?.studies[0]?.id ||
      "",
    view = route.view ?? "overview";

  useEffect(() => {
    if (route.error) return;
    const c = new AbortController();
    setError("");
    get<NonNullable<typeof list>>("/api/studies", c.signal)
      .then((v) => {
        if (c.signal.aborted) return;
        setList(v);
        if (!route.study && !route.server && !route.help) {
          const recent = readPreference("last-study", "");
          const id =
            v.studies.find((s) => s.id === recent)?.id ?? v.studies[0]?.id;
          if (id) {
            window.history.replaceState(
              window.history.state,
              "",
              window.location.pathname + window.location.search + studyHash(id),
            );
            locationChanged();
          }
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [revision, route.server, route.help, route.study, route.error]);
  useEffect(() => {
    if (route.server || route.help || route.error || !route.study) return;
    const c = new AbortController();
    setData(null);
    setError("");
    get<Study>(endpoint(route.study), c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          setData(v);
          savePreference("last-study", v.id);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [route.study, revision, route.server, route.help, route.error]);
  useScrollRestore(
    route,
    Boolean(
      route.server ||
        route.help ||
        route.error ||
        error ||
        data?.id === route.study,
    ),
  );
  const navigate = (hash: string) => {
    window.location.hash = hash;
  };
  const choose = (id: string) => navigate(routeHash([study, id]));
  const completed = (result: ActionResult) => {
    setActionResult(result);
    setRevision((r) => r + 1);
    if (result.new_attempt) choose(result.new_attempt);
  };
  const top = route.help
    ? "help"
    : route.server
      ? "jobs"
      : view === "analysis" || view === "compare"
        ? "analysis"
        : view === "files"
          ? "files"
          : "study";
  const attempt = route.attempt;
  const fileTab = route.fileTab ?? "library";
  const detail =
    route.attempt ??
    route.ensemble?.join("/") ??
    route.irc?.join("/") ??
    route.structure?.join("/") ??
    route.report;
  const back = route.attempt
    ? studyHash(study, "attempts")
    : view === "analysis"
      ? studyHash(study, "analysis")
      : studyHash(study, "files", fileTab);
  return (
    <>
      <header className="app-header">
        <a className="brand" href={study ? studyHash(study) : "#/"}>
          <span className="brand-mark" aria-hidden="true">
            Ag
          </span>
          <h1>Auto-Gaussian</h1>
        </a>
        <nav aria-label="顶部导航">
          {[
            ["jobs", "服务器"],
            ["study", "研究"],
            ["analysis", "结果"],
            ["files", "证据"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-current={top === id ? "page" : undefined}
              disabled={id !== "jobs" && !study}
              onClick={() =>
                navigate(
                  id === "jobs"
                    ? "#/servers"
                    : studyHash(
                        study,
                        ...(id === "analysis"
                          ? ["analysis"]
                          : id === "files"
                            ? ["files"]
                            : []),
                      ),
                )
              }
            >
              {label}
            </button>
          ))}
        </nav>
        <GlobalSearch
          currentStudy={
            !route.server && !route.help && !route.error
              ? route.study
              : undefined
          }
        />
        <a
          className="help-link"
          aria-current={route.help ? "page" : undefined}
          href="#/help"
        >
          使用说明
        </a>
        <StatusBadge>{actionToken ? "可操作（经 ag）" : "只读"}</StatusBadge>
        <button className="refresh" onClick={() => setRevision((r) => r + 1)}>
          刷新
        </button>
      </header>
      <div className="context-bar">
        <div className="context-content">
          <StudySwitcher
            studies={list?.studies ?? []}
            selected={study}
            onSelect={(id) => navigate(studyHash(id))}
          />
          {route.server ? (
            <strong>服务器 / 本地监控快照</strong>
          ) : route.help ? (
            <strong>使用说明</strong>
          ) : (
            detail && (
              <>
                <span className="context-divider">/</span>
                <strong>{detail}</strong>
              </>
            )
          )}
        </div>
        {detail && !route.help && !route.server && (
          <a
            className="back-link"
            href={returnLocation(back).href}
            onClick={(e) => {
              e.preventDefault();
              goBackToList(back);
            }}
          >
            ← 返回列表
          </a>
        )}
      </div>
      {route.help ? (
        <main>
          <HelpPage />
        </main>
      ) : route.server ? (
        <main className="server-page">
          <ServerMonitor revision={revision} />
        </main>
      ) : (
        <div className="workspace">
          <main>
            {list?.issues.map((x, i) => (
              <p className="notice" key={i}>
                {x.path}：{x.error}
              </p>
            ))}
            {route.error && <ErrorNotice>{route.error}</ErrorNotice>}
            {error && <ErrorNotice>{error}</ErrorNotice>}
            {study && !data && !error && !route.error && (
              <p role="status">读取 Study…</p>
            )}
            {data && !route.error && (
              <>
                {!attempt && (
                  <div className="study-heading">
                    <div>
                      <span className="eyebrow">
                        {top === "study"
                          ? "STUDY WORKSPACE"
                          : top === "analysis"
                            ? "ANALYSIS LIBRARY"
                            : "STUDY FILES"}
                      </span>
                      <h2>
                        {top === "study"
                          ? data.id
                          : top === "analysis"
                            ? view === "compare"
                              ? "结果 · 比较"
                              : "报告"
                            : "研究证据"}
                      </h2>
                    </div>
                    <StatusBadge>{data.attempts.length} Attempts</StatusBadge>
                    {top === "analysis" && (
                      <nav aria-label="结果内容">
                        <a href={studyHash(study, "analysis")}>报告</a> ·{" "}
                        <a href={routeHash([study, "compare"])}>比较</a>
                      </nav>
                    )}
                  </div>
                )}
                {top === "study" && (
                  <nav className="section-nav" aria-label="Study 内容">
                    <button
                      aria-current={view === "overview" ? "page" : undefined}
                      onClick={() => navigate(studyHash(study))}
                    >
                      进展
                    </button>
                    <button
                      aria-current={view === "chains" ? "page" : undefined}
                      onClick={() => navigate(studyHash(study, "chains"))}
                    >
                      计算链
                    </button>
                    <button
                      aria-current={view === "attempts" ? "page" : undefined}
                      onClick={() => navigate(studyHash(study, "attempts"))}
                    >
                      全部 Attempt
                    </button>
                    <button
                      aria-current={view === "autonomy" ? "page" : undefined}
                      onClick={() =>
                        navigate(studyHash(study, "research", "autonomy"))
                      }
                    >
                      自主运行
                    </button>
                  </nav>
                )}
                {top === "files" && (
                  <nav className="section-nav" aria-label="文件内容">
                    {[
                      ["library", "文件库"],
                      ["lineage", "来源关系"],
                      ["document", "研究说明"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        aria-current={fileTab === id ? "page" : undefined}
                        onClick={() => navigate(studyHash(study, "files", id))}
                      >
                        {label}
                      </button>
                    ))}
                  </nav>
                )}
                {data.issues.map((x, i) => (
                  <p className="notice" key={i}>
                    {x.path}：{x.error}
                  </p>
                ))}
                {view === "chains" && <ChainsView key={study} data={data} />}
                {view === "overview" && (
                  <StudyOverview key={study} data={data} />
                )}
                {view === "autonomy" && (
                  <AutonomyView key={study} study={study} revision={revision} />
                )}
                {view === "analysis" &&
                  (route.irc ? (
                    <IRCPage
                      key={study + route.irc.join("/")}
                      study={study}
                      parts={route.irc}
                      direction={route.direction ?? "forward"}
                      point={route.point ?? 0}
                      revision={revision}
                    />
                  ) : route.ensemble ? (
                    <EnsemblePage
                      study={study}
                      parts={route.ensemble}
                      candidate={route.candidate}
                      revision={revision}
                    />
                  ) : route.report ? (
                    data.analyses.some((a) => a.name === route.report) ? (
                      <Analyses
                        study={study}
                        analyses={data.analyses.filter(
                          (a) => a.name === route.report,
                        )}
                        selected
                      />
                    ) : (
                      <ErrorNotice>报告文件不存在：{route.report}</ErrorNotice>
                    )
                  ) : (
                    <AnalysisLibrary data={data} />
                  ))}
                {view === "attempts" &&
                  (attempt ? (
                    <AttemptView
                      key={study + attempt}
                      study={study}
                      id={attempt}
                      revision={revision}
                      busy={busy}
                      onBusy={setBusy}
                      onResult={completed}
                      autoCompare={actionResult?.new_attempt === attempt}
                      selectedFile={route.attemptFile}
                      onLoaded={ignoreAttemptLoaded}
                    />
                  ) : (
                    <AttemptTable key={study} data={data} />
                  ))}
                {view === "compare" && (
                  <ComparePage key={study} data={data} revision={revision} />
                )}
                {view === "files" && (
                  <EvidencePage
                    key={study}
                    data={data}
                    tab={fileTab}
                    selected={route.file}
                    revision={revision}
                  />
                )}
              </>
            )}
          </main>
        </div>
      )}
      {data?.id === study &&
        !route.help &&
        !route.server &&
        top !== "files" && <CompareTray key={study} study={study} />}
      <ActionOutput result={actionResult} />
      <footer>
        {actionToken
          ? "study.md 中的计划和结论仍由 Codex 更新。"
          : "Study 文件保持原样。"}
        状态与解析数字不自动构成科学结论。
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
