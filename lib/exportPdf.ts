import type { ProcessedLead } from './types';
import { formatLeadDate } from './leadUtils';

export interface ChartExport {
  title: string;
  /** Data URL (PNG) ya capturado del DOM real, o null si no se pudo capturar (esa gráfica se omite del PDF sin tronar el resto). */
  imageDataUrl: string | null;
}

interface ExportOptions {
  filtersSummary: string;
  generatedAt: string;
  /** Gráficas a incluir como páginas antes de la tabla — opcional, si no se pasa nada el PDF sale igual que antes (solo tabla). */
  charts?: ChartExport[];
}

/**
 * Genera y descarga un PDF con el reporte de leads: gráficas (una por
 * página, si se capturaron) + tabla de leads (respeta el orden y filtro
 * ya aplicado — recibe el arreglo que el usuario está viendo en
 * pantalla). Los imports de jsPDF son dinámicos para que nunca se evalúen
 * durante el render en servidor de este Client Component.
 */
export async function exportLeadsToPdf(leads: ProcessedLead[], options: ExportOptions): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  function drawHeader(subtitle?: string) {
    doc.setFontSize(16);
    doc.setTextColor(20, 20, 20);
    doc.text('Live Desarrollos — Reporte de Leads', 40, 40);

    doc.setFontSize(10);
    doc.setTextColor(90, 90, 90);
    doc.text(`Generado: ${options.generatedAt}`, 40, 58);
    doc.text(`Filtros aplicados: ${options.filtersSummary}`, 40, 72);
    if (subtitle) {
      doc.text(subtitle, 40, 86);
    } else {
      doc.text(`Total de registros: ${leads.length}`, 40, 86);
    }
  }

  // --- Página(s) de gráficas — una por página, solo las que sí se
  // lograron capturar (si html-to-image falló en alguna, simplemente no
  // aparece, sin dejar un hueco raro ni tronar el PDF completo). ---
  const chartsToRender = (options.charts ?? []).filter((c) => c.imageDataUrl);

  chartsToRender.forEach((chart) => {
    doc.addPage();
    drawHeader(chart.title);

    // Tamaño máximo disponible bajo el header, con margen — jsPDF necesita
    // las dimensiones reales de la imagen para no distorsionar proporción.
    const maxWidth = pageWidth - 80;
    const maxHeight = pageHeight - 140;

    try {
      const imgProps = doc.getImageProperties(chart.imageDataUrl as string);
      const ratio = Math.min(maxWidth / imgProps.width, maxHeight / imgProps.height);
      const renderWidth = imgProps.width * ratio;
      const renderHeight = imgProps.height * ratio;
      const x = (pageWidth - renderWidth) / 2;

      doc.addImage(chart.imageDataUrl as string, 'PNG', x, 110, renderWidth, renderHeight);
    } catch (err) {
      console.error(`[exportPdf] No se pudo insertar la gráfica "${chart.title}" en el PDF:`, err);
    }
  });

  // --- Página inicial (índice 0) — se queda en blanco de "gráficas" arriba;
  // aquí armamos la tabla en una página NUEVA al final, y luego borramos la
  // página en blanco sobrante del principio si hubo gráficas. ---
  doc.addPage();
  drawHeader();

  autoTable(doc, {
    startY: 100,
    head: [
      [
        'Fecha',
        'Nombre',
        'Correo',
        'Teléfono',
        'Campaña',
        'Equipo',
        'Fuente',
        'Proveedor',
        'Etapa',
        'Presupuesto',
        'Motivo',
        'Comentarios',
        'Status',
      ],
    ],
    body: leads.map((lead) => [
      formatLeadDate(lead.parsedDate),
      lead.Nombre || 'Sin nombre',
      lead.Correo || '—',
      lead.Telefono || '—',
      lead.Campana || '—',
      lead.Equipo || '—',
      lead.Fuente || '—',
      lead.Proveedor || '—',
      lead.Etapa || '—',
      lead.presupuestoClean,
      lead.motivoClean,
      lead.Comentarios || '—',
      lead.status,
    ]),
    styles: { fontSize: 7, cellPadding: 4 },
    headStyles: { fillColor: [24, 24, 27], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    margin: { left: 40, right: 40 },
  });

  // jsPDF siempre nace con 1 página en blanco por defecto — como ya
  // agregamos páginas explícitas para gráficas+tabla, esa primera página
  // sobrante queda vacía al inicio. La quitamos, salvo que sea la única
  // página que exista (caso raro: 0 gráficas Y tabla vacía).
  if (doc.getNumberOfPages() > 1) {
    doc.deletePage(1);
  }

  const filename = `live-desarrollos-leads-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}