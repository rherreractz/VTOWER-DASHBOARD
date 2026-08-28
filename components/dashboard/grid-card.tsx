'use client';

import { GripVertical } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Envoltura visual de cada card dentro del grid editable del dashboard
 * (components/dashboard/dashboard-shell.tsx). react-grid-layout se encarga
 * de la posición/tamaño (drag + resize); esta card solo aporta el look
 * (borde punteado + barra "arrastra aquí") mientras el modo edición está
 * activo. Sin `dashboard-drag-handle` el usuario podría arrastrar la card
 * desde cualquier punto, lo que rompería clics en botones/filas de tabla.
 */
export function GridCard({
  editMode,
  className,
  children,
}: {
  editMode: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        'flex h-full min-h-0 flex-col gap-0 overflow-hidden border-zinc-800 bg-zinc-900 py-0 shadow-none',
        editMode && 'border-dashed border-zinc-600',
        className,
      )}
    >
      {editMode && (
        <div className="dashboard-drag-handle flex shrink-0 items-center justify-center gap-1 border-b border-dashed border-zinc-700 bg-zinc-800/50 py-1 text-zinc-500">
          <GripVertical className="h-3 w-3" />
          <span className="text-[10px]">Arrastra para mover · Jala la esquina para redimensionar</span>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </Card>
  );
}
