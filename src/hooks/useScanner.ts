import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Lectura de códigos JAN.
 *
 * Chrome en Android trae BarcodeDetector nativo. Safari en iOS no, así que ahí
 * entra el ponyfill WASM: son unos 300 kB, por eso se carga solo cuando hace
 * falta y no en el bundle inicial.
 */

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

async function makeDetector(): Promise<Detector> {
  if ('BarcodeDetector' in globalThis) {
    const supported = await (globalThis as any).BarcodeDetector.getSupportedFormats();
    const formats = FORMATS.filter((f) => supported.includes(f));
    if (formats.length > 0) return new (globalThis as any).BarcodeDetector({ formats });
  }
  const { BarcodeDetector } = await import('barcode-detector/ponyfill');
  return new BarcodeDetector({ formats: [...FORMATS] }) as Detector;
}

export type ScannerState = 'idle' | 'starting' | 'scanning' | 'denied' | 'unsupported';

export function useScanner(onDetect: (jan: string) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  // getUserMedia tarda, y en ese hueco cabe un stop() o un segundo start()
  // (StrictMode monta, desmonta y vuelve a montar). Este contador dice si el
  // stream que acaba de llegar sigue siendo el vigente; si no, se apaga. Sin
  // esto la camara se queda encendida sin que nadie la use.
  const genRef = useRef(0);
  const [state, setState] = useState<ScannerState>('idle');

  const stop = useCallback(() => {
    genRef.current += 1;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    // Safari sigue mostrando el ultimo fotograma si no se suelta el srcObject.
    if (videoRef.current) videoRef.current.srcObject = null;
    setState('idle');
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }
    const gen = ++genRef.current;
    setState('starting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // La trasera, y enfocada de cerca: un JAN se lee a diez centímetros.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      });

      // Llego tarde: por el camino hubo un stop() o un start() mas nuevo.
      const video = videoRef.current;
      if (gen !== genRef.current || !video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true'); // iOS: sin esto abre a pantalla completa
      await video.play();

      const detector = await makeDetector();
      setState('scanning');

      let lastHit = '';
      let lastAt = 0;

      const tick = async () => {
        if (!streamRef.current || gen !== genRef.current) return;
        try {
          const codes = await detector.detect(video);
          const raw = codes[0]?.rawValue;
          const now = Date.now();
          // Un mismo código se reporta muchas veces por segundo: solo el primero,
          // y pasados dos segundos se vuelve a admitir por si escanea otra caja.
          if (raw && /^\d{8,13}$/.test(raw) && (raw !== lastHit || now - lastAt > 2000)) {
            lastHit = raw;
            lastAt = now;
            if ('vibrate' in navigator) navigator.vibrate(40);
            onDetect(raw);
          }
        } catch {
          // Un fotograma ilegible no es un error: sigue.
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setState((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unsupported');
    }
  }, [onDetect]);

  useEffect(() => stop, [stop]);

  return { videoRef, state, start, stop };
}
