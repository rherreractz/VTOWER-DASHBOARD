'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MetaAuditResult } from '@/lib/metaAudit';

const CATEGORY_LABELS: Record<string, string> = {
  pixel_capi: 'Pixel / CAPI',
  creative: 'Creativos',
  account_structure: 'Estructura de cuenta',
  audience_targeting: 'Audiencia / Targeting',
};

interface NamedAccount {
  name: string;
  accountId: string;
}

/**
 * Lista de cuentas publicitarias con nombre, para mostrarlas en un
 * selector en vez de tener que pegar el act_... cada vez. Se define en
 * NEXT_PUBLIC_META_AD_ACCOUNTS (debe llevar el prefijo NEXT_PUBLIC_ para
 * estar disponible en el navegador — el account_id no es información
 * sensible, el token sigue privado solo en el servidor). Ejemplo en
 * .env.local:
 *
 * NEXT_PUBLIC_META_AD_ACCOUNTS='[{"name":"Live / Neo","accountId":"act_1586604569106474"},{"name":"LIVE / OOM Creativo","accountId":"act_2737760363054335"},{"name":"Live","accountId":"act_1670510807480763"}]'
 */
function getNamedAccounts(): NamedAccount[] {
  const raw = process.env.NEXT_PUBLIC_META_AD_ACCOUNTS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    console.error('[meta-audit-panel] NEXT_PUBLIC_META_AD_ACCOUNTS no es JSON válido.');
  }
  return [];
}

function resultPillClassName(result: string): string {
  switch (result) {
    case 'PASS':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400';
    case 'WARNING':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-400';
    case 'FAIL':
      return 'border-red-500/30 bg-red-500/10 text-red-400';
    default:
      return 'border-zinc-700 bg-transparent text-zinc-500';
  }
}

function gradeClassName(grade: string): string {
  if (grade === 'A' || grade === 'B') return 'text-emerald-400';
  if (grade === 'C') return 'text-amber-400';
  return 'text-red-400';
}

export function MetaAuditPanel() {
  const namedAccounts = getNamedAccounts();
  const [accountId, setAccountId] = useState('');
  const [selectedName, setSelectedName] = useState<string>(namedAccounts.length > 0 ? namedAccounts[0].name : '__manual__');
  const [loading, setLoading] = useState(false);
  const [loadingCached, setLoadingCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MetaAuditResult | null>(null);
  const [resultGeneratedAt, setResultGeneratedAt] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'fail' | 'warning'>('all');

  const isManualEntry = selectedName === '__manual__';
  const effectiveAccountId = isManualEntry
    ? accountId.trim()
    : namedAccounts.find((a) => a.name === selectedName)?.accountId ?? '';

  // Al elegir una cuenta, mostramos de inmediato la última auditoría
  // guardada para ella (si existe) — sin gastar en Meta ni en Claude. Solo
  // se corre una auditoría nueva cuando el usuario le da clic al botón.
  useEffect(() => {
    if (!effectiveAccountId) {
      setResult(null);
      setResultGeneratedAt(null);
      return;
    }

    let cancelled = false;
    setLoadingCached(true);
    setError(null);

    fetch(`/api/meta-audit?accountId=${encodeURIComponent(effectiveAccountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.stored) {
          setResult(json.stored.audit as MetaAuditResult);
          setResultGeneratedAt(json.stored.generatedAt);
        } else {
          setResult(null);
          setResultGeneratedAt(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResult(null);
          setResultGeneratedAt(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCached(false);
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveAccountId]);

  async function runAudit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/meta-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: effectiveAccountId }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Ocurrió un error al correr la auditoría.');
      }
      setResult(json.audit as MetaAuditResult);
      setResultGeneratedAt((json.audit as MetaAuditResult).generated_at);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error inesperado.');
    } finally {
      setLoading(false);
    }
  }

  const visibleChecks =
    result?.checks.filter((check) => {
      if (filter === 'all') return true;
      if (filter === 'fail') return check.result === 'FAIL';
      if (filter === 'warning') return check.result === 'WARNING';
      return true;
    }) ?? [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {namedAccounts.length > 0 && (
          <div className="w-full sm:w-64">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
              Cuenta publicitaria
            </label>
            <select
              value={selectedName}
              onChange={(e) => setSelectedName(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
            >
              {namedAccounts.map((acc) => (
                <option key={acc.accountId} value={acc.name}>
                  {acc.name}
                </option>
              ))}
              <option value="__manual__">Otra cuenta (pegar ID)…</option>
            </select>
          </div>
        )}

        {(isManualEntry || namedAccounts.length === 0) && (
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
              Ad Account ID del cliente
            </label>
            <input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="act_1234567890"
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
            />
          </div>
        )}

        <Button
          onClick={runAudit}
          disabled={loading || !effectiveAccountId}
          className="h-9 bg-[#EFF767] px-4 text-zinc-950 hover:bg-[#EFF767]/90"
        >
          {loading ? 'Auditando… (puede tardar ~30-60s)' : 'Correr auditoría de Meta Ads'}
        </Button>

        {loadingCached && <span className="text-xs text-zinc-500">Buscando última auditoría guardada…</span>}
        {!loadingCached && resultGeneratedAt && (
          <span className="text-xs text-zinc-500">
            Última auditoría: {new Date(resultGeneratedAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {result && (
        <div className="flex flex-col gap-6">
          {/* Health Score */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
            <p className="text-xs uppercase tracking-wider text-zinc-500">Meta Ads Health Score</p>
            <div className="mt-2 flex items-end gap-3">
              <span className="text-5xl font-bold text-zinc-50">{Math.round(result.health_score)}</span>
              <span className="pb-1 text-lg text-zinc-500">/100</span>
              <span className={`pb-1 text-3xl font-bold ${gradeClassName(result.grade)}`}>{result.grade}</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(result.category_scores).map(([key, cat]) => (
                <div key={key} className="rounded-md border border-zinc-800 p-3">
                  <p className="text-xs text-zinc-500">{CATEGORY_LABELS[key] ?? key}</p>
                  <p className="text-lg font-semibold text-zinc-100">{Math.round(cat.score)}/100</p>
                  <p className="text-xs text-zinc-600">peso {Math.round(cat.weight * 100)}%</p>
                </div>
              ))}
            </div>
          </div>

          {/* Critical issues */}
          {result.critical_issues && result.critical_issues.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-6">
              <p className="mb-3 text-sm font-semibold text-red-400">
                Problemas críticos ({result.critical_issues.length})
              </p>
              <ul className="flex flex-col gap-2">
                {result.critical_issues.map((ci) => (
                  <li key={ci.check_id} className="text-sm text-zinc-300">
                    <span className="font-mono text-red-400">{ci.check_id}</span> — {ci.blocker_reason}
                    {ci.estimated_revenue_at_risk && (
                      <span className="text-zinc-500"> ({ci.estimated_revenue_at_risk})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Quick wins */}
          {result.quick_wins && result.quick_wins.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
              <p className="mb-3 text-sm font-semibold text-zinc-100">Quick Wins ({result.quick_wins.length})</p>
              <ul className="flex flex-col gap-2">
                {result.quick_wins.map((qw) => (
                  <li key={qw.check_id} className="flex items-start justify-between gap-4 text-sm text-zinc-300">
                    <span>
                      <span className="font-mono text-zinc-500">{qw.check_id}</span> — {qw.action}
                    </span>
                    {qw.effort_minutes != null && (
                      <span className="whitespace-nowrap text-xs text-zinc-500">{qw.effort_minutes} min</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Todos los checks */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-100">Checks ({result.checks.length} evaluados)</p>
              <div className="flex gap-1">
                {(['all', 'fail', 'warning'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-md border px-2 py-1 text-xs ${
                      filter === f
                        ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                        : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {f === 'all' ? 'Todos' : f === 'fail' ? 'Fail' : 'Warning'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {visibleChecks.map((check) => (
                <div key={check.id} className="flex flex-col gap-1 border-b border-zinc-800 pb-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-zinc-500">{check.id}</span>
                    <span className="text-sm text-zinc-200">{check.name}</span>
                    <Badge variant="outline" className={resultPillClassName(check.result)}>
                      {check.result}
                    </Badge>
                  </div>
                  {check.finding && <p className="text-xs text-zinc-500">{check.finding}</p>}
                  {check.recommendation && check.result !== 'PASS' && (
                    <p className="text-xs text-zinc-400">→ {check.recommendation}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {result.notes && (
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-4 text-xs text-zinc-500">
              <span className="font-medium text-zinc-400">Notas: </span>
              {result.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}