'use client';

import { useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';

/**
 * Tarjeta arrastrable/redimensionable, usada en el "modo de edición" del
 * dashboard para que cada usuario acomode sus gráficas a su gusto.
 *
 * - Arrastrar: HTML5 drag-and-drop nativo (draggable + onDragStart/Over/Drop).
 * - Redimensionar: resize: vertical de CSS (el navegador ya dibuja la
 *   esquina de resize solita) — solo escuchamos el tamaño final para
 *   guardarlo.
 * - Al arrastrar una tarjeta ENCIMA de otra, la tarjeta destino se ilumina
 *   con un borde blanco, para que quede claro dónde va a caer al soltar.
 *
 * No usa ninguna librería externa — todo con APIs nativas del navegador,
 * para máxima confiabilidad. Usa un <div> plano (no el componente Card)
 * porque Card no reenvía ref al DOM real, y aquí necesitamos leer el alto
 * final después de un resize.
 */
export function EditableChartCard({
  id,
  editMode,
  height,
  onHeightChange,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
  children,
}: {
  id: string;
  editMode: boolean;
  height: number;
  onHeightChange: (id: string, height: number) => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDrop: () => void;
  isDragging: boolean;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  // true mientras esta tarjeta ES el destino de un drag en curso (alguien
  // está arrastrando OTRA tarjeta y pasó por encima de esta) — controla el
  // borde blanco iluminado.
  const [isDragOverTarget, setIsDragOverTarget] = useState(false);

  function handleMouseUp() {
    // El usuario pudo haber redimensionado con el handle nativo del navegador —
    // leemos el alto resultante del DOM y lo guardamos.
    if (cardRef.current) {
      const newHeight = cardRef.current.getBoundingClientRect().height;
      if (Math.abs(newHeight - height) > 2) {
        onHeightChange(id, Math.round(newHeight));
      }
    }
  }

  return (
    <div
      ref={cardRef}
      draggable={editMode}
      onDragStart={(e) => {
        if (!editMode) return;
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(id);
      }}
      onDragOver={(e) => {
        if (!editMode) return;
        e.preventDefault();
        setIsDragOverTarget(true);
        onDragOver(id);
      }}
      onDragLeave={() => {
        if (!editMode) return;
        setIsDragOverTarget(false);
      }}
      onDrop={(e) => {
        if (!editMode) return;
        e.preventDefault();
        setIsDragOverTarget(false);
        onDrop();
      }}
      onDragEnd={() => {
        // Por si el drag termina fuera de cualquier tarjeta (soltado en
        // un área vacía) — nos aseguramos de que el highlight no se quede
        // pegado.
        setIsDragOverTarget(false);
      }}
      onMouseUp={editMode ? handleMouseUp : undefined}
      style={{
        height,
        resize: editMode ? 'vertical' : 'none',
        overflow: editMode ? 'auto' : 'hidden',
        minHeight: 100,
        maxHeight: 600,
      }}
      className={`flex min-h-0 flex-col rounded-xl border bg-zinc-900 transition-colors ${
        isDragOverTarget
          ? 'border-2 border-white shadow-[0_0_0_1px_rgba(255,255,255,0.3)]'
          : editMode
            ? 'border-dashed border-zinc-600'
            : 'border-zinc-800'
      } ${editMode ? 'cursor-move' : ''} ${isDragging ? 'opacity-40' : ''}`}
    >
      {editMode && (
        <div className="flex shrink-0 items-center justify-center gap-1 border-b border-dashed border-zinc-700 bg-zinc-800/50 py-1 text-zinc-500">
          <GripVertical className="h-3 w-3" />
          <span className="text-[10px]">Arrastra para mover · Jala la esquina para redimensionar</span>
        </div>
      )}
      {children}
    </div>
  );
}