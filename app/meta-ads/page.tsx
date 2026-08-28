import { getLeads } from '@/lib/googleSheets';
import { getHubspotStatusMap } from '@/lib/hubspot';
import { getGhlStatusMap } from '@/lib/ghl';
import {
  processLeads,
  mergeHubspotStatus,
  mergeGhlStatus,
  summarizeLeadQualityByFuente,
  summarizeLeadQualityByCampana,
  buildLeadQualityHistoryChartData,
  type LeadQualityHistoryChartPoint,
} from '@/lib/leadUtils';
import { saveLeadQualitySummary, getLeadQualityHistory } from '@/lib/leadQualityStorage';
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs';

// Revalida la página cada 60s (coordinado con el caché de getLeads() y
// getHubspotStatusMap()).
export const revalidate = 60;

export default async function DashboardPage() {
  // 1. Extracción segura de datos (Server Component -> nunca se envían
  //    credenciales de Google/HubSpot/GHL al cliente). Las 3 fuentes en
  //    paralelo. GHL puede tardar (cuenta con ~4,600 oportunidades,
  //    paginado) — si falla o tarda demasiado, no tumba el resto del
  //    dashboard, solo la columna "Estado GHL" queda sin dato.
  const [rawLeads, hubspotMap, ghlMap] = await Promise.all([
    getLeads(),
    getHubspotStatusMap(),
    getGhlStatusMap().catch((err) => {
      console.error('[meta-ads/page] Error al leer GoHighLevel, se omite por esta vez:', err);
      return { byEmail: new Map() };
    }),
  ]);

  // 2. Limpieza + deduplicación (server-side) SOLO sobre los leads reales
  //    del Sheet (los contactos que existen SOLO en HubSpot ya no se
  //    agregan como leads nuevos), luego cruce con el estado del CRM
  //    (HubSpot primero, GHL después — GHL cruza solo por correo).
  const leadsWithHubspot = mergeHubspotStatus(processLeads(rawLeads), hubspotMap);
  const leads = mergeGhlStatus(leadsWithHubspot, ghlMap);

  // 3. Snapshot de calidad de leads (por Fuente y por Campaña, según el
  //    semáforo) — se guarda para que la generación de campañas lo use
  //    como contexto real.
  try {
    await saveLeadQualitySummary({
      generatedAt: new Date().toISOString(),
      byFuente: summarizeLeadQualityByFuente(leads),
      byCampana: summarizeLeadQualityByCampana(leads),
    });
  } catch (err) {
    console.error('[meta-ads/page] Error al guardar calidad de leads:', err);
  }

  // 4. Historial completo (un punto por día) para la gráfica de línea del
  //    tiempo — ya incluye el snapshot de hoy que se acaba de guardar
  //    arriba. Si falla, la gráfica simplemente se muestra vacía, no
  //    tumba el resto del dashboard.
  let leadQualityHistoryChart: { data: LeadQualityHistoryChartPoint[]; fuentes: string[] } = { data: [], fuentes: [] };
  try {
    const history = await getLeadQualityHistory();
    leadQualityHistoryChart = buildLeadQualityHistoryChartData(history);
  } catch (err) {
    console.error('[meta-ads/page] Error al leer historial de calidad de leads:', err);
  }

  const lastUpdated = new Date().toLocaleString('es-MX', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 flex-col justify-between gap-1 border-b border-zinc-800 px-6 py-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Live Desarrollos</p>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Panel de Reportes</h1>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-xs text-zinc-500">Última actualización: {lastUpdated}</p>
        </div>
      </header>

      <DashboardTabs leads={leads} initialHubspotLimit={hubspotMap.limit} leadQualityHistory={leadQualityHistoryChart} />
    </div>
  );
}