import { getLastMetaAudit } from './metaAuditStorage';
import { getLeadQualitySummary } from './leadQualityStorage';


export async function buildAuditContextText(accountId: string): Promise<string> {
  const stored = await getLastMetaAudit(accountId);

  if (!stored) {
    return 'No hay una auditoría reciente guardada para esta cuenta — genera con criterio general de buenas prácticas de Meta Ads.';
  }

  const { audit, generatedAt } = stored;
  const quickWins = audit.quick_wins ?? [];
  const criticalIssues = audit.critical_issues ?? [];

  const lines: string[] = [
    `Última auditoría de Meta Ads de esta cuenta: ${new Date(generatedAt).toLocaleDateString('es-MX')} — Health Score ${Math.round(audit.health_score)}/100 (${audit.grade}).`,
  ];

  if (criticalIssues.length > 0) {
    lines.push('Problemas críticos detectados (considera si afectan la estrategia de esta campaña nueva):');
    criticalIssues.slice(0, 5).forEach((ci) => lines.push(`- ${ci.blocker_reason}`));
  }

  if (quickWins.length > 0) {
    lines.push('Quick wins / hallazgos recientes (úsalos como inspiración para el ángulo, targeting o estructura — no los repitas literal):');
    quickWins.slice(0, 6).forEach((qw) => lines.push(`- ${qw.action}`));
  }

  if (criticalIssues.length === 0 && quickWins.length === 0) {
    lines.push('La auditoría no encontró problemas críticos ni quick wins pendientes — la cuenta está en buen estado.');
  }

  return lines.join('\n');
}

/**
 * Arma un resumen en texto plano de qué Fuente/Campaña ha dado leads de
 * MEJOR calidad de verdad (según el semáforo Verde/Amarillo/Rojo del
 * dashboard de Leads) — a diferencia de la auditoría de arriba, que solo
 * mide configuración técnica de la cuenta de Meta, esto mide resultados
 * reales de negocio (¿esos leads avanzaron, o se descartaron?).
 *
 * Se calcula una vez cuando alguien carga el dashboard de Leads (ver
 * app/page.tsx) y se guarda — aquí solo se lee, para no tener que volver a
 * mezclar Sheets+HubSpot+GHL desde cero en cada generación de campaña.
 */
export async function buildLeadQualityContextText(): Promise<string> {
  const snapshot = await getLeadQualitySummary();

  if (!snapshot || (snapshot.byFuente.length === 0 && snapshot.byCampana.length === 0)) {
    return 'No hay datos de calidad histórica de leads disponibles todavía (entra al dashboard de Leads al menos una vez para que se calculen).';
  }

  const lines: string[] = [
    `Calidad histórica real de los leads (actualizado ${new Date(snapshot.generatedAt).toLocaleDateString('es-MX')}) — % Verde = leads que sí avanzaron (Contacto/Cita/Visita/Informes/Negocio), no solo se registraron:`,
  ];

  if (snapshot.byFuente.length > 0) {
    lines.push('Por Fuente (de mejor a peor calidad):');
    snapshot.byFuente.slice(0, 6).forEach((g) => lines.push(`- ${g.key}: ${g.verdePct}% avanzó de ${g.total} leads`));
  }

  if (snapshot.byCampana.length > 0) {
    lines.push('Por Campaña anterior (de mejor a peor calidad):');
    snapshot.byCampana.slice(0, 6).forEach((g) => lines.push(`- ${g.key}: ${g.verdePct}% avanzó de ${g.total} leads`));
  }

  return lines.join('\n');
}

export async function buildCampaignContext(accountId: string): Promise<string> {
  const [auditText, leadQualityText] = await Promise.all([buildAuditContextText(accountId), buildLeadQualityContextText()]);

  return [
    '=== Auditoría técnica de la cuenta de Meta Ads ===',
    auditText,
    '',
    '=== Calidad real de los leads generados hasta ahora ===',
    leadQualityText,
  ].join('\n');
}