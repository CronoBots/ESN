import { useMemo, useState } from 'react';
import type { Swimmer } from '../store/types';
import { fullName } from '../store/hooks';
import { formatTime } from '../lib/time';
import { Avatar, Empty, Section, SheetLayout, overlay } from './ui';
import { Icon } from './Icon';
import { isFollowed, matches, SearchField } from '../screens/Club';

export interface CompareCandidate {
  swimmer: Swimmer;
  /** Meilleur temps du nageur sur l'épreuve affichée (centièmes). */
  bestCs: number;
}

/** Nombre de nageurs comparés en même temps (en plus du nageur de la page). */
export const MAX_COMPARE = 2;

/** Ajoute un nageur à la comparaison ; au-delà du maximum, le plus ancien choix laisse sa place. */
export const addCompare = (ids: string[], id: string) => [...ids.filter((x) => x !== id), id].slice(-MAX_COMPARE);

const bornLabel = (gender: Swimmer['gender'], year: number) => (gender === 'F' ? `Filles nées en ${year}` : `Garçons nés en ${year}`);

/**
 * Sections du sélecteur : nageurs suivis, puis même sexe et même année que le
 * nageur de la page, puis les autres par année de naissance (les plus proches
 * en âge d'abord). Dans chaque section, du plus rapide au plus lent.
 */
function compareSections(list: CompareCandidate[], main: Swimmer, q: string) {
  const shown = list.filter((c) => matches(c.swimmer, q)).sort((a, b) => a.bestCs - b.bestCs);
  const used = new Set<string>();
  const take = (pred: (c: CompareCandidate) => boolean) =>
    shown.filter((c) => !used.has(c.swimmer.id) && pred(c)).map((c) => (used.add(c.swimmer.id), c));
  const sections: { id: string; title: string; items: CompareCandidate[]; yearShown?: boolean }[] = [];
  sections.push({ id: 'followed', title: 'Nageurs suivis', items: take((c) => isFollowed(c.swimmer)) });
  if (main.birthYear) {
    sections.push({
      id: 'same',
      title: bornLabel(main.gender, main.birthYear),
      items: take((c) => c.swimmer.birthYear === main.birthYear && c.swimmer.gender === main.gender),
      yearShown: true,
    });
  }
  const years = [...new Set(shown.filter((c) => !used.has(c.swimmer.id)).map((c) => c.swimmer.birthYear ?? 0))].sort((a, b) => {
    if (!a || !b) return a ? -1 : b ? 1 : 0;
    const ref = main.birthYear ?? 0;
    return Math.abs(a - ref) - Math.abs(b - ref) || b - a;
  });
  for (const y of years) {
    sections.push({ id: `y${y}`, title: y ? `Nés en ${y}` : 'Année inconnue', items: take((c) => (c.swimmer.birthYear ?? 0) === y), yearShown: !!y });
  }
  return sections.filter((s) => s.items.length);
}

function ComparePicker({
  main,
  eventName,
  candidates,
  initial,
  onDone,
  close,
}: {
  main: Swimmer;
  eventName: string;
  candidates: CompareCandidate[];
  initial: string[];
  onDone: (ids: string[]) => void;
  close: () => void;
}) {
  const [sel, setSel] = useState<string[]>(initial);
  const [q, setQ] = useState('');
  const sections = useMemo(() => compareSections(candidates, main, q), [candidates, main, q]);
  const toggle = (id: string) => setSel((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : addCompare(ids, id)));

  return (
    <SheetLayout
      title="Comparer"
      onCancel={close}
      onDone={() => {
        onDone(sel);
        close();
      }}
    >
      <SearchField value={q} onChange={setQ} label="Nom ou prénom du nageur" sticky />
      {!q && (
        <p className="sheet-hint">
          Choisissez jusqu’à {MAX_COMPARE} nageurs à comparer avec {main.firstName} sur le {eventName}. À côté de chaque nom : son meilleur
          temps.
        </p>
      )}
      {sections.length === 0 && <Empty icon="person" title="Aucun nageur trouvé" />}
      {sections.map((sec) => (
        <Section key={sec.id} title={`${sec.title} · ${sec.items.length}`}>
          <div className="list">
            {sec.items.map(({ swimmer: sw, bestCs }) => {
              const on = sel.includes(sw.id);
              const sub = [sec.yearShown ? null : sw.birthYear, sw.former ? 'ancien membre' : null].filter(Boolean).join('\u00a0· ');
              return (
                <button key={sw.id} type="button" className="row" role="checkbox" aria-checked={on} onClick={() => toggle(sw.id)}>
                  <Avatar swimmer={sw} size={36} />
                  <div className="row-body">
                    <div className="row-title" style={on ? { fontWeight: 600 } : undefined}>
                      {fullName(sw)}
                    </div>
                    {sub && <div className="row-sub">{sub}</div>}
                  </div>
                  <span className="row-value tnum">{formatTime(bestCs)}</span>
                  <span className={`pick-mark${on ? ' on' : ''}`} aria-hidden="true">
                    {on && <Icon name="check" />}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>
      ))}
    </SheetLayout>
  );
}

export function openComparePicker(props: Omit<Parameters<typeof ComparePicker>[0], 'close'>) {
  overlay.sheet((close) => <ComparePicker {...props} close={close} />);
}
