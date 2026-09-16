import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

/** Renders a payment address as a scannable code, drawn locally — never uploaded. */
export function QR({ value, size = 168 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 1,
      color: { dark: '#0a0e17', light: '#ffffff' },
    });
  }, [value, size]);

  return <canvas ref={canvasRef} className="rounded-lg bg-white p-1" width={size} height={size} />;
}
