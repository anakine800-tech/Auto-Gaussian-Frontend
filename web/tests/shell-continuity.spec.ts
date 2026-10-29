import { openSection } from './disclosure';
import { test, expect } from '@playwright/test';

test('old entry routes and tabs resolve to the same files', async ({
  page,
}) => {
  for (const [old, canonical, heading] of [
    ['#server', '#/servers', '服务器'],
    ['#/butane-demo', '#/s/butane-demo/research/progress', '还缺什么'],
    [
      '#/butane-demo?tab=overview',
      '#/s/butane-demo/evidence/document?tab=overview',
      'study.md',
    ],
    [
      '#/butane-demo?tab=graph',
      '#/s/butane-demo/evidence/lineage?tab=graph',
      '来源关系',
    ],
    [
      '#/butane-demo?tab=attempts',
      '#/s/butane-demo/research/attempts?tab=attempts',
      'Attempt 表',
    ],
    [
      '#/butane-demo?tab=analyses',
      '#/s/butane-demo/results?tab=analyses',
      '报告',
    ],
    [
      '#/butane-demo/analyses/thermo-demo.json',
      '#/s/butane-demo/results/file/thermo-demo.json',
      'thermo-demo.json',
    ],
    [
      '#/s/butane-demo/files/analyses/thermo-demo.json',
      '#/s/butane-demo/evidence/library?file=analyses%2Fthermo-demo.json',
      'thermo-demo.json',
    ],
  ]) {
    await page.goto('/' + old);
    await expect.poll(() => new URL(page.url()).hash).toBe(canonical);
    await expect(
      page.getByRole('heading', { name: heading, exact: true }),
    ).toBeVisible();
  }
  await page.goto('/?tab=structures&keep=1#/butane-demo');
  await expect(page).toHaveURL(
    /\?tab=structures&keep=1#\/s\/butane-demo\/evidence\/library$/,
  );
  await expect(
    page.getByRole('heading', { name: '文件库', exact: true }),
  ).toBeVisible();
  await page.goto('/#/s/butane-demo/analysis/file/missing.json');
  await expect(page.getByRole('alert')).toContainText('missing.json');
});

test('exact legacy input and log links remain available without indexing their filenames', async ({
  page,
}) => {
  for (const [name, kind, label] of [
    ['butane.gjf', 'inputs', '输入文件'],
    ['butane.log', 'logs', '输出日志'],
  ]) {
    await page.goto(
      '/#/s/butane-demo/a/anti?' +
        new URLSearchParams({ fileKind: kind, file: name }),
    );
    await expect(page).toHaveURL(new RegExp(`fileKind=${kind}&file=`));
    await expect(
      page.getByRole('combobox', { name: label, exact: true }),
    ).toHaveValue(name);
  }
  await page.goto('/#/s/butane-demo/a/anti?fileKind=record&file=status.json');
  await expect(page.locator('#record-status\\.json')).toBeVisible();
});

test('return link restores legacy filters, candidate, sort and reading position after reload', async ({
  page,
  request,
}) => {
  const attempt = await (
    await request.get('/api/studies/butane-demo/attempts/anti')
  ).json();
  await page.route('**/api/studies/descriptor-demo/attempts/source-demo', (r) =>
    r.fulfill({
      json: { ...attempt, id: 'source-demo', logs: [], input_files: [] },
    }),
  );
  await page.route(
    '**/api/studies/descriptor-demo/ensembles/ensemble.json',
    async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.manifest.routes.forEach(
        (r: { attempts: string[] }) => (r.attempts = ['source-demo']),
      );
      await route.fulfill({ json: data });
    },
  );
  const params = new URLSearchParams({
    ensembleScope: '#/descriptor-demo/ensembles/ensemble.json',
    ensembleBin0: 'trans',
  });
  await page.goto(
    '/?' + params + '#/descriptor-demo/ensembles/ensemble.json?candidate=10',
  );
  const table = page.getByRole('table', { name: '构象能量表' }),
    filters = page.getByRole('region', { name: '局部构象筛选' });
  await expect(filters.getByLabel('trans', { exact: true })).toBeChecked();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await table.getByRole('button', { name: '编号', exact: false }).click();
  const first = await table
    .locator('tbody tr')
    .first()
    .getAttribute('data-candidate');
  const source = table.getByRole('link').first();
  await source.scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollTo(0, 250));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(250);
  const url = page.url(),
    y = await page.evaluate(() => scrollY);
  await source.click();
  await expect(page).toHaveURL(/\/a\//);
  await expect(page.getByRole('link', { name: '← 返回列表' })).toHaveAttribute(
    'href',
    url,
  );
  await page.reload();
  await page.getByRole('link', { name: '← 返回列表' }).click();
  await expect(page).toHaveURL(url);
  await expect(filters.getByLabel('trans', { exact: true })).toBeChecked();
  await expect(table.locator('tbody tr').first()).toHaveAttribute(
    'data-candidate',
    first!,
  );
  await expect(table.locator('tr[data-candidate="10"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(y, 0);
});

test('invalid precise file links fail before reading any Study file', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/studies')) requests.push(r.url());
  });
  for (const query of [
    'fileKind=logs&file=..%2Fsecret',
    'fileKind=record&file=other.json',
    'fileKind=inputs&file=input.gjf&file=other.gjf',
  ]) {
    await page.goto('/#/s/butane-demo/a/anti?' + query);
    await expect(page.getByRole('alert')).toContainText('无法打开链接');
  }
  expect(requests).toEqual([]);
});

test('job and overview return links retain their source and sort', async ({
  page,
}) => {
  await page.goto('/#/jobs');
  await page.getByRole('link', { name: 'opt-demo', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'opt-demo', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '← 返回列表' }).click();
  await expect(page).toHaveURL(/#\/servers$/);
  await page.goto('/#/s/butane-demo/attempts');
  const table = page.getByRole('table', { name: 'Attempt 结果表' });
  await table
    .getByRole('button', { name: '电子能 / Eh', exact: false })
    .click();
  await expect(table.locator('tbody tr').first()).toContainText('opt-demo');
  await table.getByRole('link', { name: 'opt-demo', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'opt-demo', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '← 返回列表' }).click();
  await expect(page).toHaveURL(
    /#\/s\/butane-demo\/research\/attempts\?sort=energy&order=asc$/,
  );
  await expect(table.locator('tbody tr').first()).toContainText('opt-demo');
});

for (const lateOutcome of ['success', 'error']) {
  test(`Study changes discard pending global-search ${lateOutcome} responses`, async ({
    page,
  }) => {
    // Deliberately ignore AbortSignal in this UI-only transport fixture so an old
    // request can settle after navigation. Aborting fetch alone cannot mask a
    // stale-response bug in the component.
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      const pending: {
        resolve: (response: Response) => void;
        study: string | null;
        query: string | null;
      }[] = [];
      window.fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          location.href,
        );
        if (url.pathname !== '/api/search') return originalFetch(input, init);
        return new Promise<Response>((resolve) =>
          pending.push({
            resolve,
            study: url.searchParams.get('study'),
            query: url.searchParams.get('q'),
          }),
        );
      };
      Object.assign(window, {
        syntheticSearch: {
          calls: () => pending.map(({ study, query }) => ({ study, query })),
          finish: (
            index: number,
            label: string,
            study: string,
            status = 200,
          ) => {
            const body =
              status === 200
                ? {
                    groups: [
                      {
                        study,
                        title: study,
                        hits: [
                          {
                            label,
                            detail: 'Synthetic Attempt',
                            href: `#/s/${study}/research/a/${label}`,
                          },
                        ],
                      },
                    ],
                    incomplete: false,
                    truncated: false,
                    message: null,
                  }
                : { detail: label };
            pending[index].resolve(
              new Response(JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json' },
              }),
            );
          },
        },
      });
    });
    await page.goto('/#/s/butane-demo/research/attempts');
    const search = page.getByRole('textbox', { name: '全局搜索' });
    const scope = page.getByRole('combobox', { name: '搜索范围' });
    const results = page.getByRole('region', { name: '搜索结果' });
    await search.fill('same-attempt');
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, 'syntheticSearch').calls()),
      )
      .toEqual([{ study: 'butane-demo', query: 'same-attempt' }]);
    await page.evaluate(() =>
      Reflect.get(window, 'syntheticSearch').finish(
        0,
        'previous-study-hit',
        'butane-demo',
      ),
    );
    await expect(results).toContainText('previous-study-hit');

    await scope.selectOption('all');
    await expect
      .poll(() =>
        page.evaluate(
          () => Reflect.get(window, 'syntheticSearch').calls().length,
        ),
      )
      .toBe(2);
    await expect(results).not.toContainText('previous-study-hit');
    await page.getByRole('button', { name: /Study ▾/ }).click();
    const switcher = page.getByRole('dialog', { name: '切换 Study' });
    await switcher
      .getByRole('option')
      .filter({ hasText: 'ensemble-demo' })
      .click();
    await expect(page).toHaveURL(/#\/s\/ensemble-demo\/research\/progress$/);
    await search.focus();
    await expect(scope).toHaveValue('current');
    await expect(results).not.toContainText('previous-study-hit');
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, 'syntheticSearch').calls()),
      )
      .toEqual([
        { study: 'butane-demo', query: 'same-attempt' },
        { study: null, query: 'same-attempt' },
        { study: 'ensemble-demo', query: 'same-attempt' },
      ]);
    await page.evaluate(() =>
      Reflect.get(window, 'syntheticSearch').finish(
        2,
        'current-study-hit',
        'ensemble-demo',
      ),
    );
    await expect(results).toContainText('current-study-hit');
    await page.evaluate(
      (outcome) =>
        Reflect.get(window, 'syntheticSearch').finish(
          1,
          'stale-global-response',
          'butane-demo',
          outcome === 'error' ? 500 : 200,
        ),
      lateOutcome,
    );
    // A second evaluation runs after the deliberately late fetch's microtasks.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expect(results).toContainText('current-study-hit');
    await expect(results).not.toContainText('stale-global-response');
    await expect(results.getByRole('alert')).toHaveCount(0);
    await expect(results.getByRole('link')).toHaveAttribute(
      'href',
      '#/s/ensemble-demo/research/a/current-study-hit',
    );
  });
}
