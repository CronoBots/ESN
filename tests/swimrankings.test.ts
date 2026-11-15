import { describe, expect, it } from 'vitest';
import { extractAthleteId, parseSwimrankings, bookmarkletCode } from '../src/lib/swimrankings';

// Texte tel que copié depuis la page « Meilleurs temps » (navigateur de bureau, cellules séparées par des tabulations)
const DESKTOP_COPY = `Accueil
SplashMe
Nageurs
Recherche
Meilleurs 50 athlètes (courant)
Meilleurs 100 hommes (courant)
DUPONT, Emma
(2015 )
BEL - Belgique
Ecole Seraing Natation
Meilleurs temps	Records	Compétitions	Biographie	swimstats
Meilleurs temps: 	Meilleurs à vie	Classements personnels: 	Sélectionner...
Meilleurs temps, Meilleurs à vie
Compétition	Bassin	Temps	Pts.	Date	Ville (Pays)	Compétition
100m Libre	25m	1:24.62	205	11 oct 2026	Liège	Marie Petit & Challenge Jules ...
400m Libre	25m	6:29.33	206	10 oct 2026	Liège	Marie Petit & Challenge Jules ...
100m Brasse	25m	1:56.61	152	10 oct 2026	Liège	Marie Petit & Challenge Jules ...
Records
Classements
We use cookies to analyze traffic to our website`;

// Copie sur mobile : une cellule par ligne
const MOBILE_COPY = `DUPONT, Emma (2015)
BEL - Ecole Seraing Natation
50m Dos
25m
45.12
180
14 nov. 2026
Crisnée
Meeting Liège Natation Invite
100m 4 nages
25m
1:38.20
-
14 nov. 2026
Crisnée
Meeting Liège Natation Invite`;

describe('parseSwimrankings', () => {
  it('lit le tableau des meilleurs temps (copie bureau)', () => {
    const r = parseSwimrankings(DESKTOP_COPY);
    expect(r.athlete).toMatchObject({
      lastName: 'Dupont',
      firstName: 'Emma',
      birthYear: 2015,
      nation: 'BEL',
      club: 'Ecole Seraing Natation',
    });
    expect(r.swims).toHaveLength(3);
    const free100 = r.swims.find((s) => s.distance === 100 && s.stroke === 'FREE')!;
    expect(free100).toMatchObject({
      course: 'SCM',
      timeCs: 8462,
      points: 205,
      date: '2026-10-11',
      city: 'Liège',
      meet: 'Marie Petit & Challenge Jules',
    });
    const free400 = r.swims.find((s) => s.distance === 400)!;
    expect(free400.timeCs).toBe(38933);
    const breast = r.swims.find((s) => s.stroke === 'BREAST')!;
    expect(breast).toMatchObject({ timeCs: 11661, points: 152, date: '2026-10-10' });
  });

  it('lit une copie « une cellule par ligne » (mobile)', () => {
    const r = parseSwimrankings(MOBILE_COPY);
    expect(r.athlete).toMatchObject({ lastName: 'Dupont', firstName: 'Emma', birthYear: 2015, club: 'Ecole Seraing Natation' });
    expect(r.swims).toHaveLength(2);
    expect(r.swims[0]).toMatchObject({ distance: 50, stroke: 'BACK', timeCs: 4512, points: 180, city: 'Crisnée' });
    expect(r.swims[1]).toMatchObject({ distance: 100, stroke: 'IM', timeCs: 9820, meet: 'Meeting Liège Natation Invite' });
  });

  it("lit l'historique d'une épreuve (épreuve en en-tête, plusieurs lignes)", () => {
    const text = `100m Libre (25m)
Temps	Pts.	Date	Ville	Compétition
1:24.62	205	11 oct 2026	Liège	Marie Petit
1:29.10	176	15 Mar 2026	Seraing	Championnat provincial
1:35.44	143	07.12.2025	Huy (BEL)	Critérium d'hiver`;
    const r = parseSwimrankings(text);
    expect(r.swims).toHaveLength(3);
    expect(r.swims.every((s) => s.distance === 100 && s.stroke === 'FREE' && s.course === 'SCM')).toBe(true);
    expect(r.swims.map((s) => s.date)).toEqual(['2025-12-07', '2026-03-15', '2026-10-11']);
    expect(r.swims[0].city).toBe('Huy (BEL)');
  });

  it('accepte les noms anglais / néerlandais et ignore les relais', () => {
    const text = `50m Freestyle	50m	33.10	310	3 Jul 2026	Antwerpen (BEL)	Zomermeeting
4x50m Freestyle	25m	2:30.00	-	3 Jul 2026	Antwerpen	Relay
200m Wisselslag	25m	3:05.33	190	4 Jul 2026	Antwerpen	Zomermeeting`;
    const r = parseSwimrankings(text);
    expect(r.swims).toHaveLength(2);
    expect(r.swims[0]).toMatchObject({ distance: 50, stroke: 'FREE', course: 'LCM', timeCs: 3310 });
    expect(r.swims[1]).toMatchObject({ distance: 200, stroke: 'IM', timeCs: 18533 });
  });

  it('supprime les doublons', () => {
    const r = parseSwimrankings(DESKTOP_COPY + '\n' + DESKTOP_COPY);
    expect(r.swims).toHaveLength(3);
  });

  it('lit les métadonnées du bouton-favori', () => {
    const r = parseSwimrankings(
      `@@URL:https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=1234567&athletePage=PBEST\n@@GENDER:F\n${DESKTOP_COPY}`,
    );
    expect(r.athlete.swimrankingsId).toBe('1234567');
    expect(r.athlete.gender).toBe('F');
  });
});

describe('extractAthleteId', () => {
  it('extrait l’identifiant', () => {
    expect(
      extractAthleteId('https://www.swimrankings.net/index.php?page=athleteDetail&athleteId=1234567&athletePage=PBEST'),
    ).toBe('1234567');
    expect(extractAthleteId('1234567')).toBe('1234567');
    expect(extractAthleteId('bonjour')).toBeNull();
  });
});

describe('bookmarkletCode', () => {
  it('produit un javascript: valide', () => {
    const code = bookmarkletCode('https://exemple.org/nageo/');
    expect(code.startsWith('javascript:')).toBe(true);
    const js = decodeURIComponent(code.slice('javascript:'.length));
    expect(() => new Function(js)).not.toThrow();
  });
});
