import { NextRequest, NextResponse } from 'next/server';
import { getLeads } from '@/lib/googleSheets';
import { getHubspotStatusMap } from '@/lib/hubspot';
import { processLeads, mergeHubspotStatus } from '@/lib/leadUtils';

/**
 * Usado por el botón "Cargar más leads" del dashboard: repite la misma
 * combinación Sheet + HubSpot de app/page.tsx, pero permite pedir un límite
 * de contactos de HubSpot más alto que el default (?hubspotLimit=500). Los
 * contactos que existen SOLO en HubSpot ya no se agregan como leads nuevos.
 */
export async function GET(request: NextRequest) {
  const hubspotLimitParam = Number(request.nextUrl.searchParams.get('hubspotLimit'));
  const hubspotLimit = Number.isFinite(hubspotLimitParam) && hubspotLimitParam > 0 ? hubspotLimitParam : undefined;

  const [rawLeads, hubspotMap] = await Promise.all([getLeads(), getHubspotStatusMap(hubspotLimit)]);

  const leads = mergeHubspotStatus(processLeads(rawLeads), hubspotMap);

  // Si HubSpot devolvió menos contactos que el límite pedido, ya no quedan
  // más por traer (se agotaron los contactos disponibles).
  const hasMore = hubspotMap.all.length >= hubspotMap.limit;

  return NextResponse.json({ leads, hubspotLimit: hubspotMap.limit, hasMore });
}
