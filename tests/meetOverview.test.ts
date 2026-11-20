import { describe, expect, it } from 'vitest';
import { parseLenex } from '../src/lib/lenex';
import { medalTable, meetEventLabel } from '../src/lib/meetOverview';

// Compétition fictive : deux clubs, une épreuve classée par âge (11-12 et 13-14 ans) et un relais
const LEF = `<?xml version="1.0" encoding="UTF-8"?>
<LENEX version="3.0"><MEETS><MEET city="Liège" name="Meeting fictif" course="SCM" organizer="Club Exemple">
<SESSIONS><SESSION date="2026-11-13" daytime="15:30" number="1"><EVENTS>
<EVENT eventid="1" number="1" gender="F" round="TIM" daytime="15:30"><SWIMSTYLE distance="100" relaycount="1" stroke="FREE" />
<AGEGROUPS>
<AGEGROUP agegroupid="11" agemin="11" agemax="12"><RANKINGS><RANKING place="1" resultid="101" /><RANKING place="2" resultid="102" /><RANKING place="3" resultid="103" /></RANKINGS></AGEGROUP>
<AGEGROUP agegroupid="12" agemin="13" agemax="14"><RANKINGS><RANKING place="1" resultid="104" /></RANKINGS></AGEGROUP>
</AGEGROUPS></EVENT>
<EVENT eventid="2" number="2" gender="X" round="TIM" daytime="16:10"><SWIMSTYLE distance="50" relaycount="4" stroke="MEDLEY" />
<AGEGROUPS><AGEGROUP agegroupid="21" agemin="-1" agemax="-1"><RANKINGS><RANKING place="1" resultid="201" /></RANKINGS></AGEGROUP></AGEGROUPS></EVENT>
</EVENTS></SESSION></SESSIONS>
<CLUBS>
<CLUB name="Ecole Seraing Natation a.s.b.l." code="ESN"><ATHLETES>
<ATHLETE firstname="Emma" lastname="Dupont" birthdate="2014-01-01" gender="F"><RESULTS><RESULT eventid="1" resultid="101" swimtime="00:01:10.00" /></RESULTS></ATHLETE>
<ATHLETE firstname="Léa" lastname="Martin" birthdate="2012-01-01" gender="F"><RESULTS><RESULT eventid="1" resultid="104" swimtime="00:01:05.00" /></RESULTS></ATHLETE>
</ATHLETES>
<RELAYS><RELAY gender="X" number="1"><RESULTS><RESULT eventid="2" resultid="201" swimtime="00:02:20.00" /></RESULTS></RELAY></RELAYS></CLUB>
<CLUB name="Club Exemple Natation" code="CEN"><ATHLETES>
<ATHLETE firstname="Zoé" lastname="Durand" birthdate="2014-01-01" gender="F"><RESULTS><RESULT eventid="1" resultid="102" swimtime="00:01:11.00" /></RESULTS></ATHLETE>
<ATHLETE firstname="Chloé" lastname="Petit" birthdate="2014-01-01" gender="F"><RESULTS><RESULT eventid="1" resultid="103" swimtime="00:01:12.00" /></RESULTS></ATHLETE>
</ATHLETES></CLUB>
<CLUB name="Club Inscrit Sans Nageur" code="CISN" />
</CLUBS></MEET></MEETS></LENEX>`;

describe('vue d’ensemble d’une compétition (comme SplashMe)', () => {
  const o = parseLenex(LEF)!.overview!;

  it('compte tous les nageurs, clubs, courses et relais du fichier', () => {
    expect(o).toMatchObject({ organizer: 'Club Exemple', athletes: 4, clubs: 3, entries: 4, relayEntries: 1 });
    expect(o.events.map((e) => [e.no, e.time, e.relay])).toEqual([
      [1, '15:30', 1],
      [2, '16:10', 4],
    ]);
  });

  it('une médaille par place 1 à 3 de chaque classement par âge (relais compris)', () => {
    const t = medalTable(o);
    expect(t[0]).toMatchObject({ club: 'Ecole Seraing Natation a.s.b.l.', total: [3, 0, 0], women: [2, 0, 0] });
    expect(t[1]).toMatchObject({ club: 'Club Exemple Natation', total: [0, 1, 1] });
    expect(t).toHaveLength(2);
  });

  it('libellés d’épreuves', () => {
    expect(meetEventLabel(o.events[0])).toBe('Dames, 100 m Libre');
    expect(meetEventLabel(o.events[1])).toBe('Mixte, 4 × 50 m 4 nages');
  });
});
