import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

async function fullyVisible(locator: Locator, page: Page) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const size = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
}
for (const size of [
  { width: 1440, height: 860 },
  { width: 1280, height: 720 },
])
  test(`four entry screenshots and first-screen shell ${size.width}x${size.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(size);
    await page.clock.setFixedTime(new Date('2026-10-17T02:00:00Z'));
    await page.goto('/#/s/butane-demo');
    await expect(page.getByRole('region', { name: '还缺什么' })).toContainText(
      'opt-demo',
    );
    for (const [entry, name, ready] of [
      ['服务器', 'jobs', '服务器'],
      ['研究', 'study', '还缺什么'],
      ['结果', 'analysis', '报告'],
      ['证据', 'files', '研究证据'],
    ]) {
      await page
        .getByRole('navigation', { name: '顶部导航' })
        .getByRole('button', { name: entry, exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: ready, exact: true }),
      ).toBeVisible();
      if (entry === '服务器')
        await expect(
          page.getByRole('table', { name: '运行中作业表' }),
        ).toBeVisible();
      if (entry === '结果')
        await expect(
          page.getByRole('link', { name: 'thermo-demo.json', exact: true }),
        ).toBeVisible();
      if (entry === '证据')
        await expect(
          page.getByRole('heading', { name: '文件库', exact: true }),
        ).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await fullyVisible(page.locator('.app-header'), page);
      await fullyVisible(page.locator('.context-bar'), page);
      await fullyVisible(
        page.getByRole('heading', { name: ready, exact: true }),
        page,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(size.width);
      await page.screenshot({
        path: info.outputPath(`${name}-${size.width}x${size.height}.png`),
      });
    }
  });

test('legacy exact links replace history and preserve both query locations', async ({
  page,
}) => {
  await page.goto('/?keep=1#/s/butane-demo/files');
  await expect(
    page.getByRole('heading', { name: '文件库', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    location.hash = '#/butane-demo/prepared?extra=retained';
  });
  await expect(page).toHaveURL(
    /\?keep=1#\/s\/butane-demo\/research\/a\/prepared\?extra=retained$/,
  );
  await expect(
    page.getByRole('heading', { name: 'prepared', exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/s\/butane-demo\/evidence\/library$/);
  await page.goForward();
  await expect(page).toHaveURL(
    /#\/s\/butane-demo\/research\/a\/prepared\?extra=retained$/,
  );
  await page.goto('/#/ensemble-demo/ensembles/ensemble.json?candidate=2');
  await expect(page).toHaveURL(
    /#\/s\/ensemble-demo\/results\/ensemble\/ensemble.json\?candidate=2$/,
  );
  await expect(
    page.getByRole('button', { name: '候选 2 缩略图' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/#/butane-demo/structures/butane/conformers.xyz');
  await expect(page).toHaveURL(
    /#\/s\/butane-demo\/evidence\/library\?file=structures%2Fbutane%2Fconformers.xyz$/,
  );
  await expect(page.getByLabel('帧号')).toHaveValue('1');
});

test('local index search navigates Attempts and filenames', async ({
  page,
}) => {
  // The Attempt table loads Study metadata without visible report conclusions.
  // Requests after this point can therefore be attributed to typing in search.
  await page.goto('/#/s/butane-demo/attempts');
  await expect(
    page.getByRole('table', { name: 'Attempt 结果表' }),
  ).toContainText('opt-demo');
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.getByRole('textbox', { name: '全局搜索' }).fill('opt-demo');
  const results = page.getByRole('region', { name: '搜索结果' });
  await expect(page.getByRole('combobox', { name: '搜索范围' })).toHaveValue(
    'current',
  );
  await expect(results).toContainText('当前 Study');
  await expect(results.getByRole('link')).toHaveCount(1);
  expect(requests.every((url) => new URL(url).pathname === '/api/search')).toBe(
    true,
  );
  expect(
    requests.every(
      (url) => new URL(url).searchParams.get('study') === 'butane-demo',
    ),
  ).toBe(true);
  await results.getByRole('link').click();
  await expect(page).toHaveURL(/#\/s\/butane-demo\/research\/a\/opt-demo$/);
  await page
    .getByRole('textbox', { name: '全局搜索' })
    .fill('thermo-demo.json');
  await results.getByRole('link').click();
  await expect(
    page.getByRole('heading', { name: 'thermo-demo.json', exact: true }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: '全局搜索' }).fill('no-such-file');
  await expect(results).toContainText('没有匹配');
  await page.getByRole('textbox', { name: '全局搜索' }).press('Escape');
  await expect(results).toHaveCount(0);
});

test('manifest method search uses the current Study and preserves the all-Study entry', async ({
  page,
}, info) => {
  await page.goto('/#/s/butane-demo/research/attempts');
  await expect(
    page.getByRole('table', { name: 'Attempt 结果表' }),
  ).toContainText('opt-demo');
  const search = page.getByRole('textbox', { name: '全局搜索' });
  const scope = page.getByRole('combobox', { name: '搜索范围' });
  const results = page.getByRole('region', { name: '搜索结果' });
  const requests: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/search') requests.push(url);
  });

  // Real synthetic manifests have method_basis; their facts additionally have
  // Opt Freq. Only manifest metadata belongs in this index.
  await search.fill('hf/sto-3g');
  await expect(results.getByRole('link')).toHaveCount(2);
  await expect(
    results.getByRole('link').filter({ hasText: 'opt-demo' }),
  ).toHaveAttribute('href', '#/s/butane-demo/research/a/opt-demo');
  expect(requests.at(-1)?.searchParams.get('study')).toBe('butane-demo');
  await page.screenshot({
    path: info.outputPath('method-search-current-study.png'),
  });

  await search.fill('Opt Freq');
  await expect(results).toContainText('没有匹配');
  await search.fill('crest-demo');
  await expect(results).toContainText('没有匹配');
  await scope.selectOption('all');
  await expect(results.getByRole('link')).toHaveCount(1);
  await expect(results.getByRole('link')).toHaveAttribute(
    'href',
    '#/s/ensemble-demo/research/a/crest-demo',
  );
  expect(requests.at(-1)?.searchParams.has('study')).toBe(false);
  await scope.selectOption('current');
  await expect(results).toContainText('没有匹配');
  expect(requests.at(-1)?.searchParams.get('study')).toBe('butane-demo');

  await page
    .getByRole('navigation', { name: '顶部导航' })
    .getByRole('button', { name: '服务器', exact: true })
    .click();
  await search.focus();
  await expect(scope).toHaveValue('all');
  await expect(results.getByRole('link')).toHaveCount(1);
  expect(requests.at(-1)?.searchParams.has('study')).toBe(false);
});

test('same-named Attempts stay in their selected Study and show bounded-index notices', async ({
  page,
}, info) => {
  // UI-only transport fixture: Python tests exercise server-side filtering and
  // partial-index causes against real temporary study directories.
  const calls: (string | null)[] = [];
  await page.route('**/api/search?*', async (route) => {
    const study = new URL(route.request().url()).searchParams.get('study');
    calls.push(study);
    const ids = study ? [study] : ['butane-demo', 'ensemble-demo'];
    await route.fulfill({
      json: {
        groups: ids.map((id) => ({
          study: id,
          title: id,
          hits: [
            {
              label: 'same-attempt',
              detail: 'Synthetic method · Attempt',
              href: `#/s/${id}/research/a/same-attempt`,
            },
          ],
        })),
        incomplete: true,
        truncated: true,
        message: '索引未完成：合成读取限制；部分方法未知。',
      },
    });
  });
  await page.goto('/#/s/butane-demo/research/attempts');
  const search = page.getByRole('textbox', { name: '全局搜索' });
  const scope = page.getByRole('combobox', { name: '搜索范围' });
  const results = page.getByRole('region', { name: '搜索结果' });
  await search.fill('same-attempt');
  await expect(results.getByRole('link')).toHaveCount(1);
  await expect(results.getByRole('link')).toHaveAttribute(
    'href',
    '#/s/butane-demo/research/a/same-attempt',
  );
  await expect(results).toContainText('索引未完成');
  await expect(results).toContainText('最多显示 50 条');
  await scope.selectOption('all');
  await expect(results.getByRole('link')).toHaveCount(2);
  expect(
    await results
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  ).toEqual([
    '#/s/butane-demo/research/a/same-attempt',
    '#/s/ensemble-demo/research/a/same-attempt',
  ]);
  await page.screenshot({
    path: info.outputPath('method-search-all-studies-partial.png'),
  });
  await scope.selectOption('current');
  await expect(results.getByRole('link')).toHaveCount(1);
  expect(calls).toEqual(['butane-demo', null, 'butane-demo']);
  await page.setViewportSize({ width: 390, height: 844 });
  await fullyVisible(search, page);
  await fullyVisible(scope, page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('method-search-mobile.png') });
});

test('last Study survives reload; inaccessible storage falls back', async ({
  page,
}) => {
  await page.goto('/#/s/ensemble-demo');
  await expect(
    page.getByRole('heading', { name: 'ensemble-demo', exact: true }),
  ).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/#\/s\/ensemble-demo\/research\/progress$/);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw Error('unavailable');
    };
    Storage.prototype.setItem = () => {
      throw Error('unavailable');
    };
  });
  await page.goto('/');
  await expect(page).toHaveURL(/#\/s\/butane-demo\/research\/progress$/);
  await page.getByRole('button', { name: /Study ▾/ }).click();
  await expect(page.getByRole('dialog', { name: '切换 Study' })).toBeVisible();
});

test('all referenced CSS variables are defined', () => {
  const source = resolve('src');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : /\.(css|tsx)$/.test(e.name)
          ? [join(dir, e.name)]
          : [],
    );
  const files = walk(source),
    all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const defined = new Set(
    [...all.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
  );
  const missing = files.flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/var\((--[\w-]+)/g)]
      .filter((m) => !defined.has(m[1]))
      .map((m) => `${file.slice(source.length + 1)}: ${m[1]}`),
  );
  expect(missing).toEqual([]);
  expect(
    files
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => /<style\b|style=\{/.test(readFileSync(f, 'utf8'))),
  ).toEqual([]);
});

test('direct jobs entry can open the first Study without remembered state', async ({
  page,
}) => {
  await page.goto('/#/jobs');
  const nav = page.getByRole('navigation', { name: '顶部导航' });
  await expect(
    nav.getByRole('button', { name: '研究', exact: true }),
  ).toBeEnabled();
  await nav.getByRole('button', { name: '研究', exact: true }).click();
  await expect(page).toHaveURL(/#\/s\/butane-demo\/research\/progress$/);
  await expect(page.getByRole('region', { name: '还缺什么' })).toBeVisible();
});
