import { normalizeEmail } from './leadUtils';

/**
 * Integración con GoHighLevel (GHL) — API v2, autenticada con un Private
 * Integration Token (los API Keys viejos de v1 ya no se pueden generar,
 * GHL los dio de baja a finales de 2025).
 *
 * Trae las oportunidades (tus leads dentro de GHL) con su Stage del
 * pipeline y el usuario asignado, y arma un mapa por CORREO normalizado
 * para mezclarlo con los leads que ya vienen de Sheets/HubSpot — mismo
 * patrón que lib/hubspot.ts.
 *
 * Variables de entorno requeridas:
 * GHL_PRIVATE_TOKEN="pit-..."
 * GHL_LOCATION_ID="..."
 *
 * Opcional — si el endpoint de usuarios de GHL no responde bien (le pasó a
 * otra herramienta del equipo, según vimos), puedes definir un mapa fijo
 * de respaldo en vez de depender de la API:
 * GHL_USERS_FALLBACK='{"userId1":"Nombre Apellido","userId2":"Otro Nombre"}'
 */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

interface GhlPipelineStage {
  id: string;
  name: string;
}

interface GhlPipeline {
  id: string;
  name: string;
  stages: GhlPipelineStage[];
}

interface GhlOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  assignedTo?: string | null;
  contactId: string;
  contact?: { email?: string | null; phone?: string | null } | null;
}

export interface GhlStatusEntry {
  estadoGHL: string; // nombre del Stage, ej. "Registro", "Contacto"
  pipelineGHL: string; // nombre del Pipeline al que pertenece
  personaEncargadaGHL: string; // nombre del usuario asignado, o "Sin asignar"
}

export interface GhlStatusMap {
  byEmail: Map<string, GhlStatusEntry>;
}

function ghlHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_API_VERSION,
    Accept: 'application/json',
  };
}

/** Trae todos los pipelines de la Location, con sus Stages (id -> nombre). */
async function fetchPipelines(token: string, locationId: string): Promise<Map<string, GhlPipeline>> {
  const url = `${GHL_API_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`;
  const res = await fetch(url, { headers: ghlHeaders(token) });

  if (!res.ok) {
    console.error(`[ghl] Error ${res.status} al leer pipelines:`, await res.text());
    return new Map();
  }

  const data = await res.json();
  const pipelines: GhlPipeline[] = data.pipelines ?? [];
  return new Map(pipelines.map((p) => [p.id, p]));
}

/**
 * Trae el mapa userId -> nombre. Primero intenta la API real; si falla o
 * viene vacía (le pasa a veces a GHL), cae al mapa fijo de
 * GHL_USERS_FALLBACK si está configurado, para no dejar todo en blanco.
 */
async function fetchUsersMap(token: string, locationId: string): Promise<Map<string, string>> {
  try {
    const url = `${GHL_API_BASE}/users/?locationId=${encodeURIComponent(locationId)}`;
    const res = await fetch(url, { headers: ghlHeaders(token) });
    if (res.ok) {
      const data = await res.json();
      const users: { id: string; name?: string; firstName?: string; lastName?: string }[] = data.users ?? [];
      if (users.length > 0) {
        return new Map(
          users.map((u) => [u.id, u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Sin nombre']),
        );
      }
    } else {
      console.error(`[ghl] Error ${res.status} al leer usuarios, se usará el respaldo si existe:`, await res.text());
    }
  } catch (error) {
    console.error('[ghl] Error de red al leer usuarios, se usará el respaldo si existe:', error);
  }

  // Respaldo: mapa fijo por variable de entorno.
  const fallbackRaw = process.env.GHL_USERS_FALLBACK;
  if (fallbackRaw) {
    try {
      const fallback = JSON.parse(fallbackRaw) as Record<string, string>;
      return new Map(Object.entries(fallback));
    } catch {
      console.error('[ghl] GHL_USERS_FALLBACK no es JSON válido.');
    }
  }

  return new Map();
}

/** Trae TODAS las oportunidades de la Location (paginado). */
async function fetchAllOpportunities(token: string, locationId: string): Promise<GhlOpportunity[]> {
  const all: GhlOpportunity[] = [];
  let nextPageUrl: string | null =
    `${GHL_API_BASE}/opportunities/search?location_id=${encodeURIComponent(locationId)}&limit=100`;

  // Tope de seguridad: máximo 60 páginas (a 100 por página = 6000
  // oportunidades). La cuenta real tiene ~4,642 al momento de escribir
  // esto — con margen para que siga creciendo sin tocar código.
  let safety = 0;
  while (nextPageUrl && safety < 60) {
    safety += 1;
    const res: Response = await fetch(nextPageUrl, { headers: ghlHeaders(token) });
    if (!res.ok) {
      console.error(`[ghl] Error ${res.status} al leer oportunidades:`, await res.text());
      break;
    }
    const data = await res.json();
    const opportunities: GhlOpportunity[] = data.opportunities ?? [];
    all.push(...opportunities);

    // La API v2 de GHL pagina con un cursor "meta.nextPageUrl" o similar —
    // si no viene, asumimos que ya no hay más páginas.
    nextPageUrl = data.meta?.nextPageUrl ?? null;
  }

  return all;
}

/**
 * Versión SIN caché — hace el trabajo pesado real (pipelines + usuarios +
 * las ~47 páginas de oportunidades). Úsala solo si necesitas datos 100%
 * frescos ahora mismo; para el uso normal del dashboard usa
 * getGhlStatusMap() de abajo, que cachea el resultado.
 */
async function getGhlStatusMapUncached(): Promise<GhlStatusMap> {
  const token = process.env.GHL_PRIVATE_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!token || !locationId) {
    console.error('[ghl] Faltan GHL_PRIVATE_TOKEN / GHL_LOCATION_ID — se omite la integración con GoHighLevel.');
    return { byEmail: new Map() };
  }

  const [pipelines, usersMap, opportunities] = await Promise.all([
    fetchPipelines(token, locationId),
    fetchUsersMap(token, locationId),
    fetchAllOpportunities(token, locationId),
  ]);

  const byEmail = new Map<string, GhlStatusEntry>();

  for (const opp of opportunities) {
    const email = normalizeEmail(opp.contact?.email);
    if (!email) continue; // sin correo no podemos cruzarlo con tus leads

    const pipeline = pipelines.get(opp.pipelineId);
    const stage = pipeline?.stages.find((s) => s.id === opp.pipelineStageId);

    byEmail.set(email, {
      estadoGHL: stage?.name ?? 'Sin etapa',
      pipelineGHL: pipeline?.name ?? 'Sin pipeline',
      personaEncargadaGHL: opp.assignedTo ? (usersMap.get(opp.assignedTo) ?? 'Sin asignar') : 'Sin asignar',
    });
  }

  console.log(`[ghl] Refrescado: ${byEmail.size} correos indexados de ${opportunities.length} oportunidades.`);

  return { byEmail };
}

/**
 * CACHÉ EN MEMORIA — la cuenta tiene ~4,600 oportunidades, traerlas todas
 * (paginado, ~47 llamadas seguidas a la API) tarda 15-30+ segundos. Sin
 * caché, esto pasaba en CADA carga del dashboard. Con esto, solo la
 * primera visita (o la primera después de que expire el caché) paga ese
 * costo — el resto se sirve al instante desde memoria.
 *
 * Vive mientras la función serverless siga "caliente" (Vercel reutiliza
 * la misma instancia entre requests seguidos) — en un cold start se
 * vuelve a llenar solo, sin que haya que hacer nada manualmente.
 */
const GHL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

let ghlCache: { data: GhlStatusMap; fetchedAt: number } | null = null;
let ghlCacheInFlight: Promise<GhlStatusMap> | null = null;

export async function getGhlStatusMap(): Promise<GhlStatusMap> {
  const now = Date.now();

  if (ghlCache && now - ghlCache.fetchedAt < GHL_CACHE_TTL_MS) {
    return ghlCache.data;
  }

  // Si ya hay un refresh en curso (dos requests casi al mismo tiempo con
  // el caché vencido), que ambas esperen la MISMA llamada en vez de
  // disparar el fetch pesado dos veces por separado.
  if (ghlCacheInFlight) {
    return ghlCacheInFlight;
  }

  ghlCacheInFlight = getGhlStatusMapUncached()
    .then((data) => {
      ghlCache = { data, fetchedAt: Date.now() };
      return data;
    })
    .finally(() => {
      ghlCacheInFlight = null;
    });

  return ghlCacheInFlight;
}

/** Busca el estado de GHL de un lead por su correo (ya normalizado o crudo). */
export function lookupGhlStatus(map: GhlStatusMap, email?: string | null): GhlStatusEntry | null {
  const key = normalizeEmail(email);
  if (!key) return null;
  return map.byEmail.get(key) ?? null;
}