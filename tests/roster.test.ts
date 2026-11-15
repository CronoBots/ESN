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

  it('refuse un membre sans sexe ou sans groupe', () => {
    expect(() => validateRoster({ members: parseRosterCsv('A;DUPONT;Emma;2012;') })).toThrow(/Sexe/);
    expect(() => validateRoster({ members: parseRosterCsv(';DUPONT;Emma;2012;F') })).toThrow(/Groupe/);
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

  it('choisit mes enfants parmi les membres', () => {
    const lucas = getState().swimmers.find((x) => x.firstName === 'Lucas')!;
    actions.setChildren([lucas.id]);
    const s = getState();
    expect(s.swimmers.filter((x) => x.relation === 'child').map((x) => x.firstName)).toEqual(['Lucas']);
    expect(s.settings.selectedSwimmerId).toBe(lucas.id);
  });
});
