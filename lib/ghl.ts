import { normalizeEmail, ghlLeadToRawLead } from './leadUtils';
import type { RawLead } from './types';

/**
 * Integración con GoHighLevel (GHL) — API v2, autenticada con un Private
 * Integration Token (los API Keys viejos de v1 ya no se pueden generar,
 * GHL los dio de baja a finales de 2025).
 *
 * vtower usa GHL como fuente ÚNICA y PRIMARIA de leads — a diferencia de
 * Live, que solo lo usaba para enriquecer leads que venían de un Google
 * Sheet. Por eso este archivo expone dos cosas distintas:
 *
 *   - getGhlRawLeads()  -> RawLead[] de las oportunidades del "Marketing
 *     Pipeline" (fuente primaria, úsalo en app/page.tsx). NO descarta
 *     oportunidades sin correo — solo un contacto sin correo no podrá
 *     cruzarse más adelante con otra fuente por correo.
 *   - getGhlStatusMap() -> Map por correo (para enriquecer leads que vengan
 *     de otro lado, ej. si más adelante vuelve a entrar un Sheet fuente,
 *     usado junto con mergeGhlStatus() de lib/leadUtils.ts).
 *
 * IMPORTANTE — vtower tiene 3 pipelines en GHL, pero solo UNO es el embudo
 * real de leads de Meta Ads:
 *   - "Marketing Pipeline" (nativo de GHL): Brokers, Descarte, Nuevo Lead,
 *     Intento de Contacto, Contactado, Calificado, Cita Agendada, Cita
 *     Realizada, Negociación, Apartado, Venta Cerrada. AQUÍ caen los leads
 *     de Facebook/Meta — confirmado con el equipo (ago-2026).
 *   - "Pipeline ITM" y "Pipeline de ventas": ambos importados de HubSpot el
 *     mismo día, son procesos de cierre/escrituración POSVENTA (firma de
 *     contrato, entrega de inmueble, etc.), no tienen que ver con leads
 *     nuevos de Meta Ads — el equipo confirmó EXCLUIRLOS del dashboard de
 *     leads. Por eso getGhlRawLeads()/getGhlStatusMap() solo traen
 *     oportunidades de "Marketing Pipeline" (filtrado por nombre, ver
 *     GHL_MARKETING_PIPELINE_NAME abajo).
 *
 * Ambas funciones exportadas comparten el mismo fetch pesado (pipelines +
 * usuarios + oportunidades paginadas, ya filtradas a un solo pipeline) y el
 * mismo caché en memoria de 10 min — así no se paga el costo de traer todo
 * dos veces.
 *
 * Variables de entorno requeridas:
 * GHL_PRIVATE_TOKEN="pit-..."
 * GHL_LOCATION_ID="..."
 *
 * Opcionales:
 * GHL_MARKETING_PIPELINE_NAME="Marketing Pipeline"
 *   Nombre EXACTO (no case-sensitive) del pipeline que se usa como fuente
 *   de leads. Por defecto "Marketing Pipeline" — cámbialo solo si el
 *   equipo renombra el pipeline en GHL.
 * GHL_USERS_FALLBACK='{"userId1":"Nombre Apellido","userId2":"Otro Nombre"}'
 *   Si el endpoint de usuarios de GHL no responde bien (le pasó a otra
 *   herramienta del equipo, según vimos), puedes definir un mapa fijo de
 *   respaldo en vez de depender de la API.
 */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const MARKETING_PIPELINE_NAME = process.env.GHL_MARKETING_PIPELINE_NAME || 'Marketing Pipeline';

interface GhlPipelineStage {
  id: string;
  name: string;
}

interface GhlPipeline {
  id: string;
  name: string;
  stages: GhlPipelineStage[];
}

interface GhlAttribution {
  utmCampaign?: string | null;
  isFirst?: boolean;
  isLast?: boolean;
}

interface GhlOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  assignedTo?: string | null;
  contactId: string;
  /** Fuente/atribución de la oportunidad, si GHL la trae (ej. "Facebook"). */
  source?: string | null;
  createdAt?: string | null;
  dateAdded?: string | null;
  contact?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  /** Historial de atribución UTM (primer y último touchpoint) — de aquí sacamos utmCampaign. */
  attributions?: GhlAttribution[] | null;
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

/** Busca, por NOMBRE (no case-sensitive), el pipeline configurado como fuente de leads. */
function resolveMarketingPipeline(pipelines: Map<string, GhlPipeline>): GhlPipeline | null {
  const target = MARKETING_PIPELINE_NAME.trim().toLowerCase();
  for (const pipeline of pipelines.values()) {
    if (pipeline.name.trim().toLowerCase() === target) return pipeline;
  }
  return null;
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

/**
 * Trae TODAS las oportunidades de la Location (paginado), filtradas a un
 * solo pipeline si se pasa `pipelineId` (así no traemos ni pagineamos las
 * oportunidades de los otros pipelines que no son leads de Meta Ads).
 */
async function fetchAllOpportunities(
  token: string,
  locationId: string,
  pipelineId?: string,
): Promise<GhlOpportunity[]> {
  const all: GhlOpportunity[] = [];
  const pipelineFilter = pipelineId ? `&pipeline_id=${encodeURIComponent(pipelineId)}` : '';
  let nextPageUrl: string | null =
    `${GHL_API_BASE}/opportunities/search?location_id=${encodeURIComponent(locationId)}&limit=100${pipelineFilter}`;

  // Tope de seguridad: máximo 60 páginas (a 100 por página = 6000
  // oportunidades) — con margen para que la cuenta siga creciendo sin
  // tocar código.
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

/** Saca el nombre de campaña (utmCampaign) de la atribución de una oportunidad — prioriza el primer touchpoint (isFirst). */
function pickCampaignFromAttributions(attributions?: GhlAttribution[] | null): string {
  if (!attributions || attributions.length === 0) return '';
  const chosen = attributions.find((a) => a.isFirst) ?? attributions[0];
  return chosen?.utmCampaign?.trim() || '';
}

interface GhlDataSnapshot {
  pipelines: Map<string, GhlPipeline>;
  usersMap: Map<string, string>;
  /** Oportunidades del "Marketing Pipeline" únicamente, ya deduplicadas por id. */
  opportunities: GhlOpportunity[];
}

/**
 * Versión SIN caché — hace el trabajo pesado real (pipelines + usuarios +
 * las páginas de oportunidades del pipeline de leads). Úsala solo si
 * necesitas datos 100% frescos ahora mismo; para el uso normal del
 * dashboard usa getGhlData() de abajo, que cachea el resultado.
 */
async function getGhlDataUncached(): Promise<GhlDataSnapshot> {
  const token = process.env.GHL_PRIVATE_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!token || !locationId) {
    console.error('[ghl] Faltan GHL_PRIVATE_TOKEN / GHL_LOCATION_ID — se omite la integración con GoHighLevel.');
    return { pipelines: new Map(), usersMap: new Map(), opportunities: [] };
  }

  const pipelines = await fetchPipelines(token, locationId);
  const marketingPipeline = resolveMarketingPipeline(pipelines);

  if (!marketingPipeline) {
    console.error(
      `[ghl] No se encontró el pipeline "${MARKETING_PIPELINE_NAME}" entre los pipelines de la cuenta ` +
        `(${Array.from(pipelines.values()).map((p) => p.name).join(', ') || 'ninguno'}). ` +
        'Revisa GHL_MARKETING_PIPELINE_NAME, o compara contra /api/ghl-debug. Se omiten los leads por esta vez.',
    );
    return { pipelines, usersMap: new Map(), opportunities: [] };
  }

  const [usersMap, rawOpportunities] = await Promise.all([
    fetchUsersMap(token, locationId),
    fetchAllOpportunities(token, locationId, marketingPipeline.id),
  ]);

  // Dedup por id — por si el cursor de paginación llegara a repetir una
  // página (no debería pasar, pero es gratis cubrirlo).
  const byId = new Map<string, GhlOpportunity>();
  rawOpportunities.forEach((opp) => byId.set(opp.id, opp));

  return { pipelines, usersMap, opportunities: Array.from(byId.values()) };
}

/**
 * CACHÉ EN MEMORIA — la cuenta puede tener miles de oportunidades, traerlas
 * todas (paginado, decenas de llamadas seguidas a la API) puede tardar
 * bastantes segundos. Sin caché, esto pasaba en CADA carga del dashboard.
 * Con esto, solo la primera visita (o la primera después de que expire el
 * caché) paga ese costo — el resto se sirve al instante desde memoria.
 *
 * Vive mientras la función serverless siga "caliente" (Vercel reutiliza la
 * misma instancia entre requests seguidos) — en un cold start se vuelve a
 * llenar solo, sin que haya que hacer nada manualmente.
 */
const GHL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

let ghlCache: { data: GhlDataSnapshot; fetchedAt: number } | null = null;
let ghlCacheInFlight: Promise<GhlDataSnapshot> | null = null;

async function getGhlData(): Promise<GhlDataSnapshot> {
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

  ghlCacheInFlight = getGhlDataUncached()
    .then((data) => {
      ghlCache = { data, fetchedAt: Date.now() };
      return data;
    })
    .finally(() => {
      ghlCacheInFlight = null;
    });

  return ghlCacheInFlight;
}

/**
 * Fuente PRIMARIA de leads para vtower: TODAS las oportunidades del
 * "Marketing Pipeline" (ver nota de arriba sobre por qué solo ese
 * pipeline), convertidas a RawLead[]. NO descarta oportunidades sin correo
 * (se dedupe por id de oportunidad, no por correo) — así un contacto sin
 * correo sigue apareciendo como lead en la tabla.
 */
export async function getGhlRawLeads(): Promise<RawLead[]> {
  const { pipelines, usersMap, opportunities } = await getGhlData();

  const leads = opportunities.map((opp) => {
    const pipeline = pipelines.get(opp.pipelineId);
    const stage = pipeline?.stages.find((s) => s.id === opp.pipelineStageId);

    return ghlLeadToRawLead({
      createdAt: opp.createdAt || opp.dateAdded || '',
      nombre: opp.contact?.name || opp.name || 'Sin nombre',
      correo: opp.contact?.email || '',
      telefono: opp.contact?.phone || '',
      fuente: opp.source || '',
      campana: pickCampaignFromAttributions(opp.attributions),
      estadoGHL: stage?.name ?? 'Sin etapa',
      pipelineGHL: pipeline?.name ?? 'Sin pipeline',
      personaEncargadaGHL: opp.assignedTo ? (usersMap.get(opp.assignedTo) ?? 'Sin asignar') : 'Sin asignar',
    });
  });

  console.log(`[ghl] getGhlRawLeads: ${leads.length} oportunidades de "${MARKETING_PIPELINE_NAME}" convertidas a leads.`);

  return leads;
}

/**
 * Mapa por correo normalizado — para ENRIQUECER leads que ya vienen de otro
 * lado (no se usa en el flujo principal de vtower, que usa GHL como fuente
 * primaria vía getGhlRawLeads(); se conserva por si más adelante entra un
 * Sheet fuente y hay que volver a cruzar, ver "Invariante" en el handoff).
 */
export async function getGhlStatusMap(): Promise<GhlStatusMap> {
  const { pipelines, usersMap, opportunities } = await getGhlData();

  const byEmail = new Map<string, GhlStatusEntry>();

  for (const opp of opportunities) {
    const email = normalizeEmail(opp.contact?.email);
    if (!email) continue; // sin correo no podemos cruzarlo con leads de otra fuente

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

/** Busca el estado de GHL de un lead por su correo (ya normalizado o crudo). */
export function lookupGhlStatus(map: GhlStatusMap, email?: string | null): GhlStatusEntry | null {
  const key = normalizeEmail(email);
  if (!key) return null;
  return map.byEmail.get(key) ?? null;
}