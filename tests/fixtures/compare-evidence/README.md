# T122 合成截图

仅使用合成水结构、虚构能量及临时 study；不代表真实计算、研究结果或科学验收。

| 页面 | 1440 px | 1280 px | 390 px |
| --- | --- | --- | --- |
| 比较 | [截图](t122-compare-1440.png) | [截图](t122-compare-1280.png) | [截图](t122-compare-390.png) |
| 证据库 | [截图](t122-evidence-1440.png) | [截图](t122-evidence-1280.png) | [截图](t122-evidence-390.png) |
| 来源关系 | [截图](t122-lineage-1440.png) | — | — |

生成用例为 `web/tests/compare-page.spec.ts` 与 `web/tests/evidence.spec.ts`。
在 web 目录运行生产构建及这两份 Playwright 用例，再从 test-results 取同名 PNG。
用例核对窄屏页面无横向滚动；宽表在自身容器中滚动。
