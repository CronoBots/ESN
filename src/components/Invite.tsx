import { useMemo, useState } from 'react';
import { encode } from 'uqr';
import { getState } from '../store/store';
import { inviteLink } from '../lib/invite';
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

function InviteSheet({ close, code }: { close: () => void; code: string }) {
  const link = inviteLink(code);
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
          text: 'Les résultats, records et la progression des nageurs de l’ESN : ouvre ce lien, l’application est déjà connectée au club.',
          url: link,
        });
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
      }
    }
    await copy();
  };

  return (
    <SheetLayout title="Inviter une famille" onCancel={close} cancelLabel="Fermer">
      <div className="invite">
        <QrCode text={link} label="QR code d’invitation à ESN Compétition" />
        <p className="invite-lead">À scanner avec l’appareil photo du téléphone : l’application s’ouvre déjà connectée au club, sans code à taper.</p>
        <button className="btn block" onClick={share}>
          <Icon name="share" /> Partager le lien
        </button>
        <button className="btn ghost block" onClick={copy}>
          <Icon name={copied ? 'check' : 'link'} /> {copied ? 'Lien copié' : 'Copier le lien'}
        </button>
        <p className="invite-link" aria-label="Lien d’invitation">
          {link}
        </p>
        <div className="section-foot">
          Le lien contient le code du club : il donne accès aux nageurs de l’ESN. Partagez-le seulement avec les familles du club (groupe
          WhatsApp du club, e-mail aux parents…).
        </div>
      </div>
    </SheetLayout>
  );
}

/** Ouvre la fenêtre d'invitation (club déverrouillé sur cet appareil). */
export function openInvite() {
  const code = getState().settings.club?.code;
  if (!code) return;
  overlay.sheet((close) => <InviteSheet close={close} code={code} />);
}
