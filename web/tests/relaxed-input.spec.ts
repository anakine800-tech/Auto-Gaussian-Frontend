import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Share saved marker values with the real adapter's immutable-file tests.
const cases: Record<string, Record<string, unknown>> = JSON.parse(
  execFileSync(
    resolve(process.env.AUTOG_SOURCE_PYTHON ?? "../.venv/bin/python"),
    [
      "-B",
      "-c",
      "import json; from tests.results_fixture import RELAXED_INPUT_CASES; print(json.dumps(RELAXED_INPUT_CASES))",
    ],
    { cwd: resolve(".."), encoding: "utf8" },
  ),
);
const notice = (page: Page) =>
  page.getByRole("region", { name: "输入检查提醒", exact: true });
const source = (page: Page) => page.locator('[id="record-manifest.json"]');
const savedChecks = (name: string) =>
  (cases[name].input_validation as { skipped_checks: string[] }).skipped_checks;

async function openMarker(
  page: Page,
  name: string,
  options: { state?: string; noFacts?: boolean; manifestError?: boolean } = {},
) {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url());
  });
  await page.route(
    "**/api/studies/butane-demo/attempts/opt-demo",
    async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      delete data.manifest.data.input_validation;
      Object.assign(data.manifest.data, cases[name]);
      data.status.data.state = options.state ?? "fetched";
      data.facts.data.parser_warning = "Synthetic pre-existing parser warning";
      if (options.noFacts)
        data.facts = { data: null, error: "File not available: facts.json" };
      if (options.manifestError)
        data.manifest = {
          data: null,
          error: "Synthetic malformed manifest JSON",
        };
      await route.fulfill({ json: data });
    },
  );
  await page.goto("/#/s/butane-demo/a/opt-demo");
  await expect(
    page.getByRole("heading", { name: "opt-demo", exact: true }),
  ).toBeVisible();
  return writes;
}

test("T197 saved relaxed marker, method warning and exact source survive navigation", async ({
  page,
}) => {
  const writes = await openMarker(page, "valid");
  const panel = notice(page);
  await expect(panel.getByRole("heading")).toHaveText("输入检查已放宽");
  await expect(panel.locator("strong")).toHaveText("方法口径未核验");
  await expect(panel.locator("li")).toHaveText(savedChecks("valid"));
  await expect(panel).toContainText("ag scan-peak 不可用");
  await expect(panel).toContainText("ag profile 可能不适用");
  await expect(panel).toContainText("自定义基组");
  await expect(panel).toContainText("SCRF=Read");
  await expect(panel).toContainText("不代表科学验收通过");
  await expect(panel.locator("input, select, textarea, a")).toHaveCount(0);
  await expect(panel.getByRole("button")).toHaveText(
    "查看输入检查 manifest 来源",
  );
  await expect(
    page.getByLabel("振动模式完整性", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".fact-method")).toContainText("HF/STO-3G");
  await expect(page.locator(".fact-warnings")).toContainText(
    "Synthetic pre-existing parser warning",
  );

  await panel.getByRole("button").click();
  await expect(source(page)).toBeVisible();
  const manifest = JSON.parse(
    (await source(page).locator("pre").textContent())!,
  );
  expect(manifest.input_validation).toEqual(cases.valid.input_validation);
  await page
    .getByRole("button", { name: "定位电子能 / Eh来源", exact: true })
    .click();
  await expect(page.locator(".log-match")).toContainText("-157.00250000");

  await page.goto("/#/s/butane-demo/a/waiting");
  await expect(
    page.getByRole("heading", { name: "waiting", exact: true }),
  ).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  await page.goBack();
  await expect(notice(page).getByRole("heading")).toHaveText("输入检查已放宽");
  await page.reload();
  await expect(notice(page).locator("li")).toHaveText(savedChecks("valid"));
  expect(writes).toEqual([]);
});

for (const name of Object.keys(cases).filter(
  (name) => !["valid", "escaped", "legacy"].includes(name),
))
  test(`T197 invalid marker stays unknown and preserves source: ${name}`, async ({
    page,
  }) => {
    const writes = await openMarker(page, name);
    const panel = notice(page);
    await expect(panel.getByRole("heading")).toHaveText("输入检查标记无法核实");
    await expect(panel.locator("strong")).toHaveText("方法核验状态未知");
    await expect(
      panel.getByText("输入检查已放宽", { exact: true }),
    ).toHaveCount(0);
    await expect(panel).toContainText("保留 manifest 原记录");
    await panel
      .getByRole("button", { name: "查看输入检查 manifest 来源", exact: true })
      .click();
    await expect(source(page)).toBeVisible();
    const manifest = JSON.parse(
      (await source(page).locator("pre").textContent())!,
    );
    expect(manifest.input_validation).toEqual(cases[name].input_validation);
    expect(writes).toEqual([]);
  });

test("T197 unreadable manifest cannot silently become an ordinary input", async ({
  page,
}) => {
  const writes = await openMarker(page, "valid", { manifestError: true });
  await expect(notice(page).getByRole("heading")).toHaveText(
    "输入检查标记无法核实",
  );
  await expect(notice(page)).toContainText("manifest 无法读取");
  await notice(page).getByRole("button").click();
  await expect(source(page)).toContainText("Synthetic malformed manifest JSON");
  expect(writes).toEqual([]);
});

for (const state of ["submitted", "running", "fetched", "failed"])
  test(`T197 ${state} without facts still shows saved relaxed warning`, async ({
    page,
  }) => {
    const writes = await openMarker(page, "valid", { state, noFacts: true });
    await expect(notice(page).getByRole("heading")).toHaveText(
      "输入检查已放宽",
    );
    await expect(notice(page).locator("strong")).toHaveText("方法口径未核验");
    await expect(notice(page).locator("li")).toHaveText(savedChecks("valid"));
    const facts = page.getByRole("region", { name: "关键事实", exact: true });
    await expect(facts).toContainText(state);
    await expect(facts).toContainText("尚无可读 facts");
    await expect(
      page.getByLabel("振动模式完整性", { exact: true }).locator("summary"),
    ).toContainText("已读 未知 / 预期 未知");
    expect(writes).toEqual([]);
  });

test("T197 old unmarked input keeps existing facts without a validation claim", async ({
  page,
}) => {
  const writes = await openMarker(page, "legacy");
  await expect(notice(page)).toHaveCount(0);
  await expect(page.locator(".fact-method")).toContainText("HF/STO-3G");
  await expect(
    page.getByLabel("振动模式完整性", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".fact-warnings")).toContainText(
    "Synthetic pre-existing parser warning",
  );
  await expect(page.getByText("方法口径已核验", { exact: true })).toHaveCount(
    0,
  );
  expect(writes).toEqual([]);
});

for (const width of [1440, 390])
  test(`T197 long escaped skip text remains inert and fits ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 1200 : 960 });
    const external: string[] = [];
    const dialogs: string[] = [];
    page.on("request", (request) => {
      if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
        external.push(request.url());
    });
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    const writes = await openMarker(page, "escaped");
    const panel = notice(page);
    await expect(panel.getByRole("heading")).toHaveText("输入检查已放宽");
    await expect(panel.locator("li")).toHaveText(savedChecks("escaped"));
    await expect(
      panel.locator("a, img, script, iframe, input, select, textarea"),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as Window & { relaxedInputXss?: number }).relaxedInputXss,
      ),
    ).toBeUndefined();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`t197-relaxed-${width}.png`),
      fullPage: true,
    });
    await panel.screenshot({
      path: info.outputPath(`t197-notice-${width}.png`),
    });
    expect(external).toEqual([]);
    expect(dialogs).toEqual([]);
    expect(writes).toEqual([]);
  });
