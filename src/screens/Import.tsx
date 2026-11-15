import { useEffect, useMemo, useRef, useState } from 'react';
import { actions, useData } from '../store/store';
import { fullName, sortSwimmers } from '../store/hooks';
import { Avatar, NavBar, Section, Segmented, StrokeTag, overlay } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate, useRoute } from '../router';
import { bookmarkletCode, extractAthleteId, parseSwimrankings, swimrankingsUrl, type ParseResult } from '../lib/swimrankings';
import { eventLabel, courseLabel } from '../lib/events';
import { formatDate } from '../lib/dates';
import { formatTime, parseTime } from '../lib/time';
import type { Gender } from '../store/types';
import { openResultForm } from './forms';

type Method = 'photo' | 'paste' | 'computer';

function isMobile(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function ImportScreen() {
  const route = useRoute();
  const data = useData();
  const swimmers = sortSwimmers(data.swimmers);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [fromPhoto, setFromPhoto] = useState(false);
  const [method, setMethod] = useState<Method>(isMobile() ? 'photo' : 'computer');
  const [targetId, setTargetId] = useState<string>(route.query.get('swimmer') ?? '');
  const [gender, setGender] = useState<Gender>('F');
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Map<number, string>>(new Map());
  const [srLink, setSrLink] = useState('');
  const [ocr, setOcr] = useState<{ progress: number; label: string } | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [showText, setShowText] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const appUrl = `${location.origin}${location.pathname}`;
  const code = useMemo(() => bookmarkletCode(appUrl), [appUrl]);

  // Données transmises par le bouton-favori
  useEffect(() => {
    const incoming = route.query.get('data');
    if (incoming) {
      setText(incoming);
      analyse(incoming, false);
      const sw = route.query.get('swimmer');
      navigate(`/import${sw ? `?swimmer=${sw}` : ''}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => thumbs.forEach((u) => URL.revokeObjectURL(u)), [thumbs]);

  const preselected = swimmers.find((s) => s.id === targetId);
  const srId = preselected?.swimrankingsId ?? extractAthleteId(srLink);

  function analyse(input = text, photo = fromPhoto) {
    const r = parseSwimrankings(input);
    setResult(r);
    setFromPhoto(photo);
    setExcluded(new Set());
    setEdits(new Map());
    if (r.athlete.gender) setGender(r.athlete.gender);
    const match =
      swimmers.find((s) => r.athlete.swimrankingsId && s.swimrankingsId === r.athlete.swimrankingsId) ??
      swimmers.find(
        (s) =>
          r.athlete.lastName &&
          s.lastName.toLowerCase() === r.athlete.lastName.toLowerCase() &&
          s.firstName.toLowerCase() === (r.athlete.firstName ?? '').toLowerCase(),
      );
    if (match) setTargetId(match.id);
    else if (r.athlete.lastName && !route.query.get('swimmer')) setTargetId('new');
    else if (!targetId && swimmers.length === 1) setTargetId(swimmers[0].id);
    else if (!targetId && !swimmers.length) setTargetId('new');
    setTimeout(() => document.getElementById('import-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  async function readPhotos(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 6);
    setThumbs(list.map((f) => URL.createObjectURL(f)));
    setResult(null);
    try {
      const { recognizeScreenshots } = await import('../lib/ocr');
      const txt = await recognizeScreenshots(list, setOcr);
      setText(txt);
      analyse(txt, true);
    } catch (e) {
      overlay.toast(
        navigator.onLine ? 'Lecture impossible. Essayez une capture plus nette ou le copier-coller.' : 'Connexion nécessaire pour la première lecture',
        '⚠️',
      );
      console.error(e);
    } finally {
      setOcr(null);
    }
  }

  const existingKeys = useMemo(() => {
    const id = targetId && targetId !== 'new' ? targetId : null;
    return new Set(
      data.swims.filter((s) => s.swimmerId === id && s.timeCs).map((s) => `${s.course}|${s.distance}|${s.stroke}|${s.timeCs}|${s.date}`),
    );
  }, [data.swims, targetId]);

  const rows = result?.swims.map((s, i) => {
    const edited = edits.get(i);
    const cs = edited != null ? parseTime(edited) : s.timeCs;
    return {
      s,
      i,
      cs,
      invalid: edited != null && cs == null,
      dup: cs != null && existingKeys.has(`${s.course}|${s.distance}|${s.stroke}|${cs}|${s.date}`),
    };
  });
  const selected = rows?.filter((r) => !r.dup && !r.invalid && !excluded.has(r.i) && r.cs != null) ?? [];
  const canCreate = !!result?.athlete.lastName || !!result?.athlete.firstName;

  const doImport = () => {
    if (!result || !selected.length) return;
    let target: Parameters<typeof actions.importSwimrankings>[0];
    if (targetId && targetId !== 'new') {
      target = { swimmerId: targetId };
      const sw = swimmers.find((s) => s.id === targetId);
      if (sw) {
        const patch: Partial<typeof sw> = {};
        if (!sw.swimrankingsId && (result.athlete.swimrankingsId || srId)) patch.swimrankingsId = result.athlete.swimrankingsId ?? srId ?? undefined;
        if (!sw.birthYear && result.athlete.birthYear) patch.birthYear = result.athlete.birthYear;
        if (!sw.club && result.athlete.club) patch.club = result.athlete.club;
        if (!sw.nation && result.athlete.nation) patch.nation = result.athlete.nation;
        if (Object.keys(patch).length) actions.updateSwimmer(sw.id, patch);
      }
    } else {
      target = {
        create: {
          ...result.athlete,
          swimrankingsId: result.athlete.swimrankingsId ?? srId ?? undefined,
          firstName: result.athlete.firstName ?? 'Nageur',
          lastName: result.athlete.lastName ?? '',
          gender,
        },
      };
    }
    const res = actions.importSwimrankings(
      target,
      selected.map((r) => ({ ...r.s, timeCs: r.cs!, points: r.cs === r.s.timeCs ? r.s.points : undefined })),
    );
    overlay.celebrate();
    overlay.toast(`${res.added} performance${res.added > 1 ? 's' : ''} importée${res.added > 1 ? 's' : ''}`, '🎉');
    navigate('/', { replace: true });
  };

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t?.trim()) {
        setText(t);
        analyse(t, false);
      } else overlay.toast('Le presse-papiers est vide : copiez d’abord le tableau', 'ℹ️');
    } catch {
      setShowText(true);
      overlay.toast('Appuyez longuement dans le cadre puis « Coller »', 'ℹ️');
      setTimeout(() => document.getElementById('imp-text')?.focus(), 100);
    }
  };

  return (
    <>
      <NavBar title="Importer des temps" subtitle="Depuis swimrankings.net" back="/settings" />
      <main className="page">
        {/* 1. Le nageur et sa page */}
        <div className="card pad">
          <div className="hstack" style={{ alignItems: 'flex-start' }}>
            <span className="badge first" style={{ height: 24, fontSize: 13 }}>1</span>
            <div className="grow">
              <b>Ouvrez la page du nageur sur swimrankings.net</b>
              <div className="muted small" style={{ marginTop: 2 }}>Onglet « Meilleurs temps ». Aucun compte n’est nécessaire.</div>
            </div>
          </div>
          {!preselected?.swimrankingsId && (
            <input
              id="imp-link"
              className="textinput"
              style={{ marginTop: 12 }}
              value={srLink}
              onChange={(e) => setSrLink(e.target.value)}
              placeholder="Lien ou n° d’athlète (facultatif)"
              aria-label="Lien swimrankings.net ou numéro d’athlète"
            />
          )}
          <a
            className="btn secondary block"
            style={{ marginTop: 12 }}
            href={srId ? swimrankingsUrl(srId) : 'https://www.swimrankings.net/'}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="external" />
            {srId ? `Ouvrir la page${preselected ? ` de ${preselected.firstName}` : ''}` : 'Ouvrir swimrankings.net'}
          </a>
          {!srId && <div className="muted small center" style={{ marginTop: 8 }}>Sur le site : Nageurs › Recherche, puis le nom du nageur.</div>}
        </div>

        {/* 2. Méthode */}
        <Section
          title={
            <span className="hstack" style={{ gap: 8 }}>
              <span className="badge first" style={{ height: 24, fontSize: 13 }}>2</span>
              Récupérez les temps
            </span>
          }
        >
          <Segmented
            value={method}
            onChange={setMethod}
            options={[
              { id: 'photo', label: '📷 Capture' },
              { id: 'paste', label: '📋 Copier' },
              { id: 'computer', label: '💻 Ordinateur' },
            ]}
            ariaLabel="Méthode d’import"
          />

          {method === 'photo' && (
            <div className="card pad" style={{ marginTop: 12 }}>
              <div className="hstack" style={{ marginBottom: 12 }}>
                <span className="badge first">Le plus simple</span>
                <b>Avec une capture d’écran</b>
              </div>
              <ol className="steps">
                <li>Sur la page du nageur, zoomez sur le tableau des temps pour qu’il soit bien lisible.</li>
                <li>
                  Faites une capture d’écran (iPhone : bouton latéral + volume haut). Plusieurs captures si le tableau est long.
                </li>
                <li>Revenez ici et choisissez la ou les captures : l’application lit les temps, vous vérifiez, vous importez.</li>
              </ol>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  readPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
              <button className="btn block" onClick={() => fileRef.current?.click()} disabled={!!ocr}>
                <Icon name="upload" /> {ocr ? 'Lecture en cours…' : 'Choisir la capture d’écran'}
              </button>
              {ocr && (
                <div style={{ marginTop: 12 }}>
                  <div className="meter">
                    <div style={{ width: `${Math.round(ocr.progress * 100)}%` }} />
                  </div>
                  <div className="muted small center" style={{ marginTop: 6 }}>
                    {ocr.label} {Math.round(ocr.progress * 100)} %
                  </div>
                </div>
              )}
              <div className="muted small" style={{ marginTop: 10 }}>
                La lecture se fait sur votre téléphone : la capture n’est envoyée nulle part.
              </div>
            </div>
          )}

          {method === 'paste' && (
            <div className="card pad" style={{ marginTop: 12 }}>
              <div className="hstack" style={{ marginBottom: 12 }}>
                <span className="badge first">Le plus précis</span>
                <b>Par copier-coller</b>
              </div>
              <ol className="steps">
                <li>
                  Sur la page du nageur, <b>appuyez longuement</b> sur le premier mot du tableau (par ex. « 100m Libre ») jusqu’à ce
                  qu’il soit surligné.
                </li>
                <li>
                  <b>Faites glisser la poignée bleue</b> jusqu’au dernier temps du tableau, puis touchez <b>« Copier »</b>.
                </li>
                <li>
                  Revenez ici et touchez <b>« Coller »</b>.
                </li>
              </ol>
              <SelectionDemo />
              <button className="btn block" style={{ marginTop: 14 }} onClick={paste}>
                <Icon name="clipboard" /> Coller
              </button>
              <button className="section-link" style={{ display: 'block', margin: '10px auto 0' }} onClick={() => setShowText((v) => !v)}>
                {showText ? 'Masquer le texte' : 'Coller le texte à la main'}
              </button>
              {showText && (
                <>
                  <textarea
                    id="imp-text"
                    className="textinput"
                    style={{ marginTop: 10 }}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Appuyez longuement ici puis « Coller »"
                    aria-label="Texte copié depuis swimrankings"
                  />
                  <button className="btn small" style={{ marginTop: 10 }} disabled={!text.trim()} onClick={() => analyse(text, false)}>
                    Analyser
                  </button>
                </>
              )}
            </div>
          )}

          {method === 'computer' && (
            <div className="card pad" style={{ marginTop: 12 }}>
              <div className="hstack" style={{ marginBottom: 12 }}>
                <span className="badge first">Ordinateur</span>
                <b>Tout sélectionner, copier, coller</b>
              </div>
              <ol className="steps">
                <li>
                  Sur la page swimrankings du nageur : <span className="kbd">Ctrl</span>+<span className="kbd">A</span> puis{' '}
                  <span className="kbd">Ctrl</span>+<span className="kbd">C</span> (sur Mac : <span className="kbd">⌘</span>+<span className="kbd">A</span>,{' '}
                  <span className="kbd">⌘</span>+<span className="kbd">C</span>).
                </li>
                <li>Revenez ici et cliquez sur « Coller ».</li>
              </ol>
              <div className="btn-row">
                <button className="btn" onClick={paste}>
                  <Icon name="clipboard" /> Coller
                </button>
                <button className="btn ghost" onClick={() => setShowText((v) => !v)}>
                  Texte
                </button>
              </div>
              {showText && (
                <>
                  <textarea
                    id="imp-text"
                    className="textinput"
                    style={{ marginTop: 10 }}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Collez ici le contenu de la page (Ctrl+V)"
                    aria-label="Texte copié depuis swimrankings"
                  />
                  <button className="btn small" style={{ marginTop: 10 }} disabled={!text.trim()} onClick={() => analyse(text, false)}>
                    Analyser
                  </button>
                </>
              )}
              <details style={{ marginTop: 16 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Encore plus rapide : le bouton « Envoyer vers Nageo »</summary>
                <ol className="steps" style={{ marginTop: 12 }}>
                  <li>
                    Affichez la barre de favoris (<span className="kbd">Ctrl</span>+<span className="kbd">Maj</span>+<span className="kbd">B</span>).
                  </li>
                  <li>
                    Glissez ce bouton dans la barre de favoris : <BookmarkletLink code={code} />
                  </li>
                  <li>Sur la page du nageur, cliquez sur ce favori puis sur « Ouvrir dans Nageo ».</li>
                </ol>
              </details>
            </div>
          )}

          <div className="section-foot center">
            Pas de swimrankings ?{' '}
            <button className="section-link" style={{ padding: 0 }} onClick={() => openResultForm({ swimmerId: preselected?.id })}>
              Saisir un temps à la main
            </button>
          </div>
        </Section>

        {/* 3. Vérification */}
        {result && (
          <div id="import-preview">
            <Section
              title={
                <span className="hstack" style={{ gap: 8 }}>
                  <span className="badge first" style={{ height: 24, fontSize: 13 }}>3</span>
                  Vérifiez et importez
                </span>
              }
            >
              {result.swims.length === 0 ? (
                <div className="callout warn">
                  <Icon name="info" />
                  <div>
                    {fromPhoto
                      ? 'Aucun temps reconnu sur la capture. Zoomez davantage sur le tableau avant la capture, ou utilisez le copier-coller.'
                      : 'Aucun temps reconnu. Vérifiez que vous avez copié le tableau des « Meilleurs temps » (épreuve, bassin, temps, date).'}
                  </div>
                </div>
              ) : (
                <>
                  {fromPhoto && (
                    <div className="callout" style={{ marginBottom: 12 }}>
                      <Icon name="info" />
                      <div>Comparez avec la capture et corrigez un temps en le touchant si besoin. Décochez une ligne pour l’ignorer.</div>
                    </div>
                  )}
                  {fromPhoto && thumbs.length > 0 && (
                    <div className="chips" style={{ marginBottom: 12 }}>
                      {thumbs.map((u) => (
                        <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                          <img src={u} alt="Capture importée" style={{ height: 120, borderRadius: 10, border: '0.5px solid var(--separator)' }} />
                        </a>
                      ))}
                    </div>
                  )}

                  <div className="list">
                    <div className="field">
                      <label htmlFor="imp-target">Nageur</label>
                      <select id="imp-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                        <option value="" disabled>
                          Choisir…
                        </option>
                        <option value="new">
                          ＋ Nouveau{canCreate ? ` : ${[result.athlete.firstName, result.athlete.lastName].filter(Boolean).join(' ')}` : ' nageur'}
                        </option>
                        {swimmers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {fullName(s)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {targetId === 'new' && (
                      <>
                        {canCreate ? (
                          <div className="row">
                            <Avatar
                              swimmer={{ firstName: result.athlete.firstName ?? 'N', lastName: result.athlete.lastName ?? '', color: data.swimmers.length % 8 }}
                              size={40}
                            />
                            <div className="row-body">
                              <div className="row-title">{[result.athlete.firstName, result.athlete.lastName].filter(Boolean).join(' ')}</div>
                              <div className="row-sub">
                                {[result.athlete.birthYear, result.athlete.nation, result.athlete.club].filter(Boolean).join(' · ') || 'Informations non détectées'}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="row">
                            <div className="row-body muted small">
                              Le nom n’a pas été trouvé : le nageur sera créé sous « Nageur », modifiable ensuite. Vous pouvez aussi choisir un
                              nageur existant ci-dessus.
                            </div>
                          </div>
                        )}
                        <div className="field">
                          <span className="label">Sexe</span>
                          <div style={{ flex: 1, maxWidth: 220, marginLeft: 'auto' }}>
                            <Segmented
                              value={gender}
                              onChange={setGender}
                              options={[
                                { id: 'F', label: 'Fille' },
                                { id: 'M', label: 'Garçon' },
                              ]}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="list" style={{ marginTop: 14 }}>
                    {rows!.map(({ s, i, dup, invalid }) => {
                      const on = !dup && !invalid && !excluded.has(i);
                      return (
                        <div key={i} className="row" style={dup ? { opacity: 0.5 } : undefined}>
                          <button
                            type="button"
                            className={`check${on ? ' on' : ''}`}
                            aria-label={on ? 'Ne pas importer' : 'Importer'}
                            aria-pressed={on}
                            disabled={dup}
                            style={{ padding: 0, background: on ? undefined : 'none' }}
                            onClick={() =>
                              setExcluded((prev) => {
                                const n = new Set(prev);
                                if (n.has(i)) n.delete(i);
                                else n.add(i);
                                return n;
                              })
                            }
                          >
                            {on && <Icon name="check" />}
                          </button>
                          <StrokeTag stroke={s.stroke} distance={s.distance} size={34} />
                          <div className="row-body">
                            <div className="row-title">{eventLabel(s.distance, s.stroke)}</div>
                            <div className="row-sub">
                              {dup ? 'Déjà enregistré · ' : ''}
                              {courseLabel(s.course)}
                              {s.courseGuessed ? ' (?)' : ''} · {formatDate(s.date)}
                              {s.city ? ` · ${s.city}` : ''}
                              {s.meet ? ` · ${s.meet}` : ''}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                            <input
                              className="time-edit"
                              inputMode="decimal"
                              aria-label={`Temps ${eventLabel(s.distance, s.stroke)}`}
                              value={edits.get(i) ?? formatTime(s.timeCs)}
                              onChange={(e) => setEdits((prev) => new Map(prev).set(i, e.target.value))}
                              style={invalid ? { color: 'var(--danger)' } : undefined}
                            />
                            {s.points != null && !edits.has(i) && <span className="small muted">{s.points} pts</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="section-foot">
                    {result.swims.length} temps reconnu{result.swims.length > 1 ? 's' : ''}
                    {rows!.some((r) => r.dup) ? `, dont ${rows!.filter((r) => r.dup).length} déjà enregistré(s)` : ''}. Les compétitions sont
                    créées automatiquement.
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <button className="btn block" disabled={!selected.length || !targetId} onClick={doImport}>
                      Importer {selected.length} temps
                    </button>
                  </div>
                </>
              )}
            </Section>
          </div>
        )}
      </main>
    </>
  );
}

/** Petite illustration : sélectionner le tableau du premier au dernier temps. */
function SelectionDemo() {
  const rows = [
    ['100m Libre', '25m', '1:24.62', '11 oct 2026'],
    ['400m Libre', '25m', '6:29.33', '10 oct 2026'],
    ['100m Brasse', '25m', '1:56.61', '10 oct 2026'],
  ];
  return (
    <div className="sel-demo" aria-hidden="true">
      <div className="sel-head">
        <span>Compétition</span>
        <span>Bassin</span>
        <span>Temps</span>
        <span>Date</span>
      </div>
      {rows.map((r, i) => (
        <div className="sel-row" key={i}>
          {r.map((c, j) => (
            <span key={j}>
              {i === 0 && j === 0 && <i className="handle start" />}
              <mark>{c}</mark>
              {i === rows.length - 1 && j === r.length - 1 && <i className="handle end" />}
            </span>
          ))}
        </div>
      ))}
      <div className="sel-menu">Copier</div>
    </div>
  );
}

/**
 * Lien glissable vers la barre de favoris. React bloque les adresses
 * « javascript: » dans le rendu : on les pose directement sur l'élément.
 */
function BookmarkletLink({ code }: { code: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.setAttribute('href', code);
  }, [code]);
  return (
    <a
      ref={ref}
      className="bookmarklet"
      onClick={(e) => {
        e.preventDefault();
        overlay.toast('Glissez le bouton dans vos favoris', '👆');
      }}
    >
      <Icon name="download" style={{ width: 18, height: 18 }} /> Envoyer vers Nageo
    </a>
  );
}
