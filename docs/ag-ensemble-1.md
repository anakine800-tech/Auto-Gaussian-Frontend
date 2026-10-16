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
