import { describe, expect, it } from 'vitest';
import {
  decryptRoster,
  encryptRoster,
  generateCode,
  memberKey,
  normalizeCode,
  parseRosterCsv,
  validateRoster,
  WrongCodeError,
} from '../src/lib/roster';

const CSV = `Groupe;Nom;Prénom;Année;Sexe
A;DUPONT;Emma;2012;F
Groupe B;MARTIN;Lucas;2011;garçon
c;Lambert;Chloé;2016;f
A;DUPONT;Emma;2012;F`;

describe('liste des membres', () => {
  it('lit une liste au format tableur', () => {
    const roster = validateRoster({ members: parseRosterCsv(CSV) });
    expect(roster.members).toHaveLength(3); // doublon ignoré
    expect(roster.members[1]).toEqual({ lastName: 'MARTIN', firstName: 'Lucas', birthYear: 2011, gender: 'M', group: 'B' });
    expect(roster.groups.map((g) => g.name)).toEqual(['Groupe A', 'Groupe B', 'Groupe C']);
  });

  it('refuse un membre sans sexe ; le groupe est facultatif', () => {
    expect(() => validateRoster({ members: parseRosterCsv('A;DUPONT;Emma;2012;') })).toThrow(/Sexe/);
    const r = validateRoster({ members: parseRosterCsv(';DUPONT;Emma;2012;F') });
    expect(r.members[0].group).toBeUndefined();
    expect(r.groups).toEqual([]);
  });

  it('chiffre et déchiffre avec le code du club', async () => {
    const roster = validateRoster({ members: parseRosterCsv(CSV) });
    const enc = await encryptRoster(roster, 'ESN-7KQ4-M2XP', 1000);
    expect(JSON.stringify(enc)).not.toMatch(/DUPONT|Emma/);
    // casse, espaces, tirets et préfixe « ESN » ignorés
    await expect(decryptRoster(enc, 'esn 7kq4 m2xp')).resolves.toEqual(roster);
    await expect(decryptRoster(enc, '7KQ4M2XP')).resolves.toEqual(roster);
    await expect(decryptRoster(enc, 'ESN-7KQ4-M2XQ')).rejects.toBeInstanceOf(WrongCodeError);
  });

  it('génère des codes lisibles', () => {
    const code = generateCode();
    expect(code).toMatch(/^ESN-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(code.slice(4)).not.toMatch(/[01ILO]/);
    expect(normalizeCode(code)).toHaveLength(8);
  });

  it('reconnaît un membre malgré accents et majuscules', () => {
    expect(memberKey({ lastName: 'Lambert', firstName: 'Chloé', birthYear: 2016 })).toBe(
      memberKey({ lastName: 'LAMBERT', firstName: 'Chloe', birthYear: 2016 }),
    );
  });
});

describe('liste du club dans l’application', async () => {
  const { actions, getState } = await import('../src/store/store');
  const roster = (members: string) => validateRoster({ updated: '2026-11-15', members: parseRosterCsv(members) });

  it('ajoute les membres, garde l’enfant déjà saisi et met à jour les groupes', () => {
    actions.resetAll();
    const kid = actions.addSwimmer({ firstName: 'Emma', lastName: 'Dupont', gender: 'F', birthYear: 2012, relation: 'child' });
    const r = actions.applyRoster(roster('A;DUPONT;Emma;2012;F\nB;MARTIN;Lucas;2011;M\nC;CLAES;Zoé;2016;F'), 'ESN-TEST', 'v1');
    expect(r).toEqual({ added: 2, total: 3 });
    const s = getState();
    expect(s.swimmers).toHaveLength(3);
    expect(s.swimmers.find((x) => x.id === kid.id)).toMatchObject({ group: 'A', member: true, relation: 'child' });
    expect(s.settings.club).toMatchObject({ code: 'ESN-TEST', version: 'v1', count: 3 });

    // Nouvelle liste : Lucas change de groupe, Zoé n'est plus au club (sans résultat → retirée)
    actions.applyRoster(roster('A;DUPONT;Emma;2012;F\nA;MARTIN;Lucas;2011;M'), 'ESN-TEST', 'v2');
    const names = getState().swimmers.map((x) => `${x.firstName}:${x.group}`);
    expect(names).toEqual(['Emma:A', 'Lucas:A']);
  });

  it('garde les anciens membres à part', async () => {
    const { isActiveMember, isFormerMember } = await import('../src/store/hooks');
    const list = roster(';DUPONT;Emma;2012;F\n;MARTIN;Lucas;2011;M\n;PIRET;Julie;1998;F;ancien');
    expect(list.members.map((m) => m.former ?? false)).toEqual([false, false, true]);
    // Une liste publiée avant cette version (sans statut) reste lisible
    expect(roster(';DUPONT;Emma;2012;F').members[0]).not.toHaveProperty('former');

    actions.applyRoster(list, 'ESN-TEST', 'v3');
    const julie = getState().swimmers.find((x) => x.firstName === 'Julie')!;
    expect(julie).toMatchObject({ member: true, former: true });
    expect(isFormerMember(julie)).toBe(true);
    expect(getState().swimmers.filter(isActiveMember).map((x) => x.firstName)).toEqual(['Emma', 'Lucas']);

    // Elle revient au club : la liste suivante la remet parmi les membres actifs
    actions.applyRoster(roster(';DUPONT;Emma;2012;F\n;MARTIN;Lucas;2011;M\n;PIRET;Julie;1998;F'), 'ESN-TEST', 'v4');
    expect(isActiveMember(getState().swimmers.find((x) => x.firstName === 'Julie')!)).toBe(true);

    // Retour à la liste des tests suivants
    actions.applyRoster(roster('A;DUPONT;Emma;2012;F\nA;MARTIN;Lucas;2011;M'), 'ESN-TEST', 'v5');
  });

  it('suit des nageurs choisis dans la liste', () => {
    const lucas = getState().swimmers.find((x) => x.firstName === 'Lucas')!;
    actions.setFollowed([lucas.id]);
    let s = getState();
    const followed = () => getState().swimmers.filter((x) => x.favorite || x.relation === 'child').map((x) => x.firstName);
    expect(followed()).toEqual(['Lucas']);
    expect(s.settings.selectedSwimmerId).toBe(lucas.id);
    const emma = s.swimmers.find((x) => x.firstName === 'Emma')!;
    actions.follow(emma.id, true);
    expect(followed()).toEqual(['Emma', 'Lucas']);
    actions.follow(lucas.id, false);
    s = getState();
    expect(followed()).toEqual(['Emma']);
    expect(s.settings.selectedSwimmerId).toBe(emma.id);
  });
});

describe('historique du club', () => {
  it('lit l’en-tête d’un texte d’import et le chiffre', async () => {
    const { historyHeader, encryptHistory, decryptHistory } = await import('../src/lib/roster');
    const text = '@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=1234567\n@@GENDER:F\nDUPONT, Emma (2014)\nBEL - Club\n100m Libre\t25m\t1:31.08\t171\t11 oct 2025\tLiège\tMeeting';
    expect(historyHeader(text)).toEqual({ lastName: 'DUPONT', firstName: 'Emma', birthYear: 2014, swimrankingsId: '1234567' });
    const enc = await encryptHistory({ updated: '2026-11-16', athletes: [{ ...historyHeader(text)!, text }] }, 'ESN-7KQ4-M2XP', 1000);
    expect(enc.format).toBe('esn-history');
    expect(JSON.stringify(enc)).not.toMatch(/DUPONT|1:31/);
    expect((await decryptHistory(enc, 'esn 7kq4 m2xp')).athletes[0].text).toBe(text);
  });
});

describe('nouveaux nageurs du club trouvés en compétition', async () => {
  const { actions, getState } = await import('../src/store/store');
  const { splitName } = await import('../src/lib/heatSheet');

  it('lit les noms des feuilles', () => {
    expect(splitName('DUPONT, Hugo')).toEqual({ lastName: 'DUPONT', firstName: 'Hugo' });
    expect(splitName('VAN DEN BERG Léa')).toEqual({ lastName: 'VAN DEN BERG', firstName: 'Léa' });
    expect(splitName('Léa')).toBeNull();
  });

  it('les ajoute à la liste et les garde quand la liste publiée change', () => {
    actions.resetAll();
    actions.applyRoster(validateRoster({ updated: '2026-11-15', members: parseRosterCsv(';DUPONT;Emma;2012;F') }), 'ESN-TEST', 'v1');
    const added = actions.addClubSwimmers([
      { firstName: 'Emma', lastName: 'DUPONT', birthYear: 2012, gender: 'F' },
      { firstName: 'Hugo', lastName: 'MARTIN', birthYear: 2013, gender: 'M' },
    ]);
    expect(added.map((s) => s.firstName)).toEqual(['Hugo']);
    expect(getState().swimmers.find((s) => s.firstName === 'Hugo')).toMatchObject({ member: true, discovered: true });
    // Nouvelle liste publiée sans lui : il reste dans la liste du club
    actions.applyRoster(validateRoster({ updated: '2026-11-20', members: parseRosterCsv(';DUPONT;Emma;2012;F') }), 'ESN-TEST', 'v2');
    expect(getState().swimmers.find((s) => s.firstName === 'Hugo')).toMatchObject({ member: true });
    // Liste publiée avec lui : il devient un membre comme les autres
    actions.applyRoster(validateRoster({ updated: '2026-11-21', members: parseRosterCsv(';DUPONT;Emma;2012;F\n;MARTIN;Hugo;2013;M') }), 'ESN-TEST', 'v3');
    expect(getState().swimmers.filter((s) => s.firstName === 'Hugo')).toHaveLength(1);
    expect(getState().swimmers.find((s) => s.firstName === 'Hugo')).toMatchObject({ member: true, discovered: false });
  });
});

describe('même nageur à deux noms dans la liste du club', async () => {
  const { actions, getState } = await import('../src/store/store');
  const roster = (members: string) => validateRoster({ updated: '2026-11-17', members: parseRosterCsv(members) });
  const swim = (swimmerId: string, timeCs: number, date: string) =>
    actions.addSwim({ swimmerId, context: 'competition', date, distance: 50, stroke: 'FREE', course: 'SCM', timeCs, status: 'OK', round: 'TIM', source: 'swimrankings' });

  it('lit les autres noms du tableur', () => {
    const r = roster(';DUPONT;Emma;2001;F;ancien;DUPOND, Emma (2001) | DUPONT, Ema\n;MARTIN;Lucas;2011;M;;DUPONT, Emma (2001)');
    expect(r.members[0]).toMatchObject({ former: true, aliases: [{ lastName: 'DUPOND', firstName: 'Emma', birthYear: 2001 }, { lastName: 'DUPONT', firstName: 'Ema' }] });
    // Le nom d'un autre membre de la liste n'est pas un « autre nom »
    expect(r.members[1]).not.toHaveProperty('aliases');
  });

  it('réunit les deux fiches : courses sans doublon, objectifs, suivi et nageur affiché', () => {
    actions.resetAll();
    actions.applyRoster(roster(';MARTIN;Hugo;2001;M;ancien\n;MARTIN;Hugo;2000;M;ancien'), 'ESN-TEST', 'v1');
    const [main, dup] = getState().swimmers;
    expect(dup.birthYear).toBe(2000);
    swim(main.id, 3000, '2012-11-24');
    swim(dup.id, 3000, '2012-11-24'); // même course sur les deux fiches
    swim(dup.id, 3500, '2011-10-15');
    actions.addGoal({ swimmerId: dup.id, distance: 50, stroke: 'FREE', course: 'SCM', targetCs: 2900 });
    actions.follow(dup.id, true);
    expect(getState().settings.selectedSwimmerId).toBe(dup.id);

    actions.applyRoster(roster(';MARTIN;Hugo;2001;M;ancien;MARTIN, Hugo (2000)'), 'ESN-TEST', 'v2');
    const s = getState();
    expect(s.swimmers.map((x) => `${x.lastName} ${x.firstName} ${x.birthYear}`)).toEqual(['MARTIN Hugo 2001']);
    expect(s.swims.map((x) => `${x.swimmerId === main.id}:${x.timeCs}`).sort()).toEqual(['true:3000', 'true:3500']);
    expect(s.goals.map((g) => g.swimmerId)).toEqual([main.id]);
    expect(s.swimmers[0].favorite).toBe(true);
    expect(s.settings.selectedSwimmerId).toBe(main.id);
  });

  it('une seule fiche, à l’autre nom : elle prend le nom de la liste', () => {
    actions.resetAll();
    actions.applyRoster(roster(';CLAES;Zoé;2014;F;ancien'), 'ESN-TEST', 'v1');
    const old = getState().swimmers[0];
    swim(old.id, 4000, '2024-11-09');
    actions.applyRoster(roster(';CLAES;Zoë;2015;F;ancien;CLAES, Zoé (2014)'), 'ESN-TEST', 'v2');
    const s = getState();
    expect(s.swimmers).toHaveLength(1);
    expect(s.swimmers[0]).toMatchObject({ id: old.id, firstName: 'Zoë', birthYear: 2015, member: true, former: true });
    expect(s.swims).toHaveLength(1);
  });
});

describe('noms écrits autrement sur les feuilles', async () => {
  const { actions, getState } = await import('../src/store/store');
  it('ne crée pas de doublon pour une lettre d’écart', () => {
    actions.resetAll();
    actions.applyRoster(validateRoster({ updated: '2026-11-15', members: parseRosterCsv(';VERBRUGEN;Léa;2015;F') }), 'ESN-TEST', 'v1');
    expect(actions.addClubSwimmers([{ firstName: 'Léa', lastName: 'VERBRUGGEN', birthYear: 2015, gender: 'F' }])).toHaveLength(0);
    // Autre année de naissance : quelqu'un d'autre
    expect(actions.addClubSwimmers([{ firstName: 'Léa', lastName: 'VERBRUGGEN', birthYear: 2013, gender: 'F' }])).toHaveLength(1);
    expect(getState().swimmers).toHaveLength(2);
  });
});
