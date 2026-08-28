import { NextRequest, NextResponse } from 'next/server';
import { listLeadForms } from '@/lib/metaLeadForms';

export async function GET(req: NextRequest) {
  const pageId = req.nextUrl.searchParams.get('pageId');
  if (!pageId) {
    return NextResponse.json({ error: 'pageId es requerido.' }, { status: 400 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Falta META_ACCESS_TOKEN.' }, { status: 500 });
  }

  const forms = await listLeadForms(pageId, token);
  return NextResponse.json({ forms });
}