'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardShell } from './dashboard-shell';
import { MetaAuditPanel } from './meta-audit-panel';
import { MetaCampaignPanel } from './meta-campaign-panel';
import type { LeadQualityHistoryChartPoint } from '@/lib/leadUtils';
import type { ProcessedLead } from '@/lib/types';

export function DashboardTabs({
  leads,
  initialHubspotLimit,
  leadQualityHistory,
}: {
  leads: ProcessedLead[];
  initialHubspotLimit: number;
  leadQualityHistory: { data: LeadQualityHistoryChartPoint[]; fuentes: string[] };
}) {
  return (
    <Tabs defaultValue="leads" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-zinc-800 px-4 sm:px-6">
        <TabsList variant="line" className="h-10 gap-1 p-0">
          <TabsTrigger
            value="leads"
            className="rounded-md px-3 text-sm text-zinc-400 data-active:text-zinc-50"
          >
            Leads
          </TabsTrigger>
          <TabsTrigger
            value="meta-ads"
            className="rounded-md px-3 text-sm text-zinc-400 data-active:text-zinc-50"
          >
            Auditoría Meta Ads
          </TabsTrigger>
          <TabsTrigger
            value="meta-campaign"
            className="rounded-md px-3 text-sm text-zinc-400 data-active:text-zinc-50"
          >
            Generar Campaña
          </TabsTrigger>
        </TabsList>
      </div>

      {/* La pestaña de Leads mantiene su layout original (tabla + gráficas). */}
      <TabsContent value="leads" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DashboardShell leads={leads} initialHubspotLimit={initialHubspotLimit} leadQualityHistory={leadQualityHistory} />
      </TabsContent>

      <TabsContent value="meta-ads" className="min-h-0 flex-1 overflow-auto">
        <MetaAuditPanel />
      </TabsContent>

      <TabsContent value="meta-campaign" className="min-h-0 flex-1 overflow-auto">
        <MetaCampaignPanel />
      </TabsContent>
    </Tabs>
  );
}