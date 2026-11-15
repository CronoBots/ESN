import { useEffect, useMemo, useRef, useState } from 'react';
import { actions, useData } from '../store/store';
import { fullName, sortSwimmers } from '../store/hooks';
import { Avatar, NavBar, Section, Segmented, StrokeTag, overlay } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate, useRoute } from '../router';
import { bookmarkletCode, extractAthleteId, parseSwimrankings, swimrankingsUrl, type ParseResult } from '../lib/swimrankings';
import { eventLabel, courseLabel } from '../lib/events';
import { formatDate } from '../lib/dates';
import { formatTime } from '../lib/time';
import type { Gender } from '../store/types';

type Device = 'desktop' | 'ios' | 'android';

function detectDevice(): Device {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export function ImportScreen() {
  const route = useRoute();
  const data = useData();
  const swimmers = sortSwimmers(data.swimmers);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [device, setDevice] = useState<Device>(detectDevice());
  const [targetId, setTargetId] = useState<string>(route.query.get('swimmer') ?? '');
  const [gender, setGender] = useState<Gender>('F');
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [srLink, setSrLink] = useState('');
  const appUrl = `${location.origin}${location.pathname}`;
  const code = useMemo(() => bookmarkletCode(appUrl), [appUrl]);

  // Données transmises par le bouton-favori
  useEffect(() => {
    const incoming = route.query.get('data');
    if (incoming) {
      setText(incoming);
      analyse(incoming);
      const sw = route.query.get('swimmer');
      navigate(`/import${sw ? `?swimmer=${sw}` : ''}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preselected = swimmers.find((s) => s.id === targetId);

  function analyse(input = text) {
    const r = parseSwimrankings(input);
    setResult(r);
    setExcluded(new Set());
    if (r.athlete.gender) setGender(r.athlete.gender);
    // Associe automatiquement au nageur existant (même identifiant ou même nom)
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
    if (!r.swims.length) overlay.toast('Aucune performance reconnue dans ce texte', '⚠️');
    setTimeout(() => document.getElementById('import-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  const existingKeys = useMemo(() => {
    const id = targetId && targetId !== 'new' ? targetId : null;
    return new Set(
      data.swims.filter((s) => s.swimmerId === id && s.timeCs).map((s) => `${s.course}|${s.distance}|${s.stroke}|${s.timeCs}|${s.date}`),
    );
  }, [data.swims, targetId]);

  const rows = result?.swims.map((s, i) => ({
    s,
    i,
    dup: existingKeys.has(`${s.course}|${s.distance}|${s.stroke}|${s.timeCs}|${s.date}`),
  }));
  const selected = rows?.filter((r) => !r.dup && !excluded.has(r.i)) ?? [];
  const canCreate = !!result?.athlete.lastName || !!result?.athlete.firstName;

  const doImport = () => {
    if (!result || !selected.length) return;
    let target: Parameters<typeof actions.importSwimrankings>[0];
    if (targetId && targetId !== 'new') {
      target = { swimmerId: targetId };
      // Complète le profil existant
      const sw = swimmers.find((s) => s.id === targetId);
      if (sw) {
        const patch: Partial<typeof sw> = {};
        if (!sw.swimrankingsId && result.athlete.swimrankingsId) patch.swimrankingsId = result.athlete.swimrankingsId;
        if (!sw.birthYear && result.athlete.birthYear) patch.birthYear = result.athlete.birthYear;
        if (!sw.club && result.athlete.club) patch.club = result.athlete.club;
        if (!sw.nation && result.athlete.nation) patch.nation = result.athlete.nation;
        if (Object.keys(patch).length) actions.updateSwimmer(sw.id, patch);
      }
    } else {
      target = {
        create: {
          ...result.athlete,
          firstName: result.athlete.firstName ?? 'Nageur',
          lastName: result.athlete.lastName ?? '',
          gender,
        },
      };
    }
    const res = actions.importSwimrankings(
      target,
      selected.map((r) => r.s),
    );
    overlay.celebrate();
    overlay.toast(`${res.added} performance${res.added > 1 ? 's' : ''} importée${res.added > 1 ? 's' : ''}`, '🎉');
    navigate('/', { replace: true });
  };

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) {
        setText(t);
        analyse(t);
      }
    } catch {
      overlay.toast('Collez le texte dans le champ ci-dessous', 'ℹ️');
    }
  };

  const srId = preselected?.swimrankingsId ?? extractAthleteId(srLink);

  return (
    <>
      <NavBar title="Importer" subtitle="Depuis swimrankings.net" back="/settings" />
      <main className="page">
        <div className="callout">
          <Icon name="info" />
          <div>
            swimrankings.net ne permet pas aux applications de lire ses pages directement. ESN Natation récupère donc les temps
            <b> depuis votre navigateur</b>, en deux gestes. Aucun mot de passe n’est nécessaire : les pages des nageurs sont publiques.
          </div>
        </div>

        <Section title="1. Ouvrir la page du nageur">
          <div className="list">
            {!preselected?.swimrankingsId && (
              <div className="field stack">
                <label htmlFor="imp-link">Lien swimrankings.net ou numéro d’athlète</label>
                <input
                  id="imp-link"
                  className="textinput"
                  value={srLink}
                  onChange={(e) => setSrLink(e.target.value)}
                  placeholder="https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=…"
                />
              </div>
            )}
            {srId ? (
              <a className="row accent" href={swimrankingsUrl(srId)} target="_blank" rel="noopener noreferrer">
                <span className="row-icon">
                  <Icon name="external" />
                </span>
                <div className="row-body">
                  <div className="row-title">Ouvrir les meilleurs temps{preselected ? ` de ${preselected.firstName}` : ''}</div>
                  <div className="row-sub">Athlète n° {srId}</div>
                </div>
              </a>
            ) : (
              <a className="row accent" href="https://www.swimrankings.net/" target="_blank" rel="noopener noreferrer">
                <span className="row-icon">
                  <Icon name="external" />
                </span>
                <div className="row-body">
                  <div className="row-title">Rechercher le nageur sur swimrankings.net</div>
                  <div className="row-sub">Nageurs › Recherche, puis ouvrez sa fiche</div>
                </div>
              </a>
            )}
          </div>
          <div className="section-foot">
            Astuce : l’onglet « Meilleurs temps » donne les records. Pour l’historique complet d’une nage, choisissez-la dans
            « Tous les résultats » et importez aussi cette page : les doublons sont ignorés.
          </div>
        </Section>

        <Section title="2. Envoyer les données vers ESN Natation">
          <div style={{ marginBottom: 10 }}>
            <Segmented
              value={device}
              onChange={setDevice}
              options={[
                { id: 'ios', label: 'iPhone / iPad' },
                { id: 'android', label: 'Android' },
                { id: 'desktop', label: 'Ordinateur' },
              ]}
            />
          </div>

          <div className="card pad">
            <div className="hstack" style={{ marginBottom: 12 }}>
              <span className="badge first">Recommandé</span>
              <b>Le bouton « Envoyer vers ESN »</b>
            </div>
            {device === 'desktop' ? (
              <ol className="steps">
                <li>
                  Affichez la barre de favoris (<span className="kbd">Ctrl</span>+<span className="kbd">Maj</span>+<span className="kbd">B</span>, ou{' '}
                  <span className="kbd">⌘</span>+<span className="kbd">Maj</span>+<span className="kbd">B</span> sur Mac).
                </li>
                <li>
                  Glissez ce bouton dans la barre de favoris :{' '}
                  <BookmarkletLink code={code} />
                </li>
                <li>Sur la page swimrankings du nageur, cliquez sur ce favori puis sur « Ouvrir dans l’app ESN ».</li>
              </ol>
            ) : (
              <ol className="steps">
                <li>
                  Copiez le code du bouton :{' '}
                  <button
                    className="btn small"
                    style={{ marginTop: 6 }}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(code);
                        overlay.toast('Code copié', '📋');
                      } catch {
                        overlay.toast('Copie impossible : sélectionnez le code ci-dessous', '⚠️');
                      }
                    }}
                  >
                    <Icon name="clipboard" /> Copier le code
                  </button>
                </li>
                {device === 'ios' ? (
                  <>
                    <li>Dans Safari, ajoutez n’importe quelle page en favori (bouton Partager › Ajouter un signet), nommez-le « Envoyer vers ESN ».</li>
                    <li>Ouvrez vos signets, touchez « Modifier », choisissez ce signet et remplacez son adresse par le code copié.</li>
                    <li>
                      Sur la page swimrankings du nageur, ouvrez vos signets et touchez « Envoyer vers ESN », puis
                      « Copier les données ». Revenez dans l’app ESN et touchez « Coller » ci-dessous.
                    </li>
                  </>
                ) : (
                  <>
                    <li>Dans Chrome, ajoutez la page actuelle aux favoris (☆), puis modifiez-le : nom « Envoyer vers ESN », adresse = le code copié.</li>
                    <li>
                      Sur la page swimrankings du nageur, tapez « Envoyer vers ESN » dans la barre d’adresse et choisissez le favori,
                      puis « Ouvrir dans l’app ESN » (ou « Copier les données » et « Coller » ci-dessous).
                    </li>
                  </>
                )}
              </ol>
            )}
            {device !== 'desktop' && (
              <details style={{ marginTop: 4 }}>
                <summary className="muted small" style={{ cursor: 'pointer' }}>
                  Afficher le code
                </summary>
                <textarea className="textinput" readOnly value={code} style={{ marginTop: 8, minHeight: 90 }} onFocus={(e) => e.currentTarget.select()} />
              </details>
            )}
          </div>

          <div className="card pad" style={{ marginTop: 12 }}>
            <b>Ou par copier-coller</b>
            <p className="muted small" style={{ margin: '4px 0 12px' }}>
              {device === 'desktop'
                ? 'Sur la page swimrankings, faites Ctrl+A (⌘+A sur Mac) puis Ctrl+C, et collez ici.'
                : 'Sur la page swimrankings, sélectionnez le tableau des temps (appui long puis étirez la sélection), copiez, et collez ici.'}
            </p>
            <div className="btn-row" style={{ marginBottom: 10 }}>
              <button className="btn secondary small" onClick={paste}>
                <Icon name="clipboard" /> Coller
              </button>
              <button className="btn small" onClick={() => analyse()} disabled={!text.trim()}>
                Analyser
              </button>
            </div>
            <textarea
              className="textinput"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Exemple :\n100m Libre\t25m\t1:24.62\t205\t11 oct 2026\tLiège\tMarie Petit & Challenge…'}
              aria-label="Texte de la page swimrankings"
            />
          </div>
        </Section>

        {result && (
          <div id="import-preview">
            <Section title="3. Vérifier et importer">
              {result.swims.length === 0 ? (
                <div className="callout warn">
                  <Icon name="info" />
                  <div>
                    Aucune performance reconnue. Vérifiez que vous avez copié la page « Meilleurs temps » ou un tableau de résultats
                    (épreuve, bassin, temps, date).
                  </div>
                </div>
              ) : (
                <>
                  <div className="list">
                    <div className="field">
                      <label htmlFor="imp-target">Nageur</label>
                      <select id="imp-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                        <option value="" disabled>
                          Choisir…
                        </option>
                        {canCreate && (
                          <option value="new">
                            ＋ Nouveau : {[result.athlete.firstName, result.athlete.lastName].filter(Boolean).join(' ')}
                          </option>
                        )}
                        {!canCreate && <option value="new">＋ Nouveau nageur</option>}
                        {swimmers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {fullName(s)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {targetId === 'new' && (
                      <>
                        <div className="row">
                          <Avatar
                            swimmer={{ firstName: result.athlete.firstName ?? 'N', lastName: result.athlete.lastName ?? '', color: data.swimmers.length % 8 }}
                            size={40}
                          />
                          <div className="row-body">
                            <div className="row-title">
                              {[result.athlete.firstName, result.athlete.lastName].filter(Boolean).join(' ') || 'Nouveau nageur'}
                            </div>
                            <div className="row-sub">
                              {[result.athlete.birthYear, result.athlete.nation, result.athlete.club].filter(Boolean).join(' · ') || 'Informations non détectées'}
                            </div>
                          </div>
                        </div>
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
                    {rows!.map(({ s, i, dup }) => {
                      const on = !dup && !excluded.has(i);
                      return (
                        <button
                          key={i}
                          className="row"
                          disabled={dup}
                          style={dup ? { opacity: 0.5 } : undefined}
                          onClick={() =>
                            setExcluded((prev) => {
                              const n = new Set(prev);
                              if (n.has(i)) n.delete(i);
                              else n.add(i);
                              return n;
                            })
                          }
                        >
                          <span className={`check${on ? ' on' : ''}`}>{on && <Icon name="check" />}</span>
                          <StrokeTag stroke={s.stroke} distance={s.distance} size={34} />
                          <div className="row-body">
                            <div className="row-title">
                              {eventLabel(s.distance, s.stroke)} · {courseLabel(s.course)}
                              {s.courseGuessed ? ' (?)' : ''}
                            </div>
                            <div className="row-sub">
                              {dup ? 'Déjà enregistré · ' : ''}
                              {formatDate(s.date)}
                              {s.city ? ` · ${s.city}` : ''}
                              {s.meet ? ` · ${s.meet}` : ''}
                            </div>
                          </div>
                          <div className="row-end" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                            <span className="time-big">{formatTime(s.timeCs)}</span>
                            {s.points != null && <span className="small muted">{s.points} pts</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="section-foot">
                    {result.swims.length} performance{result.swims.length > 1 ? 's' : ''} reconnue{result.swims.length > 1 ? 's' : ''}
                    {rows!.some((r) => r.dup) ? `, dont ${rows!.filter((r) => r.dup).length} déjà présente(s)` : ''}. Les compétitions sont créées automatiquement.
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <button className="btn block" disabled={!selected.length || !targetId} onClick={doImport}>
                      Importer {selected.length} performance{selected.length > 1 ? 's' : ''}
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
      <Icon name="download" style={{ width: 18, height: 18 }} /> Envoyer vers ESN
    </a>
  );
}
