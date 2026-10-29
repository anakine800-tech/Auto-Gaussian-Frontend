"""Bounded, lazy, in-memory filename/manifest index. Never reads result bodies."""

import json
import os
import stat
import threading
import time
from urllib.parse import quote

from .studies import StudyError, component

MAX_FILES_PER_STUDY = 1000
MAX_ENTRIES_PER_STUDY = 6000
MAX_TOTAL_ENTRIES = 30000
MAX_SECONDS = 2.0
MAX_METADATA_BYTES = 256 * 1024
MAX_RESULTS = 50


class LimitReached(Exception):
    pass


class SearchIndex:
    def __init__(self, store):
        self.store = store
        self.cache = {}
        self.lock = threading.Lock()

    def search(self, query, study=None):
        if study is not None:
            component(study)
            if study.startswith((".", "_")):
                raise StudyError("Study not available", 404)
            # Validate even an empty query. A scoped request never lists the
            # root or spends its budget on unrelated studies.
            with self.store.open_dir((study,)):
                pass
        needle = query.strip().casefold()
        if not needle:
            return {
                "groups": [],
                "incomplete": False,
                "truncated": False,
                "message": None,
            }
        with self.lock:
            self.deadline = time.monotonic() + MAX_SECONDS
            self.total_entries = 0
            groups, count, incomplete, truncated = [], 0, False, False
            seen = set()
            try:
                candidates = (study,) if study is not None else self.study_ids()
                for selected_study in candidates:
                    seen.add(selected_study)
                    self.entries_read, self.files_read = 0, 0
                    try:
                        hits, partial = self.index_study(selected_study)
                    except (StudyError, UnicodeError, ValueError, OSError):
                        incomplete = True
                        continue
                    incomplete |= partial
                    matched = [h for h in hits if needle in h["search"]]
                    selected = matched[: max(0, MAX_RESULTS - count)]
                    count += len(selected)
                    truncated |= len(selected) < len(matched)
                    if selected:
                        groups.append(
                            {
                                "study": selected_study,
                                "title": hits[0]["label"],
                                "hits": [
                                    {k: v for k, v in h.items() if k != "search"}
                                    for h in selected
                                ],
                            }
                        )
            except (LimitReached, StudyError, OSError):
                incomplete = True
            if not incomplete and study is None:
                self.cache = {k: v for k, v in self.cache.items() if k in seen}
            return {
                "groups": groups,
                "incomplete": incomplete,
                "truncated": truncated,
                "message": "索引未完成：部分目录超过读取量或时间上限，或元数据损坏、方法字段类型无效、无法安全读取；缺失的方法未知。"
                if incomplete
                else None,
            }

    def study_ids(self):
        for study, info in self.entries((), root=True):
            if not study.startswith((".", "_")) and stat.S_ISDIR(info.st_mode):
                yield study

    def check(self):
        if time.monotonic() >= self.deadline or self.total_entries >= MAX_TOTAL_ENTRIES:
            raise LimitReached()

    def entries(self, parts, root=False):
        try:
            with self.store.open_dir(parts) as fd, os.scandir(fd) as entries:
                for entry in entries:
                    self.check()
                    self.total_entries += 1
                    if not root:
                        self.entries_read += 1
                        if self.entries_read > MAX_ENTRIES_PER_STUDY:
                            raise LimitReached()
                    info = entry.stat(follow_symlinks=False)
                    if stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode):
                        yield entry.name, info
        except StudyError as exc:
            if exc.status != 404:
                raise

    def index_study(self, study):
        fingerprint, files, partial = [], [], False

        # Only directories represented by the viewer are traversed. No manifest
        # path, report link or symlink is ever used as a filesystem instruction.
        def directory(parts, depth):
            nonlocal partial
            self.check()
            try:
                with self.store.open_dir(parts) as fd:
                    info = os.fstat(fd)
                    fingerprint.append(
                        (
                            parts,
                            info.st_dev,
                            info.st_ino,
                            info.st_mtime_ns,
                            info.st_ctime_ns,
                        )
                    )
                for name, info in self.entries(parts):
                    path = (*parts, name)
                    if stat.S_ISDIR(info.st_mode) and depth:
                        directory(
                            path,
                            1
                            if parts == (study, "analyses") and name == "ts-labels"
                            else depth - 1,
                        )
                    elif stat.S_ISREG(info.st_mode):
                        if (
                            parts == (study, "attempts")
                            or parts[1:2] == ("attempts",)
                            and name != "manifest.json"
                        ):
                            continue
                        self.files_read += 1
                        if self.files_read > MAX_FILES_PER_STUDY:
                            raise LimitReached()
                        fingerprint.append(
                            (
                                path,
                                info.st_dev,
                                info.st_ino,
                                info.st_mtime_ns,
                                info.st_ctime_ns,
                                info.st_size,
                            )
                        )
                        files.append(path)
            except StudyError as exc:
                if exc.status != 404:
                    partial = True

        try:
            with self.store.open_file((study, "study.md")) as stream:
                info = os.fstat(stream.fileno())
                fingerprint.append(
                    (
                        "study.md",
                        info.st_dev,
                        info.st_ino,
                        info.st_mtime_ns,
                        info.st_ctime_ns,
                        info.st_size,
                    )
                )
            directory((study, "attempts"), 1)
            directory((study, "analyses"), 1)
            directory((study, "structures"), 1)
        except LimitReached:
            partial = True
        signature = sorted(fingerprint, key=str)
        old = self.cache.get(study)
        if old and old[0] == signature and not partial and not old[2]:
            return old[1], old[2]
        self.check()
        text = self.store.read((study, "study.md"), MAX_METADATA_BYTES).decode("utf-8")
        title = next(
            (line[2:].strip() for line in text.splitlines() if line.startswith("# ")),
            study,
        )
        base = "#/s/" + quote(study, safe="")
        hits = [
            {
                "label": title,
                "detail": study,
                "href": base + "/research/progress",
                "search": (study + " " + title).casefold(),
            }
        ]
        for path in sorted(files):
            try:
                self.check()
                relative = path[1:]
                if relative[0] == "attempts":
                    attempt = relative[1]
                    label, template, methods, method_partial = "", "", [], False
                    try:
                        raw = self.store.read(path, MAX_METADATA_BYTES)
                        manifest = json.loads(raw)
                        if not isinstance(manifest, dict):
                            raise ValueError()
                        label = (
                            manifest.get("label")
                            if isinstance(manifest.get("label"), str)
                            else ""
                        )
                        template = (
                            manifest.get("template")
                            if isinstance(manifest.get("template"), str)
                            else ""
                        )
                        science = manifest.get("science", {})
                        if isinstance(science, dict):
                            for field in ("route", "method_basis"):
                                if field not in science:
                                    continue
                                if isinstance(science[field], str):
                                    methods.append(science[field])
                                else:
                                    method_partial = True
                        else:
                            method_partial = True
                    except (StudyError, ValueError, UnicodeError, RecursionError):
                        method_partial = True  # The directory ID remains searchable.
                    partial |= method_partial
                    method_note = "方法索引不完整" if method_partial else ""
                    if not any(method.strip() for method in methods):
                        method_note = "方法未知"
                    # Method text can contain paths or shell syntax. It is only
                    # searchable text, never a path, command or response detail.
                    hit = {
                        "label": attempt,
                        "detail": " · ".join(
                            filter(None, [label, template, "Attempt", method_note])
                        ),
                        "href": base + "/research/a/" + quote(attempt, safe=""),
                        "search": " ".join(
                            [attempt, label, template, *methods]
                        ).casefold(),
                    }
                else:
                    name = "/".join(relative[1:])
                    is_structure = relative[0] == "structures" or name.lower().endswith(
                        ".xyz"
                    )
                    route = (
                        ["evidence", *relative]
                        if is_structure
                        else [
                            "results",
                            "ts" if relative[1:2] == ("ts-labels",) else "file",
                            *relative[1:],
                        ]
                    )
                    hit = {
                        "label": name,
                        "detail": relative[0],
                        "href": base + "/" + "/".join(quote(p, safe="") for p in route),
                        "search": name.casefold(),
                    }
                hits.append(hit)
            except LimitReached:
                partial = True
                break
        # Cache only bounded metadata, never file content or result bodies.
        self.cache[study] = (signature, hits, partial)
        return hits, partial
