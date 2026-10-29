import { test, expect } from "@playwright/test";
import { parseCSV } from "../src/data-table-view";
import { reportCategory, reportGroups } from "../src/analysis-summary";

const report = (name: string) =>
  "/#/s/butane-demo/analysis/file/reading/" + name;
test("CSV subset preserves quotes, commas, physical newlines and row limits", () => {
  expect(parseCSV('a,b\r\n"x,y","a""b"\r\n"line\r\nnext",2\r\n')).toEqual({
    headers: ["a", "b"],
    rows: [
      ["x,y", 'a"b'],
      ["line\r\nnext", "2"],
    ],
    truncated: false,
  });
  expect(parseCSV('a,b\n"x\ny",2\nwrong')).toMatchObject({ error: 4 });
  expect(parseCSV('a,b\n"x"trailing,2')).toMatchObject({ error: 2 });
  expect(parseCSV('a\n"unfinished\n')).toMatchObject({ error: 3 });
  const text = "a\n" + Array.from({ length: 5001 }, (_, i) => i).join("\n");
  expect(parseCSV(text).rows).toHaveLength(5000);
  expect(parseCSV(text).truncated).toBe(true);
  expect(
    parseCSV("a\n" + Array.from({ length: 5000 }, (_, i) => i).join("\n"))
      .truncated,
  ).toBe(false);
});
test("classification uses schema, explicit declaration and type without filename guesses", () => {
  expect(reportCategory({ name: "formal-energy.json" }).kind).toBe("other");
  expect(
    reportCategory({
      name: "x.md",
      kind: "energy",
      category_basis: "按报告声明",
    }),
  ).toEqual({ kind: "energy", basis: "按报告声明" });
  expect(
    reportCategory({ name: "x.json", kind: "formal", schema: "ag-thermo/1" }),
  ).toEqual({ kind: "thermo", basis: "按 schema" });
  expect(reportCategory({ name: "figure.SVG" })).toEqual({
    kind: "figure",
    basis: "按文件类型",
  });
  const schemas: Record<string, string> = {
    "ag-ensemble/1": "ensemble",
    "ag-irc-review/1": "irc",
    "ag-thermo/1": "thermo",
    "ag-profile/1": "thermo",
    "ag-channel-coverage/1": "coverage",
    "ag-nci/1": "nci",
  };
  for (const [schema, kind] of Object.entries(schemas))
    expect(
      reportCategory({ name: "report.json", schema, kind: "formal" }),
    ).toEqual({ kind, basis: "按 schema" });
  for (const name of ["labels.json", "labels.md", "channel-suggestions.csv"])
    expect(reportCategory({ name: "ts-labels/synthetic/" + name })).toEqual({
      kind: "ts",
      basis: "按 TS 标签目录",
    });
  for (const name of [
    "labels.json",
    "other/labels.json",
    "ts-labels/synthetic/other.json",
  ])
    expect(reportCategory({ name }).kind).toBe("other");
  expect(reportGroups.slice(5, 10)).toEqual([
    ["thermo", "热化学 / 能量剖面"],
    ["coverage", "通道覆盖"],
    ["ts", "TS 标签"],
    ["nci", "NCI"],
    ["stage-review", "阶段审阅"],
  ]);
});
for (const [width, height] of [
  [1440, 860],
  [1280, 720],
  [390, 844],
])
  test(`report table, exact Attempt preview and responsive layout ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [],
      writes: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (!["GET", "HEAD"].includes(r.method())) writes.push(r.method());
    });
    await page.goto(report("overview.md"));
    const table = page.getByRole("table", { name: "报告表格" }),
      score = table.getByRole("columnheader").filter({ hasText: "score" });
    await expect(table.getByRole("row")).toHaveCount(4);
    await expect(score).toHaveAttribute("aria-sort", "none");
    await score.getByRole("button").click();
    await expect(score).toHaveAttribute("aria-sort", "ascending");
    await expect(table.getByRole("row").nth(1)).toContainText("anti-extra");
    await expect(table.getByRole("row").nth(2)).toContainText("gauche");
    await score.getByRole("button").click();
    await expect(score).toHaveAttribute("aria-sort", "descending");
    await expect(table.getByRole("row").nth(1)).toContainText("anti");
    await expect(
      table.getByRole("link", { name: "anti-extra", exact: true }),
    ).toHaveCount(0);
    await table.getByRole("link", { name: "anti", exact: true }).click();
    const preview = page.getByRole("complementary", { name: "报告结构预览" });
    await expect(preview.getByTestId("molecule-scene")).toBeVisible();
    await expect(
      preview.getByRole("link", { name: "打开 Attempt anti", exact: true }),
    ).toHaveAttribute("href", "#/s/butane-demo/research/a/anti");
    await expect(
      page.getByRole("navigation", { name: "报告目录" }),
    ).toContainText("按报告声明");
    await expect(page.getByRole("region", { name: "NCI列表" })).toContainText(
      "nci-demo.json",
    );
    await expect(
      page.getByRole("region", { name: "通道覆盖列表" }),
    ).toContainText("coverage-demo.json");
    await expect(
      page.getByRole("region", { name: "热化学 / 能量剖面列表" }),
    ).toContainText("profile-demo.json");
    await expect(page.getByRole("heading", { name: /^正式结论 / })).toHaveCount(
      0,
    );
    await expect(page.locator("body")).not.toContainText("暂无可识别报告");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if (width === 390)
      await page
        .locator(".report-body")
        .evaluate((el) =>
          window.scrollTo(
            0,
            el.getBoundingClientRect().top + window.scrollY - 150,
          ),
        );
    else await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath(`report-${width}x${height}.png`),
    });
    await page.goto(report("wide.json"));
    await expect(page.getByRole("table").getByRole("columnheader")).toHaveCount(
      30,
    );
    await expect(page.getByRole("status")).toContainText("超过 30 列");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    expect(
      await page
        .locator(".report-table-scroll")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
test("local document links resolve against source and refuse escape or protocols", async ({
  page,
}) => {
  await page.goto(report("overview.md"));
  const body = page.getByRole("article", { name: "报告正文" });
  for (const name of ["越界链接", "绝对链接", "脚本链接"])
    await expect(body.getByRole("link", { name, exact: true })).toHaveCount(0);
  await expect(body.getByText("越界链接", { exact: true })).toHaveAttribute(
    "title",
    "链接越出本 study",
  );
  await expect(body.getByRole("link", { name: "外部文档" })).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(body.getByRole("link", { name: "外部文档" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await expect(body.getByRole("link", { name: "同目录 CSV" })).toHaveAttribute(
    "href",
    /#\/s\/butane-demo\/results\/file\/reading\/quoted.csv$/,
  );
  await expect(body.getByRole("link", { name: "上级报告" })).toHaveAttribute(
    "href",
    /#\/s\/butane-demo\/results\/thermo\/profile-demo.json$/,
  );
  await expect(
    body.getByRole("link", { name: "Attempt", exact: true }),
  ).toHaveAttribute("href", "#/s/butane-demo/research/a/anti");
  await expect(body.getByRole("link", { name: "结构文件" })).toHaveAttribute(
    "href",
    "#/s/butane-demo/evidence/analyses/representatives.xyz",
  );
  await body.getByRole("link", { name: "普通文件" }).click();
  await expect(page).toHaveURL(/butane-demo\/file\/notes\//);
  await expect(page.locator("pre")).toHaveText("只读本地文件示例");
  await page.reload();
  await expect(page.locator("pre")).toHaveText("只读本地文件示例");
  await page.goBack();
  await page.goto("/#/s/butane-demo/files/document");
  await page.getByRole("link", { name: "本地报告", exact: true }).click();
  await expect(page.getByRole("table", { name: "报告表格" })).toBeVisible();
});
test("CSV and all JSON shapes render without treating unknown schemas as syntax errors", async ({
  page,
}) => {
  await page.goto(report("quoted.csv"));
  const table = page.getByRole("table");
  await expect(table).toContainText("quoted, comma");
  await expect(table).toContainText("two\nlines");
  await page.goto(report("objects.json"));
  await expect(page.getByRole("columnheader")).toHaveText([
    "Attempt",
    "score",
    "extra",
  ]);
  await expect(page.locator(".report-body").getByRole("alert")).toHaveCount(0);
  await page.goto(report("scalars.json"));
  await expect(page.locator(".json-list>li")).toHaveText([
    "1",
    '"text"',
    "true",
    "null",
  ]);
  await page.goto(report("object.json"));
  await page.locator(".json-view summary").click();
  await expect(page.locator(".json-view")).toContainText("Synthetic object");
  await page.getByRole("button", { name: "格式化原文", exact: true }).click();
  await expect(page.locator("pre")).toContainText('"nested"');
  for (const [name, text] of [
    ["scalar.json", "42"],
    ["null.json", "null"],
  ]) {
    await page.goto(report(name));
    await expect(page.locator(".report-body pre")).toHaveText(text);
    await expect(page.locator(".report-body").getByRole("alert")).toHaveCount(
      0,
    );
  }
  await page.goto(report("bad.json"));
  await expect(page.locator(".report-body").getByRole("alert")).toContainText(
    "解析失败：第 2 行第 13 列",
  );
  await page.goto(report("bad.csv"));
  await expect(page.locator(".report-body").getByRole("alert")).toContainText(
    "CSV 解析失败：第 3 行",
  );
  await expect(page.locator(".report-body pre")).toContainText("unterminated");
  await page.goto(report("large.csv"));
  await expect(page.locator(".report-body").getByRole("status")).toContainText(
    "超过 5000 行",
  );
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(5001);
});
test("local images and sandboxed HTML/SVG cannot run scripts", async ({
  page,
  request,
}) => {
  const executed: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("should-not-run")) executed.push(r.url());
  });
  await page.goto(report("overview.md"));
  const picture = page.getByRole("img", { name: "合成示意图" });
  await picture.scrollIntoViewIfNeeded();
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(
    page.getByText("缺失图片（无法加载：文件不存在）", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".markdown script,.markdown iframe")).toHaveCount(
    0,
  );
  await page.goto(report("diagram.svg"));
  await expect(page.locator(".report-body>img")).toHaveCount(1);
  await expect(
    page.locator(".report-body svg,.report-body iframe,.report-body object"),
  ).toHaveCount(0);
  await page.goto(report("demo.html"));
  const frame = page.locator("iframe");
  await expect(frame).toHaveAttribute("sandbox", "");
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("heading", { name: "Synthetic HTML report" }),
  ).toBeVisible();
  expect(
    await page
      .frameLocator("iframe")
      .locator("body")
      .getAttribute("data-executed"),
  ).toBeNull();
  expect(
    await page.evaluate(() => Reflect.get(window, "reportInjected")),
  ).toBeUndefined();
  const response = await request.get(
    "/api/studies/butane-demo/files/analyses/reading/demo.html",
  );
  expect(response.headers()["content-security-policy"]).toBe(
    "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
  );
  expect(executed).toEqual([]);
});

// T193: report snapshots and CSV share saved values, not live facts or G_kcal.
import { readFile } from "node:fs/promises";
import {
  profileCSV,
  profileCSVCell,
  profileSnapshot,
} from "../src/profile-panels";
const profilePath = "/#/s/butane-demo/results/thermo/profile-demo.json";
const csvRows = (csv: string) => {
  const parsed = parseCSV(csv.replace(/^\uFEFF/, ""));
  expect(parsed.error).toBeUndefined();
  return parsed.rows.map((row) =>
    Object.fromEntries(parsed.headers.map((header, i) => [header, row[i]])),
  );
};
test("profile CSV protects text, retains signed numbers, and freezes all saved sources", () => {
  for (const prefix of ["=", "+", "-", "@"])
    for (const whitespace of ["", " ", "\t", "\r\n", "\u0001", "\u00a0"]) {
      expect(profileCSVCell(whitespace + prefix + "1")).toMatch(/^"'/);
    }
  for (const control of ["\u0000", "\t", "\r", "\n", "\u007f", "\u0085"])
    expect(profileCSVCell("text" + control)).toMatch(/^"'/);
  expect(profileCSVCell(-4.125)).toBe("-4.125");
  expect(profileCSVCell("-4.125")).toBe('"\'-4.125"');
  expect(profileCSVCell('comma, "quote"')).toBe('"comma, ""quote"""');
  const source = {
    schema: "ag-profile/1",
    units: "kcal/mol",
    reference: " \t=REF()",
    temperature_K: 298.15,
    standard_state: "1M",
    explicit_solvent_concentrations_M: {},
    warnings: [],
    symmetry: { warnings: [] },
    species: {
      A: {
        warnings: [],
        conformers: [{ attempt_id: "anti", spc_attempt_id: null }],
      },
    },
    states: [
      {
        id: 'x,"y"\nz',
        kind: "minimum",
        species: { A: 1 },
        G_kcal: 100,
        relative_G_kcal: -4.125,
      },
    ],
  };
  const snapshot = profileSnapshot(source, "analyses/saved.json");
  source.states[0].relative_G_kcal = 999;
  source.species.A.conformers[0].attempt_id = "gauche";
  expect(snapshot.states[0].energy).toBe(-4.125);
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.raw.species)).toBe(true);
  expect(Object.isFrozen(snapshot.states[0].sources[0].conformer)).toBe(true);
  const row = csvRows(profileCSV(snapshot))[0];
  expect(row.reference).toBe("' \t=REF()");
  expect(row.state_id).toBe('\'x,"y"\nz');
  expect(row.relative_G_kcal).toBe("-4.125");
  expect(row.attempt_id).toBe("anti");
  expect(row.explicit_solvent_concentrations_M).toBe("{}");
  expect(row.spc_attempt_id).toContain("未采用独立单点");
});
test("missing and nonfinite saved energies remain unknown without inventing sources", () => {
  const values = [undefined, null, Infinity, -Infinity, NaN, "2", false];
  const snapshot = profileSnapshot(
    {
      schema: "ag-profile/1",
      states: values.map((relative_G_kcal, index) => ({
        id: `missing-${index}`,
        G_kcal: 0,
        relative_G_kcal,
        species: { absent: 1 },
      })),
    },
    "analyses/old.json",
  );
  expect(snapshot.states.every((state) => state.energy === null)).toBe(true);
  expect(
    snapshot.states.every((state) => state.sources[0].index === null),
  ).toBe(true);
  const rows = csvRows(profileCSV(snapshot));
  expect(
    rows.every(
      (row) =>
        row.relative_G_kcal === "" &&
        !!row.missing_reason &&
        !!row.source_missing_reason,
    ),
  ).toBe(true);
  expect(rows[0].units).toBe("未知");
  expect(rows[0].temperature_K).toContain("未知");
});
for (const [width, height] of [
  [1440, 960],
  [390, 844],
])
  test(`saved profile levels, complete sources and layout ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [],
      writes: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (!["GET", "HEAD"].includes(request.method()))
        writes.push(request.method());
    });
    await page.goto(profilePath);
    const panel = page.getByRole("region", {
      name: "已保存自由能剖面",
      exact: true,
    });
    await expect(panel.getByText("310.15 K", { exact: true })).toBeVisible();
    await expect(
      panel.getByText("solvent：0.125", { exact: true }),
    ).toBeVisible();
    await expect(panel.locator(".profile-level")).toHaveCount(3);
    await expect(panel.locator(".profile-unknown")).toHaveCount(2);
    await expect(panel.locator(".profile-ts")).toHaveCount(1);
    const level = panel.getByRole("button", {
      name: "选择能级 1：R-mixture；0 kcal/mol",
      exact: true,
    });
    await level.focus();
    await page.keyboard.press("Enter");
    const sources = panel.getByRole("region", {
      name: "状态来源",
      exact: true,
    });
    await expect(
      sources.getByRole("heading", { name: "状态 1：R-mixture 的保存来源" }),
    ).toBeFocused();
    await expect(sources.locator(".profile-source")).toHaveCount(3);
    await expect(
      sources.getByRole("link", { name: "Attempt anti", exact: true }),
    ).toHaveCount(2);
    await expect(
      sources.getByRole("link", { name: "Attempt gauche", exact: true }),
    ).toHaveAttribute("href", "#/s/butane-demo/research/a/gauche");
    await expect(
      sources.getByRole("link", { name: "Attempt opt-demo", exact: true }),
    ).toHaveAttribute("href", "#/s/butane-demo/research/a/opt-demo");
    await expect(sources).toContainText("未采用独立单点（报告为 null）");
    await panel.getByRole("button", { name: /选择能级 2：TS-mixed/ }).click();
    await expect(sources.locator(".profile-source")).toHaveCount(2);
    await expect(sources.locator(".profile-source").first()).toContainText(
      "Attempt opt-demo",
    );
    await expect(sources.locator(".profile-source").first()).toContainText(
      "Attempt gauche",
    );
    await panel
      .getByRole("button", { name: "missing-energy", exact: true })
      .click();
    await expect(sources).toContainText("物种来源或 conformers 未保存 / 为空");
    await expect(sources.getByRole("link")).toHaveCount(0);
    await panel.getByRole("button", { name: /选择能级 1：/ }).click();
    await sources
      .getByRole("link", { name: "Attempt opt-demo", exact: true })
      .click();
    await expect(page).toHaveURL(/research\/a\/opt-demo/);
    await page.goBack();
    await expect(panel.locator(".profile-level")).toHaveCount(3);
    const table = panel.getByRole("table", {
      name: "已保存剖面数值",
      exact: true,
    });
    await expect(table).toContainText("-4.125");
    await expect(table).toContainText("12.3456789");
    await panel.getByText("完整原始 JSON（本次读取）", { exact: true }).click();
    await expect(panel.locator(".profile-raw pre")).toContainText(
      '"G_kcal": -987654.321',
    );
    await panel.getByText("完整原始 JSON（本次读取）", { exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const labels = await panel
      .locator(".profile-state-name")
      .evaluateAll((elements) =>
        elements.map((el) => ({
          left: el.getBoundingClientRect().left,
          right: el.getBoundingClientRect().right,
          scroll: el.scrollWidth,
          width: el.clientWidth,
        })),
      );
    expect(
      labels.every(
        (item, i) =>
          item.scroll <= item.width &&
          (i === 0 || item.left >= labels[i - 1].right),
      ),
    ).toBe(true);
    await panel.getByRole("button", { name: /选择能级 1：/ }).click();
    await panel.locator(".profile-warnings summary").click();
    await panel
      .locator(".profile-figure")
      .evaluate((el) =>
        window.scrollTo(
          0,
          el.getBoundingClientRect().top + window.scrollY - 190,
        ),
      );
    await page.screenshot({
      path: info.outputPath(`profile-${width}x${height}.png`),
    });
    await sources.screenshot({
      path: info.outputPath(`profile-sources-${width}.png`),
    });
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
test("CSV download uses the rendered snapshot even after available source responses change", async ({
  page,
}) => {
  let changed = false;
  const laterReads: string[] = [];
  await page.route("**/api/studies/butane-demo/**", async (route) => {
    if (changed) {
      laterReads.push(route.request().url());
      if (route.request().url().includes("profile-demo.json"))
        return route.fulfill({
          json: {
            data: {
              schema: "ag-profile/1",
              states: [{ id: "REPLACED", relative_G_kcal: 999 }],
            },
            error: null,
          },
        });
    }
    await route.continue();
  });
  await page.goto(profilePath);
  const panel = page.getByRole("region", {
    name: "已保存自由能剖面",
    exact: true,
  });
  await expect(panel.locator(".profile-level")).toHaveCount(3);
  await page.waitForLoadState("networkidle");
  changed = true;
  await panel
    .getByRole("table", { name: "已保存剖面数值" })
    .getByRole("button", { name: "顺序", exact: true })
    .click();
  const pending = page.waitForEvent("download");
  await panel.getByRole("button", { name: "下载当前剖面 CSV" }).click();
  const download = await pending;
  const csv = await readFile((await download.path())!, "utf8");
  const rows = csvRows(csv);
  expect(
    rows
      .filter((row) => row.state_id === "R-mixture")
      .map((row) => [row.species, row.attempt_id, row.spc_attempt_id]),
  ).toEqual([
    ["substrate", "anti", "opt-demo"],
    ["substrate", "gauche", "未采用独立单点（报告为 null）"],
    ["solvent", "anti", "未采用独立单点（报告为 null）"],
  ]);
  expect(rows.find((row) => row.kind === "ts")?.relative_G_kcal).toBe(
    "12.3456789",
  );
  expect(
    rows.find((row) => row.state_id.startsWith("P-synthetic"))?.relative_G_kcal,
  ).toBe("-4.125");
  expect(
    rows.find((row) => row.state_id === "missing-energy")?.relative_G_kcal,
  ).toBe("");
  expect(
    rows.find((row) => row.state_id === "nonfinite-energy")?.missing_reason,
  ).toContain("不是有限数值");
  expect(rows[0].temperature_K).toBe("310.15");
  expect(rows[0].warnings).toContain('=SUM(1,2)\n"synthetic warning"');
  expect(rows[0].warnings.startsWith("'")).toBe(true);
  expect(laterReads).toEqual([]);
  await expect(panel.locator(".profile-level")).toHaveCount(3);
  await expect(
    panel.getByRole("table", { name: "已保存剖面数值" }),
  ).not.toContainText("REPLACED");
});
test("legacy profile and unknown schema retain complete raw access", async ({
  page,
}) => {
  await page.route(
    "**/files/analyses/profile-demo.json?document=true",
    (route) =>
      route.fulfill({
        json: {
          data: { schema: "ag-profile/1", note: "legacy no states" },
          error: null,
        },
      }),
  );
  await page.goto(profilePath);
  await expect(page.getByRole("status")).toContainText("states 未保存");
  await page.getByText("完整原始 JSON（本次读取）", { exact: true }).click();
  await expect(page.locator(".profile-raw pre")).toContainText(
    "legacy no states",
  );
  await page.goto("/#/s/butane-demo/results/file/unknown-demo.json");
  await expect(page.locator(".json-view")).toBeVisible();
  await page.getByRole("button", { name: "格式化原文", exact: true }).click();
  await expect(page.locator(".report-body pre")).toContainText(
    "future-report/9",
  );
});
test("state identifiers never imply Attempt sources and reserved Attempt ids route exactly", async ({
  page,
}) => {
  const reads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("comparison-structure"))
      reads.push(request.url());
  });
  const value = {
    schema: "ag-profile/1",
    units: "kcal/mol",
    explicit_solvent_concentrations_M: { solvent: "HUGE_NUMBER" },
    warnings: [],
    symmetry: { warnings: [] },
    states: [
      {
        id: "anti",
        kind: "minimum",
        species: { A: 1 },
        relative_G_kcal: "HUGE_NUMBER",
      },
    ],
    species: {
      A: {
        warnings: [],
        settings: { temperature_K: "HUGE_NUMBER" },
        conformers: [{ attempt_id: "compare", spc_attempt_id: "_synthetic" }],
      },
    },
  };
  await page.route(
    "**/files/analyses/profile-demo.json?document=true",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: value, error: null }).replaceAll(
          '"HUGE_NUMBER"',
          "1e400",
        ),
      }),
  );
  await page.goto(profilePath);
  const panel = page.getByRole("region", {
    name: "已保存自由能剖面",
    exact: true,
  });
  const table = panel.getByRole("table", { name: "已保存剖面数值" });
  await expect(table.getByRole("link")).toHaveCount(0);
  await table.getByRole("button", { name: "anti", exact: true }).click();
  await expect(panel.locator(".profile-level")).toHaveCount(0);
  await expect(
    panel.getByRole("link", { name: "Attempt compare", exact: true }),
  ).toHaveAttribute("href", "#/s/butane-demo/research/a/compare");
  await expect(
    panel.getByRole("link", { name: "Attempt _synthetic", exact: true }),
  ).toHaveAttribute("href", "#/s/butane-demo/research/a/_synthetic");
  await expect(panel).toContainText("solvent：未知（不是有限数值）");
  const settings = panel
    .locator(".profile-source details")
    .filter({ has: page.getByText("物种设置与单构象说明", { exact: true }) });
  await settings.locator("summary").click();
  await expect(settings.locator("pre")).toContainText(
    "未知（非有限数值：Infinity）",
  );
  const pending = page.waitForEvent("download");
  await panel.getByRole("button", { name: "下载当前剖面 CSV" }).click();
  const downloaded = await pending;
  const rows = csvRows(await readFile((await downloaded.path())!, "utf8"));
  expect(rows[0].explicit_solvent_concentrations_M).toContain(
    "未知（非有限数值：Infinity）",
  );
  expect(rows[0].relative_G_kcal).toBe("");
  expect(reads).toEqual([]);
});
