import { useEffect, useRef, useState } from 'react';
import { SheetLayout, overlay } from './ui';
import { Icon } from './Icon';

type ScanState = 'starting' | 'scanning' | 'denied' | 'unavailable';

/**
 * Scanner de QR code avec l'appareil photo, dans l'application : indispensable
 * pour l'application installée sur iPhone, que l'appareil photo du téléphone
 * n'ouvre pas (il ouvre Safari). Le texte lu est passé à `onText` ; la
 * fenêtre se ferme si `onText` renvoie vrai (QR code reconnu).
 * La lecture (jsQR) n'est chargée qu'à l'ouverture du scanner.
 */
function QrScannerSheet({ close, onText }: { close: () => void; onText: (text: string) => boolean | Promise<boolean> }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>('starting');
  const [hint, setHint] = useState('');
  const handlers = useRef({ close, onText });
  handlers.current = { close, onText };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    let busy = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable');
        const [{ default: jsQR }, media] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }),
        ]);
        stream = media;
        if (stopped || !video.current) return;
        video.current.srcObject = media;
        await video.current.play().catch(() => {});
        setState('scanning');
        const tick = async () => {
          const v = video.current;
          if (stopped || !v || !ctx) return;
          if (!busy && v.videoWidth) {
            // Image réduite (≤ 640 px) : lecture rapide sur tous les téléphones
            const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (found?.data) {
              busy = true;
              const ok = await handlers.current.onText(found.data);
              if (ok) {
                stopped = true;
                stream?.getTracks().forEach((t) => t.stop());
                handlers.current.close();
                return;
              }
              setHint('Ce QR code n’est pas celui de l’ESN.');
              setTimeout(() => (busy = false), 1500);
            }
          }
          timer = window.setTimeout(tick, 180);
        };
        tick();
      } catch (e) {
        const name = (e as Error)?.name;
        setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <SheetLayout title="Scanner le QR code" onCancel={close} cancelLabel="Fermer">
      <div className="scanner">
        <div className={`scanner-view${state === 'scanning' ? ' live' : ''}`}>
          <video ref={video} playsInline muted autoPlay aria-label="Image de l’appareil photo" />
          {state === 'scanning' && <span className="scanner-frame" aria-hidden="true" />}
          {state === 'starting' && <span className="scanner-msg">Ouverture de l’appareil photo…</span>}
          {state === 'denied' && (
            <span className="scanner-msg">
              <Icon name="info" />
              L’appareil photo est refusé. Autorisez-le pour ESN Compétition dans les réglages du téléphone, puis réessayez.
            </span>
          )}
          {state === 'unavailable' && (
            <span className="scanner-msg">
              <Icon name="info" />
              Appareil photo indisponible sur cet appareil.
            </span>
          )}
        </div>
        <p className="scanner-hint" role="status">
          {hint || 'Visez le QR code de l’ESN : il est lu tout seul.'}
        </p>
      </div>
    </SheetLayout>
  );
}

export function openQrScanner(onText: (text: string) => boolean | Promise<boolean>) {
  overlay.sheet((close) => <QrScannerSheet close={close} onText={onText} />);
}
