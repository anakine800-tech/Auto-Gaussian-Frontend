# ag-ensemble/1

来源：T53-ensemble-manifest.md 附录 A（T54 开发附件，2026-10-16 版本）。
当前按附录开发；T53 合并实现及生成的合成分子清单仍需交叉验证。

## 附录 A：`ag-ensemble/1` 格式（T53 与 T54 共用）

```json
{
  "schema": "ag-ensemble/1",
  "created_at": "UTC ISO 时间",
  "ag": { "...": "facts.ag_provenance() 的输出" },
  "study_id": "string",
  "label": "string 或 null",
  "inputs": {
    "merged": { "path": "analyses/<group>/<name>.json", "sha256": "hex" },
    "xyz":    { "path": "analyses/<group>/<name>.xyz",  "sha256": "hex", "file": "<name>.xyz" },
    "thermo": { "path": "analyses/....json", "sha256": "hex" }
  },
  "charge": 0,
  "hydrogens": "heavy | polar | all",
  "energy_basis": "shared_hartree | per_source_not_comparable",
  "units": { "energy": "Hartree", "relative": "kcal/mol", "population": "fraction" },
  "routes": [ { "label": "string", "attempts": ["attempt_id", "..."] } ],
  "references": { "xtb": 1, "sp": 3, "opt": null },
  "warnings": ["string"],
  "candidates": [
    {
      "candidate": 1,
      "xyz_frame": 1,
      "geometry_sha256": "hex",
      "sources": ["route label", "..."],
      "route_members": [ { "route": "label", "member": 4, "relative_kcal_within_route": 0.12 } ],
      "xtb_relative_kcal": 0.0,
      "sp":  { "attempts": ["id"], "ambiguous": false, "energy_hartree": -1.0, "relative_kcal": 0.0 },
      "opt": { "attempts": ["id"], "ambiguous": false, "termination": "normal", "n_imaginary": 0,
               "energy_hartree": -1.0, "relative_kcal": 0.0 },
      "thermo": { "attempt": "id", "qh_G": -1.0, "relative_G_kcal": 0.0, "population": 0.42 },
      "missing": ["opt_freq", "thermo"],
      "notes": ["string"]
    }
  ],
  "unmatched_attempts": [ { "layer": "sp | opt | thermo", "attempt": "id", "reason": "string" } ]
}
```

- 某层没有对应的 Attempt 时，该键为 `null`，同时出现在 `missing` 里。
- `ambiguous: true` 时，`energy_hartree` 和 `relative_kcal` 为 `null`。
- `xyz.file` 只是文件名，与清单在同一目录；前端只按这个文件名读，并核对 `xyz.sha256` 和每帧的 `geometry_sha256`。
- 数值只有有限浮点数，没有 NaN；未知值用 `null`。

## 可选局部构象描述（T70）

仅在显式传入至少一个 `--dihedral-bins` 或 `--report-distance` 时，增加顶层
`descriptors`、`bin_summary` 及每个候选的 `local`；schema 仍为 `ag-ensemble/1`，
已有字段不变。不传时不增加这些字段，JSON 与 Markdown 保持原有输出
（对比字节时固定生成时间、ag 版本来源及输入证据）。不会自动沿用 merged 中的描述符。

```json
{
  "descriptors": {
    "dihedral_bins": [{"atoms": [1, 2, 3, 4], "boundaries": [-90, 90], "names": ["cis", "trans"]}],
    "distance_pairs": [[5, 14]]
  },
  "bin_summary": [{"bins": ["cis"], "count": 3, "lowest_candidate": 1, "lowest_layer": "sp"}],
  "candidates": [{"candidate": 1, "local": {
    "dihedrals": [12.3], "bins": ["cis"], "near_boundary": false, "distances": [1.587]
  }}]
}
```

以上为新增字段片段，候选仍保留前述全部原有字段。

- 两个参数均可重复，语法、校验及定义内容复用 `ag dedup`。编号按候选
  `xyz_frame` 对应的 XYZ 帧，从 1 开始；不会改编号或使用 Opt 后的几何替代。
  `descriptors` 只包含 `dihedral_bins` 与 `distance_pairs`，不提供接触指纹参数或字段。
- `local.dihedrals` 为有符号度数，范围 `[−180,180)`；`local.distances` 为 Å，
  两者各自按命令行定义顺序排列。`local.bins` 是相应的**组名字符串**，
  与 dedup 的从 1 开始的组号不同；省略组名时沿用 `bin1`、`bin2` 等。
  第 1 组为 `[b1,b2)`，最后一组跨周期回到第一个分界；恰在分界时归入从该分界开始的组。
- `near_boundary` 为布尔值，任一二面角到任一分界的周期差严格小于 5° 时为 true，
  只供审阅，不改变组名。未请求的数组为空；仅报告距离时为 false。
- `bin_summary` 按分组组合首次出现的顺序排列，`count` 包括该组合的全部候选。
  每组按 thermo → opt → sp → xtb 查找首个有非空可用能量的层级，
  仅在该层有能量的候选中取最低值，不跨层比较，也不要求全组都有该层。
  分别使用 `qh_G`、唯一匹配的 Opt/SP `energy_hartree`、`xtb_relative_kcal`；
  ambiguous 层不参与，路线不可比较时 xTB 不参与。Opt 沿用原有收录语义，
  不以正常结束或零虚频过滤，因此此汇总不代表科学验收。
  等能时取最小 `candidate` 编号（不是 XYZ 帧号）。
  无任何可用能量时 `lowest_candidate` 与 `lowest_layer` 均为 null。
- 仅报告距离时，所有候选归为一个 `bins: []` 组合。不会按分组合并、删除或重新排序候选。
- Markdown 候选表相应增加“分组”“近边界”“距离（Å）”列，并追加分组汇总表。
  数组的顺序与 JSON 定义一致。越界编号、共线等无法定义的二面角会报告具体帧与定义，
  不发布部分清单；参数格式错误沿用 dedup 的诊断文本。

## 前端显示（T71）

以上定义同步自后端 T70（PR #285，提交 `60cd949`；合并后的输出复测待完成）。
前端只读取已有值，不重新计算角度、距离、分组、最低能候选或汇总。
二面角列显示组名、悬停显示保存的角度；距离以 Å 保留三位小数；近边界显示标记。
每个二面角可多选分组：同一二面角内取并集，不同二面角之间取交集，空选择表示不限。
“只看近边界”进一步筛选；能量表和缩略图共同使用筛选结果。

筛选写入 URL 的 `#` 前查询参数：`ensembleScope` 为集合路由，
`ensembleBin0`、`ensembleBin1` 等可重复，`ensembleNearBoundary=1` 启用近边界筛选。
参数按集合隔离，重载及浏览器前进/后退恢复；候选编号仍在 `#` 后的 `candidate` 中。
分组汇总始终显示完整清单的保存值；点击最低能候选会清除局部筛选并选中对应候选。
`lowest_candidate` 为 null 时显示“未提供”。不据此判断科学验收。

没有新增字段时保留原页面。新增字段存在时校验对象类型、有限数、数组长度、
原子编号形式、定义的组名以及汇总候选所属分组。`bin_summary` 可独立省略。
不合规时，API 在返回副本中移除 `descriptors`、`bin_summary` 与各候选 `local`，
并给出 `descriptor_error`；页面显示具体字段原因，原有值与已核验的几何继续可读。
非有限数只在这些可选字段中隔离；原有字段、XYZ 哈希及路径验证保持原来的拒绝行为。
不会修复或写回源清单。
