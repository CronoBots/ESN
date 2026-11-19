import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { eventAsMeet, groupsLabel, groupsShort, isClubCompetitionDay, parseClubCalendar, publishedMeet, upcomingClubEvents } from '../src/lib/clubCalendar';
import { buildMeetCalendar } from '../src/lib/ics';
import type { Meet } from '../src/store/types';

const cal = parseClubCalendar(JSON.parse(readFileSync('public/data/club-calendar.json', 'utf8')))!;
const meet = (over: Partial<Meet>): Meet => ({ id: 'm', name: 'Compétition', startDate: '2026-01-01', course: 'SCM', createdAt: 0, ...over });

describe('calendrier du club', () => {
  it('lit le fichier publié : toutes les compétitions, dans l’ordre', () => {
    // 1re partie de la saison 2026-2027 (la suite s'ajoute quand le club la communique)
    expect(cal.events.length).toBeGreaterThanOrEqual(7);
    expect(cal.until >= '2026-12-31').toBe(true);
    expect(cal.events.map((e) => e.start)).toEqual([...cal.events.map((e) => e.start)].sort());
    expect(cal.events.every((e) => e.groups.every((g) => /^[ABC]$/.test(g)))).toBe(true);
  });

  it('après Crisnée, la prochaine compétition est à Bastogne (championnats de Belgique 11-16 ans)', () => {
    const next = upcomingClubEvents(cal, [], '2026-11-18').slice(0, 4);
    expect(next.map((e) => `${e.start} ${e.city}`)).toEqual(['2026-11-20 Bastogne', '2026-11-28 Bastogne', '2026-12-05 Bastogne', '2026-12-12 Waremme']);
  });

  it('jours de compétition du club (veille comprise) : recherche plus fréquente', () => {
    // Bastogne, 20-22 novembre
    expect(['2026-11-19', '2026-11-20', '2026-11-22'].map((d) => isClubCompetitionDay(cal, d))).toEqual([true, true, true]);
    expect(['2026-11-18', '2026-11-23'].map((d) => isClubCompetitionDay(cal, d))).toEqual([false, false]);
    expect(isClubCompetitionDay(null, '2026-11-20')).toBe(false);
  });

  it('une compétition publiée remplace son annonce (mêmes dates, même ville ou même nom)', () => {
    // Crisnée : publiée sous un autre nom par l'organisateur
    const crisnee = meet({ name: 'Meeting Liège Natation Invite', city: 'Crisnée', startDate: '2026-11-13', endDate: '2026-11-15' });
    expect(publishedMeet(cal.events.find((e) => e.city === 'Crisnée')!, [crisnee])).toBe(crisnee);
    // Championnats publiés avec le nom de la fédération, sans ville
    const bk = meet({ name: 'Championnat de Belgique 2026', startDate: '2026-11-20', endDate: '2026-11-22' });
    const bkEvent = cal.events.find((e) => e.start === '2026-11-20')!;
    expect(publishedMeet(bkEvent, [bk])).toBe(bk);
    expect(upcomingClubEvents(cal, [bk], '2026-11-18').slice(0, 3).map((e) => e.start)).toEqual(['2026-11-28', '2026-12-05', '2026-12-12']);
    // Autre compétition le même week-end ailleurs : l'annonce reste
    expect(publishedMeet(bkEvent, [meet({ name: 'Meeting de Gand', city: 'Gent', startDate: '2026-11-21' })])).toBeUndefined();
  });

  it('les mêmes compétitions pour tout le monde, sans tri par âge', () => {
    // La prochaine compétition du club est la même pour un nageur de 8, 12 ou 17 ans
    const now = upcomingClubEvents(cal, [], '2026-11-18');
    expect(now[0].start).toBe('2026-11-20');
    expect(cal.events.every((e) => !('minAge' in e) && !('maxAge' in e))).toBe(true);
  });

  it('libellés et export vers l’agenda', () => {
    expect(groupsLabel(['A'])).toBe('Groupe A');
    expect(groupsLabel(['A', 'B'])).toBe('Groupes A et B');
    expect(groupsLabel(['A', 'B', 'C'])).toBe('Groupes A, B et C');
    // Avec le prénom de l'entraîneur de chaque groupe, comme sur le calendrier du club
    expect(cal.groupNames).toMatchObject({ A: 'Guillaume', B: 'Emilie', C: 'Synclair' });
    expect(groupsLabel(['A'], cal.groupNames)).toBe('Groupe de Guillaume');
    expect(groupsLabel(['A', 'B'], cal.groupNames)).toBe('Groupes de Guillaume et d’Emilie');
    expect(groupsLabel(['A', 'B', 'C'], cal.groupNames)).toBe('Groupes de Guillaume, d’Emilie et de Synclair');
    expect(groupsShort(['B', 'C'], cal.groupNames)).toBe('Emilie, Synclair');
    // Prénom manquant : la lettre
    expect(groupsLabel(['A', 'D'], cal.groupNames)).toBe('Groupes A et D');
    expect(groupsShort(['A', 'D'], cal.groupNames)).toBe('Guillaume, D');
    const ics = buildMeetCalendar(eventAsMeet(cal.events.find((e) => e.start === '2026-12-12')!), [], []);
    expect(ics).toMatch(/DTSTART;VALUE=DATE:20261212/);
    expect(ics).toMatch(/DTEND;VALUE=DATE:20261214/);
    expect(ics).toMatch(/LOCATION:Waremme/);
  });

  it('écarte une entrée invalide sans tout refuser', () => {
    const c = parseClubCalendar({ events: [{ start: '2026-13-40', city: 'X', name: 'Y', groups: [] }, { start: '2026-12-01', city: 'Liège', name: 'Meeting', groups: ['A'] }] })!;
    expect(c.events.map((e) => e.city)).toEqual(['Liège']);
    expect(parseClubCalendar(null)).toBeNull();
  });
});
