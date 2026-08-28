'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, LayoutGrid, RotateCcw, GripVertical } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { MotivoDonutChart, BudgetBarChart, LeadsPerDayColorChart, LeadQualityHistoryChart } from './lead-charts';
import { LeadsTable } from './leads-table';
import { useMosaicWeights, MosaicDivider } from './use-mosaic-layout';
import {
  groupByDateColor,
  groupByBudget,
  groupByMotivo,
  getUniqueCampaigns,
  getUniqueMonths,
  getUniqueEquipos,
  getUniqueFuentes,
  getUniqueProveedores,
  getUniqueEtapas,
  filterLeads,
  DEFAULT_LEAD_FILTERS,
  type LeadFilters,
  type LeadQualityHistoryChartPoint,
} from '@/lib/leadUtils';
import { exportLeadsToPdf } from '@/lib/exportPdf';
import type { ProcessedLead } from '@/lib/types';

const CHART_IDS = ['leads-por-dia', 'vivir-invertir', 'presupuesto', 'calidad-historica'] as const;
type ChartId = (typeof CHART_IDS)[number];
const DEFAULT_CHART_ORDER: ChartId[] = ['leads-por-dia', 'vivir-invertir', 'presupuesto', 'calidad-historica'];
const CHART_ORDER_STORAGE_KEY = 'live-dashboard-chart-order-v2';

function isToday(date: Date | null) {
  if (!date) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function buildFiltersSummary(filters: LeadFilters, months: { value: string; label: string }[]): string {
  const parts: string[] = [];

  parts.push(filters.campaign === 'all' ? 'Todas las campañas' : filters.campaign);

  if (filters.month === 'all') {
    parts.push('Todos los meses');
  } else {
    parts.push(months.find((m) => m.value === filters.month)?.label ?? filters.month);
  }

  if (filters.status === 'all') parts.push('Todos los status');
  else if (filters.status === 'Válido') parts.push('Solo válidos');
  else parts.push('Solo duplicados');

  if (filters.equipo !== 'all') parts.push(`Equipo: ${filters.equipo}`);
  if (filters.fuente !== 'all') parts.push(`Fuente: ${filters.fuente}`);
  if (filters.proveedor !== 'all') parts.push(`Proveedor: ${filters.proveedor}`);
  if (filters.etapa !== 'all') parts.push(`Etapa: ${filters.etapa}`);
  if (filters.periodo !== 'todos') {
    const label = filters.periodo === 'semana' ? 'Última semana' : filters.periodo === 'mes' ? 'Último mes' : 'Último año';
    parts.push(label);
  }

  return parts.join(' · ');
}

export function DashboardShell({
  leads,
  leadQualityHistory,
}: {
  leads: ProcessedLead[];
  leadQualityHistory?: { data: LeadQualityHistoryChartPoint[]; fuentes: string[] };
  /** No se usa dentro de este componente todavía — se acepta para que TypeScript no truene cuando dashboard-tabs.tsx lo pasa. */
  initialHubspotLimit?: number;
}) {
  const [filters, setFilters] = useState<LeadFilters>(DEFAULT_LEAD_FILTERS);
  const [isExporting, setIsExporting] = useState(false);

  // Refs a cada gráfica, para capturarlas como imagen al exportar el PDF
  // (html-to-image lee el DOM ya renderizado — no se recalculan datos ni
  // se re-dibuja nada, solo se toma una "foto" de lo que ya está en
  // pantalla en ese momento).
  const leadsPerDayChartRef = useRef<HTMLDivElement>(null);
  const motivoChartRef = useRef<HTMLDivElement>(null);
  const budgetChartRef = useRef<HTMLDivElement>(null);
  const historyChartRef = useRef<HTMLDivElement>(null);

  // Las opciones de los selects salen del set COMPLETO de leads, no del filtrado,
  // para que no desaparezcan opciones al ir combinando filtros.
  const campaigns = useMemo(() => getUniqueCampaigns(leads), [leads]);
  const months = useMemo(() => getUniqueMonths(leads), [leads]);
  const equipos = useMemo(() => getUniqueEquipos(leads), [leads]);
  const fuentes = useMemo(() => getUniqueFuentes(leads), [leads]);
  const proveedores = useMemo(() => getUniqueProveedores(leads), [leads]);
  const etapas = useMemo(() => getUniqueEtapas(leads), [leads]);

  const filteredLeads = useMemo(() => filterLeads(leads, filters), [leads, filters]);

  const duplicateLeads = useMemo(() => filteredLeads.filter((l) => l.status === 'Duplicado'), [filteredLeads]);
  const todayLeads = useMemo(() => filteredLeads.filter((l) => isToday(l.parsedDate)), [filteredLeads]);
  const duplicateRate = filteredLeads.length > 0 ? (duplicateLeads.length / filteredLeads.length) * 100 : 0;

  const [visibleColors, setVisibleColors] = useState<Set<'Verde' | 'Amarillo' | 'Rojo' | 'SinClasificar'>>(
    new Set(['Verde', 'Amarillo', 'Rojo', 'SinClasificar']),
  );

  function toggleColor(color: 'Verde' | 'Amarillo' | 'Rojo' | 'SinClasificar') {
    setVisibleColors((prev) => {
      const next = new Set(prev);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return next;
    });
  }

  // --- Modo de edición de gráficas: reordenar (drag) + redimensionar
  // (proporciones flexibles vía useMosaicWeights) — SOLO para la tabla y
  // las 4 gráficas. Las 3 tarjetas de stats de abajo se quedan fijas,
  // como siempre estuvieron, fuera del alcance de este sistema.
  const [chartEditMode, setChartEditMode] = useState(false);
  const [chartOrder, setChartOrder] = useState<ChartId[]>(DEFAULT_CHART_ORDER);
  const [draggingId, setDraggingId] = useState<ChartId | null>(null);

  const {
    weights: columnWeights,
    containerRef: columnContainerRef,
    handleDividerMouseDown: handleColumnDividerMouseDown,
    resetWeights: resetColumnWeights,
  } = useMosaicWeights('column', [9, 3], 'live-dashboard-column-weights-v2');

  const {
    weights: chartRowWeights,
    containerRef: chartRowContainerRef,
    handleDividerMouseDown: handleChartRowDividerMouseDown,
    resetWeights: resetChartRowWeights,
  } = useMosaicWeights('row', [1.4, 1, 1, 1], 'live-dashboard-chart-row-weights-v2');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CHART_ORDER_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { order?: ChartId[] };
        if (parsed.order && parsed.order.length === CHART_IDS.length) setChartOrder(parsed.order);
      }
    } catch {
      // localStorage no disponible o dato corrupto — se queda con el default, sin tronar.
    }
  }, []);

  function saveChartOrder(order: ChartId[]) {
    try {
      localStorage.setItem(CHART_ORDER_STORAGE_KEY, JSON.stringify({ order }));
    } catch {
      // si falla el guardado, el usuario simplemente pierde la personalización — no rompe nada más.
    }
  }

  function handleChartDrop() {
    setDraggingId(null);
  }

  function handleChartDragOver(targetId: ChartId) {
    if (!draggingId || draggingId === targetId) return;
    setChartOrder((prev) => {
      const next = [...prev];
      const fromIndex = next.indexOf(draggingId);
      const toIndex = next.indexOf(targetId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, draggingId);
      saveChartOrder(next);
      return next;
    });
  }

  function resetChartLayout() {
    setChartOrder(DEFAULT_CHART_ORDER);
    resetColumnWeights();
    resetChartRowWeights();
    try {
      localStorage.removeItem(CHART_ORDER_STORAGE_KEY);
    } catch {
      // no pasa nada si tampoco se puede borrar — el estado en memoria ya se reseteó.
    }
  }

  const leadsPerDayColor = useMemo(() => groupByDateColor(filteredLeads), [filteredLeads]);
  const motivoData = useMemo(() => groupByMotivo(filteredLeads), [filteredLeads]);
  const budgetData = useMemo(() => groupByBudget(filteredLeads), [filteredLeads]);

  const sortedLeads = useMemo(
    () => [...filteredLeads].sort((a, b) => (b.parsedDate?.getTime() ?? 0) - (a.parsedDate?.getTime() ?? 0)),
    [filteredLeads]
  );

  const hasActiveFilters =
    filters.campaign !== 'all' ||
    filters.month !== 'all' ||
    filters.status !== 'all' ||
    filters.equipo !== 'all' ||
    filters.fuente !== 'all' ||
    filters.proveedor !== 'all' ||
    filters.etapa !== 'all' ||
    filters.periodo !== 'todos';

  async function handleExportPdf() {
    setIsExporting(true);
    try {
      // Captura las 4 gráficas TAL COMO SE VEN en este momento (respeta
      // filtros activos y colores prendidos/apagados en "Leads por Día") —
      // se necesita el módulo dinámico porque html-to-image lee el DOM
      // real del navegador, no puede evaluarse en el server.
      const { toPng } = await import('html-to-image');

      async function captureChart(ref: React.RefObject<HTMLDivElement | null>): Promise<string | null> {
        if (!ref.current) return null;
        try {
          // backgroundColor solo pinta el fondo del contenedor raíz — los
          // divs internos de la gráfica (con clases bg-zinc-900, etc.) se
          // capturan tal cual con SU fondo oscuro original, tapando el
          // blanco. `style` aquí se aplica al clon justo antes de la
          // captura, forzando blanco de raíz para que nada oscuro se
          // filtre por debajo.
          return await toPng(ref.current, {
            backgroundColor: '#ffffff',
            pixelRatio: 2,
            style: { backgroundColor: '#ffffff' },
          });
        } catch (err) {
          console.error('[handleExportPdf] No se pudo capturar una gráfica, se omite del PDF:', err);
          return null;
        }
      }

      const [leadsPerDayImg, motivoImg, budgetImg, historyImg] = await Promise.all([
        captureChart(leadsPerDayChartRef),
        captureChart(motivoChartRef),
        captureChart(budgetChartRef),
        captureChart(historyChartRef),
      ]);

      await exportLeadsToPdf(sortedLeads, {
        filtersSummary: buildFiltersSummary(filters, months),
        generatedAt: new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' }),
        charts: [
          { title: 'Leads por Día', imageDataUrl: leadsPerDayImg },
          { title: 'Vivir vs Invertir', imageDataUrl: motivoImg },
          { title: 'Presupuesto', imageDataUrl: budgetImg },
          { title: 'Calidad de Leads (histórico)', imageDataUrl: historyImg },
        ],
      });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-4 sm:px-6">
      {/* Filtros */}
      <section className="flex shrink-0 flex-wrap items-center gap-2">
        <Select value={filters.campaign} onValueChange={(value) => setFilters((f) => ({ ...f, campaign: value || 'all' }))}>
          <SelectTrigger className="h-9 min-w-[130px] flex-1 border-zinc-800 bg-zinc-900 text-sm text-zinc-200 sm:w-[180px] sm:flex-none">
            <SelectValue placeholder="Campaña">{(value: string) => (value === 'all' ? 'Campaña' : value)}</SelectValue>
          </SelectTrigger>
          <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
            <SelectItem value="all">Todas las campañas</SelectItem>
            {campaigns.map((campaign) => (
              <SelectItem key={campaign} value={campaign}>
                {campaign}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.month} onValueChange={(value) => setFilters((f) => ({ ...f, month: value || 'all' }))}>
          <SelectTrigger className="h-9 min-w-[110px] flex-1 border-zinc-800 bg-zinc-900 text-sm text-zinc-200 sm:w-[160px] sm:flex-none">
            <SelectValue placeholder="Mes">
              {(value: string) => (value === 'all' ? 'Mes' : months.find((m) => m.value === value)?.label ?? value)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
            <SelectItem value="all">Todos los meses</SelectItem>
            {months.map((month) => (
              <SelectItem key={month.value} value={month.value}>
                {month.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* --- Filtros nuevos: Equipo / Fuente / Proveedor / Etapa --- */}
        <Select value={filters.equipo} onValueChange={(value) => setFilters((f) => ({ ...f, equipo: value || 'all' }))}>
          <SelectTrigger className="h-9 min-w-[120px] flex-1 border-zinc-800 bg-zinc-900 text-sm text-zinc-200 sm:w-[150px] sm:flex-none">
            <SelectValue placeholder="Equipo">{(value: string) => (value === 'all' ? 'Equipo' : value)}</SelectValue>
          </SelectTrigger>
          <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
            <SelectItem value="all">Todos los equipos</SelectItem>
            {equipos.map((equipo) => (
              <SelectItem key={equipo} value={equipo}>
                {equipo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.fuente} onValueChange={(value) => setFilters((f) => ({ ...f, fuente: value || 'all' }))}>
          <SelectTrigger className="h-9 min-w-[120px] flex-1 border-zinc-800 bg-zinc-900 text-sm text-zinc-200 sm:w-[150px] sm:flex-none">
            <SelectValue placeholder="Fuente">{(value: string) => (value === 'all' ? 'Fuente' : value)}</SelectValue>
          </SelectTrigger>
          <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
            <SelectItem value="all">Todas las fuentes</SelectItem>
            {fuentes.map((fuente) => (
              <SelectItem key={fuente} value={fuente}>
                {fuente}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.proveedor} onValueChange={(value) => setFilters((f) => ({ ...f, proveedor: value || 'all' }))}>
          <SelectTrigger className="h-9 min-w-[120px] flex-1 border-zinc-800 bg-zinc-900 text-sm text-zinc-200 sm:w-[150px] sm:flex-none">
            <SelectValue placeholder="Proveedor">{(value: string) => (value === 'all' ? 'Proveedor' : value)}</SelectValue>
          </SelectTrigger>
          <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
            <SelectItem value="all">Todos los proveedores</SelectItem>
            {proveedores.map((proveedor) => (
              <SelectItem key={proveedor} value={proveedor}>
                {proveedor}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.etapa} onValueChange={(value) => setFilters((f) => ({ ...f, etapa: value || 'all' }))}>
          <SelectTrigger className="h-9 min-w-[120px] flex-1 border-zinc-800 bg-zinc-900 text-sm text-zinc-200 sm:w-[150px] sm:flex-none">
            <SelectValue placeholder="Etapa">{(value: string) => (value === 'all' ? 'Etapa' : value)}</SelectValue>
          </SelectTrigger>
          <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
            <SelectItem value="all">Todas las etapas</SelectItem>
            {etapas.map((etapa) => (
              <SelectItem key={etapa} value={etapa}>
                {etapa}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs
          value={filters.status}
          onValueChange={(value) => setFilters((f) => ({ ...f, status: value as LeadFilters['status'] }))}
        >
          <TabsList className="h-9 border border-zinc-800 bg-zinc-900">
            <TabsTrigger
              value="all"
              className="text-xs text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50"
            >
              Todos
            </TabsTrigger>
            <TabsTrigger
              value="Válido"
              className="text-xs text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50"
            >
              Válidos
            </TabsTrigger>
            <TabsTrigger
              value="Duplicado"
              className="text-xs text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50"
            >
              Duplicados
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
            onClick={() => setFilters(DEFAULT_LEAD_FILTERS)}
          >
            Limpiar filtros
          </Button>
        )}

        {/* Ventana rápida de tiempo — se suma al filtro de Mes, no lo reemplaza */}
        <Tabs value={filters.periodo} onValueChange={(value) => setFilters((f) => ({ ...f, periodo: value as LeadFilters['periodo'] }))}>
          <TabsList className="h-9 border border-zinc-800 bg-zinc-900">
            <TabsTrigger
              value="todos"
              className="text-xs text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50"
            >
              Todo
            </TabsTrigger>
            <TabsTrigger
              value="semana"
              className="text-xs text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50"
            >
              Por semana
            </TabsTrigger>
            <TabsTrigger
              value="mes"
              className="text-xs text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50"
            >
              Por mes
            </TabsTrigger>
            <TabsTrigger
              value="año"
              className="text-xs text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50"
            >
              Por año
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <span className="ml-auto text-xs text-zinc-500">
          {filteredLeads.length} de {leads.length} leads
        </span>
      </section>

      {/* Contenido principal: la tabla ES el foco. Gráficas solo aparecen desde lg.
          Tabla y gráficas viven en un mosaico de proporciones flexibles: al
          agrandar cualquiera (solo en modo edición), las demás se encogen
          solas para seguir llenando exactamente el alto/ancho disponible —
          nunca se encima nada, nunca hace falta scroll. */}
      <section ref={columnContainerRef} className="flex min-h-0 flex-1 gap-3">
        <div
          style={{ flexGrow: columnWeights[0], flexBasis: 0, minWidth: 0 }}
          className="flex min-h-0 flex-col rounded-xl border border-zinc-800 bg-zinc-900"
        >
          <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-2 p-4 pb-2">
            <CardTitle className="text-base font-medium text-zinc-50">Leads</CardTitle>
            <Button
              variant="outline"
              size="sm"
              disabled={isExporting || sortedLeads.length === 0}
              onClick={handleExportPdf}
              className="h-8 gap-1.5 border-zinc-800 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              <Download className="h-3.5 w-3.5" />
              {isExporting ? 'Generando…' : 'Exportar PDF'}
            </Button>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
            <LeadsTable leads={sortedLeads} />
          </CardContent>
        </div>

        <MosaicDivider axis="column" editMode={chartEditMode} onMouseDown={handleColumnDividerMouseDown(0)} />

        <aside
          style={{ flexGrow: columnWeights[1], flexBasis: 0, minWidth: 0 }}
          className="hidden min-h-0 flex-col gap-2 lg:flex"
        >
          <div className="flex shrink-0 items-center justify-between gap-2">
            <Button
              variant={chartEditMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => setChartEditMode((v) => !v)}
              className={`h-7 gap-1.5 text-xs ${
                chartEditMode
                  ? 'bg-[#EFF767] text-zinc-950 hover:bg-[#EFF767]/90'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <LayoutGrid className="h-3 w-3" />
              {chartEditMode ? 'Listo' : 'Editar diseño'}
            </Button>
            {chartEditMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetChartLayout}
                className="h-7 gap-1 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              >
                <RotateCcw className="h-3 w-3" />
                Restablecer
              </Button>
            )}
          </div>

          <div ref={chartRowContainerRef} className="flex min-h-0 flex-1 flex-col">
            {chartOrder.map((chartId, index) => {
              const rowStyle = { flexGrow: chartRowWeights[index], flexBasis: 0, minHeight: 0 };

              let content: React.ReactNode;
              if (chartId === 'leads-por-dia') {
                content = (
                  <>
                    <div className="shrink-0 p-3 pb-2">
                      <p className="mb-2 text-xs font-medium text-zinc-400">Leads por Día</p>
                      <div className="flex flex-wrap gap-1">
                        <button
                          onClick={() => toggleColor('Verde')}
                          className={`rounded-full border px-2 py-0.5 text-[10px] transition-opacity ${
                            visibleColors.has('Verde') ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-zinc-800 text-zinc-600 opacity-50'
                          }`}
                        >
                          Verde
                        </button>
                        <button
                          onClick={() => toggleColor('Amarillo')}
                          className={`rounded-full border px-2 py-0.5 text-[10px] transition-opacity ${
                            visibleColors.has('Amarillo') ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400' : 'border-zinc-800 text-zinc-600 opacity-50'
                          }`}
                        >
                          Amarillo
                        </button>
                        <button
                          onClick={() => toggleColor('Rojo')}
                          className={`rounded-full border px-2 py-0.5 text-[10px] transition-opacity ${
                            visibleColors.has('Rojo') ? 'border-red-500/40 bg-red-500/10 text-red-400' : 'border-zinc-800 text-zinc-600 opacity-50'
                          }`}
                        >
                          Rojo
                        </button>
                        <button
                          onClick={() => toggleColor('SinClasificar')}
                          className={`rounded-full border px-2 py-0.5 text-[10px] transition-opacity ${
                            visibleColors.has('SinClasificar') ? 'border-zinc-600 bg-zinc-700/30 text-zinc-300' : 'border-zinc-800 text-zinc-600 opacity-50'
                          }`}
                        >
                          Sin clasificar
                        </button>
                      </div>
                    </div>
                    <div ref={leadsPerDayChartRef} className="min-h-0 flex-1 p-2 pt-1">
                      <LeadsPerDayColorChart data={leadsPerDayColor} visibleColors={visibleColors} />
                    </div>
                  </>
                );
              } else if (chartId === 'vivir-invertir') {
                content = (
                  <>
                    <div className="shrink-0 p-3 pb-0">
                      <p className="text-xs font-medium text-zinc-400">Vivir vs Invertir</p>
                    </div>
                    <div ref={motivoChartRef} className="min-h-0 flex-1 p-2 pt-1">
                      <MotivoDonutChart data={motivoData} />
                    </div>
                  </>
                );
              } else if (chartId === 'presupuesto') {
                content = (
                  <>
                    <div className="shrink-0 p-3 pb-0">
                      <p className="text-xs font-medium text-zinc-400">Presupuesto</p>
                    </div>
                    <div ref={budgetChartRef} className="min-h-0 flex-1 p-2 pt-1">
                      <BudgetBarChart data={budgetData} />
                    </div>
                  </>
                );
              } else {
                content = (
                  <>
                    <div className="shrink-0 p-3 pb-0">
                      <p className="text-xs font-medium text-zinc-400">Calidad de Leads (histórico, % avanzó por Fuente)</p>
                    </div>
                    <div ref={historyChartRef} className="min-h-0 flex-1 p-2 pt-1">
                      <LeadQualityHistoryChart data={leadQualityHistory?.data ?? []} fuentes={leadQualityHistory?.fuentes ?? []} />
                    </div>
                  </>
                );
              }

              return (
                <div key={chartId} style={rowStyle} className="flex min-h-0 flex-col">
                  <div
                    draggable={chartEditMode}
                    onDragStart={(e) => {
                      if (!chartEditMode) return;
                      e.dataTransfer.effectAllowed = 'move';
                      setDraggingId(chartId);
                    }}
                    onDragOver={(e) => {
                      if (!chartEditMode) return;
                      e.preventDefault();
                      handleChartDragOver(chartId);
                    }}
                    onDrop={(e) => {
                      if (!chartEditMode) return;
                      e.preventDefault();
                      handleChartDrop();
                    }}
                    className={`flex min-h-0 flex-1 flex-col rounded-xl border bg-zinc-900 transition-colors ${
                      chartEditMode ? 'cursor-move border-dashed border-zinc-600' : 'border-zinc-800'
                    } ${draggingId === chartId ? 'opacity-40' : ''}`}
                  >
                    {chartEditMode && (
                      <div className="flex shrink-0 items-center justify-center gap-1 border-b border-dashed border-zinc-700 bg-zinc-800/50 py-1 text-zinc-500">
                        <GripVertical className="h-3 w-3" />
                        <span className="text-[10px]">Arrastra para mover · Jala la línea de abajo para redimensionar</span>
                      </div>
                    )}
                    {content}
                  </div>

                  {/* Divisor arrastrable entre esta fila y la siguiente — no aparece después de la última. */}
                  {index < chartOrder.length - 1 && (
                    <MosaicDivider axis="row" editMode={chartEditMode} onMouseDown={handleChartRowDividerMouseDown(index)} />
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      </section>

      {/* Stats — franja compacta debajo de la tabla, reacciona a los filtros. Fija, sin redimensionar ni reordenar. */}
      <section className="grid shrink-0 grid-cols-3 gap-2">
        <Card className="flex items-center justify-between border-zinc-800 bg-zinc-900 px-3 py-2.5 shadow-none">
          <span className="text-xs font-medium text-zinc-400">Total</span>
          <span className="text-lg font-semibold text-zinc-50">{filteredLeads.length}</span>
        </Card>

        <Card className="flex items-center justify-between border-zinc-800 bg-zinc-900 px-3 py-2.5 shadow-none">
          <span className="text-xs font-medium text-zinc-400">Duplicados</span>
          <span className="text-lg font-semibold text-zinc-50">
            {duplicateLeads.length}
            <span className="ml-1 text-xs font-normal text-zinc-500">({duplicateRate.toFixed(1)}%)</span>
          </span>
        </Card>

        <Card className="flex items-center justify-between border-zinc-800 bg-zinc-900 px-3 py-2.5 shadow-none">
          <span className="text-xs font-medium text-zinc-400">Hoy</span>
          <span className="text-lg font-semibold text-zinc-50">{todayLeads.length}</span>
        </Card>
      </section>
    </div>
  );
}