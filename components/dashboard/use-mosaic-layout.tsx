'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Sistema GENÉRICO de mosaico redimensionable — un solo hook que sirve
 * para cualquier fila o columna de N elementos, en cualquier parte del
 * dashboard (tabla vs. columna de gráficas, las 4 gráficas entre sí, las
 * 3 tarjetas de stats entre sí, la fila principal vs. la fila de stats).
 *
 * Todos comparten el mismo principio: proporciones FLEXIBLES (pesos, no
 * píxeles fijos). Arrastrar el divisor entre dos elementos adyacentes
 * reparte el espacio SOLO entre esos dos — como la suma total de pesos
 * nunca cambia, el conjunto completo siempre llena exactamente el
 * espacio disponible: nada se encima, nada se sale de pantalla, nunca
 * hace falta scroll.
 *
 * Solo interactivo cuando editMode=true — fuera de edición, las
 * proporciones guardadas se siguen respetando pero no se puede arrastrar.
 */

export type MosaicAxis = 'row' | 'column';

function loadWeights(storageKey: string, defaultWeights: number[]): number[] {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length === defaultWeights.length && parsed.every((n) => typeof n === 'number' && n > 0)) {
        return parsed;
      }
    }
  } catch {
    // localStorage no disponible o dato corrupto — se ignora, se usa el default.
  }
  return [...defaultWeights];
}

function saveWeights(storageKey: string, weights: number[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(weights));
  } catch {
    // si falla el guardado, el usuario simplemente pierde la personalización — no rompe nada más.
  }
}

/**
 * @param axis 'row' = los elementos se reparten el ALTO (divisor horizontal, se arrastra verticalmente). 'column' = se reparten el ANCHO (divisor vertical, se arrastra horizontalmente).
 * @param defaultWeights pesos iniciales, uno por elemento — el tamaño real de cada uno es weight / suma(weights) del espacio total.
 * @param storageKey clave de localStorage para persistir la personalización de cada usuario.
 */
export function useMosaicWeights(axis: MosaicAxis, defaultWeights: number[], storageKey: string) {
  const [weights, setWeights] = useState<number[]>(() =>
    typeof window !== 'undefined' ? loadWeights(storageKey, defaultWeights) : [...defaultWeights],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ index: number; startPos: number; startWeights: number[] } | null>(null);

  const handleDividerMouseDown = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      const startPos = axis === 'row' ? e.clientY : e.clientX;
      dragState.current = { index, startPos, startWeights: [...weights] };

      function handleMouseMove(moveEvent: MouseEvent) {
        if (!dragState.current || !containerRef.current) return;
        const { index, startPos, startWeights } = dragState.current;
        const rect = containerRef.current.getBoundingClientRect();
        const containerSize = axis === 'row' ? rect.height : rect.width;
        if (containerSize <= 0) return;

        const currentPos = axis === 'row' ? moveEvent.clientY : moveEvent.clientX;
        const delta = currentPos - startPos;
        const totalWeight = startWeights.reduce((a, b) => a + b, 0);
        const deltaWeight = (delta / containerSize) * totalWeight;

        const next = [...startWeights];
        const minWeight = totalWeight * 0.06; // ~6% mínimo, para que ningún elemento desaparezca del todo
        const pairTotal = startWeights[index] + startWeights[index + 1];
        const a = Math.max(minWeight, Math.min(pairTotal - minWeight, startWeights[index] + deltaWeight));
        next[index] = a;
        next[index + 1] = pairTotal - a;

        setWeights(next);
      }

      function handleMouseUp() {
        dragState.current = null;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        setWeights((current) => {
          saveWeights(storageKey, current);
          return current;
        });
      }

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [axis, weights, storageKey],
  );

  const resetWeights = useCallback(() => {
    setWeights([...defaultWeights]);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // no pasa nada si tampoco se puede borrar — el estado en memoria ya se reseteó.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  return { weights, containerRef, handleDividerMouseDown, resetWeights };
}

/** Divisor delgado y arrastrable entre dos elementos adyacentes — solo interactivo si editMode=true. Úsalo con axis='row' (elementos apilados verticalmente) o axis='column' (elementos lado a lado). */
export function MosaicDivider({
  axis,
  editMode,
  onMouseDown,
}: {
  axis: MosaicAxis;
  editMode: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  if (!editMode) return null;

  if (axis === 'row') {
    return (
      <div onMouseDown={onMouseDown} className="group relative -my-1.5 flex h-3 shrink-0 cursor-row-resize items-center justify-center">
        <div className="h-1 w-10 rounded-full bg-zinc-700 transition-colors group-hover:bg-white" />
      </div>
    );
  }

  return (
    <div onMouseDown={onMouseDown} className="group relative -mx-1.5 hidden w-3 shrink-0 cursor-col-resize items-center justify-center lg:flex">
      <div className="h-10 w-1 rounded-full bg-zinc-700 transition-colors group-hover:bg-white" />
    </div>
  );
}