import { afterEach, describe, expect, it, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { lenexTime, parseLenex, unzipFirst } from '../src/lib/lenex';
import { parseLiveDates, parseMeetList } from '../src/lib/liveResults';

// LENEX fictif (même structure que les fichiers publiés par Splash Meet Manager)
const LEF = `<?xml version="1.0" encoding="UTF-8"?>
<LENEX version="3.0">
  <MEETS>
    <MEET city="Liège" name="Meeting d&apos;automne " course="SCM" nation="BEL" organizer="Club Exemple" result.url="https://live.swimrankings.net/1/">
      <SESSIONS>
        <SESSION date="2026-10-10" daytime="09:00" number="1">
          <EVENTS>
            <EVENT eventid="11" daytime="09:41" gender="F" number="3" round="TIM">
              <SWIMSTYLE distance="400" relaycount="1" stroke="FREE" />
              <AGEGROUPS>
                <AGEGROUP agegroupid="111" agemax="-1" agemin="-1"><RANKINGS><RANKING order="1" place="30" resultid="501" /></RANKINGS></AGEGROUP>
                <AGEGROUP agegroupid="112" agemax="12" agemin="11"><RANKINGS><RANKING order="1" place="11" resultid="501" /></RANKINGS></AGEGROUP>
              </AGEGROUPS>
              <HEATS><HEAT heatid="901" number="1" /></HEATS>
            </EVENT>
            <EVENT eventid="12" daytime="10:30" gender="F" number="5" round="TIM">
              <SWIMSTYLE distance="50" relaycount="4" stroke="FREE" />
            </EVENT>
          </EVENTS>
        </SESSION>
        <SESSION date="2026-10-11" daytime="09:00" number="2">
          <EVENTS>
            <EVENT eventid="13" daytime="11:08" gender="F" number="27" round="PRE">
              <SWIMSTYLE distance="100" relaycount="1" stroke="FREE" />
              <HEATS><HEAT heatid="902" number="2" /></HEATS>
            </EVENT>
            <EVENT eventid="14" daytime="12:06" gender="F" number="33" round="PRE">
              <SWIMSTYLE distance="100" relaycount="1" stroke="BACK" />
            </EVENT>
          </EVENTS>
        </SESSION>
      </SESSIONS>
      <CLUBS>
        <CLUB name="Club Exemple Natation" code="CEN">
          <ATHLETES>
            <ATHLETE firstname="Emma" lastname="Dupont" birthdate="2015-06-26" gender="F" license="CEN/123/15" swrid="1234567">
              <RESULTS>
                <RESULT eventid="11" points="206" swimtime="00:06:29.33" resultid="501" heatid="901" lane="4" entrytime="00:06:40.00" />
                <RESULT eventid="13" points="205" swimtime="00:01:24.62" resultid="502" heatid="902" lane="2">
                  <SPLITS><SPLIT distance="50" swimtime="00:00:40.11" /></SPLITS>
                </RESULT>
                <RESULT comment="6.4.c - Ne pas toucher le mur lors du virage" eventid="14" status="DSQ" swimtime="00:01:41.32" resultid="503" />
                <RESULT eventid="12" swimtime="00:00:35.00" resultid="504" />
                <RESULT eventid="13" status="WDR" swimtime="NT" resultid="505" />
              </RESULTS>
            </ATHLETE>
          </ATHLETES>
        </CLUB>
      </CLUBS>
    </MEET>
  </MEETS>
</LENEX>`;

/** Archive zip minimale (un fichier compressé « deflate »). */
function zip(name: string, content: string): ArrayBuffer {
  const data = Buffer.from(content, 'utf8');
  const comp = deflateRawSync(data);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(n.length, 28);
  cd.writeUInt32LE(0, 42);
  const cdOffset = local.length + n.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length + n.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  const all = Buffer.concat([local, n, comp, cd, n, eocd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

describe('LENEX', () => {
  it('lit les temps', () => {
    expect(lenexTime('00:01:24.62')).toBe(8462);
    expect(lenexTime('NT')).toBeNull();
  });

  it('lit la compétition, les épreuves, places, passages et disqualifications', async () => {
    const xml = await unzipFirst(zip('results.lef', LEF));
    const r = parseLenex(xml)!;
    expect(r.meet).toMatchObject({ name: "Meeting d'automne", city: 'Liège', course: 'SCM', startDate: '2026-10-10', endDate: '2026-10-11' });
    expect(r.athletes).toHaveLength(1);
    const a = r.athletes[0];
    expect(a).toMatchObject({ firstName: 'Emma', lastName: 'Dupont', birthYear: 2015, gender: 'F', club: 'Club Exemple Natation', swrid: '1234567' });
    // relais et forfait (WDR) ignorés
    expect(a.swims).toHaveLength(3);
    expect(a.swims[0]).toMatchObject({ eventNo: 3, distance: 400, stroke: 'FREE', date: '2026-10-10', startTime: '09:41', timeCs: 38933, points: 206, place: 11, heat: 1, lane: 4, entryCs: 40000, round: 'TIM' });
    expect(a.swims[1]).toMatchObject({ eventNo: 27, round: 'HEAT', date: '2026-10-11', timeCs: 8462, splits: [4011], heat: 2 });
    expect(a.swims[2]).toMatchObject({ stroke: 'BACK', status: 'DSQ', timeCs: 10132, comment: '6.4.c - Ne pas toucher le mur lors du virage' });
  });
});

// Disqualification et forfait avec un temps nul (« 00:00:00.00 ») ou sans temps, comme dans certains fichiers Splash
const LEF_ZERO = `<?xml version="1.0" encoding="UTF-8"?>
<LENEX version="3.0">
  <MEETS>
    <MEET city="Ville Fictive" name="Challenge fictif" course="SCM" nation="BEL">
      <SESSIONS>
        <SESSION date="2026-10-11" daytime="09:00" number="1">
          <EVENTS>
            <EVENT eventid="21" daytime="09:30" gender="F" number="8" round="TIM"><SWIMSTYLE distance="100" relaycount="1" stroke="BACK" /></EVENT>
            <EVENT eventid="22" daytime="10:15" gender="F" number="12" round="TIM"><SWIMSTYLE distance="50" relaycount="1" stroke="FLY" /></EVENT>
            <EVENT eventid="23" daytime="11:00" gender="F" number="16" round="TIM"><SWIMSTYLE distance="200" relaycount="1" stroke="FREE" /></EVENT>
            <EVENT eventid="24" daytime="11:40" gender="F" number="20" round="TIM"><SWIMSTYLE distance="100" relaycount="1" stroke="BREAST" /></EVENT>
          </EVENTS>
        </SESSION>
      </SESSIONS>
      <CLUBS>
        <CLUB name="Club Exemple Natation" code="CEN">
          <ATHLETES>
            <ATHLETE firstname="Zoé" lastname="Exemple" birthdate="2014-03-02" gender="F">
              <RESULTS>
                <RESULT comment="SW 6.5 - Nage sur le ventre" eventid="21" status="DSQ" swimtime="00:00:00.00" resultid="601" entrytime="00:00:00.00">
                  <SPLITS><SPLIT distance="50" swimtime="00:00:00.00" /></SPLITS>
                </RESULT>
                <RESULT eventid="22" status="DNS" swimtime="00:00:00.00" resultid="602" />
                <RESULT eventid="23" status="DSQ" resultid="603" />
                <RESULT eventid="24" swimtime="00:00:00.00" resultid="604" />
              </RESULTS>
            </ATHLETE>
          </ATHLETES>
        </CLUB>
      </CLUBS>
    </MEET>
  </MEETS>
</LENEX>`;

/** localStorage minimal (les tests tournent sous Node). */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('LENEX : disqualification ou forfait au temps nul', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('un temps « 00:00:00.00 » n’est pas un temps', () => {
    expect(lenexTime('00:00:00.00')).toBeNull();
    expect(lenexTime('00:00:00.01')).toBe(1);
  });

  it('la disqualification et le forfait restent, sans temps ; une course nagée au temps nul est ignorée', () => {
    const swims = parseLenex(LEF_ZERO)!.athletes[0].swims;
    expect(swims.map((s) => `${s.distance}${s.stroke}:${s.status}:${s.timeCs}`)).toEqual([
      '100BACK:DSQ:undefined',
      '50FLY:DNS:undefined',
      '200FREE:DSQ:undefined',
    ]);
    expect(swims[0]).toMatchObject({ comment: 'SW 6.5 - Nage sur le ventre', splits: undefined, entryCs: undefined });
  });

  it('direct : la disqualification enregistrée sans temps, une seule fois, et le « 0 » déjà gardé effacé', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('indexedDB', undefined);
    // Téléphone : la disqualification lue par une ancienne version, avec un temps 0
    localStorage.setItem(
      'nageo:data:v1',
      JSON.stringify({
        version: 1,
        swimmers: [{ id: 'z', firstName: 'Zoé', lastName: 'Exemple', gender: 'F', birthYear: 2014, relation: 'followed', color: 0, favorite: false, createdAt: 1 }],
        meets: [{ id: 'm', name: 'Challenge fictif', city: 'Ville Fictive', startDate: '2026-10-11', course: 'SCM', createdAt: 1 }],
        swims: [
          { id: 'old', swimmerId: 'z', meetId: 'm', context: 'competition', date: '2026-10-11', distance: 100, stroke: 'BACK', course: 'SCM', timeCs: 0, status: 'DSQ', round: 'TIM', eventNo: 8, source: 'live', createdAt: 1, updatedAt: 1 },
          { id: 'plan', swimmerId: 'z', meetId: 'm', context: 'competition', date: '2026-10-11', distance: 200, stroke: 'FREE', course: 'SCM', timeCs: null, status: 'OK', round: 'TIM', eventNo: 16, source: 'live', createdAt: 1, updatedAt: 1 },
        ],
        goals: [],
        settings: {},
      }),
    );
    vi.resetModules();
    const store = await import('../src/store/store');
    expect(store.getState().swims.find((s) => s.id === 'old')).toMatchObject({ status: 'DSQ', timeCs: null });

    const l = parseLenex(LEF_ZERO)!;
    const r = store.actions.importClubResults('z', [{ meet: l.meet, source: 'live', swims: l.athletes[0].swims }]);
    const mine = store.getState().swims.filter((s) => s.swimmerId === 'z');
    // 100 m dos : déjà là ; 50 m papillon : forfait ajouté ; 200 m libre : le programme devient la disqualification
    expect(r.added).toBe(2);
    expect(mine.map((s) => `${s.distance}${s.stroke}:${s.status}:${s.timeCs}`).sort()).toEqual([
      '100BACK:DSQ:null',
      '200FREE:DSQ:null',
      '50FLY:DNS:null',
    ]);
    expect(mine.some((s) => s.timeCs === 0)).toBe(false);
  });

  it('direct : une course lue « nagée » puis disqualifiée sans temps dans le fichier est corrigée, pas doublée', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('indexedDB', undefined);
    const swim = (id: string, distance: number, stroke: string, eventNo: number, timeCs: number, status: string, place?: number) => ({
      id, swimmerId: 'z', meetId: 'm', context: 'competition', date: '2026-10-11', distance, stroke, course: 'SCM',
      timeCs, status, place, round: 'TIM', eventNo, source: 'live', createdAt: 1, updatedAt: 1,
    });
    localStorage.setItem(
      'nageo:data:v1',
      JSON.stringify({
        version: 1,
        swimmers: [{ id: 'z', firstName: 'Zoé', lastName: 'Exemple', gender: 'F', birthYear: 2014, relation: 'followed', color: 0, favorite: false, createdAt: 1 }],
        meets: [{ id: 'm', name: 'Challenge fictif', city: 'Ville Fictive', startDate: '2026-10-11', course: 'SCM', liveId: '777', createdAt: 1 }],
        // Feuille PDF lue avant le fichier : 100 m dos « nagé » (temps, place) ; 200 m libre déjà disqualifié avec son temps
        swims: [swim('dos', 100, 'BACK', 8, 9012, 'OK', 4), swim('libre', 200, 'FREE', 16, 15034, 'DSQ')],
        goals: [],
        settings: {},
      }),
    );
    vi.resetModules();
    const store = await import('../src/store/store');
    const l = parseLenex(LEF_ZERO)!;
    const r = store.actions.importClubResults('z', [{ meet: { ...l.meet, liveId: '777' }, source: 'live', swims: l.athletes[0].swims }]);
    const mine = store.getState().swims.filter((s) => s.swimmerId === 'z');
    expect(r.added).toBe(1); // le forfait du 50 m papillon
    expect(mine.map((s) => `${s.distance}${s.stroke}:${s.status}:${s.timeCs}`).sort()).toEqual([
      '100BACK:DSQ:null',
      '200FREE:DSQ:15034',
      '50FLY:DNS:null',
    ]);
    expect(mine.find((s) => s.id === 'dos')?.place).toBeUndefined();
  });
});

describe('liste des compétitions en direct', () => {
  it('lit les dates', () => {
    expect(parseLiveDates('13 - 15 Nov 2026')).toEqual({ start: '2026-11-13', end: '2026-11-15' });
    expect(parseLiveDates('31 Oct - 1 Nov 2026')).toEqual({ start: '2026-10-31', end: '2026-11-01' });
    expect(parseLiveDates('8 Nov 2026')).toEqual({ start: '2026-11-08' });
    expect(parseLiveDates('30 Dec 2026 - 2 Jan 2027')).toEqual({ start: '2026-12-30', end: '2027-01-02' });
  });

  it('lit les lignes du tableau', () => {
    const html = `<tbody><tr class="group"><th colspan="5">This week</th></tr><tr class="live"><td class="tdStatus"><a href="/123/"><span class="badge badge-live" title="Live">Live</span></a></td><td class="tdDate"><a href="/123/"><span class="dateLong"> 13 - 15 Nov 2026</span><span class="dateShort">x</span></a></td><td class="tdCourse"><a href="/123/"><span class="course">25m</span></a></td><td class="tdName"><a href="/123/"><span class="name">Meeting d&#39;automne</span><span class="meta">Liège</span></a></td><td class="tdCity"><a href="/123/"><span class="flag">🇧🇪</span>4000 Liège <span class="nation">BEL</span></a></td></tr>
<tr class=""><td class="tdStatus"><a href="/99/"><span class="badge badge-finished">Finished</span></a></td><td class="tdDate"><a href="/99/"><span class="dateLong"> 8 Nov 2026</span></a></td><td class="tdCourse"><a href="/99/"><span class="course">50m</span></a></td><td class="tdName"><a href="/99/"><span class="name">Open de Namur</span></a></td><td class="tdCity"><a href="/99/">Namur <span class="nation">BEL</span></a></td></tr></tbody>`;
    expect(parseMeetList(html)).toEqual([
      { id: '123', status: 'live', name: "Meeting d'automne", city: 'Liège', course: 'SCM', startDate: '2026-11-13', endDate: '2026-11-15' },
      { id: '99', status: 'finished', name: 'Open de Namur', city: 'Namur', course: 'LCM', startDate: '2026-11-08', endDate: undefined },
    ]);
  });
});
