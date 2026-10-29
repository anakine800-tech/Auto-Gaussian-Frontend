import { endpoint, get, object } from './api';
import type { Attempt } from './api';
import { isGeometry } from './molecule-viewer';

// T82: ag/_profile_sources.py protocol(), SCF_ENERGY_METHODS and
// NON_SCF_METHOD_PREFIXES. Job keywords do not change an electronic protocol.
const scfMethods = new Set(
  `hf lsda svwn svwn5 slyp blyp bp86 bpw91 bpe bpbe g96lyp g96p86 g96pw91 pw91lyp pw91p86 pw91pw91 mpwlyp mpwpw91 mpwpbe pbe pbe0 pbepbe pbe1pbe b3lyp b3lyp5 b3p86 b3pw91 b1b95 b1lyp b1pw91 b98 b971 b972 b97d b97d3 mpw1pw91 mpw1lyp mpw1pbe mpw3pbe mpw3lyp mpw1b95 mpwlyp1m o3lyp olyp opbe x3lyp cam-b3lyp lc-wpbe wb97 wb97x wb97xd m05 m052x m06 m06l m062x m06hf m08hx m08so m11 m11l mn12l mn12sx mn15 mn15l tpsstpss tpssh revtpss revtpssh vsxc hcth93 hcth147 hcth407 thcth thcthhyb sogga11 sogga11x n12 n12sx hseh1pbe hse1pbe hse2pbe ohse1pbe ohse2pbe`
    .split(' ')
    .map((s) => s.replaceAll('-', '')),
);
export const HARTREE_TO_KCAL = 627.5094740631;
export function spinTreatmentOf(method: string) {
  const lower = method.toLowerCase();
  const prefix = scfMethods.has(lower.replaceAll('-', ''))
    ? undefined
    : ['ro', 'r', 'u'].find(
        (p) =>
          lower.startsWith(p) &&
          scfMethods.has(lower.slice(p.length).replaceAll('-', '')),
      );
  return prefix?.toUpperCase() ?? '未显式指定';
}
function thermodynamicSetting(route: string, key: 'temperature' | 'pressure') {
  const normalized = route.toLowerCase().replace(/\s*=\s*/g, '=');
  const matches = [
    ...normalized.matchAll(new RegExp(`\\b${key}\\b(?:=([^\\s]+))?`, 'g')),
  ];
  if (!matches.length) return key === 'temperature' ? '298.15' : '1';
  const raw = matches[0][1] ?? '',
    value = Number(raw.replace(/d/i, 'e'));
  if (
    matches.length !== 1 ||
    !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[ed][+-]?\d+)?$/i.test(raw) ||
    !Number.isFinite(value) ||
    value <= 0
  )
    throw Error(`Freq ${key === 'temperature' ? '温度' : '压力'}无法识别`);
  return String(value);
}
export const thermoKeys = ['Freq 温度', 'Freq 压力'];
const nonScf =
  'mp2 mp3 mp4 mp5 cc qcisd cbs g1 g2 g3 g4 b2 mpw2 dsd dod revdsd revdod pbe0dh pbeqidh pwpb95 xyg wb97x2 oniom am1 pm3 pm6 pm7 pddg mndo cndo indo zindo dftb uff dreiding amber cis eom bd cas sac td'.split(
    ' ',
  );
const variants = (method: string) => {
  const s = method.replaceAll('-', '');
  return [
    s,
    ...['ro', 'r', 'u']
      .filter((p) => s.startsWith(p))
      .map((p) => s.slice(p.length)),
  ];
};
const requireValue = (condition: boolean, message: string) => {
  if (!condition) throw Error(message);
};
function protocol(
  value: unknown,
  multiplicity: number,
): { spec: Record<string, string>; methodLabel: string } {
  requireValue(
    typeof value === 'string' && Boolean(value.trim()),
    '缺少 facts.route',
  );
  const originalRoute = (value as string)
      .replace(/\s*([=,/])\s*/g, '$1')
      .replace(/\(\s*/g, '(')
      .replace(/\s*\)/g, ')'),
    route = originalRoute.toLowerCase();
  const tokens = [
    ...route.matchAll(/(?<!\S)([a-z][a-z0-9-]*)(?=[\s/(=]|$)/g),
  ].map((m) => m[1]);
  requireValue(
    !tokens.some((t) =>
      variants(t).some((v) => nonScf.some((p) => v.startsWith(p))),
    ),
    'T82 不支持的非 SCF 方法',
  );
  const pairs = [...route.matchAll(/(?<!\S)([a-z0-9+_()\-]+)\/([^\s]+)/g)];
  requireValue(pairs.length === 1, '需要唯一、明确的方法 / 基组');
  const [, method, basis] = pairs[0];
  requireValue(
    !variants(method).some((v) => nonScf.some((p) => v.startsWith(p))) &&
      variants(method).some((v) => scfMethods.has(v)),
    'T82 不支持或不认识的 SCF 方法',
  );
  // T99 normalized_method(): match the complete base before adding R/U, so
  // revTPSS is not split. Hyphens are ignored only for supported-set lookup.
  const normalized = scfMethods.has(method.replaceAll('-', ''))
    ? (multiplicity === 1 ? 'r' : 'u') + method
    : method;
  const rawMethod = originalRoute.slice(
    pairs[0].index,
    pairs[0].index! + method.length,
  );
  const methodLabel =
    rawMethod +
    (normalized !== method
      ? `（按${multiplicity === 1 ? '单重态' : `多重度 ${multiplicity}`}视为 ${normalized.toUpperCase()}）`
      : '');
  requireValue(
    !['gen', 'genecp', 'chkbasis'].includes(basis) &&
      !['extrabasis', 'pseudo', 'iop'].some((s) => route.includes(s)),
    '不支持自定义基组 / ECP / IOp',
  );
  const dispersion = [
    ...route.matchAll(/\b(?:empiricaldispersion|em)=(\([^)]*\)|[^\s]+)/g),
  ];
  requireValue(dispersion.length <= 1, '色散设置有歧义');
  let model = 'none',
    solvent = 'none';
  const scrf = [...route.matchAll(/\bscrf(?:=)?(\([^)]*\)|[^\s]*)/g)];
  requireValue(scrf.length <= 1, '溶剂设置有歧义');
  if (scrf.length) {
    const options = scrf[0][1].replace(/^\(+|\)+$/g, '').split(','),
      models = options.filter((x) =>
        ['smd', 'pcm', 'iefpcm', 'cpcm', 'dipole', 'ipcm', 'scipcm'].includes(
          x,
        ),
      ),
      solvents = options
        .filter((x) => x.startsWith('solvent='))
        .map((x) => x.split('=')[1]);
    requireValue(
      models.length === 1 && solvents.length === 1 && options.length === 2,
      '溶剂需要明确模型和溶剂名称，不支持自定义 / Read',
    );
    model = models[0];
    solvent = solvents[0];
  }
  const types = [...route.matchAll(/(?<!\S)(5d|6d|7f|10f)(?!\S)/g)].map(
    (m) => m[1],
  );
  requireValue(
    !(
      (types.includes('5d') && types.includes('6d')) ||
      (types.includes('7f') && types.includes('10f'))
    ),
    '基函数形式冲突',
  );
  return {
    spec: {
      方法: normalized,
      基组: basis,
      色散: dispersion[0]?.[1] ?? 'method_default',
      溶剂模型: model,
      溶剂: solvent,
      基函数形式:
        ['5d', '6d', '7f', '10f']
          .filter((x) => types.includes(x))
          .map((x) => x.toUpperCase())
          .join(' ') || 'basis_default',
    },
    methodLabel,
  };
}
const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const record = (v: unknown) => (object(v) ? v : {});
export type ComparisonRow = {
  id: string;
  termination: string | null;
  nImag: number | null;
  electronic: number | null;
  free: number | null;
  relativeElectronic: number | null;
  relativeFree: number | null;
};
export type Comparison = {
  differences: string[];
  rows: ComparisonRow[];
  protocol: Record<string, string>;
  methodLabel: string;
};
export function compareAttempts(
  attempts: Pick<Attempt, 'id' | 'facts' | 'geometry'>[],
): Comparison {
  const differences: string[] = [],
    specifications: Record<string, string>[] = [],
    methodLabels: string[] = [];
  const rows: ComparisonRow[] = attempts.map((a) => {
    const f = record(a.facts.data),
      e = record(f.energies);
    try {
      requireValue(f.program === 'gaussian', '需要明确的 Gaussian 程序记录');
      requireValue(
        Number.isInteger(f.multiplicity) && Number(f.multiplicity) > 0,
        '缺少正整数多重度',
      );
      const { spec, methodLabel } = protocol(f.route, Number(f.multiplicity));
      requireValue(
        typeof f.program_version === 'string' &&
          Boolean(f.program_version.trim()),
        '缺少程序版本',
      );
      spec.程序版本 = String(f.program_version);
      requireValue(Number.isInteger(f.charge), '缺少整数电荷');
      spec.电荷 = String(f.charge);
      spec.多重度 = String(f.multiplicity);
      const geometry = a.geometry.data;
      requireValue(isGeometry(geometry), '缺少有效最终几何，无法核对元素组成');
      if (isGeometry(geometry)) {
        requireValue(
          geometry.atoms.length === f.n_atoms,
          '最终几何原子数与 facts 不符',
        );
        const counts: Record<number, number> = {};
        for (const atom of geometry.atoms)
          counts[atom.atomic_number] = (counts[atom.atomic_number] ?? 0) + 1;
        spec.元素组成 = Object.entries(counts)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([n, count]) => `Z${n}×${count}`)
          .join(' ');
      }
      requireValue(
        record(f.units).energy === 'Hartree',
        '能量单位必须明确为 Hartree',
      );
      specifications.push(spec);
      methodLabels.push(methodLabel);
    } catch (error) {
      differences.push(`${a.id}：${(error as Error).message}`);
      specifications.push({});
    }
    return {
      id: a.id,
      termination:
        typeof f.termination === 'string' && f.termination.trim()
          ? f.termination
          : null,
      nImag:
        typeof f.n_imag === 'number' &&
        Number.isSafeInteger(f.n_imag) &&
        f.n_imag >= 0
          ? f.n_imag
          : null,
      electronic: finite(e.scf),
      free: finite(e.g),
      relativeElectronic: null,
      relativeFree: null,
    };
  });
  if (attempts.length < 2) differences.push('至少选择两个 Attempt');
  if (!differences.length) {
    for (const key of Object.keys(specifications[0]))
      if (new Set(specifications.map((s) => s[key])).size > 1)
        differences.push(
          `${key}不同：${attempts.map((a, i) => `${a.id} = ${key === '方法' ? methodLabels[i] : specifications[i][key]}`).join('；')}`,
        );
  }
  if (!differences.length)
    for (const [source, target] of [
      ['electronic', 'relativeElectronic'],
      ['free', 'relativeFree'],
    ] as const) {
      const values = rows
          .map((r) => r[source])
          .filter((v): v is number => v !== null),
        minimum = values.length ? Math.min(...values) : null;
      for (const row of rows)
        row[target] =
          row[source] === null || minimum === null
            ? null
            : (row[source] - minimum) * HARTREE_TO_KCAL;
    }
  if (
    rows.some((r) =>
      [r.relativeElectronic, r.relativeFree].some(
        (v) => v !== null && !Number.isFinite(v),
      ),
    )
  ) {
    differences.push('能量差超出有限数值范围');
    for (const row of rows) {
      row.relativeElectronic = null;
      row.relativeFree = null;
    }
  }
  return {
    differences,
    rows,
    protocol: specifications[0] ?? {},
    methodLabel: methodLabels[0] ?? '—',
  };
}

// The unified page reuses the exact T82 parser above. Legacy comparisons stay
// strict; only the explicitly requested cross-multiplicity state gap is new.
export type CompareSource = Pick<Attempt, 'id' | 'facts' | 'geometry'>;
// A load owns its sources: one request/JSON parse per actual Attempt, shared
// across adopted layers and the structure viewer. Refreshes create a new load.
export async function loadComparisonSources(
  study: string,
  ids: string[],
  signal: AbortSignal,
): Promise<Record<string, CompareSource>> {
  const loaded = await Promise.all(
    [...new Set(ids)].map(async (id) => {
      let source: CompareSource;
      try {
        source = await get<CompareSource>(
          endpoint(study, 'attempts', id, 'comparison-structure'),
          signal,
        );
        source = {
          ...source,
          id,
          facts: source.facts.error
            ? { ...source.facts, data: null }
            : source.facts,
          geometry: source.geometry.error
            ? { ...source.geometry, data: null }
            : source.geometry,
        };
      } catch (error) {
        if (signal.aborted) throw error;
        const message = (error as Error).message;
        source = {
          id,
          facts: { data: null, error: message },
          geometry: { data: null, error: message },
        };
      }
      return [id, source] as const;
    }),
  );
  return Object.fromEntries(loaded);
}

export const protocolKeys = [
  '方法',
  '基组',
  '色散',
  '溶剂模型',
  '溶剂',
  '基函数形式',
  '程序版本',
  '元素组成',
  '电荷',
  '多重度',
];
export function inspectProtocol(
  a: CompareSource | undefined,
  thermodynamics = false,
) {
  const spec: Record<string, string> = {},
    errors: string[] = [];
  if (!a) return { spec, errors: ['未采用此层或来源 Attempt 缺失'] };
  const f = record(a.facts.data);
  if (a.facts.error) errors.push('facts 无法读取');
  if (f.program !== 'gaussian') errors.push('需要明确的 Gaussian 程序记录');
  if (!Number.isInteger(f.multiplicity) || Number(f.multiplicity) < 1)
    errors.push('缺少正整数多重度');
  else spec.多重度 = String(f.multiplicity);
  try {
    Object.assign(spec, protocol(f.route, Number(f.multiplicity)).spec);
  } catch (e) {
    errors.push((e as Error).message);
  }
  if (typeof f.program_version === 'string' && f.program_version.trim())
    spec.程序版本 = f.program_version;
  else errors.push('缺少程序版本');
  if (Number.isInteger(f.charge)) spec.电荷 = String(f.charge);
  else errors.push('缺少整数电荷');
  if (thermodynamics)
    for (const [key, name] of [
      ['temperature', 'Freq 温度'],
      ['pressure', 'Freq 压力'],
    ] as const) {
      try {
        spec[name] = thermodynamicSetting(String(f.route ?? ''), key);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  const geometry = a.geometry.data;
  if (
    !a.geometry.error &&
    isGeometry(geometry) &&
    geometry.atoms.length === f.n_atoms
  ) {
    const counts: Record<number, number> = {};
    for (const atom of geometry.atoms)
      counts[atom.atomic_number] = (counts[atom.atomic_number] ?? 0) + 1;
    spec.元素组成 = Object.entries(counts)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([n, count]) => `Z${n}×${count}`)
      .join(' ');
  } else errors.push('缺少有效最终几何或原子数与 facts 不符');
  if (record(f.units).energy !== 'Hartree')
    errors.push('能量单位必须明确为 Hartree');
  return { spec, errors };
}
export function protocolDifference(
  a: CompareSource | undefined,
  b: CompareSource | undefined,
  identityOnly = false,
  thermodynamics = false,
) {
  const left = inspectProtocol(a, thermodynamics),
    right = inspectProtocol(b, thermodynamics),
    stateGap = left.spec.多重度 !== right.spec.多重度;
  const keys = identityOnly
    ? ['元素组成', '电荷', '多重度']
    : [...protocolKeys, ...(thermodynamics ? thermoKeys : [])];
  const base = (method: string) =>
    scfMethods.has(method.replaceAll('-', ''))
      ? method
      : (['ro', 'r', 'u']
          .filter((p) => method.startsWith(p))
          .map((p) => method.slice(p.length))
          .find((v) => scfMethods.has(v.replaceAll('-', ''))) ?? method);
  const differences = keys.filter((k) => {
    if (!left.spec[k] || !right.spec[k]) return true;
    if (!identityOnly && k === '多重度') return false;
    // R/U changes implied by different multiplicities are an electronic state
    // difference, not permission to compare different underlying functionals.
    if (!identityOnly && stateGap && k === '方法')
      return base(left.spec[k]) !== base(right.spec[k]);
    return left.spec[k] !== right.spec[k];
  });
  return {
    reason: [
      ...new Set([
        ...left.errors,
        ...right.errors,
        ...differences.map((k) => `${k}不同或缺失`),
      ]),
    ].join('；'),
    stateGap,
  };
}
export type EvidenceCatalog = {
  state: unknown;
  journal_ok: boolean;
  warning: string | null;
};
export type ComparedObject = {
  id: string;
  name: string;
  status: string;
  registered: boolean;
  members: string[];
  adopted: Partial<Record<'opt' | 'freq' | 'sp', string>>;
  values: Record<string, unknown>;
};
export function comparisonObjects(
  catalog: EvidenceCatalog | undefined,
): ComparedObject[] {
  const state = record(catalog?.state);
  if (
    !catalog?.journal_ok ||
    state.schema !== 'ag-catalog-state/1' ||
    !Array.isArray(state.objects)
  )
    return [];
  return state.objects.filter(object).map((o) => ({
    id: String(o.id),
    name: typeof o.name === 'string' ? o.name : String(o.id),
    status: String(o.status),
    registered: true,
    members: Array.isArray(o.members)
      ? o.members.filter(object).map((m) => String(m.attempt))
      : [],
    adopted: Object.fromEntries(
      ['opt', 'freq', 'sp'].flatMap((role) => {
        const ref = record(record(o.adopted)[role]);
        return typeof ref.attempt === 'string' ? [[role, ref.attempt]] : [];
      }),
    ),
    values: record(o.values),
  }));
}
export type CompareEntry = {
  id: string;
  label: string;
  object: ComparedObject | null;
  error: string;
  layers: Partial<Record<'opt' | 'freq' | 'sp', CompareSource>>;
};
function ownLayers(source: CompareSource | undefined): CompareEntry['layers'] {
  if (!source) return {};
  const route = String(record(source.facts.data).route ?? '');
  const jobs = new Set(
    [...route.matchAll(/(?:^|[\s#])(opt|freq|stable|irc|scan|sp)\b/gi)].map(
      (m) => m[1].toLowerCase(),
    ),
  );
  const layers: CompareEntry['layers'] = {};
  if (jobs.has('opt')) layers.opt = source;
  if (jobs.has('freq')) layers.freq = source;
  if (!jobs.size || (jobs.size === 1 && jobs.has('sp'))) layers.sp = source;
  return layers;
}
export function comparisonEntries(
  ids: string[],
  objects: ComparedObject[],
  sources: Record<string, CompareSource>,
): CompareEntry[] {
  return ids.map((id) => {
    const matches = objects.filter(
        (o) => o.members.includes(id) || Object.values(o.adopted).includes(id),
      ),
      obj = matches.length === 1 ? matches[0] : null;
    return {
      id,
      label: obj ? `${obj.name} · ${id}` : id,
      object: obj,
      error:
        matches.length > 1
          ? 'Attempt 属于多个登记对象，无法确定采用来源'
          : obj && obj.status !== 'adopted'
            ? '对象未采用或已退役'
            : '',
      layers:
        matches.length > 1
          ? {}
          : obj
            ? Object.fromEntries(
                Object.entries(obj.adopted).map(([role, source]) => [
                  role,
                  sources[source],
                ]),
              )
            : ownLayers(sources[id]),
    };
  });
}
export const energyMetrics = [
  ['opt', 'Opt 层 E'],
  ['sp', 'SP 层 E'],
  ['zpe', 'ZPE'],
  ['zero', 'E+ZPE（近似 0–0）'],
  ['g', 'G'],
] as const;
export type EnergyMetric = (typeof energyMetrics)[number][0];
export function comparisonValue(
  entry: CompareEntry,
  metric: EnergyMetric,
): number | null {
  if (entry.error) return null;
  if (entry.object) {
    if (entry.object.status !== 'adopted') return null;
    const needed =
      metric === 'opt'
        ? ['opt']
        : metric === 'sp'
          ? ['sp']
          : metric === 'zpe'
            ? ['freq']
            : ['sp', 'freq'];
    if (
      needed.some(
        (role) => !entry.object!.adopted[role as 'opt' | 'freq' | 'sp'],
      )
    )
      return null;
  }
  const energy = (role: 'opt' | 'freq' | 'sp', key: string) =>
    finite(record(record(entry.layers[role]?.facts.data).energies)[key]);
  const adopted = entry.object?.values;
  const sp = adopted ? finite(adopted.scf_h) : energy('sp', 'scf'),
    zpe = adopted ? finite(adopted.zpe_h) : energy('freq', 'zpe'),
    g = adopted ? finite(adopted.g_h) : energy('freq', 'g'),
    freq = adopted ? finite(adopted.freq_scf_h) : energy('freq', 'scf');
  if (metric === 'opt') return energy('opt', 'scf');
  if (metric === 'sp') return sp;
  if (metric === 'zpe') return zpe;
  if (metric === 'zero')
    return sp === null || zpe === null ? null : finite(sp + zpe);
  return sp === null || g === null || freq === null
    ? null
    : finite(sp + (g - freq));
}
export function comparisonEnergy(
  entry: CompareEntry,
  reference: CompareEntry,
  metric: EnergyMetric,
) {
  const roles: ('opt' | 'freq' | 'sp')[] =
    metric === 'opt'
      ? ['opt']
      : metric === 'sp'
        ? ['sp']
        : metric === 'zpe'
          ? ['freq']
          : ['sp', 'freq'];
  const checks = roles.map((role) => {
    const check = protocolDifference(
      entry.layers[role],
      reference.layers[role],
      false,
      metric === 'g' && role === 'freq',
    );
    return {
      ...check,
      reason: check.reason
        .split('；')
        .filter(Boolean)
        .map((reason) =>
          reason.startsWith('Freq ')
            ? reason
            : `${role === 'freq' ? 'Freq' : role.toUpperCase()} ${reason}`,
        )
        .join('；'),
    };
  });
  if (roles.length > 1)
    for (const e of [entry, reference])
      checks.push(protocolDifference(e.layers.sp, e.layers.freq, true));
  const value = comparisonValue(entry, metric),
    ref = comparisonValue(reference, metric);
  const reason = [
    entry.error,
    reference.error && `参照项：${reference.error}`,
    ...checks.map((c) => c.reason),
    value === null ? '所需能量缺失' : '',
    ref === null ? '参照项所需能量缺失' : '',
  ]
    .filter(Boolean)
    .join('；');
  const delta =
    value !== null && ref !== null ? (value - ref) * HARTREE_TO_KCAL : null;
  const finalReason =
    reason ||
    (delta !== null && !Number.isFinite(delta) ? '能量差超出有限数值范围' : '');
  return {
    value: finalReason ? null : value,
    delta: finalReason ? null : delta,
    reason: finalReason,
    stateGap: !finalReason && checks.some((c) => c.stateGap),
  };
}
