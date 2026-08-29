import { loadDashboardData } from '@/lib/dashboardData';
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs';

// Revalida la página cada 60s (coordinado con el caché de getGhlRawLeads()
// en lib/ghl.ts, que dura 10 min pero se sirve desde memoria).
export const revalidate = 60;

export default async function DashboardPage() {
  // Misma página que app/page.tsx (es donde /login redirige por defecto) —
  // ambas comparten la lógica de carga vía lib/dashboardData.ts.
  const { leads, leadQualityHistoryChart } = await loadDashboardData('meta-ads/page');

  const lastUpdated = new Date().toLocaleString('es-MX', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 flex-col justify-between gap-1 border-b border-zinc-800 px-6 py-4 sm:flex-row sm:items-end">
        <div>
          {/* TODO: confirmar nombre/branding exacto del cliente. */}
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">vtower</p>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Panel de Reportes</h1>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-xs text-zinc-500">Última actualización: {lastUpdated}</p>
        </div>
      </header>

      <DashboardTabs leads={leads} initialHubspotLimit={0} leadQualityHistory={leadQualityHistoryChart} />
    </div>
  );
}