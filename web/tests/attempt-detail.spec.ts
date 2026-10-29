import { test, expect } from "@playwright/test";
import { openSection } from "./disclosure";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

const vibrationCases: Record<string, Record<string, unknown>> = JSON.parse(
  execFileSync(
    resolve(process.env.AUTOG_SOURCE_PYTHON ?? "../.venv/bin/python"),
    [
      "-B",
      "-c",
      "import json; from tests.results_fixture import VIBRATION_FACTS_CASES; print(json.dumps(VIBRATION_FACTS_CASES))",
    ],
    { cwd: resolve(".."), encoding: "utf8" },
  ),
);
async function vibrationFacts(page: Page, name: string) {
  await page.route(
    "**/api/studies/butane-demo/attempts/opt-demo",
    async (route) => {
      const response = await route.fetch(),
        data = await response.json();
      for (const key of [
        "n_vibrational_modes",
        "expected_vibrational_modes",
        "vibrational_modes_complete",
        "frequency_unavailable_reason",
      ])
        delete data.facts.data[key];
      Object.assign(data.facts.data, vibrationCases[name]);
      await route.fulfill({ json: data });
    },
  );
  await page.goto("/#/s/butane-demo/a/opt-demo");
}

for (const [name, count, status, detail] of [
  ["complete", "已读 3 / 预期 3", "完整", "vibrational_modes_complete：true"],
  [
    "incomplete",
    "已读 2 / 预期 3",
    "不完整",
    "Synthetic frequency section is truncated",
  ],
  [
    "unknown",
    "已读 未知 / 预期 未知",
    "未知",
    "n_vibrational_modes：null（未知）",
  ],
  [
    "legacy",
    "已读 未知 / 预期 未知",
    "未知",
    "未记录振动完整性字段，可能为旧 facts。",
  ],
  ["zero", "已读 0 / 预期 0", "完整", "n_vibrational_modes：0"],
  [
    "equal-null",
    "已读 3 / 预期 3",
    "未知",
    "vibrational_modes_complete：null（未知）",
  ],
  [
    "equal-missing",
    "已读 3 / 预期 3",
    "未知",
    "vibrational_modes_complete：字段缺失",
  ],
  [
    "count-only",
    "已读 2 / 预期 未知",
    "未知",
    "expected_vibrational_modes：字段缺失",
  ],
  [
    "expected-only",
    "已读 未知 / 预期 3",
    "未知",
    "n_vibrational_modes：字段缺失",
  ],
  [
    "true-mismatch",
    "已读 2 / 预期 3",
    "完整",
    "计数与完整性标志不一致；保留 facts 原值",
  ],
  ["false-equal", "已读 3 / 预期 3", "不完整", "未记录不可用原因（字段缺失）"],
  ["missing-reason", "已读 2 / 预期 3", "不完整", "未记录不可用原因（null）"],
  ["empty-reason", "已读 2 / 预期 3", "不完整", "未记录不可用原因（空文本）"],
])
  test(`T194 saved vibration facts: ${name}`, async ({ page }) => {
    const writes: string[] = [];
    page.on("request", (r) => {
      if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
    });
    await vibrationFacts(page, name);
    const panel = page.getByLabel("振动模式完整性", { exact: true }),
      summary = panel.locator("summary");
    await expect(summary).toContainText(count);
    await expect(summary.locator(".StatusBadge")).toHaveText(status);
    await expect(summary.locator(".StatusBadge")).not.toHaveClass(/tone-ok/);
    await expect(panel.locator(".vibration-conflict")).toHaveCount(
      ["true-mismatch", "false-equal"].includes(name) ? 1 : 0,
    );
    const imaginary = page
      .getByRole("region", { name: "关键事实", exact: true })
      .locator("dt")
      .filter({ hasText: "虚频数 / cm⁻¹" });
    await expect(
      imaginary.locator("xpath=following-sibling::dd[1]"),
    ).toContainText("0");
    await summary.click();
    await expect(panel).toContainText(detail);
    await expect(panel).toContainText("不代表 TS 或科学验收通过");
    if (["count-only", "expected-only"].includes(name))
      await expect(panel).toContainText("仅有部分计数");
    if (name === "incomplete")
      await expect(page.locator(".fact-warnings")).toContainText(
        "Synthetic frequency section is truncated",
      );
    if (name === "complete") {
      await page
        .getByRole("button", { name: "查看振动完整性 facts 来源", exact: true })
        .click();
      await expect(page.locator('[id="record-facts.json"]')).toBeVisible();
      await expect(page.locator('[id="record-facts.json"]')).toContainText(
        '"vibrational_modes_complete": true',
      );
    }
    expect(writes).toEqual([]);
  });

test("T194 no facts keeps completeness unknown and explains the missing source", async ({
  page,
}) => {
  await page.goto("/#/s/butane-demo/a/waiting");
  const panel = page.getByLabel("振动模式完整性", { exact: true });
  await expect(panel.locator("summary")).toContainText("已读 未知 / 预期 未知");
  await expect(panel.locator(".StatusBadge")).toHaveText("未知");
  await panel.locator("summary").click();
  await expect(panel).toContainText("尚无可读 facts；模式数和完整性均未知。");
  await page
    .getByRole("button", { name: "查看振动完整性 facts 来源", exact: true })
    .click();
  await expect(page.locator('[id="record-facts.json"]')).toContainText(
    "File not available",
  );
});

for (const width of [1440, 390])
  test(`T194 vibration completeness layout ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 1200 : 960 });
    await vibrationFacts(page, "true-mismatch");
    const panel = page.getByLabel("振动模式完整性", { exact: true });
    await panel.locator("summary").click();
    await expect(panel).toContainText("保留 facts 原值");
    await panel.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`t194-completeness-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("region", { name: "关键事实", exact: true })
      .screenshot({
        path: info.outputPath(`t194-facts-${width}.png`),
      });
  });
for (const [width, height] of [
  [1440, 860],
  [1280, 720],
])
  for (const id of ["anti", "prepared"])
    test(`T96 first screen ${id} ${width}x${height}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height });
      await page.goto("http://localhost:18766/#/s/butane-demo/a/" + id);
      await expect(
        page.getByRole("group", { name: "Attempt 操作", exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("molecule-scene").first()).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`t96-${id}-${width}x${height}.png`),
      });
      console.log(
        "T96 layout",
        width,
        height,
        id,
        await page.evaluate(() =>
          [
            ".app-header",
            ".context-bar",
            ".section-nav",
            ".attempt-heading",
            ".attempt-actions",
            ".attempt-facts",
            ".attempt-structure",
            ".molecule-stage svg",
          ].map((selector) => {
            const b = document.querySelector(selector)!.getBoundingClientRect();
            return { selector, top: b.top, height: b.height, bottom: b.bottom };
          }),
        ),
      );
      for (const name of ["关键事实", "三维结构"]) {
        const panel = page.getByRole("region", { name, exact: true });
        await expect(panel).toBeVisible();
        const box = await panel.boundingBox();
        expect(box!.y).toBeGreaterThanOrEqual(85);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(box!.y + box!.height, name).toBeLessThanOrEqual(height);
      }
      const scene = await page
        .getByTestId("molecule-scene")
        .first()
        .boundingBox();
      expect(scene!.height).toBeGreaterThanOrEqual(190);
      const tools = await page
        .locator(".attempt-structure .structure-tools > summary")
        .boundingBox();
      expect(tools!.y + tools!.height).toBeLessThanOrEqual(height);
      const caption = await page
          .locator(".attempt-structure .scene-caption")
          .boundingBox(),
        hint = await page
          .locator(".attempt-structure .model-hint")
          .boundingBox(),
        tray = await page
          .getByRole("complementary", { name: "比较篮", exact: true })
          .boundingBox();
      expect(caption!.y + caption!.height).toBeLessThanOrEqual(hint!.y);
      expect(tools!.y + tools!.height).toBeLessThanOrEqual(tray!.y);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(`t96-${id}-${width}x${height}.png`),
      });
    });
test("facts locate lines, missing states and snapshots are explicit and readonly", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
  });
  await page.goto("/#/s/butane-demo/a/opt-demo");
  await page
    .getByRole("button", { name: "定位电子能 / Eh来源", exact: true })
    .click();
  await expect(page.locator(".log-match")).toContainText("-157.00250000");
  await expect(page.locator("#attempt-logs")).toContainText("未记录来源区间");
  await page.goto("/#/s/butane-demo/a/waiting");
  await expect(
    page.getByRole("region", { name: "关键事实", exact: true }),
  ).toContainText("尚无可读 facts");
  await openSection(page, "日志搜索");
  await expect(page.locator("#attempt-logs")).toContainText(
    "尚无 outputs 日志",
  );
  await page.goto("/#/s/butane-demo/a/prepared");
  await page
    .getByRole("button", { name: "定位方法 / 基组 / 溶剂来源", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "输入参数", exact: true }),
  ).toBeVisible();
  await page.goto("/#/s/butane-demo/a/anti");
  await openSection(page, "快照 · 运行中快照，不是结果");
  const table = page.getByRole("table", { name: "本地快照摘要" });
  await expect(table).toContainText("synthetic-capture");
  await expect(table).toContainText("128");
  expect(await page.locator("body").textContent()).not.toContain(
    "RAW_SNAPSHOT_LOG_SENTINEL",
  );
  expect(writes).toEqual([]);
});
test("fact source range never jumps to another Link1 section", async ({
  page,
}) => {
  await page.route(
    "**/api/studies/butane-demo/attempts/opt-demo",
    async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.facts.data.fact_sources = { "energies.scf": 1 };
      data.facts.data.job_sections = [{ index: 1, start_line: 1, end_line: 3 }];
      await route.fulfill({ json: data });
    },
  );
  await page.goto("/#/s/butane-demo/a/opt-demo");
  await page
    .getByRole("button", { name: "定位电子能 / Eh来源", exact: true })
    .click();
  await expect(page.locator("#attempt-logs")).toContainText(
    "记录的来源区间内没有匹配",
  );
  await expect(page.locator(".log-match")).toHaveCount(0);
});
for (const state of [
  "prepared",
  "submitting",
  "submitted",
  "running",
  "finished",
  "fetched",
  "unknown",
  "failed_presubmit",
])
  test(`action availability ${state}`, async ({ page }) => {
    await page.route("**/api/actions/butane-demo/prepared", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.state = state;
      data.can_cancel = ["submitted", "running"].includes(state);
      if (["unknown", "failed_presubmit"].includes(state)) data.source = null;
      await route.fulfill({ json: data });
    });
    await page.goto("http://localhost:18766/#/s/butane-demo/a/prepared");
    const bar = page.getByRole("group", { name: "Attempt 操作", exact: true });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("button")).toHaveText([
      "刷新状态",
      ...(state === "finished" ? ["取回结果"] : []),
      ...(!["unknown", "failed_presubmit"].includes(state)
        ? ["基于此新建"]
        : []),
      ...(state === "prepared" ? ["提交"] : []),
      ...(["submitted", "running"].includes(state) ? ["取消计算"] : []),
    ]);
    if (["submitted", "running"].includes(state)) {
      await expect(bar.locator(".danger button")).toHaveText("取消计算");
      expect(
        await bar
          .locator(".danger button")
          .evaluate((el) => getComputedStyle(el).color),
      ).toBe("rgb(169, 60, 56)");
    }
  });
test("numeric cells, measured sticky offset and metadata-only study response", async ({
  page,
  request,
}) => {
  const metadata = await (await request.get("/api/studies/butane-demo")).json();
  expect(
    metadata.analyses.every((r: { data: unknown }) => r.data === null),
  ).toBe(true);
  const bodies: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/reports/") || r.url().includes("/files/analyses/"))
      bodies.push(r.url());
  });
  await page.goto("/#/s/butane-demo");
  await page.getByText("最近改动的文件", { exact: true }).click();
  const link = page.getByRole("link", {
    name: "thermo-demo.json",
    exact: true,
  });
  await expect(link).toHaveAttribute(
    "href",
    "#/s/butane-demo/results/thermo/thermo-demo.json",
  );
  expect(bodies).toHaveLength(0);
  await link.click();
  await expect(page.getByRole("table", { name: "热化学表" })).toContainText(
    "50.000%",
  );
  expect(
    bodies.filter((url) =>
      new URL(url).pathname.endsWith("/files/analyses/thermo-demo.json"),
    ),
  ).toHaveLength(1);
  await page.goto("/#/s/butane-demo/attempts");
  const table = page.getByRole("table", { name: "Attempt 结果表" }),
    row = table.locator("tbody tr").filter({
      has: page.getByRole("link", { name: "opt-demo", exact: true }),
    });
  await expect(row.locator("td.numeric").first()).toHaveText("-157.002500");
  await expect(row.locator('[title="-157.0025"]')).toBeVisible();
  expect(
    await row
      .locator("td.numeric")
      .first()
      .evaluate((el) => getComputedStyle(el).textAlign),
  ).toBe("right");
  const offset = await table
      .locator("th")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).top)),
    actual = await page.evaluate(
      () =>
        document.querySelector(".app-header")!.getBoundingClientRect().height +
        document.querySelector(".context-bar")!.getBoundingClientRect().height,
    );
  expect(offset).toBeCloseTo(actual, 1);
});
