import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

/**
 * Pembungkus uPlot untuk data yang terus mengalir.
 *
 * uPlot dipilih daripada Recharts karena grafik di sini diperbarui setiap dua
 * detik selama panel terbuka. Recharts membangun ulang pohon React setiap
 * pembaruan; uPlot menggambar ke canvas dan hanya menyentuh piksel yang
 * berubah — bedanya terasa setelah panel dibiarkan terbuka berjam-jam.
 */

interface ChartProps {
  /** [waktu (detik), ...seri]. Panjang tiap larik harus sama. */
  data: uPlot.AlignedData;
  series: Array<{ label: string; color: string }>;
  height?: number;
  /** Batas atas sumbu Y. Kosongkan untuk skala otomatis. */
  maxY?: number;
  /** Pemformat nilai pada sumbu Y dan tooltip. */
  format?: (value: number) => string;
}

export function Chart({ data, series, height = 120, maxY, format }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  // Simpan di ref supaya perubahan format tidak memicu pembuatan ulang plot.
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const options: uPlot.Options = {
      width: container.clientWidth,
      height,
      padding: [8, 8, 0, 0],
      legend: { show: false },
      cursor: { y: false, drag: { x: false, y: false } },
      scales: {
        x: { time: false },
        y: maxY !== undefined ? { range: [0, maxY] } : { range: (_u, _min, max) => [0, max * 1.1 || 1] },
      },
      axes: [
        { show: false },
        {
          stroke: '#5b6275',
          grid: { stroke: '#1c202b', width: 1 },
          ticks: { show: false },
          size: 52,
          font: '11px ui-monospace, monospace',
          values: (_u, ticks) => ticks.map((t) => formatRef.current?.(t) ?? String(t)),
        },
      ],
      series: [
        {},
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 1.5,
          fill: `${s.color}1f`,
          points: { show: false },
        })),
      ],
    };

    const plot = new uPlot(options, data, container);
    plotRef.current = plot;

    const observer = new ResizeObserver(() =>
      plot.setSize({ width: container.clientWidth, height }),
    );
    observer.observe(container);

    return () => {
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // Sengaja tidak menyertakan `data`: pembaruan data ditangani efek di bawah
    // agar plot tidak dibangun ulang tiap dua detik.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, maxY, series.length]);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return <div ref={containerRef} className="w-full" />;
}
