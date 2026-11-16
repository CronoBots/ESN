import { useEffect, useMemo, useState } from 'react';
import { actions, getState, useData } from '../store/store';
import { fullName } from '../store/hooks';
import { Avatar, BrandLogo, Empty, NavBar, Section, SheetLayout, overlay } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate, useRoute } from '../router';
import { decryptRoster, isEncryptedRoster, WrongCodeError, type EncryptedRoster, type RosterGroup } from '../lib/roster';
import { normName } from '../lib/results';
import { formatDate } from '../lib/dates';
import type { Swimmer } from '../store/types';
import { SyncBanner } from './autoResults';

/** Liste chiffrée des membres, publiée avec l'application (voir scripts/roster.mjs). */
const ROSTER_URL = './data/club-roster.json';

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
    .join(' · ');
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
  return actions.applyRoster(roster, code.trim(), enc.iv);
}

/**
 * À l'ouverture : si le club a publié une nouvelle liste, elle est appliquée
 * (nouveaux nageurs, changements de groupe). Renvoie le nombre de nouveaux nageurs.
 */
export async function refreshClubRoster(): Promise<number> {
  const club = getState().settings.club;
  if (!club) return 0;
  const enc = await fetchRoster();
  if (!enc || enc.iv === club.version) return 0;
  try {
    return actions.applyRoster(await decryptRoster(enc, club.code), club.code, enc.iv).added;
  } catch (e) {
    // Le club a changé de code : on le redemandera
    if (e instanceof WrongCodeError) actions.updateSettings({ club: { ...club, version: enc.iv, expired: true } });
    return 0;
  }
}

/* ------------------------------------------------------------------------ */
/* Code du club                                                              */
/* ------------------------------------------------------------------------ */

export function openClubCode(onUnlocked?: () => void, initial = '') {
  overlay.sheet((close) => <ClubCodeSheet close={close} onUnlocked={onUnlocked} initial={initial} />);
}

type CodeState = 'idle' | 'busy' | 'wrong' | 'unavailable';

function ClubCodeSheet({ close, onUnlocked, initial }: { close: () => void; onUnlocked?: () => void; initial: string }) {
  const [code, setCode] = useState(initial);
  const [state, setState] = useState<CodeState>('idle');

  const submit = async () => {
    if (!code.trim() || state === 'busy') return;
    setState('busy');
    try {
      const r = await unlockClub(code);
      close();
      overlay.toast(`${r.total} nageurs du club dans l’application`, '🏊');
      onUnlocked?.();
    } catch (e) {
      setState(e instanceof WrongCodeError ? 'wrong' : 'unavailable');
    }
  };

  return (
    <SheetLayout title="Code du club" onCancel={close}>
      <div className="center" style={{ padding: '4px 0 18px' }}>
        <BrandLogo height={72} />
        <p className="muted" style={{ margin: '14px auto 0', maxWidth: 380 }}>
          Entrez le code donné par le club : les nageurs du club apparaissent dans l’application, avec leurs résultats.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          className="textinput code-input"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            if (state !== 'busy') setState('idle');
          }}
          placeholder="ESN-XXXX-XXXX"
          aria-label="Code du club"
          aria-invalid={state === 'wrong'}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
        {state === 'wrong' && (
          <p className="form-msg bad" role="alert">
            Code incorrect. Vérifiez-le auprès du club.
          </p>
        )}
        {state === 'unavailable' && (
          <p className="form-msg bad" role="alert">
            {navigator.onLine ? 'La liste du club n’est pas disponible pour le moment.' : 'Pas de connexion internet.'}
          </p>
        )}
        <button className="btn block" type="submit" style={{ marginTop: 14 }} disabled={!code.trim() || state === 'busy'}>
          {state === 'busy' ? 'Vérification…' : 'Valider'}
        </button>
      </form>
      <div className="section-foot" style={{ marginTop: 14 }}>
        La liste des nageurs est chiffrée : sans ce code, personne ne peut la lire, ni sur le site ni ailleurs.
      </div>
    </SheetLayout>
  );
}

/* ------------------------------------------------------------------------ */
/* Nageurs suivis (favoris), choisis dans la liste du club                   */
/* ------------------------------------------------------------------------ */

export function openFollowPicker(onDone?: () => void) {
  overlay.sheet((close) => <FollowPicker close={close} onDone={onDone} />);
}

/** Choisir des nageurs à suivre : dans la liste du club (code du club demandé la première fois). */
export function openFollow(onDone?: () => void) {
  if (getState().settings.club && !getState().settings.club?.expired) openFollowPicker(onDone);
  else openClubCode(() => openFollowPicker(onDone));
}

const isFollowed = (sw: Swimmer) => sw.favorite || sw.relation === 'child';

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

function matches(sw: Swimmer, q: string) {
  if (!q) return true;
  const hay = normName(`${sw.firstName}${sw.lastName}`);
  return normName(q)
    .split(/\s+/)
    .every((t) => hay.includes(t));
}

/** Années de naissance des membres, de la plus ancienne à la plus récente. */
const memberYears = (swimmers: Swimmer[]) =>
  [...new Set(swimmers.filter((s) => s.member).map((s) => String(s.birthYear ?? '')))].sort((a, b) => (a || '9999').localeCompare(b || '9999'));

/**
 * Membres par groupe (A, B, C…) ou, sans groupes, par année de naissance ;
 * chaque section triée par année puis par nom. Puis les autres nageurs.
 */
function clubSections(swimmers: Swimmer[], groups: RosterGroup[], filter: string, q: string) {
  const list = swimmers.filter((s) => matches(s, q)).sort(byYearName);
  const sections = groups.length
    ? groups
        .filter((g) => filter === 'all' || g.id === filter)
        .map((g) => ({ id: g.id, title: g.name, items: list.filter((s) => s.member && s.group === g.id) }))
    : memberYears(swimmers)
        .filter((y) => filter === 'all' || y === filter)
        .map((y) => ({ id: y || 'na', title: y || 'Année inconnue', items: list.filter((s) => s.member && String(s.birthYear ?? '') === y) }));
  if (filter === 'all') {
    const others = list.filter((s) => !s.member || (groups.length > 0 && !groups.some((g) => g.id === s.group)));
    if (others.length) sections.push({ id: 'others', title: 'Autres nageurs', items: others });
  }
  return sections.filter((s) => s.items.length);
}

function SearchField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="search-field">
      <Icon name="search" aria-hidden="true" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label} enterKeyHint="search" />
    </div>
  );
}

function FollowPicker({ close, onDone }: { close: () => void; onDone?: () => void }) {
  const data = useData();
  const groups = data.settings.club?.groups ?? [];
  const [sel, setSel] = useState<Set<string>>(() => new Set(data.swimmers.filter(isFollowed).map((s) => s.id)));
  const [q, setQ] = useState('');
  const sections = useMemo(() => clubSections(data.swimmers, groups, 'all', q), [data.swimmers, groups, q]);

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
    if (sel.size) overlay.toast(`${sel.size}\u00a0nageur${sel.size > 1 ? 's' : ''} suivi${sel.size > 1 ? 's' : ''} sur l’accueil`, '❤️');
    onDone?.();
  };

  return (
    <SheetLayout title="Nageurs suivis" onCancel={close} onDone={done} doneLabel={sel.size ? 'OK' : 'Plus tard'}>
      <p className="muted" style={{ margin: '0 4px 12px' }}>
        Touchez les nageurs à suivre (vos enfants, leurs coéquipiers…) : leurs résultats, records et progression s’affichent sur
        l’accueil.
      </p>
      <SearchField value={q} onChange={setQ} label="Rechercher un nageur" />
      {sections.length === 0 && <Empty icon="person" title="Aucun nageur trouvé" />}
      {sections.map((sec) => (
        <Section key={sec.id} title={`${sec.title} · ${sec.items.length}`}>
          <div className="list">
            {sec.items.map((sw) => {
              const on = sel.has(sw.id);
              return (
                <button key={sw.id} type="button" className="row" role="checkbox" aria-checked={on} onClick={() => toggle(sw.id)}>
                  <Avatar swimmer={sw} size={36} />
                  <div className="row-body">
                    <div className="row-title" style={on ? { fontWeight: 600 } : undefined}>
                      {fullName(sw)}
                    </div>
                    {groups.length > 0 && sw.birthYear && <div className="row-sub">{sw.birthYear}</div>}
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
  const route = useRoute();
  const available = useRosterAvailable();
  const club = data.settings.club;
  const groups = club?.groups ?? [];
  const [filter, setFilter] = useState(savedGroup);
  const [q, setQ] = useState('');
  const linkCode = route.query.get('code');

  // Lien partagé par le club (…#/club?code=…) : déverrouillage direct, puis le code quitte l'adresse
  useEffect(() => {
    if (!linkCode) return;
    navigate('/club', { replace: true });
    if (!getState().settings.club || getState().settings.club?.expired) openClubCode(() => openFollowPicker(), linkCode);
  }, [linkCode]);

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

  const members = data.swimmers.filter((s) => s.member);
  const followedCount = members.filter(isFollowed).length;
  const years = memberYears(data.swimmers).filter(Boolean);
  const choices = [...(groups.length ? groups.map((g) => g.id) : years), ...(followedCount ? ['followed'] : [])];
  const active = filter === 'all' || choices.includes(filter) ? filter : 'all';
  const sections = useMemo(() => {
    if (active === 'followed') {
      const items = members.filter((s) => isFollowed(s) && matches(s, q)).sort(byYearName);
      return items.length ? [{ id: 'followed', title: 'Suivis', items }] : [];
    }
    return clubSections(members, groups, active, q).filter((s) => s.id !== 'others');
  }, [data.swimmers, groups, active, q]);
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
            <BrandLogo height={96} />
            <h2>Les nageurs de l’ESN</h2>
            <p className="muted">
              Retrouvez tous les nageurs du club et leurs résultats de compétition. La liste est réservée aux membres :
              elle s’ouvre avec le code donné par le club.
            </p>
            {available ? (
              <button className="btn" onClick={() => openClubCode(() => openFollowPicker())}>
                <Icon name="shield" /> Entrer le code du club
              </button>
            ) : (
              <p className="small muted">La liste des membres n’est pas encore disponible.</p>
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
        subtitle={clubSummary(groups, members)}
        back="/"
      />
      <main className="page">
        {club.expired && (
          <div className="callout" style={{ marginTop: 8 }}>
            <Icon name="info" />
            <div>
              Le club a publié une nouvelle liste avec un nouveau code.{' '}
              <button className="link-btn" onClick={() => openClubCode()}>
                Entrer le nouveau code
              </button>
            </div>
          </div>
        )}
        <div className="chips" style={{ marginTop: 8 }} role="group" aria-label={groups.length ? 'Groupe' : 'Année de naissance'}>
          {['all', ...(followedCount ? ['followed'] : []), ...(groups.length ? groups.map((g) => g.id) : years)].map((v) => (
            <button key={v} className={`chip${active === v ? ' active' : ''}`} aria-pressed={active === v} onClick={() => choose(v)}>
              {v === 'all' ? (groups.length ? 'Tous' : 'Toutes les années') : v === 'followed' ? (
                <>
                  <Icon name="heartFill" style={{ width: 13, height: 13, color: '#ff375f' }} /> Suivis
                  <span className="count">{followedCount}</span>
                </>
              ) : (
                groupName(groups, v) ?? v
              )}
            </button>
          ))}
        </div>
        <div className="section-foot" style={{ margin: '8px 4px 0' }}>
          Touchez le cœur d’un nageur pour le suivre : il apparaît sur l’accueil.
        </div>
        <div style={{ marginTop: 10 }}>
          <SearchField value={q} onChange={setQ} label="Rechercher un nageur" />
        </div>
        <SyncBanner />
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
                  groups.length ? sw.birthYear : null, // sans groupes, l'année est déjà le titre de la section
                  st?.count
                    ? `${st.count}\u00a0course${st.count > 1 ? 's' : ''}`
                    : st?.planned
                      ? `${st.planned}\u00a0épreuve${st.planned > 1 ? 's' : ''} au programme, résultats en attente`
                      : 'Pas encore de résultat',
                  st?.last ? `dernière le ${formatDate(st.last)}` : null,
                ].filter(Boolean);
                return (
                  <div key={sw.id} className="row club-row">
                    <button className="club-row-main" onClick={() => navigate(`/swimmer/${sw.id}`)}>
                      <Avatar swimmer={sw} size={38} />
                      <div className="row-body">
                        <div className="row-title" style={isFollowed(sw) ? { fontWeight: 600 } : undefined}>
                          {fullName(sw)}
                        </div>
                        <div className="row-sub">{sub.join(' · ')}</div>
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
          Liste du club du {formatDate(club.updated)} · réservée aux membres (code du club).
          <br />
          Les résultats de compétition de chaque nageur sont ajoutés automatiquement.
        </div>
      </main>
    </>
  );
}
