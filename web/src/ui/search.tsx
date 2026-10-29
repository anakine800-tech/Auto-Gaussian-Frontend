import { useEffect, useState } from 'react';
import { get } from '../api';

type Results = {
  groups: {
    study: string;
    title: string;
    hits: { label: string; detail: string; href: string }[];
  }[];
  incomplete: boolean;
  truncated: boolean;
  message: string | null;
};

export function GlobalSearch({ currentStudy }: { currentStudy?: string }) {
  const [query, setQuery] = useState('');
  // A different Study starts with its own scope and request lifecycle. Keep the
  // keyword useful across navigation without ever carrying over its results.
  return (
    <ScopedSearch
      key={currentStudy ?? ''}
      currentStudy={currentStudy}
      query={query}
      setQuery={setQuery}
    />
  );
}

function ScopedSearch({
  currentStudy,
  query,
  setQuery,
}: {
  currentStudy?: string;
  query: string;
  setQuery: (query: string) => void;
}) {
  const [scope, setScope] = useState(currentStudy ? 'current' : 'all');
  const [open, setOpen] = useState(false);
  const [response, setResponse] = useState<{
    url: string;
    results?: Results;
    error?: string;
  } | null>(null);
  const needle = query.trim();
  const selectedStudy = scope === 'current' ? currentStudy : undefined;
  const params = new URLSearchParams({ q: needle });
  if (selectedStudy) params.set('study', selectedStudy);
  const url = '/api/search?' + params.toString();
  // Hide old results synchronously, including the render before effect cleanup.
  const currentResponse = response?.url === url ? response : null;
  const results = currentResponse?.results;
  const error = currentResponse?.error;

  useEffect(() => {
    setResponse(null);
    if (!needle) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      get<Results>(url, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) setResponse({ url, results });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setResponse({ url, error: error.message });
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needle, url]);

  return (
    <div
      className="global-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <select
        aria-label="搜索范围"
        value={scope}
        onChange={(event) => {
          setScope(event.target.value);
          setOpen(true);
        }}
      >
        {currentStudy && <option value="current">当前 Study</option>}
        <option value="all">所有 Study</option>
      </select>
      <input
        maxLength={256}
        aria-label="全局搜索"
        placeholder="搜索方法、route、编号、标签或文件名"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
      />
      {open && needle && (
        <div className="search-results" role="region" aria-label="搜索结果">
          <p className="muted">
            {selectedStudy ? `当前 Study · ${selectedStudy}` : '本机所有 Study'}
            {' · 名称与 manifest 方法元数据'}
          </p>
          {error ? (
            <p role="alert">{error}</p>
          ) : !results ? (
            <p role="status">搜索中…</p>
          ) : (
            <>
              {results.incomplete && (
                <p role="status">{results.message ?? '索引未完成'}</p>
              )}
              {results.groups.map((group) => (
                <section key={group.study} aria-label={group.title}>
                  <h3>{group.title}</h3>
                  {group.hits.map((hit) => (
                    <a
                      key={hit.href}
                      href={hit.href}
                      onClick={() => setOpen(false)}
                    >
                      <strong>{hit.label}</strong>
                      <small>
                        {group.study} · {hit.detail}
                      </small>
                    </a>
                  ))}
                </section>
              ))}
              {!results.groups.length && (
                <p>
                  所选范围的本机 study
                  中没有匹配的编号、标签或文件名，也没有匹配的方法
                  {results.incomplete ? '（仅限已完成索引的范围）' : ''}
                </p>
              )}
              {results.truncated && <p>最多显示 50 条，请缩小关键词范围。</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
