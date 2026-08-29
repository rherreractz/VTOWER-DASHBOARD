import { NextResponse } from 'next/server';
import { getGhlRawLeads } from '@/lib/ghl';
import { processLeads } from '@/lib/leadUtils';

/**
 * Devuelve los leads actuales (100% GoHighLevel). Antes esta ruta existía
 * para el botón "Cargar más leads" ligado a un límite de contactos de
 * HubSpot (?hubspotLimit=500) — ya no aplica: getGhlRawLeads() siempre trae
 * TODAS las oportunidades de la cuenta de una sola vez (con caché de 10 min
 * en lib/ghl.ts), así que no existe un concepto de "cargar más" por límite.
 * Nada del cliente llama hoy esta ruta (no hay botón "Cargar más" en la UI
 * actual) — se deja disponible por si hace falta más adelante.
 */
export async function GET() {
  const rawLeads = await getGhlRawLeads();
  const leads = processLeads(rawLeads);

  return NextResponse.json({ leads, hasMore: false });
}