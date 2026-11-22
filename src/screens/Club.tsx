import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { firstGroups, useProgressive } from '../components/progressive';
import { actions, batch, getState, ROSTER_PARSER, useData } from '../store/store';
import { fullName, isActiveMember, isFormerMember } from '../store/hooks';
import { Avatar, Empty, NavBar, Section, SheetLayout, overlay } from '../components/ui';
import { Icon } from '../components/Icon';
import { openShareApp } from '../components/Invite';
import { offerInstall } from './Install';
import { navigate } from '../router';
import { decryptHistory, decryptRankings, decryptRoster, isEncryptedRoster, keepClubRaces, WrongCodeError, type EncryptedRoster, type RosterGroup } from '../lib/roster';
import { historyNote, parseSwimrankings } from '../lib/swimrankings';
import { sameSwimmer } from '../lib/results';
import { normName } from '../lib/results';
import { formatDate, formatDayMonth } from '../lib/dates';
import { CLUB } from '../club';
import type { NationalRank, Swim, Swimmer } from '../store/types';
import { parseRankingsText } from '../lib/rankings';
import { recordHolders } from '../lib/clubRecords';

/** Liste chiffrée des membres, publiée avec l'application (voir scripts/roster.mjs). */
const ROSTER_URL = './data/club-roster.json';
/** Historique swimrankings des membres, chiffré avec le même code. */
const HISTORY_URL = './data/club-history.json';
const RANKINGS_URL = './data/club-rankings.json';
/** 2 : noms des compétitions repris tels quels (chiffres compris). 3 : dates d'août abrégées « aoû ».
 * 5 : temps de passage officiels (400 m d'un 800 m…) retirés des courses. 6 : rattaché aussi par les autres noms du membre.
 * 7 : disqualifications, forfaits et abandons (DSQ, DNS, DNF, sans temps), avec la raison de la disqualification.
 * 8 : jour non relevé, dates de la compétition affichées à la place (13e colonne). */
const HISTORY_PARSER = 8;

const letters = (s: string) => normName(s);

/**
 * Un seul traitement à la fois. Au premier lancement, le chargement de la liste et la vérification
 * à l'ouverture se suivent de près : le second appel attend la fin du premier, qui a alors enregistré
 * la version appliquée, au lieu de tout télécharger, déchiffrer et relire une deuxième fois.
 */
function oneAtATime(run: () => Promise<number>): () => Promise<number> {
  let last: Promise<unknown> = Promise.resolve();
  return () => {
    const next = last.then(run);
    last = next.catch(() => {});
    return next;
  };
}

/**
 * Classements nationaux publiés par le club (swimrankings) : appliqués une fois par version,
 * en remplaçant les précédents. Pas de fichier publié : rien à faire.
 */
export const applyClubRankings = oneAtATime(runClubRankings);

/**
 * Historique des nageurs du club (toutes leurs compétitions, relevées sur
 * swimrankings.net par le club) : ajouté une fois par version publiée.
 * Renvoie le nombre de courses ajoutées.
 */
export const applyClubHistory = oneAtATime(runClubHistory);

async function runClubRankings(): Promise<number> {
  const club = getState().settings.club;
  if (!club || club.expired) return 0;
  const res = await fetch(RANKINGS_URL, { cache: 'no-cache' }).catch(() => null);
  if (!res?.ok) return 0;
  const enc: unknown = await res.json().catch(() => null);
  if (!isEncryptedRoster(enc, 'esn-rankings') || enc.iv === club.rankingsVersion) return 0;
  const published = await decryptRankings(enc, club.code).catch(() => null);
  if (!published) return 0;
  const members = getState().swimmers.filter((s) => s.member);
  const list: NationalRank[] = [];
  for (const a of published.athletes) {
    // Sous le nom de la liste du club, sinon sous l'un de ses autres noms (orthographe de la fédération…)
    const sw = members.find((s) => sameSwimmer(a, s)) ?? members.find((s) => s.aliases?.some((al) => sameSwimmer(a, al)));
    if (sw) for (const r of parseRankingsText(a.text)) list.push({ swimmerId: sw.id, ...r });
  }
  actions.setRankings(list, enc.iv);
  return list.length;
}

async function runClubHistory(): Promise<number> {
  const club = getState().settings.club;
  if (!club || club.expired) return 0;
  const res = await fetch(HISTORY_URL, { cache: 'no-cache' }).catch(() => null);
  if (!res?.ok) return 0;
  const enc: unknown = await res.json().catch(() => null);
  if (!isEncryptedRoster(enc, 'esn-history')) return 0;
  if (enc.iv === club.historyVersion && (club.historyParser ?? 1) >= HISTORY_PARSER) return 0;
  const history = await decryptHistory(enc, club.code).catch(() => null);
  if (!history) return 0;
  // Membres du club par nom normalisé (dans les deux ordres, comme sameSwimmer) : une recherche par nageur
  const byName = new Map<string, Swimmer[]>();
  /** Autres noms : « NOM|Prénom » → membres (avec l'année de naissance de l'autre nom). */
  const byAlias = new Map<string, { s: Swimmer; birthYear?: number }[]>();
  for (const s of getState().swimmers) {
    if (!s.member) continue;
    for (const k of [`${normName(s.lastName)}|${normName(s.firstName)}`, `${normName(s.firstName)}|${normName(s.lastName)}`]) {
      const list = byName.get(k);
      if (!list) byName.set(k, [s]);
      else if (!list.includes(s)) list.push(s);
    }
    for (const al of s.aliases ?? []) {
      const k = `${normName(al.lastName)}|${normName(al.firstName)}`;
      byAlias.set(k, [...(byAlias.get(k) ?? []), { s, birthYear: al.birthYear }]);
    }
  }
  // Lecture des temps par petits paquets : l'écran reste fluide pendant l'import, même sur un téléphone
  const todo: { a: (typeof history.athletes)[number]; swimmerId: string; parsed: ReturnType<typeof parseSwimrankings> }[] = [];
  let slice = performance.now();
  for (const a of history.athletes) {
    const k = `${normName(a.lastName)}|${normName(a.firstName)}`;
    // Sous le nom de la liste du club, sinon sous l'un de ses autres noms (orthographe de la fédération…)
    const sw =
      byName.get(k)?.find((s) => sameSwimmer(a, s)) ??
      byAlias.get(k)?.find((x) => !(x.birthYear && a.birthYear && x.birthYear !== a.birthYear))?.s;
    if (!sw) continue;
    // Seulement les courses nagées pour l'ESN (club relevé pour chaque course)
    todo.push({ a, swimmerId: sw.id, parsed: parseSwimrankings(keepClubRaces(a.text, CLUB.match).text) });
    if (performance.now() - slice > 12) {
      await new Promise((r) => setTimeout(r, 0));
      slice = performance.now();
    }
  }
  let added = 0;
  batch(() => {
    for (const { a, swimmerId, parsed } of todo) {
      const sw = getState().swimmers.find((s) => s.id === swimmerId);
      if (!sw) continue;
      // L'historique publié fait foi : ses courses retirées (autre club, correction) disparaissent aussi ici
      if (parsed.swims.length) actions.pruneHistorySwims(swimmerId, parsed.swims);
      // Sans changer le nageur affiché sur l'accueil
      if (parsed.swims.length) added += actions.importSwimrankings({ swimmerId }, parsed.swims, { select: false }).added;
      // Noms de compétitions tronqués par une version précédente (« e édition… ») : on les rétablit
      const state = getState();
      // Courses du nageur et compétitions indexées une fois (et non une recherche dans toutes les courses par temps)
      // Disqualification, forfait (sans temps) : reconnus à leur statut
      const key = (x: { distance: number; stroke: string; course: string; timeCs?: number | null; status?: string; date: string }) =>
        `${x.distance}|${x.stroke}|${x.course}|${x.timeCs ?? ''}|${x.status ?? 'OK'}|${x.date}`;
      const mine = new Map(state.swims.filter((x) => x.swimmerId === swimmerId).map((x) => [key(x), x]));
      const meetsById = new Map(state.meets.map((m) => [m.id, m]));
      for (const ps of parsed.swims) {
        const swim = mine.get(key(ps));
        // Temps masters déjà présents sans la marque (lus par une version précédente) : on la rajoute
        if (ps.masters && swim && !swim.masters) actions.updateSwim(swim.id, { masters: true });
        // Place, tour et passages relevés depuis : la course déjà présente est complétée (jamais écrasée)
        if (swim) {
          const extra: Partial<Swim> = {};
          if (ps.place != null && swim.place == null) extra.place = ps.place;
          if (ps.round && ps.round !== 'TIM' && swim.round === 'TIM') extra.round = ps.round;
          if (ps.splits && !swim.splits?.length) Object.assign(extra, { splits: ps.splits, splitEvery: ps.splitEvery });
          // Raison de la disqualification relevée depuis
          const note = historyNote(ps);
          if (note && !swim.notes) extra.notes = note;
          // Jour non relevé (dates de la compétition affichées), ou relevé depuis : comme l'historique publié
          if (swim.source === 'swimrankings' && `${swim.dayRange?.from}/${swim.dayRange?.to}` !== `${ps.dayRange?.from}/${ps.dayRange?.to}`)
            extra.dayRange = ps.dayRange;
          if (Object.keys(extra).length) actions.updateSwim(swim.id, extra);
          // La compétition couvre au moins ses dates connues
          const m0 = ps.dayRange && swim.meetId ? meetsById.get(swim.meetId) : undefined;
          if (m0 && ps.dayRange && (ps.dayRange.from < m0.startDate || ps.dayRange.to > (m0.endDate ?? m0.startDate))) {
            const span = {
              startDate: ps.dayRange.from < m0.startDate ? ps.dayRange.from : m0.startDate,
              endDate: ps.dayRange.to > (m0.endDate ?? m0.startDate) ? ps.dayRange.to : (m0.endDate ?? m0.startDate),
            };
            actions.updateMeet(m0.id, span);
            meetsById.set(m0.id, { ...m0, ...span });
          }
        }
        if (!ps.meet) continue;
        const meet = swim?.meetId ? meetsById.get(swim.meetId) : undefined;
        if (!meet || meet.name === ps.meet || !letters(ps.meet).includes(letters(meet.name))) continue;
        const onlyHistory = state.swims.every((x) => x.meetId !== meet.id || x.source === 'swimrankings');
        if (onlyHistory) actions.updateMeet(meet.id, { name: ps.meet });
      }
      const id = a.swimrankingsId ?? parsed.athlete.swimrankingsId;
      if (id && !sw.swimrankingsId) actions.updateSwimmer(sw.id, { swimrankingsId: id });
    }
    const now = getState().settings.club;
    if (now) actions.updateSettings({ club: { ...now, historyVersion: enc.iv, historyParser: HISTORY_PARSER } });
  });
  return added;
}

/** « groupes A, B et C » (ou les noms des groupes s'ils sont personnalisés). */
export function groupsLabel(groups: RosterGroup[]): string {
  const letters = groups.every((g) => g.name === `Groupe ${g.id}`);
  const names = groups.map((g) => (letters ? g.id : g.name));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names.join('');
  return letters ? `${names.length > 1 ? 'groupes' : 'groupe'}\u00a0${list}` : list;
}

/** « années 2008 à 2016 » */
export function yearsLabel(swimmers: Swimmer[]): string {
  const years = swimmers.map((s) => s.birthYear).filter((y): y is number => !!y);
  if (!years.length) return '';
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? `année\u00a0${min}` : `années ${min} à\u00a0${max}`;
}

/** Résumé de la liste du club : groupes s'il y en a, sinon années de naissance. */
export function clubSummary(groups: RosterGroup[], members: Swimmer[]): string {
  return [`${members.length}\u00a0nageur${members.length > 1 ? 's' : ''}`, groups.length ? groupsLabel(groups) : yearsLabel(members)]
    .filter(Boolean)
    .join('\u00a0· ');
}

export function groupName(groups: RosterGroup[], id?: string): string | undefined {
  if (!id) return undefined;
  return groups.find((g) => g.id === id)?.name ?? `Groupe ${id}`;
}

async function fetchRoster(): Promise<EncryptedRoster | null> {
  const res = await fetch(ROSTER_URL, { cache: 'no-cache' });
  if (!res.ok) return null;
  const json: unknown = await res.json().catch(() => null);
  return isEncryptedRoster(json) ? json : null;
}

let available: Promise<boolean> | null = null;

/** Vrai quand le club a publié sa liste de membres (sinon, rien à déverrouiller). */
export function useRosterAvailable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    available ??= fetchRoster()
      .then((r) => r != null)
      .catch(() => false);
    available.then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, []);
  return ok;
}

/** Déverrouille la liste du club avec son code et ajoute tous les membres. */
async function unlockClub(code: string): Promise<{ added: number; total: number }> {
  const enc = await fetchRoster();
  if (!enc) throw new Error('indisponible');
  const roster = await decryptRoster(enc, code);
  const r = actions.applyRoster(roster, code.trim(), enc.iv);
  void applyClubHistory().then(applyClubRankings);
  return r;
}

let opening: Promise<boolean> | null = null;

/**
 * Application ouverte à tous : la liste du club s'ouvre toute seule avec la
 * clé intégrée (CLUB.accessKey), sans lien, code ni connexion. Vrai si la
 * liste est disponible sur l'appareil. Un seul chargement à la fois.
 */
export function ensureClub(): Promise<boolean> {
  const club = getState().settings.club;
  if (club && !club.expired) return Promise.resolve(true);
  opening ??= unlockClub(CLUB.accessKey)
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      opening = null;
    });
  return opening;
}

/**
 * À l'ouverture : si le club a publié une nouvelle liste, elle est appliquée
 * (nouveaux nageurs, changements de groupe). Renvoie le nombre de nouveaux nageurs.
 */
export async function refreshClubRoster(): Promise<number> {
  const club = getState().settings.club;
  if (!club) return 0;
  const enc = await fetchRoster();
  // Même liste déjà lue par cette version de l'application : rien à refaire
  if (!enc || (enc.iv === club.version && (club.rosterParser ?? 1) >= ROSTER_PARSER)) {
    await applyClubHistory();
    await applyClubRankings();
    return 0;
  }
  try {
    const added = actions.applyRoster(await decryptRoster(enc, club.code), club.code, enc.iv).added;
    await applyClubHistory();
    await applyClubRankings();
    return added;
  } catch (e) {
    // Le club a changé de code : on le redemandera
    if (e instanceof WrongCodeError) actions.updateSettings({ club: { ...club, version: enc.iv, expired: true } });
    return 0;
  }
}

/* ------------------------------------------------------------------------ */
/* Nageurs suivis (favoris), choisis dans la liste du club                   */
/* ------------------------------------------------------------------------ */

export function openFollowPicker(onDone?: () => void) {
  overlay.sheet((close) => <FollowPicker close={close} onDone={onDone} />);
}

/** Chargement de la liste du club demandé par un bouton : un message si elle ne peut pas se charger. */
export function loadClub(): Promise<boolean> {
  return ensureClub().then((ok) => {
    if (!ok) overlay.toast(navigator.onLine ? 'Liste du club indisponible pour le moment' : 'Pas de connexion internet', '⚠️');
    return ok;
  });
}

/** Choisir des nageurs à suivre : dans la liste du club (ouverte avec le QR code la première fois). */
export function openFollow(onDone?: () => void) {
  void loadClub().then((ok) => ok && openFollowPicker(onDone));
}

export const isFollowed = (sw: Swimmer) => sw.favorite || sw.relation === 'child';

/**
 * Anciens membres masqués dans la liste du club (choix du club) : ceux qui ne détiennent aucun record du
 * club (aucune épreuve, aucun bassin, aucune tranche d'âge) ou n'ont aucune course. Toujours retrouvés par
 * une recherche à leur nom, et affichés s'ils sont suivis.
 */
function useHiddenFormer(): (s: Swimmer) => boolean {
  const { swims, swimmers } = useData();
  const holders = useMemo(() => recordHolders(swims, swimmers), [swims, swimmers]);
  return useMemo(() => (s: Swimmer) => !!s.member && !!s.former && !holders.has(s.id) && !isFollowed(s), [holders]);
}

/** Bouton cœur : suivre / ne plus suivre. */
export function FollowButton({ swimmer }: { swimmer: Swimmer }) {
  const on = isFollowed(swimmer);
  return (
    <button
      type="button"
      className={`follow-btn${on ? ' on' : ''}`}
      aria-pressed={on}
      aria-label={on ? `Ne plus suivre ${fullName(swimmer)}` : `Suivre ${fullName(swimmer)}`}
      onClick={() => {
        actions.follow(swimmer.id, !on);
        overlay.toast(on ? `${swimmer.firstName} n’est plus suivi${swimmer.gender === 'F' ? 'e' : ''}` : `${swimmer.firstName} est suivi${swimmer.gender === 'F' ? 'e' : ''} sur l’accueil`, on ? '♡' : '❤️');
      }}
    >
      <Icon name={on ? 'heartFill' : 'heart'} />
    </button>
  );
}

/** Par année de naissance, puis par nom. */
const byYearName = (a: Swimmer, b: Swimmer) =>
  (a.birthYear ?? 9999) - (b.birthYear ?? 9999) ||
  `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'fr', { sensitivity: 'base' });

export function matches(sw: Swimmer, q: string) {
  if (!q) return true;
  const hay = normName(`${sw.firstName}${sw.lastName}`);
  return normName(q)
    .split(/\s+/)
    .every((t) => hay.includes(t));
}

/** Sections par année de naissance, de la plus récente à la plus ancienne (année inconnue à la fin). */
function byBirthYear(list: Swimmer[]) {
  const years = [...new Set(list.map((s) => String(s.birthYear ?? '')))].sort((a, b) => (b || '0').localeCompare(a || '0'));
  return years.map((y) => ({ id: `y${y || 'na'}`, title: y || 'Année inconnue', items: list.filter((s) => String(s.birthYear ?? '') === y) }));
}

/** L'année de naissance est-elle déjà le titre de la section ? */
const yearInTitle = (sectionId: string) => /^y\d{4}$/.test(sectionId);

/** Filtres de la liste du club (en plus des groupes, s'il y en a). */
type ClubFilter = 'all' | 'active' | 'former' | 'followed' | string;

/**
 * Nageurs du club, actifs et anciens ensemble, une section par année de naissance
 * (les plus jeunes d'abord). Filtres : actifs, anciens, ou un groupe (A, B, C…) s'il y en a.
 * Dans le sélecteur des nageurs suivis (« all »), les nageurs hors club suivent à part.
 */
function clubSections(swimmers: Swimmer[], groups: RosterGroup[], filter: ClubFilter, q: string, hidden?: (s: Swimmer) => boolean) {
  // Nageurs masqués (anciens sans record) : retrouvés seulement par une recherche à leur nom
  const list = swimmers.filter((s) => matches(s, q) && (q.trim() !== '' || !hidden?.(s))).sort(byYearName);
  const members = list.filter((s) => isActiveMember(s) || isFormerMember(s));
  const others = list.filter((s) => !s.member);
  if (groups.some((g) => g.id === filter)) return byBirthYear(members.filter((s) => s.group === filter && !s.former));
  const shown = filter === 'active' ? members.filter(isActiveMember) : filter === 'former' ? members.filter(isFormerMember) : members;
  const sections = byBirthYear(shown);
  if (filter === 'all' && others.length) sections.push({ id: 'others', title: 'Autres nageurs', items: others });
  return sections.filter((s) => s.items.length);
}

export function SearchField({
  value,
  onChange,
  label,
  sticky,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  /** Dans une feuille : reste visible en haut pendant qu'on fait défiler la liste. */
  sticky?: boolean;
}) {
  const field = (
    <div className="search-field">
      <Icon name="search" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          // Nouvelle recherche : les résultats repartent du haut de la liste
          if (sticky) e.currentTarget.closest('.sheet-body')?.scrollTo({ top: 0 });
        }}
        onKeyDown={(e) => {
          // Touche « Rechercher » du clavier : on ferme le clavier pour voir les résultats
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        placeholder={label}
        aria-label={label}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {value && (
        <button type="button" className="search-clear" onClick={() => onChange('')} aria-label="Effacer la recherche">
          <Icon name="close" />
        </button>
      )}
    </div>
  );
  return sticky ? <div className="sheet-search">{field}</div> : field;
}

function FollowPicker({ close, onDone }: { close: () => void; onDone?: () => void }) {
  const data = useData();
  const groups = data.settings.club?.groups ?? [];
  const [sel, setSel] = useState<Set<string>>(() => new Set(data.swimmers.filter(isFollowed).map((s) => s.id)));
  const [q, setQ] = useState('');
  // Recherche : la frappe reste fluide, la liste suit juste après
  const dq = useDeferredValue(q);
  const full = useProgressive();
  const hidden = useHiddenFormer();
  const all = useMemo(() => clubSections(data.swimmers, groups, 'all', dq, hidden), [data.swimmers, groups, dq, hidden]);
  const sections = firstGroups(all, (s) => s.items.length, full);

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const done = () => {
    actions.setFollowed([...sel]);
    close();
    // Première visite par le QR code (version web) : on propose d'installer l'application (le guide remplace le message)
    if (sel.size && !offerInstall()) overlay.toast(`${sel.size}\u00a0nageur${sel.size > 1 ? 's' : ''} suivi${sel.size > 1 ? 's' : ''} sur l’accueil`, '❤️');
    onDone?.();
  };

  return (
    <SheetLayout title="Nageurs suivis" onCancel={close} onDone={done} doneLabel={sel.size ? 'OK' : 'Plus tard'}>
      <SearchField value={q} onChange={setQ} label="Nom ou prénom du nageur" sticky />
      {!q && (
        <p className="sheet-hint">
          Touchez le cœur des nageurs à suivre (vos enfants, leurs coéquipiers…) : leurs résultats s’affichent sur l’accueil.
        </p>
      )}
      {sections.length === 0 && <Empty icon="person" title="Aucun nageur trouvé" />}
      {sections.map((sec) => (
        <Section key={sec.id} title={`${sec.title} · ${sec.items.length}`}>
          <div className="list follow-list">
            {sec.items.map((sw) => {
              const on = sel.has(sw.id);
              return (
                <button key={sw.id} type="button" className="row" role="checkbox" aria-checked={on} onClick={() => toggle(sw.id)}>
                  <Avatar swimmer={sw} size={36} />
                  <div className="row-body">
                    <div className="row-title" style={on ? { fontWeight: 600 } : undefined}>
                      {fullName(sw)}
                    </div>
                    {(sw.former || (!yearInTitle(sec.id) && sw.birthYear)) && (
                      <div className="row-sub">{[yearInTitle(sec.id) ? null : sw.birthYear, sw.former ? 'ancien membre' : null].filter(Boolean).join('\u00a0· ')}</div>
                    )}
                  </div>
                  <span className={`follow-mark${on ? ' on' : ''}`} aria-hidden="true">
                    <Icon name={on ? 'heartFill' : 'heart'} />
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

/* ------------------------------------------------------------------------ */
/* Écran « Le club »                                                         */
/* ------------------------------------------------------------------------ */

const GROUP_KEY = 'esn.clubGroup';

function savedGroup(): string {
  try {
    return localStorage.getItem(GROUP_KEY) || 'all';
  } catch {
    return 'all';
  }
}

export function ClubScreen() {
  const data = useData();
  const available = useRosterAvailable();
  const club = data.settings.club;
  const groups = club?.groups ?? [];
  const [filter, setFilter] = useState(savedGroup);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; last?: string; planned: number }>();
    for (const s of data.swims) {
      if (s.context !== 'competition') continue;
      const cur = m.get(s.swimmerId) ?? { count: 0, planned: 0 };
      if (s.timeCs == null && s.status === 'OK') cur.planned++;
      else {
        cur.count++;
        if (!cur.last || s.date > cur.last) cur.last = s.date;
      }
      m.set(s.swimmerId, cur);
    }
    return m;
  }, [data.swims]);

  const hidden = useHiddenFormer();
  const members = data.swimmers.filter((s) => s.member);
  const activeMembers = members.filter(isActiveMember);
  const hiddenCount = members.filter(hidden).length;
  const formerCount = members.length - activeMembers.length - hiddenCount;
  const followedCount = members.filter(isFollowed).length;
  const choices = ['active', ...(formerCount ? ['former'] : []), ...(followedCount ? ['followed'] : []), ...groups.map((g) => g.id)];
  const active = filter === 'all' || choices.includes(filter) ? filter : 'all';
  const dq = useDeferredValue(q);
  const full = useProgressive(active);
  const allSections = useMemo(() => {
    if (active === 'followed') {
      const items = members.filter((s) => isFollowed(s) && matches(s, dq)).sort(byYearName);
      return items.length ? [{ id: 'followed', title: 'Suivis', items }] : [];
    }
    return clubSections(members, groups, active, dq, hidden);
  }, [data.swimmers, groups, active, dq, hidden]);
  const sections = firstGroups(allSections, (s) => s.items.length, full);
  const choose = (v: string) => {
    setFilter(v);
    try {
      localStorage.setItem(GROUP_KEY, v);
    } catch {
      /* ignore */
    }
  };

  if (!club) {
    return (
      <>
        <NavBar title="Le club" back="/" />
        <main className="page">
          <div className="card pad center club-lock">
            <span className="lock-icon" aria-hidden="true">
              <Icon name="users" />
            </span>
            <h2>Les nageurs de l’ESN</h2>
            <p className="muted">La liste du club se charge dès que le téléphone est connecté à internet.</p>
            {available && (
              <button
                className="btn"
                disabled={loading}
                onClick={() => {
                  setLoading(true);
                  void loadClub().finally(() => setLoading(false));
                }}
              >
                <Icon name="download" /> {loading ? 'Chargement…' : 'Charger la liste du club'}
              </button>
            )}
          </div>
        </main>
      </>
    );
  }

  const shown = sections.reduce((n, s) => n + s.items.length, 0);
  return (
    <>
      <NavBar
        title="Le club"
        subtitle={`${activeMembers.length} membres actifs${formerCount ? ` · ${formerCount} anciens membres` : ''} · par année de naissance`}
        back="/"
        right={
          <button className="icon-btn" onClick={openShareApp} aria-label="Partager l’application">
            <Icon name="share" />
          </button>
        }
      />
      <main className="page">
        <div className="chips" style={{ marginTop: 8 }} role="group" aria-label="Nageurs affichés">
          {['all', ...choices].map(
            (v) => (
              <button key={v} className={`chip${active === v ? ' active' : ''}`} aria-pressed={active === v} onClick={() => choose(v)}>
                {v === 'all' ? (
                  <>
                    Tous
                    <span className="count">{members.length - hiddenCount}</span>
                  </>
                ) : v === 'active' ? (
                  <>
                    Actifs
                    <span className="count">{activeMembers.length}</span>
                  </>
                ) : v === 'followed' ? (
                  <>
                    <Icon name="heartFill" style={{ width: 13, height: 13, color: '#ff375f' }} /> Suivis
                    <span className="count">{followedCount}</span>
                  </>
                ) : v === 'former' ? (
                  <>
                    Anciens
                    <span className="count">{formerCount}</span>
                  </>
                ) : (
                  groupName(groups, v)
                )}
              </button>
            ),
          )}
        </div>
        <div className="section-foot" style={{ margin: '8px 4px 0' }}>
          {active === 'former'
            ? `Anciens membres : nageurs qui ont représenté l’ESN en compétition. Ils restent hors des classements, sauf si vous les y ajoutez.${hiddenCount ? ` Les ${hiddenCount} anciens sans record du club n’apparaissent qu’en les cherchant par leur nom.` : ''}`
            : 'Touchez le cœur d’un nageur pour le suivre : il apparaît sur l’accueil.'}
        </div>
        <div style={{ marginTop: 10 }}>
          <SearchField value={q} onChange={setQ} label="Rechercher un nageur" />
        </div>
        {shown === 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <Empty icon="person" title="Aucun nageur trouvé" text={q ? 'Vérifiez l’orthographe du nom ou du prénom.' : undefined} />
          </div>
        )}
        {sections.map((sec) => (
          <Section key={sec.id} title={`${sec.title} · ${sec.items.length} nageur${sec.items.length > 1 ? 's' : ''}`}>
            <div className="list">
              {sec.items.map((sw) => {
                const st = stats.get(sw.id);
                const sub = [
                  yearInTitle(sec.id) ? null : sw.birthYear, // l'année est le plus souvent le titre de la section
                  sw.former ? 'ancien membre' : null,
                  st?.count
                    ? `${st.count}\u00a0course${st.count > 1 ? 's' : ''}`
                    : st?.planned
                      ? `${st.planned}\u00a0épreuve${st.planned > 1 ? 's' : ''} au programme, résultats en attente`
                      : 'Pas encore de résultat',
                  st?.last ? `dernière le ${st.last.slice(0, 4) === String(new Date().getFullYear()) ? formatDayMonth(st.last) : formatDate(st.last)}` : null,
                ].filter(Boolean);
                return (
                  <div key={sw.id} className="row club-row">
                    <button className="club-row-main" onClick={() => navigate(`/swimmer/${sw.id}`)}>
                      <Avatar swimmer={sw} size={38} />
                      <div className="row-body">
                        <div className="row-title" style={isFollowed(sw) ? { fontWeight: 600 } : undefined}>
                          {fullName(sw)}
                        </div>
                        <div className="row-sub">{sub.join('\u00a0· ')}</div>
                      </div>
                    </button>
                    <FollowButton swimmer={sw} />
                  </div>
                );
              })}
            </div>
          </Section>
        ))}
        <div className="section-foot center" style={{ marginTop: 18 }}>
          Liste du club du {formatDate(club.updated)} · ouverte avec le QR code de l’ESN.
          <br />
          Les résultats de compétition de chaque nageur sont ajoutés automatiquement.
        </div>
      </main>
    </>
  );
}
