export type AttemptFile = { kind: "inputs" | "logs" | "record"; name: string };
export type Route = {
  study: string;
  file?: string;
  view?:
    | "autonomy"
    | "chains"
    | "overview"
    | "attempts"
    | "analysis"
    | "files"
    | "compare";
  fileTab?: string;
  server?: boolean;
  help?: boolean;
  attempt?: string;
  attemptFile?: AttemptFile;
  structure?: string[];
  report?: string;
  ensemble?: string[];
  irc?: string[];
  direction?: "forward" | "reverse";
  point?: number;
  candidate?: number;
  error?: string;
};
export const compareHash = (study: string, ids: string[] = []) =>
  "#/" +
  encodeURIComponent(study) +
  "/compare?" +
  new URLSearchParams({ cmp: ids.join(",") });
export const evidenceHash = (study: string, tab = "library", file?: string) =>
  studyHash(study, "evidence", tab) +
  (file ? "?" + new URLSearchParams({ file }) : "");
const hash = (parts: string[]) =>
  "#/" + parts.map(encodeURIComponent).join("/");
// Existing page links keep their object identity while adopting the new shell.
export function routeHash(parts: string[]): string {
  if (!parts.length) return "#/";
  const [study, kind, ...rest] = parts;
  if (!kind) return studyHash(study);
  if (kind === "compare") return "#/" + encodeURIComponent(study) + "/compare";
  if (kind === "ensembles" || kind === "irc-reviews")
    return studyHash(
      study,
      "analysis",
      kind === "ensembles" ? "ensemble" : "irc",
      ...rest,
    );
  if (kind === "analyses" && !rest.at(-1)?.endsWith(".xyz"))
    return studyHash(study, "analysis", "file", ...rest);
  if (kind === "structures" || kind === "analyses")
    return studyHash(study, "files", kind, ...rest);
  return studyHash(study, "a", kind);
}
export function studyHash(study: string, ...parts: string[]) {
  const [section, ...rest] = parts;
  if (section === "chains" && !rest.length) return hash([study, "chains"]);
  const mapped = !section
    ? ["research", "progress"]
    : section === "attempts"
      ? ["research", "attempts"]
      : section === "a"
        ? ["research", "a", ...rest]
        : section === "analysis"
          ? ["results", ...rest]
          : section === "files"
            ? ["evidence", ...rest]
            : parts;
  return hash(["s", study, ...mapped]);
}
export function readRoute(): Route {
  // Migrate saved ensemble filter scope with the route, without changing filters.
  const search = new URLSearchParams(location.search),
    scope = search.get("ensembleScope");
  try {
    if (scope?.startsWith("#/")) {
      const raw = scope.slice(2).split("/").map(decodeURIComponent);
      const canonical =
        raw[0] === "s" ? studyHash(raw[1], ...raw.slice(2)) : routeHash(raw);
      if (canonical !== scope) {
        search.set("ensembleScope", canonical);
        history.replaceState(
          history.state,
          "",
          location.pathname + "?" + search + location.hash,
        );
      }
    }
  } catch {
    /* Invalid saved filters do not prevent opening a valid route. */
  }
  const original = window.location.hash;
  if (!original || original === "#/") return { study: "" };
  try {
    const cut = original.indexOf("?"),
      path = cut < 0 ? original : original.slice(0, cut),
      query = cut < 0 ? "" : original.slice(cut);
    if (path === "#server" || path === "#/jobs") {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search + "#/servers" + query,
      );
      return { study: "", server: true };
    }
    if (!path.startsWith("#/")) throw Error();
    const parts = path.slice(2).split("/").map(decodeURIComponent);
    if (parts.some((p) => !p || p === "." || p === ".." || /[\/\\\0]/.test(p)))
      throw Error();
    if (parts.length === 1 && parts[0] === "servers")
      return { study: "", server: true };
    if (parts.length === 1 && parts[0] === "help")
      return { study: "", help: true };
    if (parts.length === 2 && parts[1] === "chains")
      return { study: parts[0], view: "chains" };
    if (parts.length === 2 && parts[1] === "compare")
      return { study: parts[0], view: "compare" };
    // T118 document links are already canonical; do not migrate them as legacy links.
    if (parts.length >= 3 && parts[1] === "file")
      return {
        study: parts[0],
        view: "files",
        fileTab: "document",
        file: parts.slice(2).join("/"),
      };
    if (parts[0] !== "s") {
      const valid =
        parts.length <= 2 ||
        (["ensembles", "irc-reviews", "analyses"].includes(parts[1]) &&
          [3, 4].includes(parts.length)) ||
        (parts[1] === "structures" && parts.length === 4);
      if (!valid) throw Error();
      const tab = new URLSearchParams(query || window.location.search).get(
        "tab",
      );
      const tabs: Record<string, string[]> = {
        results: [],
        overview: ["files", "document"],
        attempts: ["attempts"],
        graph: ["files", "graph"],
        structures: ["files", "structures"],
        analyses: ["analysis"],
        ensembles: ["analysis"],
        "irc-reviews": ["analysis"],
      };
      const target =
        parts.length === 1 && tab && Object.hasOwn(tabs, tab)
          ? studyHash(parts[0], ...tabs[tab])
          : routeHash(parts);
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search + target + query,
      );
      return readRoute();
    }
    const [, study, section, ...rest] = parts;
    if (
      study &&
      (!section || ["attempts", "a", "analysis", "files"].includes(section))
    ) {
      history.replaceState(
        history.state,
        "",
        location.pathname +
          location.search +
          studyHash(study, ...parts.slice(2)) +
          query,
      );
      return readRoute();
    }
    if (section === "results" && rest.length === 1 && rest[0] === "compare") {
      history.replaceState(
        history.state,
        "",
        location.pathname +
          location.search +
          "#/" +
          encodeURIComponent(study) +
          "/compare" +
          query,
      );
      return readRoute();
    }
    if (section === "evidence") {
      const tab = rest[0],
        params = new URLSearchParams(query);
      if (!tab || ["graph", "structures", "analyses"].includes(tab)) {
        if (rest.length > 1 && ["structures", "analyses"].includes(tab))
          params.set("file", rest.join("/"));
        const target = evidenceHash(
          study,
          tab === "graph" ? "lineage" : "library",
        );
        history.replaceState(
          history.state,
          "",
          location.pathname +
            location.search +
            target +
            (params.size ? "?" + params : ""),
        );
        return readRoute();
      }
      if (["library", "lineage"].includes(tab) && rest.length === 1) {
        const file = params.get("file");
        if (
          params.getAll("file").length > 1 ||
          (file &&
            file
              .split("/")
              .some((p) => !p || p === "." || p === ".." || /[\\\0]/.test(p)))
        )
          throw Error();
        return { study, view: "files", fileTab: tab, file: file ?? undefined };
      }
    }
    // Keep the existing detail parser, including exact file queries, intact.
    if (section === "research") {
      if (rest[0] === "progress" && rest.length === 1)
        return { study, view: "overview" };
      if (rest[0] === "autonomy" && rest.length === 1)
        return { study, view: "autonomy" };
      if (rest[0] === "attempts" && rest.length === 1)
        return { study, view: "attempts" };
      if (rest[0] !== "a") throw Error();
      parts.splice(2, 2, "a");
    } else if (section === "results") parts[2] = "analysis";
    else if (section === "evidence") parts[2] = "files";
    else throw Error();
    return parseStudyRoute(parts, query);
  } catch {
    /* Invalid URLs remain visible as an error, not a file request. */
  }
  return {
    study: "",
    error: "无法打开链接：Study / Attempt / 结构文件路径格式不正确。",
  };
}
function parseStudyRoute(parts: string[], query: string): Route {
  const [, study, section, ...rest] = parts;
  try {
    if (!study) throw Error();
    if (!section) return { study, view: "overview" };
    if (section === "attempts" && !rest.length)
      return { study, view: "attempts" };
    if (section === "a" && rest.length === 1) {
      const params = new URLSearchParams(query),
        kind = params.get("fileKind"),
        name = params.get("file");
      if (kind === null && name === null)
        return { study, view: "attempts", attempt: rest[0] };
      if (
        params.getAll("fileKind").length !== 1 ||
        params.getAll("file").length !== 1 ||
        !["inputs", "logs", "record"].includes(kind ?? "") ||
        !name ||
        name === "." ||
        name === ".." ||
        /[\/\\\0]/.test(name)
      )
        throw Error();
      if (
        kind === "record" &&
        ![
          "manifest.json",
          "status.json",
          "facts.json",
          "review.md",
          "final.xyz",
        ].includes(name)
      )
        throw Error();
      return {
        study,
        view: "attempts",
        attempt: rest[0],
        attemptFile: { kind: kind as AttemptFile["kind"], name },
      };
    }
    if (section === "analysis") {
      if (!rest.length) return { study, view: "analysis" };
      const fixedTS =
        rest.length === 4 &&
        rest[0] === "ts" &&
        rest[1] === "ts-labels" &&
        ["labels.json", "labels.md", "channel-suggestions.csv"].includes(
          rest[3],
        );
      if (![2, 3].includes(rest.length) && !fixedTS) throw Error();
      const params = new URLSearchParams(query);
      if (rest[0] === "ensemble") {
        const id = params.get("candidate");
        if (
          params.getAll("candidate").length > 1 ||
          (id !== null &&
            (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))))
        )
          throw Error();
        return {
          study,
          view: "analysis",
          ensemble: rest.slice(1),
          candidate: id === null ? undefined : Number(id),
        };
      }
      if (rest[0] === "irc") {
        const direction = params.get("direction"),
          point = params.get("point");
        if (
          params.getAll("direction").length > 1 ||
          params.getAll("point").length > 1 ||
          (direction !== null && !["forward", "reverse"].includes(direction)) ||
          (point !== null &&
            (!/^(0|[1-9][0-9]*)$/.test(point) ||
              !Number.isSafeInteger(Number(point))))
        )
          throw Error();
        return {
          study,
          view: "analysis",
          irc: rest.slice(1),
          direction: (direction ?? "forward") as "forward" | "reverse",
          point: point === null ? 0 : Number(point),
        };
      }
      return { study, view: "analysis", report: rest.slice(1).join("/") };
    }
    if (section === "files") {
      if (!rest.length) return { study, view: "files", fileTab: "document" };
      if (
        rest.length === 1 &&
        ["document", "graph", "structures", "analyses"].includes(rest[0])
      )
        return { study, view: "files", fileTab: rest[0] };
      if (
        (rest[0] === "structures" && rest.length === 3) ||
        (rest[0] === "analyses" && [2, 3].includes(rest.length))
      )
        return rest[0] === "analyses" && !rest.at(-1)?.endsWith(".xyz")
          ? {
              study,
              view: "files",
              fileTab: "analyses",
              report: rest.slice(1).join("/"),
            }
          : { study, view: "files", fileTab: rest[0], structure: rest };
    }
  } catch {
    /* Invalid URLs remain visible as an error, not a file request. */
  }
  return {
    study: "",
    error: "无法打开链接：Study / Attempt / 结构文件路径格式不正确。",
  };
}
