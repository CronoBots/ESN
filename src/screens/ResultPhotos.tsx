import { useMemo, useRef, useState } from 'react';
import { actions, getState } from '../store/store';
import { Avatar, overlay, Segmented, SheetLayout, StrokeTag } from '../components/ui';
import { Icon } from '../components/Icon';
import { sortSwimmers } from '../store/hooks';
import { findSwimmerResult, lapsToSplits, parseSheetHeader, type SheetHeader, type SheetResult } from '../lib/resultSheet';
import { COURSES, eventLabel, ROUND_LABEL, STATUS_SHORT, isValidEvent } from '../lib/events';
import { formatDate, formatRange, todayISO } from '../lib/dates';
import { formatTime, parseTime } from '../lib/time';
import { navigate } from '../router';
import type { Course, Meet } from '../store/types';

/**
 * Photos des feuilles de résultats affichées à la piscine : lecture sur le
 * téléphone, on ne garde que les lignes des nageurs choisis.
 */
export function openResultPhotos(opts: { meetId?: string; swimmerId?: string } = {}) {
  overlay.sheet((close) => <ResultPhotos close={close} {...opts} />);
}

interface Found {
  photo: number;
  header: SheetHeader;
  swimmerId: string;
  result: SheetResult;
}

function mostFrequent<T>(values: (T | undefined)[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

function ResultPhotos({ close, meetId: initialMeet, swimmerId }: { close: () => void; meetId?: string; swimmerId?: string }) {
  const data = getState();
  const swimmers = sortSwimmers(data.swimmers);
  const [selected, setSelected] = useState<string[]>(() => {
    if (swimmerId) return [swimmerId];
    const kids = swimmers.filter((s) => s.relation === 'child').map((s) => s.id);
    return kids.length ? kids : swimmers.slice(0, 1).map((s) => s.id);
  });
  const [ocr, setOcr] = useState<{ progress: number; label: string } | null>(null);
  const [headers, setHeaders] = useState<SheetHeader[] | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [meetChoice, setMeetChoice] = useState<string>(initialMeet ?? '');
  const [courseChoice, setCourseChoice] = useState<Course | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const chosenSwimmers = swimmers.filter((s) => selected.includes(s.id));

  async function read(files: FileList | null) {
    if (!files?.length || !chosenSwimmers.length) return;
    const list = Array.from(files).slice(0, 20);
    setThumbs(list.map((f) => URL.createObjectURL(f)));
    setHeaders(null);
    setFound([]);
    try {
      const { recognizePhotos } = await import('../lib/ocr');
      // Seconde lecture seulement si aucun nageur n'a été trouvé avec un temps vérifié
      const texts = await recognizePhotos(list, setOcr, (t) => chosenSwimmers.some((sw) => findSwimmerResult(t, sw)?.verified));
      const hs = texts.map((t) => parseSheetHeader(t));
      // Infos de la compétition : la valeur la plus fréquente sur l'ensemble des photos
      const meetName = mostFrequent(hs.map((h) => h.meetName));
      const city = mostFrequent(hs.map((h) => h.city));
      const startDate = mostFrequent(hs.map((h) => h.startDate));
      const endDate = mostFrequent(hs.map((h) => h.endDate));
      const merged = hs.map((h) => ({ ...h, meetName: meetName ?? h.meetName, city: city ?? h.city, startDate: startDate ?? h.startDate, endDate: endDate ?? h.endDate }));
      const res: Found[] = [];
      texts.forEach((t, i) => {
        for (const sw of chosenSwimmers) {
          const r = findSwimmerResult(t, sw, merged[i]);
          if (r && (r.timeCs != null || r.status !== 'OK')) res.push({ photo: i, header: merged[i], swimmerId: sw.id, result: r });
        }
      });
      setHeaders(merged);
      setFound(res);
      // Compétition existante correspondante (mêmes dates)
      if (!initialMeet && startDate) {
        const match = data.meets.find((m) => m.startDate <= (endDate ?? startDate) && (m.endDate ?? m.startDate) >= startDate);
        setMeetChoice(match?.id ?? 'new');
      }
      setTimeout(() => document.getElementById('rp-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (e) {
      console.error(e);
      overlay.toast(navigator.onLine ? 'Lecture impossible, réessayez avec une photo plus nette' : 'Connexion nécessaire pour la première lecture', '⚠️');
    } finally {
      setOcr(null);
    }
  }

  const meetInfo = headers?.[0];
  const meetsSorted = useMemo(() => [...data.meets].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)), [data.meets]);
  const chosenMeet: Meet | undefined = data.meets.find((m) => m.id === meetChoice);
  const inferredCourse = mostFrequent(found.map((f) => f.result.course));
  const course: Course = chosenMeet?.course ?? courseChoice ?? inferredCourse ?? data.settings.defaultCourse;

  const rows = found.map((f, k) => {
    const key = `${f.photo}-${f.swimmerId}-${k}`;
    const edited = edits[key];
    const cs = edited != null ? parseTime(edited) : f.result.timeCs;
    const valid = !!f.header.distance && !!f.header.stroke && isValidEvent(f.header.distance, f.header.stroke, course);
    return { ...f, key, cs, invalid: edited != null && cs == null, valid };
  });
  const toImport = rows.filter((r) => r.valid && !r.invalid && !excluded.has(r.key) && (r.cs != null || r.result.status !== 'OK'));
  const missing = chosenSwimmers.flatMap((sw) =>
    (headers ?? []).map((h, i) => ({ sw, h, i })).filter(({ sw: s, i }) => !found.some((f) => f.photo === i && f.swimmerId === s.id)),
  );

  const doImport = () => {
    if (!toImport.length || !meetInfo) return;
    const meet = {
      name: chosenMeet?.name ?? meetInfo.meetName ?? `Compétition${meetInfo.city ? ` à ${meetInfo.city}` : ''}`,
      city: chosenMeet?.city ?? meetInfo.city,
      course,
      startDate: chosenMeet?.startDate ?? meetInfo.startDate ?? toImport.find((r) => r.header.date)?.header.date ?? todayISO(),
      endDate: chosenMeet?.endDate ?? meetInfo.endDate,
    };
    let total = 0;
    for (const sw of chosenSwimmers) {
      const mine = toImport.filter((r) => r.swimmerId === sw.id);
      if (!mine.length) continue;
      const res = actions.importClubResults(sw.id, [
        {
          meet,
          meetId: chosenMeet?.id,
          swims: mine.map((r) => ({
            eventNo: r.header.eventNo,
            distance: r.header.distance!,
            stroke: r.header.stroke!,
            course,
            round: r.header.round,
            timeCs: r.cs ?? undefined,
            status: r.result.status,
            place: r.result.place,
            splits: lapsToSplits(r.result.laps),
            points: r.cs === r.result.timeCs ? r.result.points : undefined,
            date: r.header.date,
            startTime: r.header.startTime,
          })),
        },
      ]);
      total += res.added;
    }
    close();
    overlay.celebrate();
    overlay.toast(total ? `${total} résultat${total > 1 ? 's' : ''} importé${total > 1 ? 's' : ''}` : 'Ces résultats étaient déjà enregistrés', '🏊');
    const m = getState().meets.find((x) => x.name === meet.name && x.startDate <= meet.startDate) ?? chosenMeet;
    if (m) navigate(`/meet/${m.id}`);
  };

  const swimmerName = (id: string) => swimmers.find((s) => s.id === id)?.firstName ?? '';

  return (
    <SheetLayout title="Résultats affichés" onCancel={close} cancelLabel="Fermer">
      <div className="callout" style={{ marginBottom: 14 }}>
        <Icon name="sparkles" />
        <div>
          À la piscine, prenez en photo les feuilles de résultats de vos enfants (une photo par épreuve). Nageo les lit sur votre téléphone et
          ne garde que leurs lignes.
        </div>
      </div>

      {swimmers.length > 1 && (
        <div className="section" style={{ marginTop: 0 }}>
          <p className="section-caption">Nageurs à chercher</p>
          <div className="chips">
            {swimmers.map((s) => {
              const on = selected.includes(s.id);
              return (
                <button
                  key={s.id}
                  className={`chip${on ? ' active' : ''}`}
                  onClick={() => setSelected((v) => (on ? v.filter((x) => x !== s.id) : [...v, s.id]))}
                >
                  <Avatar swimmer={s} size={22} />
                  {s.firstName}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          read(e.target.files);
          e.target.value = '';
        }}
      />
      <button className="btn block" style={{ marginTop: 12 }} disabled={!!ocr || !chosenSwimmers.length} onClick={() => fileRef.current?.click()}>
        <Icon name="upload" /> {ocr ? 'Lecture en cours…' : 'Choisir les photos'}
      </button>
      <ul className="muted small" style={{ margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.5 }}>
        <li>Une photo par feuille, bien en face, la feuille entière visible.</li>
        <li>Évitez les reflets (penchez légèrement le téléphone).</li>
        <li>Vous pouvez choisir toutes les photos d’un coup.</li>
      </ul>

      {ocr && (
        <div style={{ marginTop: 14 }}>
          <div className="meter">
            <div style={{ width: `${Math.round(ocr.progress * 100)}%` }} />
          </div>
          <div className="muted small center" style={{ marginTop: 6 }}>
            {ocr.label} {Math.round(ocr.progress * 100)} %
          </div>
        </div>
      )}

      {headers && (
        <div id="rp-results">
          <div className="section" style={{ marginTop: 18 }}>
            <p className="section-caption">Compétition</p>
            <div className="list">
              <div className="field">
                <label htmlFor="rp-meet">Compétition</label>
                <select id="rp-meet" value={meetChoice} onChange={(e) => setMeetChoice(e.target.value)}>
                  <option value="new">＋ {meetInfo?.meetName ?? 'Nouvelle compétition'}</option>
                  {meetsSorted.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {formatDate(m.startDate)}
                    </option>
                  ))}
                </select>
              </div>
              {meetChoice === 'new' && meetInfo && (
                <div className="row">
                  <div className="row-body">
                    <div className="row-title">{meetInfo.meetName ?? 'Nom non lu'}</div>
                    <div className="row-sub">
                      {[meetInfo.city, meetInfo.startDate ? formatRange(meetInfo.startDate, meetInfo.endDate) : null].filter(Boolean).join(' · ') ||
                        'Lieu et dates non lus'}
                    </div>
                  </div>
                </div>
              )}
              <div className="field">
                <span className="label">Bassin</span>
                {chosenMeet ? (
                  <span className="muted" style={{ marginLeft: 'auto' }}>
                    {chosenMeet.course === 'SCM' ? '25 m' : '50 m'}
                  </span>
                ) : (
                  <div style={{ flex: 1, maxWidth: 200, marginLeft: 'auto' }}>
                    <Segmented value={course} onChange={setCourseChoice} options={COURSES.map((c) => ({ id: c.id, label: c.label }))} />
                  </div>
                )}
              </div>
            </div>
            {!chosenMeet && inferredCourse && <div className="section-foot">Bassin déduit des points imprimés sur les feuilles.</div>}
          </div>

          <div className="section" style={{ marginTop: 18 }}>
            <p className="section-caption">
              {rows.length} résultat{rows.length > 1 ? 's' : ''} trouvé{rows.length > 1 ? 's' : ''}
            </p>
            {rows.length > 0 && (
              <div className="list">
                {rows.map((r) => {
                  const on = r.valid && !r.invalid && !excluded.has(r.key);
                  const h = r.header;
                  return (
                    <div key={r.key} className="row" style={!r.valid ? { opacity: 0.6 } : undefined}>
                      <button
                        type="button"
                        className={`check${on ? ' on' : ''}`}
                        aria-label={on ? 'Ne pas importer' : 'Importer'}
                        disabled={!r.valid}
                        style={{ padding: 0, background: on ? undefined : 'none' }}
                        onClick={() =>
                          setExcluded((prev) => {
                            const n = new Set(prev);
                            if (n.has(r.key)) n.delete(r.key);
                            else n.add(r.key);
                            return n;
                          })
                        }
                      >
                        {on && <Icon name="check" />}
                      </button>
                      {h.stroke && h.distance ? <StrokeTag stroke={h.stroke} distance={h.distance} size={34} /> : <span className="stroke-tag" style={{ background: 'var(--fill-2)', width: 34, height: 34 }}>?</span>}
                      <div className="row-body">
                        <div className="row-title">
                          {h.distance && h.stroke ? eventLabel(h.distance, h.stroke) : 'Épreuve non lue'}
                          {chosenSwimmers.length > 1 ? ` · ${swimmerName(r.swimmerId)}` : ''}
                        </div>
                        <div className="row-sub">
                          {[
                            h.eventNo ? `Épr. ${h.eventNo}` : null,
                            h.date ? `${formatDate(h.date)}${h.startTime ? ` ${h.startTime}` : ''}` : null,
                            r.result.status !== 'OK' ? STATUS_SHORT[r.result.status] : r.result.place ? `${r.result.place}${r.result.place === 1 ? 're' : 'e'}` : null,
                            h.round !== 'TIM' ? ROUND_LABEL[h.round] : null,
                            r.result.points ? `${r.result.points} pts` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                        <div className="row-sub">
                          {r.result.verified ? (
                            <span className="good" style={{ fontWeight: 600 }}>✓ vérifié</span>
                          ) : (
                            <span style={{ color: 'var(--warning)', fontWeight: 600 }}>À vérifier sur la photo</span>
                          )}
                          {r.result.laps.length > 1 ? ` · passages ${r.result.laps.map((l) => formatTime(l)).join(' / ')}` : ''}
                        </div>
                      </div>
                      <input
                        className="time-edit"
                        inputMode="decimal"
                        aria-label="Temps"
                        value={edits[r.key] ?? (r.result.timeCs != null ? formatTime(r.result.timeCs) : '')}
                        placeholder={r.result.status !== 'OK' ? STATUS_SHORT[r.result.status] : '–'}
                        onChange={(e) => setEdits((v) => ({ ...v, [r.key]: e.target.value }))}
                        style={r.invalid ? { color: 'var(--danger)' } : undefined}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {missing.length > 0 && (
              <div className="section-foot">
                Non trouvé :{' '}
                {missing
                  .map(({ sw, h, i }) => `${sw.firstName} sur la photo ${i + 1}${h.distance && h.stroke ? ` (${eventLabel(h.distance, h.stroke)})` : ''}`)
                  .join(', ')}
                . Reprenez la photo plus nettement, ou saisissez le temps à la main.
              </div>
            )}
          </div>

          {thumbs.length > 0 && (
            <div className="chips" style={{ marginTop: 12 }}>
              {thumbs.map((u, i) => (
                <a key={u} href={u} target="_blank" rel="noopener noreferrer" title={`Photo ${i + 1}`}>
                  <img src={u} alt={`Photo ${i + 1}`} style={{ height: 90, borderRadius: 8, border: '0.5px solid var(--separator)' }} />
                </a>
              ))}
            </div>
          )}

          <button className="btn block" style={{ marginTop: 16 }} disabled={!toImport.length} onClick={doImport}>
            Importer {toImport.length} résultat{toImport.length > 1 ? 's' : ''}
          </button>
        </div>
      )}
      <div className="section-foot center" style={{ marginTop: 16 }}>
        Les photos restent sur votre téléphone ; seuls les résultats de vos nageurs sont enregistrés.
      </div>
    </SheetLayout>
  );
}
