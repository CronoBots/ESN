import { useMemo, useState } from 'react';
import { actions, getState } from '../store/store';
import type { Course, Goal, Stroke } from '../store/types';
import { overlay, Segmented, SheetLayout, StrokeDot } from '../components/ui';
import { TimeInput } from '../components/TimeInput';
import { COURSES, distancesFor, STROKES } from '../lib/events';
import { formatTime } from '../lib/time';
import { isValidISO } from '../lib/dates';
import { countsForRecords } from '../lib/stats';
import { computePoints, timeForPoints } from '../lib/points';


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
