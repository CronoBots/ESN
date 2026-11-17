import { useMemo, useState } from 'react';
import { encode } from 'uqr';

/** Adresse de l'application (sans page ni paramètre) : ouverte à tous, sans connexion. */
export function appUrl(): string {
  return `${location.origin}${location.pathname}`;
}
import { SheetLayout, overlay } from './ui';
import { Icon } from './Icon';

/** QR code dessiné en SVG (un seul tracé, bords nets, marge blanche réglementaire de 4 modules). */
function QrCode({ text, label }: { text: string; label: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 0 });
    let d = '';
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      }),
    );
    return { path: d, size: qr.size + 8 };
  }, [text]);
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#0b1630" />
    </svg>
  );
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/** Affiche à imprimer ou à envoyer : logo du club, QR code, consigne (PNG 1200 × 1600). */
async function qrPoster(link: string): Promise<Blob> {
  const qr = encode(link, { ecc: 'M', border: 0 });
  const W = 1200;
  const H = 1600;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const logo = await loadImage('./brand/esn-competition.png');
  const lw = 560;
  const lh = (lw * logo.height) / logo.width;
  g.drawImage(logo, (W - lw) / 2, 90, lw, lh);
  const size = 860;
  const n = qr.size + 8;
  const m = size / n;
  const x0 = (W - size) / 2;
  const y0 = 90 + lh + 50;
  g.fillStyle = '#0b1630';
  qr.data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) g.fillRect(Math.floor(x0 + (x + 4) * m), Math.floor(y0 + (y + 4) * m), Math.ceil(m), Math.ceil(m));
    }),
  );
  await document.fonts?.ready;
  g.textAlign = 'center';
  g.fillStyle = '#14254d';
  g.font = '700 60px "Barlow Condensed", "Barlow", system-ui, sans-serif';
  g.fillText('Scannez pour ouvrir l’application', W / 2, y0 + size + 80);
  g.fillStyle = '#4a5568';
  g.font = '400 38px "Barlow", system-ui, sans-serif';
  g.fillText('Résultats, records et progression des nageurs de l’ESN', W / 2, y0 + size + 140);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('image'))), 'image/png'));
}

function ShareSheet({ close }: { close: () => void }) {
  const link = appUrl();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      overlay.toast('Lien copié', '🔗');
    } catch {
      overlay.toast('Copie impossible : touchez longuement le lien pour le copier', '⚠️');
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'ESN Compétition',
          text: 'Les résultats, records et la progression des nageurs de l’ESN, dans l’application ESN Compétition :',
          url: link,
        });
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
      }
    }
    await copy();
  };

  const saveImage = async () => {
    try {
      const blob = await qrPoster(link);
      const file = new File([blob], 'qr-code-esn-competition.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'QR code ESN Compétition' });
          return;
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      overlay.toast('Image indisponible pour le moment', '⚠️');
    }
  };

  return (
    <SheetLayout title="Partager aux parents" onCancel={close} cancelLabel="Fermer">
      <div className="invite">
        <QrCode text={link} label="QR code d’ESN Compétition" />
        <p className="invite-lead">Montrez ce QR code à un autre parent : il le scanne avec l’appareil photo de son téléphone et arrive aussitôt sur les nageurs de l’ESN.</p>
        <button className="btn block" onClick={share}>
          <Icon name="share" /> Partager le lien
        </button>
        <button className="btn ghost block" onClick={copy}>
          <Icon name={copied ? 'check' : 'link'} /> {copied ? 'Lien copié' : 'Copier le lien'}
        </button>
        <button className="btn ghost block" onClick={saveImage}>
          <Icon name="download" /> Image à imprimer ou afficher
        </button>
        <p className="invite-link" aria-label="Adresse de l’application">
          {link}
        </p>
        <div className="section-foot">
          Aucun compte ni mot de passe : il suffit d’ouvrir l’adresse. Groupe WhatsApp du club, e-mail aux parents, affiche à la piscine…
        </div>
      </div>
    </SheetLayout>
  );
}

/** Partager l'application : QR code, lien et affiche de l'adresse du site. */
export function openShareApp() {
  overlay.sheet((close) => <ShareSheet close={close} />);
}
