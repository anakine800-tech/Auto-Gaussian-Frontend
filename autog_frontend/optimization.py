"""Display-only Gaussian optimization parsing; no scientific acceptance.

Adapted from 83184af:autog_frontend/calculation_analysis.py (numeric,
orientation and convergence-table parsing only). No legacy query dependency.
Cycle-local geometry prevents a missing/truncated block reusing old coordinates;
job boundaries and optimization completion prevent joining Link1/frequency work.
"""
import math
import re

NUM = r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[DEde][+-]?\d+)?'
LABELS = ('Maximum Force', 'RMS Force', 'Maximum Displacement', 'RMS Displacement')


def number(value):
    result = float(value.replace('D', 'E').replace('d', 'e'))
    if not math.isfinite(result):
        raise ValueError('Non-finite optimization number')
    return result


def orientation(lines, start):
    separators = [i for i in range(start+1, min(start+8, len(lines)))
                  if re.fullmatch(r'\s*-{5,}\s*', lines[i])]
    if len(separators) < 2:
        return None
    atoms = []
    for line in lines[separators[1]+1:separators[1]+2003]:
        if re.fullmatch(r'\s*-{5,}\s*', line):
            return dict(atoms=atoms, units='angstrom', orientation_kind=lines[start].strip()) if atoms else None
        m = re.fullmatch(r'\s*(\d+)\s+(\d+)\s+[-+]?\d+\s+('+NUM+r')\s+('+NUM+r')\s+('+NUM+r')\s*', line)
        if not m or len(atoms) >= 2000 or int(m[1]) != len(atoms)+1 or not 1 <= int(m[2]) <= 118:
            return None
        coords = [number(m[i]) for i in (3, 4, 5)]
        if any(abs(v) >= 1e8 for v in coords):
            return None
        atoms.append(dict(center=int(m[1]), atomic_number=int(m[2]), **dict(zip(('x', 'y', 'z'), coords))))
    return None


def parse_optimization(raw, name):
    if len(raw) > 32*1024*1024:
        raise ValueError('日志超过 32 MB')
    lines = raw.decode('utf-8').splitlines()
    segments = []
    current = None
    geometries, energy, printed_step, energy_line = {}, None, None, None
    stopped, is_opt = False, False

    def segment(reason):
        return dict(index=len(segments)+1, reason=reason, route=None, steps=[], termination='incomplete', optimization='incomplete')

    def save(metrics):
        nonlocal geometries, energy, printed_step, energy_line
        if energy is not None and not stopped and (metrics or is_opt or printed_step is not None):
            current['steps'].append(dict(index=len(current['steps'])+1, printed_step=printed_step,
                scf_hartree=energy, metrics=metrics, geometry=geometries.get('Standard') or geometries.get('Input'), line=energy_line))
        geometries, energy, printed_step, energy_line = {}, None, None, None

    for i, line in enumerate(lines):
        boundary = re.search(r'Entering Gaussian System|Proceeding to internal job step|^\s*--Link1--|^\s*Entering Link 1\s*=', line)
        if boundary:
            if current is not None:
                save([])
            current = None
            geometries, energy, printed_step, energy_line = {}, None, None, None
            stopped, is_opt = False, False
        if current is None:
            current = segment('job-boundary' if boundary else 'log-start')
            segments.append(current)
        if line.lstrip().startswith('#'):
            route = [line.strip()]
            for following in lines[i+1:i+30]:
                if not following.strip() or re.fullmatch(r'\s*-{5,}\s*', following):
                    break
                route.append(following.strip())
            current['route'] = ' '.join(route)
            is_opt = bool(re.search(r'\bopt\b', current['route'], re.I))
        step = re.search(r'Step number\s+(\d+)\s+out of', line)
        if step and not stopped:
            printed_step = int(step[1])
            if current['steps'] and current['steps'][-1]['printed_step'] is not None and printed_step <= current['steps'][-1]['printed_step']:
                # Preserve this cycle, but never connect a restarted curve.
                current = segment('step-number-restart')
                segments.append(current)
            is_opt = True
        orient = re.fullmatch(r'\s*(Standard|Input) orientation:\s*', line)
        if orient and not stopped:
            geometries[orient[1]] = orientation(lines, i)
        if 'SCF Done:' in line and not stopped:
            scf = re.search(r'SCF Done:\s+E\([^)]+\)\s*=\s*('+NUM+r')\s+A\.U\.', line)
            energy = number(scf[1]) if scf else None
            energy_line = i+1
        if re.fullmatch(r'\s*Item\s+Value\s+Threshold\s+Converged\?\s*', line) and not stopped:
            metrics = []
            for n, label in enumerate(LABELS, 1):
                m = re.fullmatch(r'\s*'+r'\s+'.join(label.split())+r'\s+('+NUM+r')\s+('+NUM+r')\s+(YES|NO)\s*', lines[i+n]) if i+n < len(lines) else None
                if m:
                    metrics.append(dict(label=label, value=number(m[1]), threshold=number(m[2]), result=m[3]))
            is_opt = True
            save(metrics)
        if re.search(r'Optimization completed|Stationary point found|Optimization stopped|Harmonic frequencies|Frequencies\s+--|Full mass-weighted force constant matrix', line):
            save([])
            stopped = True
            if 'Optimization completed' in line or 'Stationary point found' in line:
                current['optimization'] = 'completed'
            elif 'Optimization stopped' in line:
                current['optimization'] = 'stopped'
        termination = re.search(r'(Normal|Error) termination', line)
        if termination:
            save([])
            current['termination'] = termination[1].lower()
            current = None
            stopped, is_opt = False, False
    if current is not None:
        save([])
    # Pure frequency/SP segments remain visible without invented optimization steps.
    return dict(name=name, segments=[dict(s, index=i+1) for i, s in enumerate(
        s for s in segments if s['steps'] or s['route'] or s['termination'] != 'incomplete')])
