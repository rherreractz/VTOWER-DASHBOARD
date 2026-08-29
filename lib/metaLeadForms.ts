/**
 * Lee los formularios de leads (Instant Forms / Lead Ads) de una Página de
 * Facebook, para poder usarlos automáticamente en los anuncios sin que
 * nadie tenga que copiar el Form ID a mano — solo el nombre (ej. "Live
 * General").
 */

const GRAPH_BASE = 'https://graph.facebook.com';

export interface LeadForm {
  id: string;
  name: string;
  status: string;
}

/**
 * El edge `leadgen_forms` (y varios otros edges de Página) exige un PAGE
 * ACCESS TOKEN — no basta con el token general del usuario del sistema,
 * aunque tenga rol de Admin/Control total sobre la Página. Si se le pasa
 * el token "de siempre" (META_ACCESS_TOKEN), Meta responde con un error
 * engañoso: "(#100) Tried accessing nonexisting field (leadgen_forms)",
 * que en realidad es un problema de tipo de token, no de que el campo no
 * exista.
 *
 * Este helper hace el intercambio: usa el token del usuario del sistema
 * para pedirle a Meta el token específico de esa Página (solo funciona si
 * el usuario del sistema tiene esa Página asignada con acceso).
 */
async function getPageAccessToken(pageId: string, systemUserToken: string, apiVersion: string): Promise<string> {
  const url = new URL(`${GRAPH_BASE}/${apiVersion}/${pageId}`);
  url.searchParams.set('fields', 'access_token');
  url.searchParams.set('access_token', systemUserToken);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (!res.ok || !data.access_token) {
    console.error(`[metaLeadForms] No se pudo obtener el Page Access Token de ${pageId}:`, data);
    // Si falla el intercambio, se intenta con el token original como
    // último recurso (por si acaso Meta cambia este comportamiento).
    return systemUserToken;
  }

  return data.access_token as string;
}

export async function listLeadForms(pageId: string, token: string): Promise<LeadForm[]> {
  const apiVersion = process.env.META_API_VERSION || 'v22.0';
  const pageToken = await getPageAccessToken(pageId, token, apiVersion);

  const url = new URL(`${GRAPH_BASE}/${apiVersion}/${pageId}/leadgen_forms`);
  url.searchParams.set('fields', 'id,name,status');
  url.searchParams.set('access_token', pageToken);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (!res.ok) {
    console.error(`[metaLeadForms] Error ${res.status} al leer formularios de la página ${pageId}:`, data);
    return [];
  }

  return (data.data ?? []) as LeadForm[];
}

/**
 * Busca un formulario por nombre (coincidencia parcial, sin distinguir
 * mayúsculas/minúsculas). Si hay varios activos con ese nombre, toma el
 * primero.
 */
export async function findLeadFormByName(pageId: string, token: string, name: string): Promise<LeadForm | null> {
  const forms = await listLeadForms(pageId, token);
  const normalized = name.trim().toLowerCase();
  return forms.find((f) => f.name.toLowerCase().includes(normalized) && f.status === 'ACTIVE') ?? forms.find((f) => f.name.toLowerCase().includes(normalized)) ?? null;
}