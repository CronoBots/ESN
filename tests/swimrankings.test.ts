import { describe, expect, it } from 'vitest';
import { extractAthleteId, parseSwimrankings } from '../src/lib/swimrankings';

// Texte tel que copié depuis la page « Meilleurs temps » (navigateur de bureau, cellules séparées par des tabulations)
const DESKTOP_COPY = `Accueil
SplashMe
Nageurs
Recherche
Meilleurs 50 athlètes (courant)
Meilleurs 100 hommes (courant)
DUPONT, Emma
(2014 )
BEL - Belgique
Club Exemple Natation
Meilleurs temps	Records	Compétitions	Biographie	swimstats
Meilleurs temps: 	Meilleurs à vie	Classements personnels: 	Sélectionner...
Meilleurs temps, Meilleurs à vie
Compétition	Bassin	Temps	Pts.	Date	Ville (Pays)	Compétition
100m Libre	25m	1:31.08	205	11 oct 2026	Liège	Meeting d’automne & Trophée des jeunes ...
400m Libre	25m	6:41.20	206	10 oct 2026	Liège	Meeting d’automne & Trophée des jeunes ...
100m Brasse	25m	1:49.95	152	10 oct 2026	Liège	Meeting d’automne & Trophée des jeunes ...
Records
Classements
We use cookies to analyze traffic to our website`;

// Copie sur mobile : une cellule par ligne
const MOBILE_COPY = `DUPONT, Emma (2014)
BEL - Club Exemple Natation
50m Dos
25m
45.12
180
14 nov. 2026
Namur
Meeting de Namur
100m 4 nages
25m
1:38.20
-
14 nov. 2026
Namur
Meeting de Namur`;

describe('parseSwimrankings', () => {
  it('lit le tableau des meilleurs temps (copie bureau)', () => {
    const r = parseSwimrankings(DESKTOP_COPY);
    expect(r.athlete).toMatchObject({
      lastName: 'Dupont',
      firstName: 'Emma',
      birthYear: 2014,
      nation: 'BEL',
      club: 'Club Exemple Natation',
    });
    expect(r.swims).toHaveLength(3);
    const free100 = r.swims.find((s) => s.distance === 100 && s.stroke === 'FREE')!;
    expect(free100).toMatchObject({
      course: 'SCM',
      timeCs: 9108,
      points: 205,
      date: '2026-10-11',
      city: 'Liège',
      meet: 'Meeting d’automne & Trophée des jeunes',
    });
    const free400 = r.swims.find((s) => s.distance === 400)!;
    expect(free400.timeCs).toBe(40120);
    const breast = r.swims.find((s) => s.stroke === 'BREAST')!;
    expect(breast).toMatchObject({ timeCs: 10995, points: 152, date: '2026-10-10' });
  });

  it('lit une copie « une cellule par ligne » (mobile)', () => {
    const r = parseSwimrankings(MOBILE_COPY);
    expect(r.athlete).toMatchObject({ lastName: 'Dupont', firstName: 'Emma', birthYear: 2014, club: 'Club Exemple Natation' });
    expect(r.swims).toHaveLength(2);
    expect(r.swims[0]).toMatchObject({ distance: 50, stroke: 'BACK', timeCs: 4512, points: 180, city: 'Namur' });
    expect(r.swims[1]).toMatchObject({ distance: 100, stroke: 'IM', timeCs: 9820, meet: 'Meeting de Namur' });
  });

  it("lit l'historique d'une épreuve (épreuve en en-tête, plusieurs lignes)", () => {
    const text = `100m Libre (25m)
Temps	Pts.	Date	Ville	Compétition
1:31.08	205	11 oct 2026	Liège	Coupe d’hiver
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

describe('capture d’écran (texte reconnu)', () => {
  it('lit le texte d’une capture avec le menu sur les mêmes lignes', () => {
    const ocr = `Accueil                                             DUPONT,  Emma
(2014)
SplashMe
BEL - Belgique
Records                                         Meilleurs temps, Meilleurs a vie
Classements                                   Compétition             Bassin        Temps         Pts.      Date                    Ville (Pays)          Compétition
Compétitions                              100m Libre             25m          1:31.08       205      11 oct 2026          Liège                Meeting d’automne & Trophée des jeunes …
.                                      400m Libre              25m           6:41.20       206      10 oct 2026          Liege                 Meeting d’automne & Trophée des jeunes ...
Calendrier
100m Brasse           25m           1:49.95       152      10 oct 2026          Liège                 Meeting d’automne & Trophée des jeunes …
50m Dos              25m         48.07        139     14 nov 2026        Namur            Meeting de Namur`;
    const r = parseSwimrankings(ocr);
    expect(r.athlete).toMatchObject({ lastName: 'Dupont', firstName: 'Emma', birthYear: 2014, nation: 'BEL' });
    expect(r.swims).toHaveLength(4);
    expect(r.swims.find((s) => s.stroke === 'BACK')).toMatchObject({ timeCs: 4807, points: 139, city: 'Namur', meet: 'Meeting de Namur' });
  });
});

describe('format d’import en colonnes', () => {
  it('garde les noms de compétition avec chiffres', () => {
    const r = parseSwimrankings(
      'DUPONT, Emma (2014)\n100m Libre\t25m\t1:31.08\t171\t11 oct 2025\tWaremme\t4e édition de la Dernière Chance\n50m Dos\t50m\t45.12\t180\t14 juin 2025\tNamur\tInterclubs U15',
    );
    expect(r.swims.map((s) => s.meet)).toEqual(['Interclubs U15', '4e édition de la Dernière Chance']);
    expect(r.swims.map((s) => s.city)).toEqual(['Namur', 'Waremme']);
  });

  it('lit les dates d’août abrégées « aoû » (swimrankings en français)', () => {
    const r = parseSwimrankings('DUPONT, Emma (1995)\n100m Brasse\t25m\t1:16.47\t542\t4 aoû 2009\tLiège\tMeeting d’été');
    expect(r.swims).toHaveLength(1);
    expect(r.swims[0]).toMatchObject({ date: '2009-08-04', timeCs: 7647, meet: 'Meeting d’été' });
  });
});
