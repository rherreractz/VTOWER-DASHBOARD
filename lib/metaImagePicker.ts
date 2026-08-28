import type { DriveMedia } from './driveImages';
import type { AdCopyVariant } from './metaCampaignGenerator';

/**
 * Le pide a Claude que elija, para cada variante de copy, cuál imagen O
 * VIDEO de la carpeta de Drive le queda mejor — basado en el NOMBRE del
 * archivo (no analiza el contenido visual todavía; eso sería una mejora
 * futura mandando el contenido como multimodal a Claude).
 */
export async function pickImagesForVariants(
  variants: AdCopyVariant[],
  images: DriveMedia[],
  campaignContext?: string,
): Promise<Record<number, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || images.length === 0) {
    // Sin API key o sin imágenes disponibles: repartimos por orden simple
    // (round-robin) como respaldo, para no tumbar todo el flujo.
    const fallback: Record<number, string> = {};
    variants.forEach((_, i) => {
      if (images[i % images.length]) fallback[i] = images[i % images.length].id;
    });
    return fallback;
  }

  const systemPrompt = `Eres un director de arte de Meta Ads. Te dan 3 variantes de copy de un anuncio, el contexto de qué desarrollo/negocio es la campaña, y una lista de archivos disponibles (imágenes o videos, solo con su nombre, sin ver el contenido).

En esta cuenta, cada archivo suele nombrarse según el DESARROLLO específico al que pertenece (ej. "Olivia", "Loretta", "Esther" son nombres de desarrollos distintos, no descripciones genéricas). Tu prioridad #1 es identificar de qué desarrollo trata la campaña (usando el contexto que te dan) y elegir SOLO archivos cuyo nombre coincida con ese desarrollo — nunca mezcles archivos de un desarrollo distinto al de la campaña, aunque el nombre "suene bien" para el copy.

Si no hay ninguna pista de desarrollo en el contexto, o ningún archivo coincide con el nombre mencionado, entonces sí reparte por criterio general (que cada variante tenga un archivo distinto).

Sobre el FORMATO: algunos nombres de archivo incluyen "SQ" (cuadrado, 1:1) o "LG" (alargado/vertical). Cuando haya ambas versiones disponibles para el mismo desarrollo, PREFIERE "SQ" — el formato cuadrado es el que Meta recomienda por default y se adapta mejor a la mayoría de las ubicaciones (Feed, Instagram, etc.) sin recortarse mal. Usa "LG" solo si "SQ" no está disponible para ese desarrollo.

Devuelve EXCLUSIVAMENTE un objeto JSON (sin \`\`\`json, sin texto antes o después) con esta forma:
{ "0": "<id del archivo elegido para la variante 1>", "1": "<id para la variante 2>", "2": "<id para la variante 3>" }`;

  const userMessage = `Contexto de la campaña (de aquí sale el nombre del desarrollo, si lo menciona):\n"""\n${campaignContext || '(sin contexto adicional)'}\n"""\n\nVariantes de copy:\n${variants
    .map((v, i) => `${i}. Headline: "${v.headline}" — Texto: "${v.primaryText.slice(0, 150)}"`)
    .join('\n')}\n\nArchivos disponibles:\n${images.map((img) => `id="${img.id}" nombre="${img.name}" tipo="${img.mediaType}"`).join('\n')}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const textBlock = (json.content ?? []).find((b: any) => b.type === 'text');
    if (!textBlock?.text) throw new Error('Sin texto en la respuesta.');

    const cleaned = textBlock.text
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '');

    const parsed = JSON.parse(cleaned) as Record<string, string>;
    const result: Record<number, string> = {};
    Object.entries(parsed).forEach(([key, imageId]) => {
      const index = Number(key);
      if (Number.isFinite(index) && images.some((img) => img.id === imageId)) {
        result[index] = imageId;
      }
    });
    return result;
  } catch (error) {
    console.error('[metaImagePicker] Error al pedirle a Claude que elija imágenes, usando reparto simple:', error);
    const fallback: Record<number, string> = {};
    variants.forEach((_, i) => {
      if (images[i % images.length]) fallback[i] = images[i % images.length].id;
    });
    return fallback;
  }
}