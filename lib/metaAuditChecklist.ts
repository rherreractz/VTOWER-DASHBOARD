/**
 * Checklist de Meta Ads, copiado de ads/references/meta-audit.md del repo
 * rherreractz/claude-ads, DIVIDIDO por categoría. Se llama a Claude una vez
 * por categoría (4 llamadas paralelas) en vez de una sola llamada gigante
 * con los 50 checks — una respuesta de ese tamaño se corta antes de
 * terminar el JSON incluso con max_tokens alto. Dividido, cada llamada es
 * pequeña y confiable.
 */

export interface AuditCategory {
  key: string;
  label: string;
  weight: number;
  checklist: string;
}

export const AUDIT_CATEGORIES: AuditCategory[] = [
  {
    key: 'pixel_capi',
    label: 'Pixel / CAPI Health',
    weight: 0.3,
    checklist: `## Pixel / CAPI Health (30% weight, 10 checks: M01-M10)

| ID | Check | Severity | Pass | Warning | Fail |
|----|-------|----------|------|---------|------|
| M01 | Meta Pixel installed | Critical | Pixel firing on all pages | Firing on most pages (>90%) | Pixel not firing |
| M02 | Conversions API (CAPI) active | Critical | Server-side events sending alongside pixel | CAPI planned but not deployed | No CAPI (30-40% data loss post-iOS 14.5) |
| M03 | Event deduplication | Critical | event_id matching between pixel and CAPI; >=90% dedup rate | event_id present but <90% dedup rate | Missing event_id (double-counting) |
| M04 | Event Match Quality (EMQ) | Critical | Purchase >=8.5, AddToCart >=6.5, PageView >=5.5 | EMQ 6.0-7.9 (Purchase) | EMQ <6.0 (Purchase) |
| M05 | Domain verification | High | Business domain verified in Business Manager | N/A | Domain not verified |
| M06 | Aggregated Event Measurement (AEM) | High | Top 8 events configured and prioritized correctly | Events configured but not prioritized | AEM not configured |
| M07 | Standard events vs custom | High | Using standard events (Purchase, AddToCart, Lead, etc.) | Mix of standard and custom | Custom events replacing standard events |
| M08 | CAPI Gateway | Medium | CAPI Gateway deployed for simplified server-side | Direct CAPI integration active | N/A |
| M09 | iOS attribution window | High | 7-day click / 1-day view configured | 1-day click only | Attribution not configured |
| M10 | Data freshness | Medium | Events firing in real-time (no >1hr lag) | <4hr lag | >4hr lag or intermittent firing |`,
  },
  {
    key: 'creative',
    label: 'Creative (Diversity & Fatigue)',
    weight: 0.3,
    checklist: `## Creative: Diversity & Fatigue (30% weight, 12 checks: M25-M32 + M-CR1 a M-CR4 + M-AN1)

| ID | Check | Severity | Pass | Warning | Fail |
|----|-------|----------|------|---------|------|
| M25 | Creative format diversity | Critical | >=3 formats active (image, video, carousel) | 2 formats | Only 1 format used |
| M26 | Creative volume per ad set | High | >=10 for Advantage+ Sales, >=5 standard | 3-4 creatives | <3 creatives per ad set |
| M27 | Video aspect ratios | High | 9:16 vertical video present for Reels/Stories | Only 1:1 or 4:5 video | No video assets |
| M28 | Creative fatigue detection | Critical | No CTR drop >20% over 14 days while active | CTR drop 10-20% | CTR drop >20% + frequency >3 |
| M29 | Hook rate (video) | High | <50% skip rate in first 3 seconds | 50-70% skip rate | >70% skip rate in first 3s |
| M30 | Social proof utilization | Medium | Top organic posts boosted as partnership ads | Some organic boosting | No organic content leveraged |
| M31 | UGC / social-native content | High | >=30% of creative assets are UGC/social-native | 10-30% UGC content | <10% UGC (all polished/corporate) |
| M32 | Advantage+ Creative | Medium | Enhancements enabled (test vs control) | N/A | Not tested |
| M-CR1 | Creative freshness | High | New creative tested within last 14-21 days | 21-45 days ago | No new creative in >45 days |
| M-CR2 | Frequency: Prospecting (ad set) | High | Ad set frequency <3.0 in last 7 days | 3.0-5.0 | >5.0 (audience exhausted) |
| M-CR3 | Frequency: Retargeting | Medium | Ad set frequency <8.0 in last 7 days | 8.0-12.0 | >12.0 |
| M-CR4 | CTR benchmark | High | CTR >=1.0% | 0.5-1.0% | <0.5% |
| M-AN1 | Andromeda creative diversity | Critical | Genuinely diverse concepts, Similarity Score <60% | Some diversity but similar templates | All ads are minor variations |`,
  },
  {
    key: 'account_structure',
    label: 'Account Structure',
    weight: 0.2,
    checklist: `## Account Structure (20% weight, 21 checks: M11-M18 + M33-M40 + M-ST1/2 + M-AT1 + M-IA1 + M-TH1)

| ID | Check | Severity | Pass | Warning | Fail |
|----|-------|----------|------|---------|------|
| M11 | Campaign count | High | 1-3 campaigns total recommended | 4-5 campaigns | >5 campaigns (over-fragmented) |
| M12 | CBO vs ABO appropriateness | High | CBO for >$500/day; ABO for testing <$100/day | Mismatched but functional | CBO on <$100/day OR ABO on >$500/day |
| M13 | Learning phase status | Critical | <30% of ad sets in "Learning Limited" | 30-50% Learning Limited | >50% ad sets "Learning Limited" |
| M14 | Learning phase resets | High | No unnecessary edits during learning phase | 1-2 minor resets | Frequent resets from edits during learning |
| M15 | Advantage+ Sales campaign | Medium | Active for e-commerce with catalog | Tested but paused | Not tested despite eligible catalog |
| M16 | Ad set consolidation | High | No overlapping ad sets targeting same audience | Minor overlap (<20%) | Significant overlap (>30%) |
| M17 | Budget distribution | High | All ad sets getting >=$10/day | $5-$10/day | Ad sets getting <$5/day |
| M18 | Campaign objective alignment | High | Objective matches actual business goal | N/A | Objective mismatched |
| M33 | Advantage+ Placements | Medium | Enabled (unless exclusion needed) | Manual placements (justified) | Manual placements limiting delivery without reason |
| M34 | Placement performance review | Medium | Reviewed monthly; underperformers excluded | Reviewed quarterly | Never reviewed |
| M35 | Attribution setting | High | 7-day click / 1-day view configured | 1-day click only | Not configured / expecting removed windows |
| M36 | Bid strategy appropriateness | High | Cost Cap for margin protection; Lowest Cost for volume | N/A | Bid Cap set below historical CPA |
| M37 | Frequency cap monitoring (campaign) | High | Prospecting frequency <4.0 (7-day) | 4.0-6.0 | >6.0 |
| M38 | Breakdown reporting | Medium | Age, gender, placement, platform reviewed monthly | Reviewed quarterly | Never reviewed |
| M39 | UTM parameters | Medium | On all ad URLs for GA4 attribution | On some ads | No UTM parameters |
| M40 | A/B testing active | Medium | At least 1 active A/B test | Test planned | No testing infrastructure |
| M-ST1 | Budget adequacy | High | Daily budget >=5x target CPA per ad set | Budget 2-5x CPA | Budget <2x target CPA |
| M-ST2 | Budget utilization | Medium | >80% of daily budget being utilized | 60-80% utilization | <60% utilization |
| M-AT1 | Attribution window (post removal of view-through windows) | High | Verified and aligned with business model | Using defaults without review | Not configured / expecting removed windows |
| M-IA1 | Incremental Attribution testing | Medium | Evaluated or active for measuring causal impact | N/A | Not evaluated despite >$5K/month spend |
| M-TH1 | Threads placement evaluation | Low | Reviewed for incremental reach | N/A | Not evaluated |`,
  },
  {
    key: 'audience_targeting',
    label: 'Audience & Targeting',
    weight: 0.2,
    checklist: `## Audience & Targeting (20% weight, 6 checks: M19-M24)

| ID | Check | Severity | Pass | Warning | Fail |
|----|-------|----------|------|---------|------|
| M19 | Audience overlap | High | <20% overlap between active ad sets | 20-40% overlap | >40% overlap |
| M20 | Custom Audience freshness | High | Refreshed within 180 days | 180-365 days old | >365 days old or not created |
| M21 | Lookalike source quality | Medium | Source >=1,000 users from high-value events | 500-1,000 users | <500 users or low-value source |
| M22 | Advantage+ Audience testing | Medium | Tested vs manual | N/A | Not tested |
| M23 | Exclusion audiences | High | Purchasers/converters excluded from prospecting | Partial exclusions | No purchaser exclusions |
| M24 | First-party data utilization | High | Customer list uploaded for Custom Audience + Lookalike | List uploaded but not refreshed | No first-party data uploaded |`,
  },
];

export const CONTEXT_NOTES = `## Notas de contexto (aplican a cualquier categoría)

- Offline Conversions API fue descontinuada permanentemente; usar CAPI con action_source="physical_store" para tracking offline.
- Meta redefinió "link clicks" para excluir clics de engagement social; comparar pre/post con cuidado.
- Advantage+ Sales (antes ASC) eliminó el tope de presupuesto para clientes existentes.
- Andromeda agrupa creativos similares por Entity ID: 100 variaciones menores rinden igual que 10.
- Si la cuenta corre anuncios en categorías restringidas (Vivienda, Empleo, Crédito, Productos Financieros), aplican reglas adicionales de targeting (sin ZIP, edad 18-65+, sin Lookalike).`;