'use client';

import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from 'recharts';
import { ACCENT, GRAYS } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Leads por Día — Area chart (llena el 100% del contenedor padre)
// ---------------------------------------------------------------------------
interface LeadsPerDayChartProps {
  data: { label: string; total: number }[];
}

export function LeadsPerDayChart({ data }: LeadsPerDayChartProps) {
  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="leadsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.3} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRAYS[800]} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: GRAYS[400] }}
            axisLine={{ stroke: GRAYS[800] }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: GRAYS[400] }}
            axisLine={false}
            tickLine={false}
            width={22}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: `1px solid ${GRAYS[800]}`,
              backgroundColor: GRAYS[900],
              fontSize: 12,
            }}
            labelStyle={{ color: GRAYS[100], fontWeight: 600 }}
            itemStyle={{ color: ACCENT }}
          />
          <Area
            type="monotone"
            dataKey="total"
            name="Leads"
            stroke={ACCENT}
            strokeWidth={2}
            fill="url(#leadsGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Semáforo de Etapas — Donut chart con colores fijos (verde/amarillo/rojo/gris)
// ---------------------------------------------------------------------------
interface EtapaColorChartProps {
  data: { name: string; value: number; colorKey: 'green' | 'yellow' | 'red' | 'gray' }[];
}

const ETAPA_COLORS: Record<string, string> = {
  green: '#22C55E',
  yellow: '#EAB308',
  red: '#EF4444',
  gray: GRAYS[600],
};

export function EtapaColorChart({ data }: EtapaColorChartProps) {
  const total = data.reduce((acc, d) => acc + d.value, 0);

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={ETAPA_COLORS[entry.colorKey]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: `1px solid ${GRAYS[800]}`,
              backgroundColor: GRAYS[900],
              fontSize: 12,
            }}
            labelStyle={{ color: GRAYS[100] }}
            itemStyle={{ color: GRAYS[100] }}
          />
          <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 10, color: GRAYS[400] }} />
        </PieChart>
      </ResponsiveContainer>

      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center justify-center"
        style={{ bottom: '22%' }}
      >
        <span className="text-lg font-semibold text-zinc-50">{total}</span>
        <span className="text-[10px] text-zinc-500">Leads</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leads por Día, separado por semáforo — Area chart apilable con filtro de color
// ---------------------------------------------------------------------------
interface LeadsPerDayColorChartProps {
  data: { label: string; Verde: number; Amarillo: number; Rojo: number; SinClasificar: number }[];
  /** Qué series mostrar — si un color no está aquí, su área no se dibuja. */
  visibleColors: Set<'Verde' | 'Amarillo' | 'Rojo' | 'SinClasificar'>;
}

const SEMAFORO_HEX: Record<string, string> = {
  Verde: '#22C55E',
  Amarillo: '#EAB308',
  Rojo: '#EF4444',
  SinClasificar: GRAYS[500],
};

export function LeadsPerDayColorChart({ data, visibleColors }: LeadsPerDayColorChartProps) {
  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRAYS[800]} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: GRAYS[400] }}
            axisLine={{ stroke: GRAYS[800] }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: GRAYS[400] }}
            axisLine={false}
            tickLine={false}
            width={22}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: `1px solid ${GRAYS[800]}`,
              backgroundColor: GRAYS[900],
              fontSize: 12,
            }}
            labelStyle={{ color: GRAYS[100], fontWeight: 600 }}
          />
          {visibleColors.has('Verde') && (
            <Area type="monotone" dataKey="Verde" name="Verde" stroke={SEMAFORO_HEX.Verde} fill={SEMAFORO_HEX.Verde} fillOpacity={0.15} strokeWidth={2} />
          )}
          {visibleColors.has('Amarillo') && (
            <Area type="monotone" dataKey="Amarillo" name="Amarillo" stroke={SEMAFORO_HEX.Amarillo} fill={SEMAFORO_HEX.Amarillo} fillOpacity={0.15} strokeWidth={2} />
          )}
          {visibleColors.has('Rojo') && (
            <Area type="monotone" dataKey="Rojo" name="Rojo" stroke={SEMAFORO_HEX.Rojo} fill={SEMAFORO_HEX.Rojo} fillOpacity={0.15} strokeWidth={2} />
          )}
          {visibleColors.has('SinClasificar') && (
            <Area type="monotone" dataKey="SinClasificar" name="Sin clasificar" stroke={SEMAFORO_HEX.SinClasificar} fill={SEMAFORO_HEX.SinClasificar} fillOpacity={0.1} strokeWidth={2} />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vivir vs Invertir — Donut chart compacto
// ---------------------------------------------------------------------------
interface MotivoDonutChartProps {
  data: { name: string; value: number }[];
}

const MOTIVO_COLORS: Record<string, string> = {
  Vivir: ACCENT,
  Invertir: GRAYS[100],
  Otro: GRAYS[600],
};

export function MotivoDonutChart({ data }: MotivoDonutChartProps) {
  const total = data.reduce((acc, d) => acc + d.value, 0);

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={MOTIVO_COLORS[entry.name] ?? GRAYS[600]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: `1px solid ${GRAYS[800]}`,
              backgroundColor: GRAYS[900],
              fontSize: 12,
            }}
            labelStyle={{ color: GRAYS[100] }}
            itemStyle={{ color: GRAYS[100] }}
          />
          <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 10, color: GRAYS[400] }} />
        </PieChart>
      </ResponsiveContainer>

      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center justify-center"
        style={{ bottom: '22%' }}
      >
        <span className="text-lg font-semibold text-zinc-50">{total}</span>
        <span className="text-[10px] text-zinc-500">Leads</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distribución de Presupuesto — Horizontal bar chart compacto
// ---------------------------------------------------------------------------
interface BudgetBarChartProps {
  data: { label: string; total: number }[];
}

export function BudgetBarChart({ data }: BudgetBarChartProps) {
  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap={10}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRAYS[800]} horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 10, fill: GRAYS[400] }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={100}
            tick={{ fontSize: 10, fill: GRAYS[400] }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: `1px solid ${GRAYS[800]}`,
              backgroundColor: GRAYS[900],
              fontSize: 12,
            }}
            labelStyle={{ color: GRAYS[100] }}
            itemStyle={{ color: ACCENT }}
          />
          <Bar dataKey="total" name="Leads" fill={ACCENT} radius={[0, 4, 4, 0]} barSize={12} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calidad de leads en el tiempo — % Verde por Fuente, un punto por día
// ---------------------------------------------------------------------------

/** Un color fijo y consistente por Fuente, para que la línea de "fb" siempre sea del mismo color entre recargas. */
const HISTORY_LINE_COLORS = [ACCENT, '#22C55E', '#38BDF8', '#F472B6', '#A78BFA', '#FB923C'];

export interface LeadQualityHistoryChartPoint {
  /** Fecha ya formateada para mostrar en el eje X (ej. "14 ago") */
  label: string;
  /** Un valor 0-100 (o null si esa Fuente no tenía muestra suficiente ese día) por cada Fuente presente en el histórico. */
  [fuenteKey: string]: string | number | null;
}

interface LeadQualityHistoryChartProps {
  data: LeadQualityHistoryChartPoint[];
  /** Nombres de Fuente a graficar como líneas — deben coincidir con las keys presentes en `data`. */
  fuentes: string[];
}

export function LeadQualityHistoryChart({ data, fuentes }: LeadQualityHistoryChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-zinc-500">
        Todavía no hay suficiente historial — vuelve en unos días, se guarda un punto nuevo cada vez que alguien entra al dashboard.
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRAYS[800]} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: GRAYS[400] }} axisLine={{ stroke: GRAYS[800] }} tickLine={false} />
          <YAxis
            domain={[0, 100]}
            unit="%"
            tick={{ fontSize: 10, fill: GRAYS[400] }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: `1px solid ${GRAYS[800]}`,
              backgroundColor: GRAYS[900],
              fontSize: 12,
            }}
            labelStyle={{ color: GRAYS[100], fontWeight: 600 }}
            formatter={(value: number | string) => (value === null ? 'Sin muestra' : `${value}%`)}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: GRAYS[400] }} />
          {fuentes.map((fuente, i) => (
            <Line
              key={fuente}
              type="monotone"
              dataKey={fuente}
              name={fuente}
              stroke={HISTORY_LINE_COLORS[i % HISTORY_LINE_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}