import { NextResponse } from 'next/server';

/**
 * RUTA TEMPORAL DE DIAGNÓSTICO — bórrala cuando ya no la necesites.
 *
 * Abre esto en tu navegador (con el proyecto corriendo: npm run dev):
 * http://localhost:3000/api/ghl-debug
 *
 * Te muestra el JSON real de tus pipelines (con sus Stages y los IDs
 * internos de cada uno) y tus usuarios — así sabes exactamente qué nombres
 * usar, sin adivinar desde la interfaz de GHL.
 */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

export async function GET() {
  const token = process.env.GHL_PRIVATE_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!token || !locationId) {
    return NextResponse.json(
      { error: 'Faltan GHL_PRIVATE_TOKEN / GHL_LOCATION_ID en tu .env.local.' },
      { status: 400 },
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Version: GHL_API_VERSION,
    Accept: 'application/json',
  };

  const [pipelinesRes, usersRes, opportunitiesRes] = await Promise.all([
    fetch(`${GHL_API_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { headers }),
    fetch(`${GHL_API_BASE}/users/?locationId=${encodeURIComponent(locationId)}`, { headers }),
    fetch(`${GHL_API_BASE}/opportunities/search?location_id=${encodeURIComponent(locationId)}&limit=2`, { headers }),
  ]);

  const pipelines = pipelinesRes.ok ? await pipelinesRes.json() : { error: await pipelinesRes.text(), status: pipelinesRes.status };
  const users = usersRes.ok ? await usersRes.json() : { error: await usersRes.text(), status: usersRes.status };
  const opportunitiesSample = opportunitiesRes.ok
    ? await opportunitiesRes.json()
    : { error: await opportunitiesRes.text(), status: opportunitiesRes.status };

  return NextResponse.json(
    {
      nota: 'Ruta temporal de diagnóstico — bórrala cuando termines de confirmar los nombres.',
      pipelines,
      users,
      opportunitiesSample,
    },
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}