import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Virtualisasi daftar dengan tinggi baris tetap.
 *
 * Hanya baris yang benar-benar terlihat yang dirender. Tanpa ini, membuka
 * direktori berisi puluhan ribu berkas akan membuat React membangun puluhan
 * ribu simpul DOM sekaligus — aplikasi membeku beberapa detik dan pemakaian
 * memori melonjak.
 *
 * Ditulis sendiri alih-alih memakai pustaka virtualisasi karena kasusnya
 * sederhana: tinggi baris seragam dan hanya satu arah gulir.
 */

interface VirtualRowsOptions {
  count: number;
  rowHeight: number;
  /** Baris ekstra di atas dan bawah viewport, meredam kedipan saat menggulir. */
  overscan?: number;
}

interface VirtualRows {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  /** Tinggi semu seluruh daftar, dipakai agar bilah gulir berukuran benar. */
  totalHeight: number;
  /** Geser blok baris terlihat ke posisi yang seharusnya. */
  offsetY: number;
  startIndex: number;
  endIndex: number;
  scrollToTop: () => void;
}

export function useVirtualRows({
  count,
  rowHeight,
  overscan = 8,
}: VirtualRowsOptions): VirtualRows {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const onScroll = useCallback(() => {
    setScrollTop(scrollRef.current?.scrollTop ?? 0);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(count, startIndex + visibleCount + overscan * 2);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, []);

  return {
    scrollRef,
    onScroll,
    totalHeight: count * rowHeight,
    offsetY: startIndex * rowHeight,
    startIndex,
    endIndex,
    scrollToTop,
  };
}
