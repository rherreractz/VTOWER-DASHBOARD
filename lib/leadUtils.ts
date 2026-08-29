import type { RawLead, ProcessedLead, MotivoCategoria, LeadStatus } from './types';
import type { HubspotStatusMap, HubspotContactInfo } from './hubspot';
import type { GhlStatusMap } from './ghl';

const SMALL_WORDS = new Set([
  'a', 'de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'o', 'un', 'una', 'al',
]);

/**
 * Limpia un valor "crudo" proveniente de Facebook Lead Ads.
 * Ej: "en_los_próximos_3_a_6_meses." -> "En los próximos 3 a 6 meses"
 */
export function cleanRawText(value?: string | null): string {
  if (!value) return 'No especificado';

  const normalized = value
    .replace(/_/g, ' ')
    .replace(/\.+$/, '')
    .trim()
    .toLowerCase();

  if (!normalized) return 'No especificado';

  return normalized
    .split(' ')
    .filter(Boolean)
    .map((word, index) => {
      if (/^\d/.test(word)) return word;
      if (index !== 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Limpia específicamente montos de presupuesto, preservando el símbolo "$"
 * y normalizando unidades monetarias a mayúsculas.
 * Ej: "$2_a_3_mdp" -> "$2 a 3 MDP"
 */
export function cleanBudget(value?: string | null): string {
  if (!value) return 'No especificado';

  let cleaned = value.replace(/_/g, ' ').replace(/\.+$/, '').trim();
  cleaned = cleaned
    .replace(/\bmdp\b/gi, 'MDP')
    .replace(/\busd\b/gi, 'USD')
    .replace(/\bmxn\b/gi, 'MXN');

  return cleaned || 'No especificado';
}

/** Extrae el primer número de un string, útil para ordenar rangos de presupuesto. */
function extractLeadingNumber(text: string): number {
  const match = text.match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : Number.POSITIVE_INFINITY;
}

export function normalizePhone(phone?: string | null): string {
  if (!phone) return '';
  // se queda con los últimos 10 dígitos para tolerar +52, lada, espacios, etc.
  return phone.replace(/\D/g, '').slice(-10);
}

export function normalizeEmail(email?: string | null): string {
  if (!email) return '';
  return email.trim().toLowerCase();
}

/**
 * Clasifica el motivo del lead en "Vivir" / "Invertir" / "Otro" a partir
 * del texto crudo, buscando palabras clave (antes de aplicar cleanRawText).
 */
export function classifyMotivo(motivo?: string | null): MotivoCategoria {
  if (!motivo) return 'Otro';
  const lower = motivo.toLowerCase();
  if (lower.includes('vivir')) return 'Vivir';
  if (lower.includes('invertir') || lower.includes('inversion') || lower.includes('inversión')) {
    return 'Invertir';
  }
  return 'Otro';
}

/**
 * Intenta parsear fechas en formatos comunes de Sheets/Meta (dd/mm/yyyy,
 * dd/mm/yyyy hh:mm:ss, ISO 8601). Devuelve null si no se puede interpretar.
 */
export function parseLeadDate(value?: string | null): Date | null {
  if (!value) return null;

  const dmy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Formatea la fecha para mostrar en la tabla, ej. "07 jul 2026". */
export function formatLeadDate(date: Date | null): string {
  if (!date) return 'Sin fecha';
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Procesa el arreglo crudo proveniente de Google Sheets:
 *  - Limpia campos de texto libre (Presupuesto, Motivo, TiempoParaInvertir).
 *  - Detecta duplicados evaluando Telefono O Correo: la primera ocurrencia
 *    se marca como "Válido", las siguientes con el mismo teléfono o correo
 *    se marcan como "Duplicado".
 */
export function processLeads(rawLeads: RawLead[]): ProcessedLead[] {
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  return rawLeads.map((lead, index) => {
    const phoneKey = normalizePhone(lead.Telefono);
    const emailKey = normalizeEmail(lead.Correo);

    const isDuplicate =
      (phoneKey !== '' && seenPhones.has(phoneKey)) ||
      (emailKey !== '' && seenEmails.has(emailKey));

    if (phoneKey) seenPhones.add(phoneKey);
    if (emailKey) seenEmails.add(emailKey);

    const parsedDate = parseLeadDate(lead.Fecha);

    return {
      ...lead,
      id: `lead-${index}-${phoneKey || emailKey || index}`,
      status: isDuplicate ? 'Duplicado' : 'Válido',
      parsedDate,
      presupuestoClean: cleanBudget(lead.Presupuesto),
      motivoClean: cleanRawText(lead.Motivo),
      tiempoClean: cleanRawText(lead.TiempoParaInvertir),
      motivoCategoria: classifyMotivo(lead.Motivo),
    };
  });
}

/**
 * Convierte un contacto de HubSpot (que no tiene lead correspondiente en el
 * Sheet) en un RawLead "sintético". Los campos que solo existen en el Sheet
 * (Presupuesto, Motivo, Campaña, etc.) quedan vacíos porque HubSpot no los
 * tiene — se muestran como "No especificado" una vez que pasan por
 * processLeads().
 */
function hubspotContactToRawLead(contact: HubspotContactInfo): RawLead {
  return {
    Fecha: contact.fechaCreacion || '',
    Campana: 'HubSpot',
    Nombre: contact.nombre || 'Sin nombre',
    Correo: contact.correo || '',
    Telefono: contact.telefono || '',
    Presupuesto: '',
    Motivo: '',
    TiempoParaInvertir: '',
    Equipo: '',
    Fuente: 'HubSpot',
    Proveedor: '',
    Formulario: '',
    Etapa: '',
    Comentarios: 'Contacto de HubSpot sin lead correspondiente en el Google Sheet.',
  };
}

/**
 * Convierte TODOS los contactos de HubSpot en RawLead. Útil si algún día
 * quieres usar HubSpot como única fuente. Los campos que solo existían en
 * el Sheet (Presupuesto, Motivo, Campaña real, etc.) quedan vacíos.
 */
export function getHubspotRawLeads(hubspotMap: HubspotStatusMap): RawLead[] {
  return hubspotMap.all.map(hubspotContactToRawLead);
}

// ---------------------------------------------------------------------------
// GoHighLevel como fuente PRIMARIA de leads (vtower) — equivalente a
// hubspotContactToRawLead()/getHubspotRawLeads() de arriba, pero para GHL.
// ---------------------------------------------------------------------------

/**
 * Forma ya resuelta de una oportunidad de GHL (nombre de stage, de pipeline
 * y de la persona asignada ya buscados) — no el objeto crudo de la API
 * (ese vive en lib/ghl.ts, que ya tiene sus propios tipos). Se define como
 * forma plana aquí, en vez de importar los tipos de ghl.ts, para evitar un
 * import circular en tiempo de ejecución (ghl.ts ya importa funciones de
 * este archivo).
 */
export interface GhlLeadInput {
  createdAt: string;
  nombre: string;
  correo: string;
  telefono: string;
  fuente: string;
  /** Nombre de campaña sacado de la atribución UTM de GHL (utmCampaign), si existe. */
  campana: string;
  estadoGHL: string;
  pipelineGHL: string;
  personaEncargadaGHL: string;
}

/**
 * Convierte una oportunidad de GoHighLevel en un RawLead, para usarla como
 * fuente PRIMARIA (a diferencia de mergeGhlStatus(), que solo enriquece
 * leads que ya vienen de otro lado). Los campos que solo existían en el
 * Sheet/HubSpot y que GHL no tiene de forma nativa (Presupuesto, Motivo,
 * TiempoParaInvertir, Equipo, Proveedor) quedan vacíos — se muestran como
 * "No especificado" (o "—" en la tabla) una vez procesados. "Fuente" se
 * llena con el campo `source` de la oportunidad (ej. "Facebook"); si no
 * viene, cae a "GoHighLevel". "Campaña" se llena con el `utmCampaign` de
 * la atribución de GHL cuando existe (ej. "V Tower | Lead Generation"); si
 * no hay atribución, queda vacía ("No especificado").
 *
 * Importante: además de los campos de RawLead, esto agrega
 * estadoGHL/pipelineGHL/personaEncargadaGHL directamente en el objeto (en
 * vez de depender de mergeGhlStatus(), que cruza por correo) — así un lead
 * SIN correo no se queda sin su estado de GHL. processLeads() conserva
 * cualquier propiedad extra del objeto original porque arma el resultado
 * con spread (`{ ...lead, ... }`), y ProcessedLead ya declara esos tres
 * campos como opcionales (lib/types.ts) — no hace falta tocar ese tipo.
 */
export function ghlLeadToRawLead(
  g: GhlLeadInput,
): RawLead & { estadoGHL: string; pipelineGHL: string; personaEncargadaGHL: string } {
  return {
    Fecha: g.createdAt,
    Campana: g.campana || '',
    Nombre: g.nombre || 'Sin nombre',
    Correo: g.correo,
    Telefono: g.telefono,
    Presupuesto: '',
    Motivo: '',
    TiempoParaInvertir: '',
    Equipo: '',
    Fuente: g.fuente || 'GoHighLevel',
    Proveedor: '',
    Formulario: '',
    Etapa: g.estadoGHL,
    Comentarios: `Oportunidad de GoHighLevel · Pipeline: ${g.pipelineGHL}.`,
    estadoGHL: g.estadoGHL,
    pipelineGHL: g.pipelineGHL,
    personaEncargadaGHL: g.personaEncargadaGHL,
  };
}

/**
 * Devuelve un RawLead sintético por cada contacto de HubSpot que NO tenga
 * ya un lead con el mismo teléfono o correo en `existingLeads` (los del
 * Google Sheet). Se usa para combinar ambas fuentes sin duplicar: el Sheet
 * sigue siendo la base (con Equipo/Fuente/Proveedor reales), y esto agrega
 * los contactos que solo existen en HubSpot (ej. los que no pasaron por el
 * flujo normal de Meta Lead Ads).
 */
export function getHubspotOnlyRawLeads(existingLeads: RawLead[], hubspotMap: HubspotStatusMap): RawLead[] {
  const existingPhones = new Set<string>();
  const existingEmails = new Set<string>();

  existingLeads.forEach((lead) => {
    const phoneKey = normalizePhone(lead.Telefono);
    const emailKey = normalizeEmail(lead.Correo);
    if (phoneKey) existingPhones.add(phoneKey);
    if (emailKey) existingEmails.add(emailKey);
  });

  const nuevos = hubspotMap.all.filter((contact) => {
    const phoneKey = normalizePhone(contact.telefono);
    const emailKey = normalizeEmail(contact.correo);
    return !((phoneKey && existingPhones.has(phoneKey)) || (emailKey && existingEmails.has(emailKey)));
  });

  console.log(
    `[hubspot] Leads del Sheet: ${existingLeads.length} | Contactos de HubSpot: ${hubspotMap.all.length} | Solo en HubSpot: ${nuevos.length}`,
  );

  return nuevos.map(hubspotContactToRawLead);
}

/**
 * Cruza los leads procesados (Google Sheets) con el mapa de estados de
 * HubSpot, buscando primero por teléfono y usando el correo como respaldo.
 * Los leads sin match en HubSpot quedan con 'Sin dato' en ambos campos.
 */
export function mergeHubspotStatus(leads: ProcessedLead[], hubspotMap: HubspotStatusMap): ProcessedLead[] {
  let matched = 0;

  const result = leads.map((lead) => {
    const phoneKey = normalizePhone(lead.Telefono);
    const emailKey = normalizeEmail(lead.Correo);

    const match =
      (phoneKey ? hubspotMap.byPhone.get(phoneKey) : undefined) ??
      (emailKey ? hubspotMap.byEmail.get(emailKey) : undefined);

    if (match) matched += 1;

    return {
      ...lead,
      estadoLeadCrm: match?.estadoLead || 'Sin dato',
      etapaLeadCrm: match?.etapaLead || 'Sin dato',
      propietarioCrm: match?.propietario || 'Sin asignar',
      crmExtra: match?.extra || {},
    };
  });

  console.log(
    `[hubspot] Cruce Sheet <-> HubSpot: ${matched} de ${leads.length} leads del Sheet encontraron su contacto en HubSpot (de ${hubspotMap.byPhone.size} tel. / ${hubspotMap.byEmail.size} correos indexados).`,
  );

  return result;
}

/**
 * Cruza los leads con el estado de GoHighLevel — SOLO por correo (a
 * diferencia de HubSpot, que también intenta por teléfono), porque así lo
 * pidió el equipo explícitamente para esta integración.
 */
export function mergeGhlStatus(leads: ProcessedLead[], ghlMap: GhlStatusMap): ProcessedLead[] {
  let matched = 0;

  const result = leads.map((lead) => {
    const emailKey = normalizeEmail(lead.Correo);
    const match = emailKey ? ghlMap.byEmail.get(emailKey) : undefined;

    if (match) matched += 1;

    return {
      ...lead,
      estadoGHL: match?.estadoGHL || 'Sin dato',
      pipelineGHL: match?.pipelineGHL || 'Sin dato',
      personaEncargadaGHL: match?.personaEncargadaGHL || 'Sin asignar',
    };
  });

  console.log(`[ghl] Cruce Sheet <-> GoHighLevel: ${matched} de ${leads.length} leads encontraron su oportunidad en GHL (de ${ghlMap.byEmail.size} correos indexados).`);

  return result;
}

// ---------------------------------------------------------------------------
// Agregaciones para alimentar las gráficas de Recharts
// ---------------------------------------------------------------------------

export function groupByDate(leads: ProcessedLead[]) {
  const counts = new Map<string, number>();

  leads.forEach((lead) => {
    if (!lead.parsedDate) return;
    const key = formatDateKey(lead.parsedDate);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([date, total]) => ({
      date,
      label: new Date(`${date}T00:00:00`).toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
      }),
      total,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Igual que groupByDate, pero separa el conteo de cada día por semáforo de
 * etapa (Verde/Amarillo/Rojo/Sin clasificar) — para la gráfica de líneas
 * con filtro de color.
 */
export function groupByDateColor(leads: ProcessedLead[]) {
  const counts = new Map<string, { Verde: number; Amarillo: number; Rojo: number; SinClasificar: number }>();

  leads.forEach((lead) => {
    if (!lead.parsedDate) return;
    const key = formatDateKey(lead.parsedDate);
    if (!counts.has(key)) counts.set(key, { Verde: 0, Amarillo: 0, Rojo: 0, SinClasificar: 0 });
    const bucket = counts.get(key)!;

    const color = getSemaforoColor(lead);
    if (color === 'Verde') bucket.Verde += 1;
    else if (color === 'Amarillo') bucket.Amarillo += 1;
    else if (color === 'Rojo') bucket.Rojo += 1;
    else bucket.SinClasificar += 1;
  });

  return Array.from(counts.entries())
    .map(([date, values]) => ({
      date,
      label: new Date(`${date}T00:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
      ...values,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function groupByBudget(leads: ProcessedLead[]) {
  const counts = new Map<string, number>();

  leads.forEach((lead) => {
    counts.set(lead.presupuestoClean, (counts.get(lead.presupuestoClean) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => extractLeadingNumber(a.label) - extractLeadingNumber(b.label));
}

export function groupByMotivo(leads: ProcessedLead[]) {
  const counts = { Vivir: 0, Invertir: 0, Otro: 0 };

  leads.forEach((lead) => {
    counts[lead.motivoCategoria] += 1;
  });

  return [
    { name: 'Vivir', value: counts.Vivir },
    { name: 'Invertir', value: counts.Invertir },
    { name: 'Otro', value: counts.Otro },
  ].filter((entry) => entry.value > 0);
}

// ---------------------------------------------------------------------------
// Semáforo de etapas — rojo (descartado) / amarillo (registro) / verde (avanzando)
// ---------------------------------------------------------------------------

/**
 * Clasifica una etapa de GoHighLevel por su NÚMERO inicial (ej. "10 -
 * Registro" -> 10), no por el texto — porque en GHL el número es el
 * contrato real: 10 = recién registrado, 20-99 = avanzando por el pipeline
 * normal, 100+ = cualquier motivo de descarte (Inválido, No responde, No
 * da cita, No acude a cita, No hay negocio, Cancela reserva, etc.). Así,
 * si el equipo agrega una etapa nueva en el rango 100+, se clasifica sola
 * como Rojo sin que haya que tocar código.
 */
export function classifyGhlStageNumber(stageName: string): 'Rojo' | 'Amarillo' | 'Verde' | null {
  const match = stageName.trim().match(/^(\d+)/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (num >= 100) return 'Rojo';
  if (num === 10) return 'Amarillo';
  if (num > 10 && num < 100) return 'Verde';
  return null;
}

/**
 * Clasifica el texto de una etapa/estado en un color de semáforo, por
 * COINCIDENCIA DE PALABRA CLAVE (no exacta) — porque los valores reales que
 * llegan de HubSpot/Sheet varían bastante ("No califica", "Primer contacto
 * sin respuesta", etc.) y casi nunca coinciden letra por letra con una
 * lista fija. El orden de los checks importa: los más específicos van
 * primero, para que por ejemplo "no da cita" no termine cayendo en la regla
 * genérica de "cita", o "primer contacto sin respuesta" no caiga en la de
 * "primer contacto" a secas.
 */
function classifyEtapaColor(etapaRaw: string): 'Rojo' | 'Amarillo' | 'Verde' | null {
  const v = etapaRaw.trim().toLowerCase();
  if (!v) return null;

  // --- Rojo: descartado / no avanza ---
  if (v.includes('no califica')) return 'Rojo';
  if (v.includes('inválido') || v.includes('invalido')) return 'Rojo';
  if (v.includes('no responde')) return 'Rojo';
  if (v.includes('no da cita')) return 'Rojo';

  // --- Amarillo: todavía pendiente / sin resolver ---
  if (v.includes('sin respuesta')) return 'Amarillo'; // ej. "Primer contacto sin respuesta"
  if (v.includes('registro')) return 'Amarillo';

  // --- Verde: ya hubo avance/interacción real ---
  if (v.includes('contacto')) return 'Verde'; // "Contacto", "Primer contacto" (sin "sin respuesta", ya se descartó arriba)
  if (v.includes('cita')) return 'Verde'; // "Cita" (ya se descartó "no da cita" arriba)
  if (v.includes('visita')) return 'Verde';
  if (v.includes('informes')) return 'Verde';
  if (v.includes('negocio')) return 'Verde';

  return null;
}

/**
 * Mapa FIJO etapa (nombre exacto tal como aparece en GHL) -> color, para las
 * etapas reales del "Marketing Pipeline" de vtower — confirmado con el
 * equipo (ago-2026), ya que vtower NO usa la numeración tipo "10 -
 * Registro" de Live (classifyGhlStageNumber no aplica aquí).
 *
 * Es un mapeo EXACTO por nombre, no por palabra clave — si en algún
 * momento el equipo agrega o renombra una etapa en GHL, esa etapa nueva
 * cae a "Sin clasificar" (gris) hasta que se agregue aquí a propósito, en
 * vez de adivinar mal por keyword.
 */
const VTOWER_MARKETING_STAGE_COLOR: Record<string, 'Rojo' | 'Amarillo' | 'Verde'> = {
  brokers: 'Amarillo', // leads canalizados a agentes/brokers externos — confirmado con el equipo
  descarte: 'Rojo',
  'nuevo lead': 'Amarillo',
  'intento de contacto': 'Amarillo', // se intentó pero no se confirma contacto — confirmado con el equipo
  contactado: 'Verde',
  calificado: 'Verde',
  'cita agendada': 'Verde',
  'cita realizada': 'Verde',
  negociación: 'Verde',
  negociacion: 'Verde', // por si en algún punto se guarda/exporta sin acento
  apartado: 'Verde',
  'venta cerrada': 'Verde',
};

/** Clasifica una etapa del "Marketing Pipeline" de vtower por su nombre EXACTO (ver tabla de arriba). */
function classifyVtowerMarketingStage(stageName: string): 'Rojo' | 'Amarillo' | 'Verde' | null {
  const key = stageName.trim().toLowerCase();
  return VTOWER_MARKETING_STAGE_COLOR[key] ?? null;
}

/**
 * Punto único de verdad para el semáforo de un lead. Orden de prioridad:
 *  1. Nombre exacto de etapa del "Marketing Pipeline" de vtower (más
 *     confiable — es el mapa que el equipo confirmó a mano).
 *  2. Número inicial de la etapa GHL (convención de Live, "10 - Registro"
 *     — vtower no la usa hoy, pero se deja como red de seguridad genérica
 *     por si algún día aplica).
 *  3. Palabra clave sobre la Etapa de HubSpot/Sheet (fallback histórico de
 *     Live, tampoco debería activarse en vtower hoy).
 */
export function getSemaforoColor(lead: ProcessedLead): 'Rojo' | 'Amarillo' | 'Verde' | null {
  if (lead.estadoGHL) {
    const fromVtowerStage = classifyVtowerMarketingStage(lead.estadoGHL);
    if (fromVtowerStage) return fromVtowerStage;

    const fromGhl = classifyGhlStageNumber(lead.estadoGHL);
    if (fromGhl) return fromGhl;
  }
  return classifyEtapaColor(lead.etapaLeadCrm || lead.Etapa || '');
}

/** Agrupa los leads por semáforo de etapa (prioriza GHL, cae a HubSpot/Sheet si no hay match). */
export function groupByEtapaColor(leads: ProcessedLead[]) {
  const counts = { Verde: 0, Amarillo: 0, Rojo: 0, 'Sin clasificar': 0 };

  leads.forEach((lead) => {
    const color = getSemaforoColor(lead);
    if (color) counts[color] += 1;
    else counts['Sin clasificar'] += 1;
  });

  return [
    { name: 'Verde (avanzando)', value: counts.Verde, colorKey: 'green' as const },
    { name: 'Amarillo (registro)', value: counts.Amarillo, colorKey: 'yellow' as const },
    { name: 'Rojo (descartado)', value: counts.Rojo, colorKey: 'red' as const },
    { name: 'Sin clasificar', value: counts['Sin clasificar'], colorKey: 'gray' as const },
  ].filter((entry) => entry.value > 0);
}

// ---------------------------------------------------------------------------
// Filtros interactivos para el dashboard
// ---------------------------------------------------------------------------

export interface LeadFilters {
  /** 'all' o el valor exacto de la columna Campana */
  campaign: string;
  /** 'all' o 'YYYY-MM' */
  month: string;
  status: 'all' | LeadStatus;
  /** 'all' o el valor exacto de la columna Equipo */
  equipo: string;
  /** 'all' o el valor exacto de la columna Fuente (Instagram, Meta/Facebook, WhatsApp, etc.) */
  fuente: string;
  /** 'all' o el valor exacto de la columna Proveedor */
  proveedor: string;
  /** 'all' o el valor exacto de la columna Etapa */
  etapa: string;
  /** Ventana rápida de tiempo, independiente del filtro de mes específico. */
  periodo: 'todos' | 'semana' | 'mes' | 'año';
}

export const DEFAULT_LEAD_FILTERS: LeadFilters = {
  campaign: 'all',
  month: 'all',
  status: 'all',
  equipo: 'all',
  fuente: 'all',
  proveedor: 'all',
  etapa: 'all',
  periodo: 'todos',
};

/** Helper genérico: valores únicos no vacíos de un campo de texto del lead, ordenados alfabéticamente. */
function getUniqueValues(leads: ProcessedLead[], field: keyof ProcessedLead): string[] {
  const set = new Set<string>();
  leads.forEach((lead) => {
    const value = (lead[field] as string | undefined)?.trim();
    if (value) set.add(value);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Lista de campañas únicas (no vacías), ordenadas alfabéticamente. */
export function getUniqueCampaigns(leads: ProcessedLead[]): string[] {
  return getUniqueValues(leads, 'Campana');
}

/** Lista de equipos únicos (no vacíos), ordenados alfabéticamente. */
export function getUniqueEquipos(leads: ProcessedLead[]): string[] {
  return getUniqueValues(leads, 'Equipo');
}

/** Lista de fuentes únicas (Instagram, Meta/Facebook, WhatsApp, etc.). */
export function getUniqueFuentes(leads: ProcessedLead[]): string[] {
  return getUniqueValues(leads, 'Fuente');
}

/** Lista de proveedores únicos. */
export function getUniqueProveedores(leads: ProcessedLead[]): string[] {
  return getUniqueValues(leads, 'Proveedor');
}

/** Lista de etapas únicas (estado del lead dentro del proceso de atención). */
export function getUniqueEtapas(leads: ProcessedLead[]): string[] {
  return getUniqueValues(leads, 'Etapa');
}

/** Meses únicos presentes en los datos, con label en español, más reciente primero. */
export function getUniqueMonths(leads: ProcessedLead[]): { value: string; label: string }[] {
  const map = new Map<string, string>();

  leads.forEach((lead) => {
    if (!lead.parsedDate) return;
    const value = lead.parsedDate.toISOString().slice(0, 7); // YYYY-MM
    if (!map.has(value)) {
      const label = lead.parsedDate.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
      map.set(value, label.charAt(0).toUpperCase() + label.slice(1));
    }
  });

  return Array.from(map.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => b.value.localeCompare(a.value));
}

/** Aplica todos los filtros activos sobre el arreglo de leads procesados. */
export function filterLeads(leads: ProcessedLead[], filters: LeadFilters): ProcessedLead[] {
  return leads.filter((lead) => {
    if (filters.status !== 'all' && lead.status !== filters.status) return false;
    if (filters.campaign !== 'all' && lead.Campana?.trim() !== filters.campaign) return false;
    if (filters.equipo !== 'all' && lead.Equipo?.trim() !== filters.equipo) return false;
    if (filters.fuente !== 'all' && lead.Fuente?.trim() !== filters.fuente) return false;
    if (filters.proveedor !== 'all' && lead.Proveedor?.trim() !== filters.proveedor) return false;
    if (filters.etapa !== 'all' && lead.Etapa?.trim() !== filters.etapa) return false;

    if (filters.month !== 'all') {
      if (!lead.parsedDate) return false;
      if (lead.parsedDate.toISOString().slice(0, 7) !== filters.month) return false;
    }

    if (filters.periodo !== 'todos') {
      if (!lead.parsedDate) return false;
      const days = filters.periodo === 'semana' ? 7 : filters.periodo === 'mes' ? 30 : 365;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      if (lead.parsedDate.getTime() < cutoff) return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// Calidad histórica de leads — insumo para que la IA genere campañas nuevas
// informada por qué canales/campañas han dado leads reales de mejor calidad
// (no solo la auditoría técnica de la cuenta de Meta).
// ---------------------------------------------------------------------------

export interface LeadQualityGroup {
  key: string;
  total: number;
  verde: number;
  amarillo: number;
  rojo: number;
  sinClasificar: number;
  /** % de leads en Verde (avanzando) sobre el total del grupo, 0-100. */
  verdePct: number;
}

/** Tamaño mínimo de muestra para que un grupo sea representativo — evita que una Fuente con 2 leads (1 de ellos bueno) parezca "100% verde". */
const MIN_SAMPLE_SIZE = 5;

function groupLeadQuality(leads: ProcessedLead[], keyFn: (lead: ProcessedLead) => string): LeadQualityGroup[] {
  const groups = new Map<string, { total: number; verde: number; amarillo: number; rojo: number; sinClasificar: number }>();

  leads.forEach((lead) => {
    const key = keyFn(lead) || 'Sin dato';
    if (!groups.has(key)) groups.set(key, { total: 0, verde: 0, amarillo: 0, rojo: 0, sinClasificar: 0 });
    const g = groups.get(key)!;
    g.total += 1;

    const color = getSemaforoColor(lead);
    if (color === 'Verde') g.verde += 1;
    else if (color === 'Amarillo') g.amarillo += 1;
    else if (color === 'Rojo') g.rojo += 1;
    else g.sinClasificar += 1;
  });

  return Array.from(groups.entries())
    .map(([key, g]) => ({ key, ...g, verdePct: g.total > 0 ? Math.round((g.verde / g.total) * 100) : 0 }))
    .filter((g) => g.total >= MIN_SAMPLE_SIZE)
    .sort((a, b) => b.verdePct - a.verdePct);
}

/** Calidad de leads agrupada por Fuente (fb/ig/an/HubSpot/etc.) — cuál canal da los leads que más avanzan. */
export function summarizeLeadQualityByFuente(leads: ProcessedLead[]): LeadQualityGroup[] {
  return groupLeadQuality(leads, (lead) => lead.Fuente?.trim() ?? '');
}

/** Calidad de leads agrupada por Campaña — cuáles campañas anteriores dieron leads que más avanzaron. */
export function summarizeLeadQualityByCampana(leads: ProcessedLead[]): LeadQualityGroup[] {
  return groupLeadQuality(leads, (lead) => lead.Campana?.trim() ?? '');
}

/**
 * Un punto de la gráfica de historial de calidad — mismo tipo que espera
 * LeadQualityHistoryChart en components/dashboard/lead-charts.tsx. Se
 * define aquí (no allá) porque leadUtils.ts es seguro de importar tanto
 * desde Server Components (app/page.tsx) como Client Components
 * (dashboard-shell.tsx) — lead-charts.tsx es 'use client', así que
 * importar un tipo desde ahí en un Server Component sería más frágil.
 */
export interface LeadQualityHistoryChartPoint {
  /** Fecha ya formateada para mostrar en el eje X (ej. "14 ago") */
  label: string;
  /** Un valor 0-100 (o null si esa Fuente no tenía muestra suficiente ese día) por cada Fuente presente en el histórico. */
  [fuenteKey: string]: string | number | null;
}

/**
 * Transforma el historial guardado (un LeadQualityGroup[] por día, ver
 * lib/leadQualityStorage.ts) al formato "ancho" que necesita la gráfica
 * de líneas (LeadQualityHistoryChart en lead-charts.tsx): un objeto por
 * día, con una propiedad por Fuente.
 *
 * También regresa la lista de nombres de Fuente presentes en TODO el
 * histórico (no solo el día más reciente), para que la gráfica sepa
 * cuántas líneas dibujar — una Fuente que ya no aparece en los últimos
 * días pero sí en días anteriores igual debe verse en su tramo histórico.
 */
export function buildLeadQualityHistoryChartData(
  history: { dateKey: string; byFuente: LeadQualityGroup[] }[],
): { data: LeadQualityHistoryChartPoint[]; fuentes: string[] } {
  const allFuentes = new Set<string>();
  history.forEach((point) => point.byFuente.forEach((g) => allFuentes.add(g.key)));

  const fuentes = Array.from(allFuentes).sort();

  const data: LeadQualityHistoryChartPoint[] = history.map((point) => {
    const row: LeadQualityHistoryChartPoint = {
      label: new Date(`${point.dateKey}T00:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
    };
    fuentes.forEach((fuente) => {
      const match = point.byFuente.find((g) => g.key === fuente);
      row[fuente] = match ? match.verdePct : null; // null = sin muestra suficiente ese día, la línea se conecta (connectNulls) en vez de romperse
    });
    return row;
  });

  return { data, fuentes };
}