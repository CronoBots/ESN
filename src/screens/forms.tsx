import { useMemo, useState } from 'react';
import { actions, getState } from '../store/store';
import type { Course, Goal, Gender, Meet, Relation, Round, Stroke, Swim, SwimContext, SwimStatus, Swimmer } from '../store/types';
import { Avatar, overlay, Segmented, SheetLayout, Stepper, StrokeDot } from '../components/ui';
import { TimeInput } from '../components/TimeInput';
import { Icon } from '../components/Icon';
import { COURSES, distancesFor, eventLabel, ROUNDS, STATUSES, STROKES, courseLabel } from '../lib/events';
import { formatDelta, formatTime, parseTime } from '../lib/time';
import { formatDate, todayISO, isValidISO } from '../lib/dates';
import { chronoCompare, countsForRecords } from '../lib/stats';
import { computePoints, timeForPoints } from '../lib/points';
import { extractAthleteId } from '../lib/swimrankings';
import { fullName, sortSwimmers } from '../store/hooks';
import { navigate } from '../router';
import { findResultsNow } from './autoResults';

export const DEFAULT_CLUB = 'Ecole Seraing Natation';

/* ======================================================================== */
/* Nageur                                                                    */
/* ======================================================================== */

export function openSwimmerForm(swimmer?: Swimmer, onCreated?: (s: Swimmer) => void) {
  overlay.sheet((close) => <SwimmerForm swimmer={swimmer} close={close} onCreated={onCreated} />);
}

function SwimmerForm({ swimmer, close, onCreated }: { swimmer?: Swimmer; close: () => void; onCreated?: (s: Swimmer) => void }) {
  const [firstName, setFirstName] = useState(swimmer?.firstName ?? '');
  const [lastName, setLastName] = useState(swimmer?.lastName ?? '');
  const [gender, setGender] = useState<Gender>(swimmer?.gender ?? 'F');
  const [birthYear, setBirthYear] = useState(swimmer?.birthYear ? String(swimmer.birthYear) : '');
  const [club, setClub] = useState(swimmer ? (swimmer.club ?? '') : DEFAULT_CLUB);
  const [sr, setSr] = useState(swimmer?.swimrankingsId ?? '');
  const [relation, setRelation] = useState<Relation>(swimmer?.relation ?? 'child');
  const [color, setColor] = useState(swimmer?.color ?? getState().swimmers.length % 8);

  const year = birthYear ? Number(birthYear) : undefined;
  const yearOk = !birthYear || (year! > 1930 && year! <= new Date().getFullYear());
  const srId = sr.trim() ? extractAthleteId(sr) : null;
  const srOk = !sr.trim() || !!srId;
  const valid = firstName.trim() && yearOk && srOk;

  const save = () => {
    if (!valid) return;
    const data = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      gender,
      birthYear: year,
      club: club.trim() || undefined,
      swimrankingsId: srId ?? undefined,
      relation,
      color,
    };
    if (swimmer) {
      const renamed = data.firstName !== swimmer.firstName || data.lastName !== swimmer.lastName || data.birthYear !== swimmer.birthYear;
      actions.updateSwimmer(swimmer.id, data);
      close();
      if (renamed) findResultsNow(data.firstName);
      else overlay.toast('Profil mis à jour');
    } else {
      const s = actions.addSwimmer(data);
      actions.selectSwimmer(s.id);
      onCreated?.(s);
      close();
      // Ses résultats de compétition sont recherchés tout de suite
      findResultsNow(s.firstName);
    }
  };

  return (
    <SheetLayout
      title={swimmer ? 'Modifier le nageur' : 'Nouveau nageur'}
      onCancel={close}
      onDone={save}
      doneLabel={swimmer ? 'OK' : 'Ajouter'}
      doneDisabled={!valid}
    >
      <div className="center" style={{ padding: '10px 0 16px' }}>
        <Avatar swimmer={{ firstName: firstName || '?', lastName, color }} size={84} />
        <div className="hstack" style={{ justifyContent: 'center', marginTop: 14, gap: 8 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Couleur ${i + 1}`}
              onClick={() => setColor(i)}
              style={{ border: 0, background: 'none', padding: 2, borderRadius: '50%', outline: color === i ? '2px solid var(--accent)' : 'none' }}
            >
              <Avatar swimmer={{ firstName: ' ', lastName: ' ', color: i }} size={26} />
            </button>
          ))}
        </div>
      </div>
      <div className="list">
        <div className="field">
          <label htmlFor="sf-first">Prénom</label>
          <input id="sf-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Emma" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="sf-last">Nom</label>
          <input id="sf-last" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Dupont" autoComplete="off" />
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
        <div className="field">
          <label htmlFor="sf-year">Année de naissance</label>
          <input
            id="sf-year"
            inputMode="numeric"
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="2015"
            style={!yearOk ? { color: 'var(--danger)' } : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor="sf-club">Club</label>
          <input id="sf-club" value={club} onChange={(e) => setClub(e.target.value)} placeholder="Nom du club" />
        </div>
      </div>

      <div className="section-foot">
        Nom, prénom et année de naissance permettent de retrouver automatiquement ses résultats de compétition.
      </div>

      <div className="section">
        <div className="list">
          <div className="field stack">
            <label htmlFor="sf-sr">Profil swimrankings.net (facultatif)</label>
            <input
              id="sf-sr"
              className="textinput"
              value={sr}
              onChange={(e) => setSr(e.target.value)}
              placeholder="Lien de la page ou numéro d'athlète"
              style={!srOk ? { color: 'var(--danger)' } : undefined}
            />
          </div>
        </div>
        <div className="section-foot">
          Collez l’adresse de la page du nageur sur swimrankings.net : le numéro est détecté automatiquement
          {srId ? ` (n° ${srId})` : ''}.
        </div>
      </div>

      <div className="section">
        <div className="list">
          <div className="field">
            <span className="label">Type</span>
            <div style={{ flex: 1, maxWidth: 260, marginLeft: 'auto' }}>
              <Segmented
                value={relation}
                onChange={setRelation}
                options={[
                  { id: 'child', label: 'Mon enfant' },
                  { id: 'followed', label: 'Suivi' },
                ]}
              />
            </div>
          </div>
        </div>
        <div className="section-foot">« Suivi » : un coéquipier, un ami… pour comparer les progressions et les classements.</div>
      </div>

      {swimmer && (
        <div className="section">
          <div className="list">
            <button
              className="row danger"
              type="button"
              onClick={async () => {
                const ok = await overlay.confirm({
                  title: `Supprimer ${fullName(swimmer)} ?`,
                  message: 'Toutes ses performances et objectifs seront supprimés. Cette action est irréversible.',
                  confirmLabel: 'Supprimer définitivement',
                  destructive: true,
                });
                if (ok) {
                  actions.deleteSwimmer(swimmer.id);
                  close();
                  navigate('/', { replace: true });
                  overlay.toast('Nageur supprimé', '🗑️');
                }
              }}
            >
              <div className="row-body center">Supprimer ce nageur</div>
            </button>
          </div>
        </div>
      )}
    </SheetLayout>
  );
}

/* ======================================================================== */
/* Compétition                                                               */
/* ======================================================================== */

export function openMeetForm(meet?: Meet, onCreated?: (m: Meet) => void) {
  overlay.sheet((close) => <MeetForm meet={meet} close={close} onCreated={onCreated} />);
}

function MeetForm({ meet, close, onCreated }: { meet?: Meet; close: () => void; onCreated?: (m: Meet) => void }) {
  const [name, setName] = useState(meet?.name ?? '');
  const [city, setCity] = useState(meet?.city ?? '');
  const [startDate, setStartDate] = useState(meet?.startDate ?? todayISO());
  const [endDate, setEndDate] = useState(meet?.endDate ?? '');
  const [course, setCourse] = useState<Course>(meet?.course ?? getState().settings.defaultCourse);
  const [organizer, setOrganizer] = useState(meet?.organizer ?? '');
  const [notes, setNotes] = useState(meet?.notes ?? '');
  const valid = name.trim() && isValidISO(startDate) && (!endDate || (isValidISO(endDate) && endDate >= startDate));

  const save = () => {
    if (!valid) return;
    const data = {
      name: name.trim(),
      city: city.trim() || undefined,
      startDate,
      endDate: endDate && endDate !== startDate ? endDate : undefined,
      course,
      organizer: organizer.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    if (meet) {
      actions.updateMeet(meet.id, data);
      overlay.toast('Compétition mise à jour');
    } else {
      const m = actions.addMeet(data);
      overlay.toast('Compétition créée');
      onCreated?.(m);
    }
    close();
  };

  return (
    <SheetLayout
      title={meet ? 'Modifier la compétition' : 'Nouvelle compétition'}
      onCancel={close}
      onDone={save}
      doneLabel={meet ? 'OK' : 'Créer'}
      doneDisabled={!valid}
    >
      <div className="list">
        <div className="field stack">
          <label htmlFor="mf-name">Nom</label>
          <input id="mf-name" className="textinput" value={name} onChange={(e) => setName(e.target.value)} placeholder="Meeting de Noël" />
        </div>
        <div className="field">
          <label htmlFor="mf-city">Lieu</label>
          <input id="mf-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ville" />
        </div>
        <div className="field">
          <label htmlFor="mf-start">Début</label>
          <input id="mf-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ marginLeft: 'auto' }} />
        </div>
        <div className="field">
          <label htmlFor="mf-end">Fin (facultatif)</label>
          <input id="mf-end" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} style={{ marginLeft: 'auto' }} />
        </div>
        <div className="field">
          <span className="label">Bassin</span>
          <div style={{ flex: 1, maxWidth: 200, marginLeft: 'auto' }}>
            <Segmented value={course} onChange={setCourse} options={COURSES.map((c) => ({ id: c.id, label: c.label }))} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="mf-org">Organisateur</label>
          <input id="mf-org" value={organizer} onChange={(e) => setOrganizer(e.target.value)} placeholder="Club organisateur" />
        </div>
      </div>
      <div className="section">
        <div className="list">
          <div className="field stack">
            <label htmlFor="mf-notes">Notes</label>
            <textarea id="mf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Adresse, heure de rendez-vous, échauffement…" />
          </div>
        </div>
      </div>
      {meet && (
        <div className="section">
          <div className="list">
            <button
              className="row danger"
              type="button"
              onClick={() => {
                const count = getState().swims.filter((s) => s.meetId === meet.id).length;
                overlay.actions({
                  title: `Supprimer « ${meet.name} » ?`,
                  message: count ? `${count} course(s) sont liées à cette compétition.` : undefined,
                  actions: [
                    ...(count
                      ? [
                          {
                            label: 'Supprimer en gardant les temps',
                            onSelect: () => {
                              actions.deleteMeet(meet.id, false);
                              close();
                              navigate('/meets', { replace: true });
                            },
                          },
                        ]
                      : []),
                    {
                      label: count ? 'Tout supprimer' : 'Supprimer',
                      destructive: true,
                      onSelect: () => {
                        actions.deleteMeet(meet.id, true);
                        close();
                        navigate('/meets', { replace: true });
                        overlay.toast('Compétition supprimée', '🗑️');
                      },
                    },
                  ],
                });
              }}
            >
              <div className="row-body center">Supprimer la compétition</div>
            </button>
          </div>
        </div>
      )}
    </SheetLayout>
  );
}

/* ======================================================================== */
/* Course / résultat                                                         */
/* ======================================================================== */

export interface ResultFormOptions {
  swim?: Swim;
  swimmerId?: string;
  meetId?: string;
  /** Inscription (programme) plutôt que résultat. */
  entry?: boolean;
  preset?: Partial<Pick<Swim, 'distance' | 'stroke' | 'course' | 'context'>>;
}

export function openResultForm(opts: ResultFormOptions = {}) {
  overlay.sheet((close) => <ResultForm {...opts} close={close} />);
}

function ResultForm({ swim, swimmerId: initialSwimmer, meetId: initialMeet, entry, preset, close }: ResultFormOptions & { close: () => void }) {
  const data = getState();
  const swimmers = sortSwimmers(data.swimmers);
  const meets = useMemo(
    () => [...data.meets].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    [data.meets],
  );
  const initialMeetObj = meets.find((m) => m.id === (swim?.meetId ?? initialMeet));

  const [swimmerId, setSwimmerId] = useState(
    swim?.swimmerId ?? initialSwimmer ?? data.settings.selectedSwimmerId ?? swimmers[0]?.id,
  );
  const [context, setContext] = useState<SwimContext>(swim?.context ?? preset?.context ?? 'competition');
  const [meetId, setMeetId] = useState<string>(initialMeetObj?.id ?? '');
  const [newMeetName, setNewMeetName] = useState('');
  const [newMeetCity, setNewMeetCity] = useState('');
  const [stroke, setStroke] = useState<Stroke>(swim?.stroke ?? preset?.stroke ?? 'FREE');
  const [distance, setDistance] = useState<number>(swim?.distance ?? preset?.distance ?? 50);
  const [course, setCourse] = useState<Course>(swim?.course ?? initialMeetObj?.course ?? preset?.course ?? data.settings.defaultCourse);
  const [timeCs, setTimeCs] = useState<number | null>(swim?.timeCs ?? null);
  const [status, setStatus] = useState<SwimStatus>(swim?.status ?? 'OK');
  const [date, setDate] = useState(swim?.date ?? (initialMeetObj ? (todayISO() >= initialMeetObj.startDate && todayISO() <= (initialMeetObj.endDate ?? initialMeetObj.startDate) ? todayISO() : initialMeetObj.startDate) : todayISO()));
  const [startTime, setStartTime] = useState(swim?.startTime ?? '');
  const [round, setRound] = useState<Round>(swim?.round ?? 'TIM');
  const [eventNo, setEventNo] = useState<number | undefined>(swim?.eventNo);
  const [heat, setHeat] = useState<number | undefined>(swim?.heat);
  const [lane, setLane] = useState<number | undefined>(swim?.lane);
  const [place, setPlace] = useState<number | undefined>(swim?.place);
  const [entryText, setEntryText] = useState(swim?.entryCs ? formatTime(swim.entryCs) : '');
  const [timing, setTiming] = useState<'electronic' | 'manual'>(swim?.timing ?? (context === 'training' ? 'manual' : 'electronic'));
  const [notes, setNotes] = useState(swim?.notes ?? '');
  const [splits, setSplits] = useState<string[]>(swim?.splits?.map((s) => formatTime(s)) ?? []);
  const [showMore, setShowMore] = useState(!!entry || !!(swim && (swim.eventNo || swim.heat || swim.lane || swim.place || swim.notes || swim.splits?.length)));

  const meet = meets.find((m) => m.id === meetId);
  const effectiveCourse: Course = meet ? meet.course : course;
  const distances = distancesFor(stroke, effectiveCourse);
  const dist = distances.includes(distance) ? distance : distances.includes(50) ? 50 : distances[0];
  const swimmer = data.swimmers.find((s) => s.id === swimmerId);

  // Record actuel pour cette épreuve (hors course en cours d'édition)
  const prevBest = useMemo(() => {
    const list = data.swims
      .filter(
        (s) =>
          s.id !== swim?.id &&
          s.swimmerId === swimmerId &&
          s.course === effectiveCourse &&
          s.distance === dist &&
          s.stroke === stroke &&
          countsForRecords(s, data.settings.includeTraining) &&
          s.date <= date,
      )
      .sort(chronoCompare);
    return list.length ? Math.min(...list.map((s) => s.timeCs!)) : null;
  }, [data.swims, swimmerId, effectiveCourse, dist, stroke, date, swim?.id, data.settings.includeTraining]);

  const entryCs = entryText.trim() ? parseTime(entryText) : null;
  const isPB = status === 'OK' && timeCs != null && prevBest != null && timeCs < prevBest && (context === 'competition' || data.settings.includeTraining);
  const points = swimmer && timeCs && status === 'OK' ? computePoints(timeCs, effectiveCourse, swimmer.gender, dist, stroke) : null;

  let hint: string | undefined;
  if (timeCs && status === 'OK') {
    if (prevBest == null) hint = `Premier temps sur ${eventLabel(dist, stroke)}${points ? ` · ${points} pts` : ''}`;
    else if (isPB) hint = `🎉 Nouveau record ! ${formatDelta(timeCs - prevBest)}${points ? ` · ${points} pts` : ''}`;
    else hint = `Record : ${formatTime(prevBest)} (${formatDelta(timeCs - prevBest)})${points ? ` · ${points} pts` : ''}`;
  } else if (prevBest != null) hint = `Record actuel : ${formatTime(prevBest)}`;

  const splitMarks = useMemo(() => {
    if (dist <= 25) return [];
    if (dist === 50) return effectiveCourse === 'SCM' ? [25] : [];
    const marks: number[] = [];
    for (let m = 50; m < dist; m += 50) marks.push(m);
    return marks;
  }, [dist, effectiveCourse]);

  const needsTime = !entry && status === 'OK' && context === 'training';
  const meetOk = context === 'training' || meetId !== 'new' || newMeetName.trim();
  const valid = !!swimmerId && isValidISO(date) && meetOk && (!needsTime || timeCs != null) && (entryText.trim() === '' || entryCs != null);

  const save = () => {
    if (!valid || !swimmerId) return;
    let finalMeetId: string | undefined = context === 'competition' && meetId && meetId !== 'new' ? meetId : undefined;
    if (context === 'competition' && meetId === 'new') {
      finalMeetId = actions.addMeet({ name: newMeetName.trim(), city: newMeetCity.trim() || undefined, startDate: date, course }).id;
    }
    const payload: Omit<Swim, 'id' | 'createdAt' | 'updatedAt'> = {
      swimmerId,
      meetId: finalMeetId,
      context,
      date,
      startTime: startTime || undefined,
      distance: dist,
      stroke,
      course: effectiveCourse,
      timeCs: status === 'OK' || status === 'DSQ' ? timeCs : null,
      entryCs: entryCs ?? undefined,
      status,
      round,
      eventNo,
      heat,
      lane,
      place: status === 'OK' ? place : undefined,
      splits: splits.map((s) => parseTime(s)).filter((s): s is number => s != null).length
        ? splits.map((s) => parseTime(s) ?? 0)
        : undefined,
      timing,
      notes: notes.trim() || undefined,
      points: swim?.source === 'swimrankings' && swim.timeCs === timeCs ? swim.points : undefined,
      source: swim?.source === 'swimrankings' && swim.timeCs === timeCs ? 'swimrankings' : 'manual',
    };
    if (swim) actions.updateSwim(swim.id, payload);
    else actions.addSwim(payload);

    if (isPB && timeCs != null && prevBest != null) {
      if (data.settings.celebrate) overlay.celebrate();
      overlay.toast(`Nouveau record ! ${formatTime(timeCs)} (${formatDelta(timeCs - prevBest)})`, '🏆');
    } else if (timeCs != null && prevBest == null && status === 'OK') {
      overlay.toast(`Premier temps enregistré : ${formatTime(timeCs)}`, '⏱️');
    } else {
      overlay.toast(swim ? 'Course mise à jour' : entry && timeCs == null ? 'Épreuve ajoutée au programme' : 'Temps enregistré');
    }
    close();
  };

  return (
    <SheetLayout
      title={swim ? (swim.timeCs == null && !entry ? 'Saisir le résultat' : 'Modifier la course') : entry ? 'Ajouter une épreuve' : 'Nouveau temps'}
      onCancel={close}
      onDone={save}
      doneLabel="Enregistrer"
      doneDisabled={!valid}
    >
      {swimmers.length > 1 && !swim && (
        <div className="switcher" style={{ marginBottom: 6 }}>
          {swimmers.map((s) => (
            <button key={s.id} type="button" className={s.id === swimmerId ? 'active' : ''} onClick={() => setSwimmerId(s.id)}>
              <Avatar swimmer={s} size={44} />
              <span className="name">{s.firstName}</span>
            </button>
          ))}
        </div>
      )}

      {!entry && (
        <div style={{ margin: '4px 0 12px' }}>
          <Segmented
            value={context}
            onChange={(v) => {
              setContext(v);
              setTiming(v === 'training' ? 'manual' : 'electronic');
            }}
            options={[
              { id: 'competition', label: 'Compétition' },
              { id: 'training', label: 'Entraînement' },
            ]}
          />
        </div>
      )}

      <div className="card">
        <div style={{ padding: '14px 14px 4px' }}>
          <div className="chips" role="radiogroup" aria-label="Nage">
            {STROKES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={stroke === s.id}
                className={`chip${stroke === s.id ? ' active' : ''}`}
                onClick={() => setStroke(s.id)}
              >
                <StrokeDot stroke={s.id} />
                {s.label}
              </button>
            ))}
          </div>
          <div className="chips" role="radiogroup" aria-label="Distance" style={{ marginTop: 8 }}>
            {distances.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={dist === d}
                className={`chip${dist === d ? ' active' : ''}`}
                onClick={() => setDistance(d)}
              >
                {d} m
              </button>
            ))}
          </div>
          <div style={{ margin: '10px 0 6px' }}>
            {meet ? (
              <div className="muted small center">Bassin de {courseLabel(meet.course)} (défini par la compétition)</div>
            ) : (
              <Segmented value={course} onChange={setCourse} options={COURSES.map((c) => ({ id: c.id, label: `Bassin ${c.label}` }))} />
            )}
          </div>
        </div>
        {!entry || swim ? (
          <TimeInput value={timeCs} onChange={setTimeCs} autoFocus={!swim || swim.timeCs == null} hint={hint} hintClass={isPB ? 'pb' : ''} />
        ) : (
          <div style={{ padding: '6px 16px 14px' }} className="muted small center">
            Le temps se saisit après la course, directement depuis le programme.
          </div>
        )}
      </div>

      {(!entry || swim) && (
        <div className="section" style={{ marginTop: 14 }}>
          <Segmented value={status} onChange={setStatus} options={STATUSES.map((s) => ({ id: s.id, label: s.label }))} ariaLabel="Statut" />
        </div>
      )}

      {context === 'competition' && (
        <div className="section" style={{ marginTop: 18 }}>
          <div className="list">
            <div className="field">
              <label htmlFor="rf-meet">Compétition</label>
              <select
                id="rf-meet"
                value={meetId}
                onChange={(e) => {
                  const v = e.target.value;
                  setMeetId(v);
                  const m = meets.find((x) => x.id === v);
                  if (m) {
                    setCourse(m.course);
                    if (date < m.startDate || date > (m.endDate ?? m.startDate)) setDate(m.startDate);
                  }
                }}
              >
                <option value="">Aucune / non précisée</option>
                <option value="new">＋ Nouvelle compétition…</option>
                {meets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {formatDate(m.startDate)}
                  </option>
                ))}
              </select>
            </div>
            {meetId === 'new' && (
              <>
                <div className="field">
                  <label htmlFor="rf-mname">Nom</label>
                  <input id="rf-mname" value={newMeetName} onChange={(e) => setNewMeetName(e.target.value)} placeholder="Nom de la compétition" />
                </div>
                <div className="field">
                  <label htmlFor="rf-mcity">Lieu</label>
                  <input id="rf-mcity" value={newMeetCity} onChange={(e) => setNewMeetCity(e.target.value)} placeholder="Ville" />
                </div>
              </>
            )}
            <div className="field">
              <label htmlFor="rf-round">Tour</label>
              <select id="rf-round" value={round} onChange={(e) => setRound(e.target.value as Round)}>
                {ROUNDS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="section" style={{ marginTop: 18 }}>
        <div className="list">
          <div className="field">
            <label htmlFor="rf-date">Date</label>
            <input id="rf-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginLeft: 'auto' }} />
          </div>
          <div className="field">
            <label htmlFor="rf-time">Heure</label>
            <input id="rf-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ marginLeft: 'auto' }} />
          </div>
        </div>
      </div>

      <div className="section" style={{ marginTop: 18 }}>
        <button type="button" className="pill-toggle" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
          <Icon name="chevronDown" style={{ width: 16, height: 16, transform: showMore ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
          {showMore ? 'Moins de détails' : 'Plus de détails (série, ligne, place, passages…)'}
        </button>
      </div>

      {showMore && (
        <>
          <div className="section" style={{ marginTop: 12 }}>
            <div className="list">
              <div className="field">
                <span className="label">N° d’épreuve</span>
                <div style={{ marginLeft: 'auto' }}>
                  <Stepper value={eventNo} onChange={setEventNo} min={1} max={999} />
                </div>
              </div>
              <div className="field">
                <span className="label">Série</span>
                <div style={{ marginLeft: 'auto' }}>
                  <Stepper value={heat} onChange={setHeat} min={1} max={99} />
                </div>
              </div>
              <div className="field">
                <span className="label">Ligne</span>
                <div style={{ marginLeft: 'auto' }}>
                  <Stepper value={lane} onChange={setLane} min={0} max={10} />
                </div>
              </div>
              {(!entry || swim) && (
                <div className="field">
                  <span className="label">Classement</span>
                  <div style={{ marginLeft: 'auto' }}>
                    <Stepper value={place} onChange={setPlace} min={1} max={999} />
                  </div>
                </div>
              )}
              <div className="field">
                <label htmlFor="rf-entry">Temps d’engagement</label>
                <input
                  id="rf-entry"
                  inputMode="decimal"
                  value={entryText}
                  onChange={(e) => setEntryText(e.target.value)}
                  placeholder={prevBest ? formatTime(prevBest) : 'NT'}
                  style={entryText && entryCs == null ? { color: 'var(--danger)' } : undefined}
                />
              </div>
              <div className="field">
                <span className="label">Chronométrage</span>
                <div style={{ flex: 1, maxWidth: 220, marginLeft: 'auto' }}>
                  <Segmented
                    value={timing}
                    onChange={setTiming}
                    options={[
                      { id: 'electronic', label: 'Électro.' },
                      { id: 'manual', label: 'Manuel' },
                    ]}
                  />
                </div>
              </div>
            </div>
            {prevBest && !entryText && (
              <div className="section-foot">
                <button type="button" className="section-link" onClick={() => setEntryText(formatTime(prevBest))}>
                  Utiliser le record ({formatTime(prevBest)}) comme temps d’engagement
                </button>
              </div>
            )}
          </div>

          {splitMarks.length > 0 && (!entry || swim) && (
            <div className="section" style={{ marginTop: 18 }}>
              <p className="section-caption">Temps de passage (cumulés)</p>
              <div className="card pad">
                <div className="splits">
                  {splitMarks.map((m, i) => (
                    <label className="split" key={m}>
                      <div className="sl">{m} m</div>
                      <input
                        inputMode="decimal"
                        value={splits[i] ?? ''}
                        placeholder="–"
                        onChange={(e) => {
                          const next = [...splits];
                          next[i] = e.target.value;
                          setSplits(next);
                        }}
                      />
                    </label>
                  ))}
                  {timeCs != null && (
                    <div className="split">
                      <div className="sl">{dist} m</div>
                      <div className="sv">{formatTime(timeCs)}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="section" style={{ marginTop: 18 }}>
            <div className="list">
              <div className="field stack">
                <label htmlFor="rf-notes">Notes</label>
                <textarea id="rf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ressenti, départ, virages, conseils du coach…" />
              </div>
            </div>
          </div>
        </>
      )}

      {swim && (
        <div className="section">
          <div className="list">
            <button
              className="row danger"
              type="button"
              onClick={async () => {
                const ok = await overlay.confirm({ title: 'Supprimer cette course ?', confirmLabel: 'Supprimer', destructive: true });
                if (ok) {
                  actions.deleteSwim(swim.id);
                  close();
                  overlay.toast('Course supprimée', '🗑️');
                }
              }}
            >
              <div className="row-body center">Supprimer la course</div>
            </button>
          </div>
        </div>
      )}
    </SheetLayout>
  );
}

/* ======================================================================== */
/* Objectif                                                                  */
/* ======================================================================== */

export function openGoalForm(opts: { goal?: Goal; swimmerId: string; preset?: { distance: number; stroke: Stroke; course: Course } }) {
  overlay.sheet((close) => <GoalForm {...opts} close={close} />);
}

function GoalForm({
  goal,
  swimmerId,
  preset,
  close,
}: {
  goal?: Goal;
  swimmerId: string;
  preset?: { distance: number; stroke: Stroke; course: Course };
  close: () => void;
}) {
  const data = getState();
  const swimmer = data.swimmers.find((s) => s.id === swimmerId);
  const [stroke, setStroke] = useState<Stroke>(goal?.stroke ?? preset?.stroke ?? 'FREE');
  const [distance, setDistance] = useState(goal?.distance ?? preset?.distance ?? 100);
  const [course, setCourse] = useState<Course>(goal?.course ?? preset?.course ?? data.settings.defaultCourse);
  const [target, setTarget] = useState<number | null>(goal?.targetCs ?? null);
  const [label, setLabel] = useState(goal?.label ?? '');
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const distances = distancesFor(stroke, course);
  const dist = distances.includes(distance) ? distance : distances[0];

  const best = useMemo(() => {
    const list = data.swims.filter(
      (s) =>
        s.swimmerId === swimmerId &&
        s.course === course &&
        s.distance === dist &&
        s.stroke === stroke &&
        countsForRecords(s, data.settings.includeTraining),
    );
    return list.length ? Math.min(...list.map((s) => s.timeCs!)) : null;
  }, [data.swims, swimmerId, course, dist, stroke, data.settings.includeTraining]);

  const bestPts = best && swimmer ? computePoints(best, course, swimmer.gender, dist, stroke) : null;
  const suggestions: { label: string; cs: number }[] = [];
  if (best) {
    suggestions.push({ label: '−1 %', cs: Math.round(best * 0.99) });
    suggestions.push({ label: '−3 %', cs: Math.round(best * 0.97) });
    suggestions.push({ label: '−5 %', cs: Math.round(best * 0.95) });
    if (bestPts && swimmer) {
      const t = timeForPoints(Math.ceil((bestPts + 50) / 50) * 50, course, swimmer.gender, dist, stroke);
      if (t) suggestions.push({ label: `${Math.ceil((bestPts + 50) / 50) * 50} pts`, cs: t });
    }
  }

  const valid = target != null && target > 0 && (!deadline || isValidISO(deadline));
  const save = () => {
    if (!valid) return;
    const payload = { swimmerId, stroke, distance: dist, course, targetCs: target!, label: label.trim() || undefined, deadline: deadline || undefined };
    if (goal) actions.updateGoal(goal.id, payload);
    else actions.addGoal(payload);
    overlay.toast(goal ? 'Objectif mis à jour' : 'Objectif créé', '🎯');
    close();
  };

  return (
    <SheetLayout title={goal ? 'Modifier l’objectif' : 'Nouvel objectif'} onCancel={close} onDone={save} doneLabel="Enregistrer" doneDisabled={!valid}>
      <div className="card">
        <div style={{ padding: '14px 14px 4px' }}>
          <div className="chips">
            {STROKES.map((s) => (
              <button key={s.id} type="button" className={`chip${stroke === s.id ? ' active' : ''}`} onClick={() => setStroke(s.id)}>
                <StrokeDot stroke={s.id} />
                {s.label}
              </button>
            ))}
          </div>
          <div className="chips" style={{ marginTop: 8 }}>
            {distances.map((d) => (
              <button key={d} type="button" className={`chip${dist === d ? ' active' : ''}`} onClick={() => setDistance(d)}>
                {d} m
              </button>
            ))}
          </div>
          <div style={{ margin: '10px 0 6px' }}>
            <Segmented value={course} onChange={setCourse} options={COURSES.map((c) => ({ id: c.id, label: `Bassin ${c.label}` }))} />
          </div>
        </div>
        <TimeInput
          value={target}
          onChange={setTarget}
          label="Temps visé"
          hint={best ? `Record actuel : ${formatTime(best)}${target ? ` · encore ${formatTime(Math.max(0, best - target))} à gagner` : ''}` : 'Pas encore de temps sur cette épreuve'}
        />
        {suggestions.length > 0 && (
          <div className="chips" style={{ padding: '0 14px 14px', justifyContent: 'center' }}>
            {suggestions.map((s) => (
              <button key={s.label} type="button" className="chip" onClick={() => setTarget(s.cs)}>
                {s.label} · {formatTime(s.cs)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="section" style={{ marginTop: 18 }}>
        <div className="list">
          <div className="field">
            <label htmlFor="gf-label">Intitulé</label>
            <input id="gf-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Temps limite championnat…" />
          </div>
          <div className="field">
            <label htmlFor="gf-deadline">Échéance</label>
            <input id="gf-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={{ marginLeft: 'auto' }} />
          </div>
        </div>
      </div>
      {goal && (
        <div className="section">
          <div className="list">
            <button
              className="row danger"
              type="button"
              onClick={() => {
                actions.deleteGoal(goal.id);
                close();
                overlay.toast('Objectif supprimé', '🗑️');
              }}
            >
              <div className="row-body center">Supprimer l’objectif</div>
            </button>
          </div>
        </div>
      )}
    </SheetLayout>
  );
}
