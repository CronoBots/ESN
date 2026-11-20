import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error script Node sans types
import { activeEvents, eventKey, findLiveLink, findLiveLinks, liveBase, matchPublication, meetFiles, mirrorId, parseLnlCalendar, withLinks } from '../scripts/mirror-live.mjs';
import { isMirrored, liveUrl, listMirroredMeets, mergeMeetLists, pdfText, type LiveMeet } from '../src/lib/liveResults';
import { pdfLines } from '../src/lib/pdfText';

// Lecteur PDF remplacé : on compte les lectures
vi.mock('../src/lib/pdfText', () => ({ pdfLines: vi.fn(async () => ['Epreuve 1']) }));

const cal = {
  events: [
    { start: '2026-11-20', end: '2026-11-22', city: 'Bastogne', name: 'Championnats', live: 'https://resultats.example.be/CB-test26/' },
    { start: '2026-11-28', city: 'Ailleurs', name: 'Sans livetiming' },
  ],
};

describe('livetiming copié avec le site (hors live.swimrankings.net)', () => {
  it('copié de 2 jours avant à 14 jours après, seulement pour les compétitions qui ont un livetiming', () => {
    expect(activeEvents(cal, '2026-11-17')).toHaveLength(0);
    expect(activeEvents(cal, '2026-11-18')).toHaveLength(1);
    expect(activeEvents(cal, '2026-12-06')).toHaveLength(1);
    expect(activeEvents(cal, '2026-12-07')).toHaveLength(0);
    expect(activeEvents(cal, '2026-11-28').map((e: { city: string }) => e.city)).toEqual(['Bastogne']); // l'autre n'a pas de livetiming
  });

  it('identifiant et feuilles de la page Splash Meet Manager', () => {
    expect(mirrorId('https://resultats.example.be/CB-test26/')).toBe('ext-CB-test26');
    const html =
      '<a href="StartList_1.pdf">1</a><a href="ResultList_1.pdf">r</a><a href="StartList_1.pdf">1</a><a href="EntryStatistics.pdf">s</a>' +
      '<a href="ProgressionSummary.pdf">p</a><a href="results.lxf">l</a><a href="https://ailleurs.example/x.pdf">x</a><a href="../StartList_9.pdf">y</a>';
    expect(meetFiles(html).sort()).toEqual(['EntryStatistics.pdf', 'ResultList_1.pdf', 'StartList_1.pdf', 'results.lxf']);
  });

  it('chaque version d’une feuille copiée n’est téléchargée et lue qu’une fois', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      calls.push(u);
      return new Response(new Uint8Array([37, 80, 68, 70]));
    });
    const url = liveUrl('ext-CB-test26', 'ResultList_2.pdf');
    vi.mocked(pdfLines).mockClear();
    await pdfText(url, true, false, 'aaa');
    expect(calls).toEqual(['./live/ext-CB-test26/ResultList_2.pdf?v=aaa']);
    await pdfText(url, true, false, 'bbb'); // feuille republiée : nouvelle version
    expect(calls[1]).toBe('./live/ext-CB-test26/ResultList_2.pdf?v=bbb');
    expect(pdfLines).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('l’application lit la copie sur son propre site', () => {
    expect(isMirrored('ext-CB-test26')).toBe(true);
    expect(isMirrored('11570')).toBe(false);
    expect(liveUrl('ext-CB-test26')).toBe('./live/ext-CB-test26/index.html');
    expect(liveUrl('ext-CB-test26', 'StartList_3.pdf')).toBe('./live/ext-CB-test26/StartList_3.pdf');
    expect(liveUrl('11570', 'results.lxf')).toBe('https://live.swimrankings.net/11570/results.lxf');
  });

  it('état d’après les dates, et pas de doublon si la compétition paraît aussi sur live.swimrankings.net', async () => {
    const meet = { id: 'ext-CB-test26', name: 'Championnats Test 2026', city: 'Bastogne', course: 'SCM', startDate: '2026-11-20', endDate: '2026-11-22' };
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ meets: [meet] })));
    expect((await listMirroredMeets('2026-11-19'))[0].status).toBe('upcoming');
    expect((await listMirroredMeets('2026-11-21'))[0].status).toBe('live');
    const [m] = await listMirroredMeets('2026-11-23');
    expect(m.status).toBe('finished');
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    expect(await listMirroredMeets('2026-11-21')).toEqual([]);
    vi.unstubAllGlobals();
    const live: LiveMeet = { ...m, id: '12000', name: 'CHAMPIONNATS TEST 2026' };
    expect(mergeMeetLists([live], [m]).map((x) => x.id)).toEqual(['12000']);
    expect(mergeMeetLists([{ ...live, startDate: '2026-11-21' }], [m]).map((x) => x.id)).toEqual(['12000', 'ext-CB-test26']);
  });

  it('live.swimrankings.net : une feuille inchangée (même version) n’est pas relue', async () => {
    let etag = '"a-1"';
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([37, 80, 68, 70]), { headers: { etag } }));
    const url = 'https://live.example/9001/StartList_1.pdf';
    vi.mocked(pdfLines).mockClear();
    expect(await pdfText(url, true)).toBe('Epreuve 1');
    expect(await pdfText(url, true)).toBe('Epreuve 1');
    expect(pdfLines).toHaveBeenCalledTimes(1);
    etag = '"b-1"'; // feuille republiée (résultats)
    await pdfText(url, true);
    expect(pdfLines).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

/*
 * Liens de livetiming publiés par le district LNL (lnl.glprod.be) : pages fictives, construites comme
 * celles du site (calendrier du mois, page de la compétition avec le bouton « Résultats live »).
 */
const row = (n: number, name: string, tag: string, dates: string) =>
  `<article class="event-row"><div class="event-date"><strong>05</strong><span>Déc 2026</span></div><div class="event-content">` +
  `<span class="tag">${tag}</span><h2><a href="/publication/${n}/">${name}</a></h2><p>Lieu à préciser · ${dates}</p>` +
  `<a class="text-link" href="/publication/${n}/">Informations et documents ↗</a></div></article>`;
const month = (...rows: string[]) => `<html><body><div class="calendar-toolbar"><h2>décembre 2026</h2></div>${rows.join('')}</body></html>`;
const pubPage = (live?: string) =>
  `<html><body><a class="champ-button" href="#resultats">Résultats complets ↓</a>` +
  `<a href="https://resultats.glprod.be/Ancien-25/index.html">Résultats de l’an passé</a>` +
  `<a href="https://resultats.glprod.be/Fictif-26/ResultList_1.pdf">Épreuve 1</a>` +
  (live ? `<a class="champ-button" href="${live}" target="_blank" rel="noopener noreferrer">Résultats live ↗</a>` : '') +
  `<a href="https://www.ffbn.be/">FFBN</a></body></html>`;

describe('liens de livetiming du district LNL trouvés tout seuls', () => {
  const jeunes = { start: '2026-12-05', end: '2026-12-06', city: 'Bastogne', name: 'Championnats FFBN 25\u00a0m Jeunes' };
  const derniere = { start: '2026-12-12', end: '2026-12-13', city: 'Waremme', name: 'Dernière Chance' };

  it('lien publié par le district (…/index.html) : même copie que le dossier', () => {
    expect(liveBase('https://resultats.glprod.be/Fictif-26/index.html')).toBe('https://resultats.glprod.be/Fictif-26/');
    expect(liveBase('https://resultats.glprod.be/Fictif-26')).toBe('https://resultats.glprod.be/Fictif-26/');
    expect(liveBase('https://resultats.glprod.be/Fictif-26/')).toBe('https://resultats.glprod.be/Fictif-26/');
    expect(mirrorId('https://resultats.glprod.be/Fictif-26/index.html')).toBe('ext-Fictif-26');
  });

  it('calendrier du district : page, nom, organisateur et dates', () => {
    const html = month(
      row(16, 'Championnats FFBN 25 M Jeunes', 'Natation · FFBN', '05/12/2026 — 06/12/2026'),
      row(18, 'Meeting d&#39;hiver &amp; relais', 'Natation · Club fictif - WAREMME', '12/12/2026'),
      '<article class="event-row"><p>Sans lien</p></article>',
    );
    expect(parseLnlCalendar(html)).toEqual([
      { path: '/publication/16/', name: 'Championnats FFBN 25 M Jeunes', tag: 'Natation · FFBN', start: '2026-12-05', end: '2026-12-06' },
      { path: '/publication/18/', name: 'Meeting d’hiver & relais', tag: 'Natation · Club fictif - WAREMME', start: '2026-12-12', end: '2026-12-12' },
    ]);
  });

  it('compétition du district rattachée par les dates et le nom (ou la ville)', () => {
    const entries = parseLnlCalendar(
      month(
        row(15, 'Championnats FFBN 25 M 15 ans et +', 'Natation · FFBN', '28/11/2026 — 29/11/2026'),
        row(20, 'Meeting fictif de Spa', 'Natation · Club fictif - SPA', '05/12/2026'),
        row(16, 'Championnats FFBN 25 M Jeunes', 'Natation · FFBN', '05/12/2026 — 06/12/2026'),
        row(18, 'Meeting d’hiver', 'Natation · Club fictif - WAREMME', '12/12/2026 — 13/12/2026'),
      ),
    );
    expect(matchPublication(jeunes, entries)?.path).toBe('/publication/16/');
    expect(matchPublication(derniere, entries)?.path).toBe('/publication/18/'); // même ville
    // Dates qui ne se recouvrent pas, aucun mot en commun : rien
    expect(matchPublication({ ...jeunes, start: '2026-12-19', end: '2026-12-20' }, entries)).toBeNull();
    expect(matchPublication({ start: '2026-12-05', city: 'Ailleurs', name: 'Critérium d’automne' }, entries)).toBeNull();
    // Deux compétitions aussi proches l'une que l'autre : on ne devine pas
    const twice = parseLnlCalendar(month(row(21, 'Jeunes A', 'FFBN', '05/12/2026'), row(22, 'Jeunes B', 'FFBN', '05/12/2026')));
    expect(matchPublication(jeunes, twice)).toBeNull();
  });

  it('lien « Résultats live » de la page de la compétition, seulement vers une page de resultats.glprod.be', () => {
    expect(findLiveLink(pubPage('https://resultats.glprod.be/Fictif-26/index.html'))).toBe('https://resultats.glprod.be/Fictif-26/');
    // Pas encore publié : ni l'édition passée, ni une feuille PDF ; le livetiming d'un autre site n'est pas copié
    expect(findLiveLink(pubPage())).toBeNull();
    expect(findLiveLink(pubPage('https://resultats.glprod.be/Fictif-26/ResultList_1.pdf'))).toBeNull();
    expect(findLiveLink(pubPage('https://live.swimrankings.net/12345/'))).toBeNull();
  });

  it('recherche polie : de 7 jours avant au dernier jour, au plus toutes les 30 minutes, arrêtée une fois le lien trouvé', async () => {
    const calendar = { events: [jeunes, { start: '2026-12-05', city: 'Liège', name: 'Avec lien', live: 'https://resultats.glprod.be/Autre-26/' }] };
    let published = false;
    const calls: string[] = [];
    const fetchText = async (url: string) => {
      calls.push(url);
      if (url.includes('/calendrier/')) return month(row(16, 'Championnats FFBN 25 M Jeunes', 'Natation · FFBN', '05/12/2026 — 06/12/2026'));
      return pubPage(published ? 'https://resultats.glprod.be/Fictif-26/index.html' : undefined);
    };
    const state: Record<string, { checked: number; live?: string }> = {};
    const t0 = Date.UTC(2026, 10, 28, 9);
    const opts = (day: string, now: number) => ({ day, now, fetchText, pause: 0 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await findLiveLinks(calendar, state, opts('2026-11-27', t0))).toBe(false); // 8 jours avant
    expect(calls).toEqual([]);
    expect(await findLiveLinks(calendar, state, opts('2026-11-28', t0))).toBe(true);
    expect(calls).toEqual(['https://lnl.glprod.be/calendrier/?month=2026-12&view=list', 'https://lnl.glprod.be/publication/16/']);
    expect(state[eventKey(jeunes)]).toEqual({ checked: t0 });
    await findLiveLinks(calendar, state, opts('2026-11-28', t0 + 10 * 60000)); // 10 minutes plus tard : rien
    expect(calls).toHaveLength(2);
    published = true;
    await findLiveLinks(calendar, state, opts('2026-11-28', t0 + 31 * 60000));
    expect(calls).toHaveLength(4);
    expect(state[eventKey(jeunes)].live).toBe('https://resultats.glprod.be/Fictif-26/');
    await findLiveLinks(calendar, state, opts('2026-12-05', t0 + 7 * 86400000)); // trouvé : plus rien
    expect(calls).toHaveLength(4);

    // Copié comme un lien du calendrier, de 2 jours avant à 14 jours après
    const links = { [eventKey(jeunes)]: state[eventKey(jeunes)].live };
    expect(activeEvents(withLinks(calendar, links), '2026-12-02').map((e: { name: string }) => e.name)).toEqual([]);
    expect(activeEvents(withLinks(calendar, links), '2026-12-03').map((e: { live: string }) => e.live)).toEqual([
      'https://resultats.glprod.be/Fictif-26/',
      'https://resultats.glprod.be/Autre-26/',
    ]);
    // Lien d'un autre site : ignoré
    expect(withLinks(calendar, { [eventKey(jeunes)]: 'https://ailleurs.example/x/' }).events[0].live).toBeUndefined();
    // Compétition finie depuis plus de 14 jours : oubliée
    expect(await findLiveLinks(calendar, state, opts('2026-12-22', t0 + 30 * 86400000))).toBe(true);
    expect(state).toEqual({});
    expect(calls).toHaveLength(4);
    warn.mockRestore();
  });
});
