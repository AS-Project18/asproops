import { useEffect, useRef, type RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from '../terminalPrefs';

interface TerminalFontWheelZoomOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  termRef: RefObject<Terminal | null>;
  fitRef: RefObject<FitAddon | null>;
  active: boolean;
  onResize: (cols: number, rows: number) => void;
}

/**
 * Ctrl + wheel mengubah ukuran font HANYA untuk instance terminal aktif.
 *
 * Nilai ini sengaja tidak ditulis ke TerminalPrefs global. Jadi terminal lain
 * tidak ikut meloncat ukurannya hanya karena user memperbesar satu tab.
 * Perubahan Settings tetap menjadi baseline global dan akan mengganti zoom
 * sementara ketika preferensi terminal diubah.
 */
export function useTerminalFontWheelZoom({
  containerRef,
  termRef,
  fitRef,
  active,
  onResize,
}: TerminalFontWheelZoomOptions): void {
  const onResizeRef = useRef(onResize);
  const accumulatorRef = useRef(0);
  const lastEventAtRef = useRef(0);

  onResizeRef.current = onResize;

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;

      // Mencegah Chromium melakukan page zoom dan mencegah xterm menganggap
      // gesture ini sebagai scrollback / mouse-wheel event untuk TUI.
      event.preventDefault();
      event.stopPropagation();

      const term = termRef.current;
      const fit = fitRef.current;
      if (!term || !fit) return;

      const now = performance.now();
      if (now - lastEventAtRef.current > 250) accumulatorRef.current = 0;
      lastEventAtRef.current = now;

      // deltaMode 0=pixel, 1=line, 2=page. Normalisasi supaya mouse wheel dan
      // touchpad tidak menghasilkan kecepatan zoom yang terlalu berbeda.
      const normalizedDelta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * 100
            : event.deltaY;

      if (
        accumulatorRef.current !== 0 &&
        Math.sign(accumulatorRef.current) !== Math.sign(normalizedDelta)
      ) {
        accumulatorRef.current = 0;
      }

      accumulatorRef.current += normalizedDelta;

      // Satu notch mouse biasanya jauh di atas nilai ini; touchpad perlu
      // sedikit gerakan sebelum satu step terjadi sehingga tidak "liar".
      if (Math.abs(accumulatorRef.current) < 24) return;

      const current = Math.round(Number(term.options.fontSize) || MIN_TERMINAL_FONT_SIZE);
      const direction = accumulatorRef.current < 0 ? 1 : -1;
      const next = Math.max(
        MIN_TERMINAL_FONT_SIZE,
        Math.min(MAX_TERMINAL_FONT_SIZE, current + direction),
      );

      accumulatorRef.current = 0;
      if (next === current) return;

      term.options.fontSize = next;

      requestAnimationFrame(() => {
        if (!active || !termRef.current || !fitRef.current) return;

        try {
          fitRef.current.fit();
        } catch {
          return;
        }

        onResizeRef.current(termRef.current.cols, termRef.current.rows);
        termRef.current.focus();
      });
    };

    container.addEventListener('wheel', handleWheel, {
      capture: true,
      passive: false,
    });

    return () => {
      container.removeEventListener('wheel', handleWheel, true);
      accumulatorRef.current = 0;
    };
  }, [active, containerRef, fitRef, termRef]);
}
