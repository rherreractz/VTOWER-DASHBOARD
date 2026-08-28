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

export async function listLeadForms(pageId: string, token: string): Promise<LeadForm[]> {
  const apiVersion = process.env.META_API_VERSION || 'v22.0';
  const url = new URL(`${GRAPH_BASE}/${apiVersion}/${pageId}/leadgen_forms`);
  url.searchParams.set('fields', 'id,name,status');
  url.searchParams.set('access_token', token);

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