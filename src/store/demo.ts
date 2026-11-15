import type { AppData, Course, Meet, Round, Stroke, Swim, Swimmer } from './types';
import { addDays, todayISO } from '../lib/dates';
import { uid } from '../lib/id';

/** Générateur pseudo-aléatoire déterministe (mêmes données à chaque fois). */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

interface Plan {
  distance: number;
  stroke: Stroke;
  /** Temps de départ et temps d'arrivée (centièmes) sur ~2 ans, en 25 m. */
  from: number;
  to: number;
}

const PLANS: Plan[] = [
  { distance: 50, stroke: 'FREE', from: 4350, to: 3695 },
  { distance: 100, stroke: 'FREE', from: 9890, to: 8210 },
  { distance: 200, stroke: 'FREE', from: 21500, to: 17890 },
  { distance: 50, stroke: 'BACK', from: 5320, to: 4410 },
  { distance: 100, stroke: 'BACK', from: 11480, to: 9640 },
  { distance: 50, stroke: 'BREAST', from: 5790, to: 4920 },
  { distance: 100, stroke: 'BREAST', from: 12600, to: 10880 },
  { distance: 50, stroke: 'FLY', from: 5450, to: 4380 },
  { distance: 100, stroke: 'IM', from: 11220, to: 9560 },
  { distance: 200, stroke: 'IM', from: 23900, to: 20150 },
  { distance: 400, stroke: 'FREE', from: 44800, to: 37900 },
];

const MEETS: { name: string; city: string; course: Course; daysAgo: number; days: number }[] = [
  { name: 'Critérium d’automne', city: 'Namur', course: 'SCM', daysAgo: 720, days: 1 },
  { name: 'Meeting de Noël', city: 'Liège', course: 'SCM', daysAgo: 665, days: 2 },
  { name: 'Interclubs provinciaux', city: 'Huy', course: 'SCM', daysAgo: 610, days: 1 },
  { name: 'Championnat provincial', city: 'Liège', course: 'SCM', daysAgo: 560, days: 2 },
  { name: 'Meeting de printemps', city: 'Verviers', course: 'LCM', daysAgo: 500, days: 2 },
  { name: 'Open d’été', city: 'Charleroi', course: 'LCM', daysAgo: 440, days: 2 },
  { name: 'Critérium d’automne', city: 'Namur', course: 'SCM', daysAgo: 375, days: 1 },
  { name: 'Meeting de Noël', city: 'Liège', course: 'SCM', daysAgo: 300, days: 2 },
  { name: 'Championnat provincial', city: 'Liège', course: 'SCM', daysAgo: 200, days: 2 },
  { name: 'Meeting international', city: 'Anvers', course: 'LCM', daysAgo: 140, days: 3 },
  { name: 'Championnat francophone', city: 'Mons', course: 'LCM', daysAgo: 100, days: 3 },
  { name: 'Coupe de rentrée', city: 'Seraing', course: 'SCM', daysAgo: 35, days: 1 },
];

export function buildDemo(): AppData {
  const r = rng(42);
  const today = todayISO();
  const swimmer: Swimmer = {
    id: uid(),
    firstName: 'Emma',
    lastName: 'Exemple',
    gender: 'F',
    birthYear: new Date().getFullYear() - 12,
    club: 'Club de démonstration',
    nation: 'BEL',
    color: 4,
    relation: 'child',
    favorite: true,
    createdAt: Date.now(),
  };
  const meets: Meet[] = [];
  const swims: Swim[] = [];
  const now = Date.now();

  MEETS.forEach((m, mi) => {
    const start = addDays(today, -m.daysAgo);
    const meet: Meet = {
      id: uid(),
      name: m.name,
      city: m.city,
      nation: 'BEL',
      startDate: start,
      endDate: m.days > 1 ? addDays(start, m.days - 1) : undefined,
      course: m.course,
      createdAt: now,
    };
    meets.push(meet);
    // 3 à 5 épreuves par compétition
    const count = 3 + Math.floor(r() * 3);
    const chosen = [...PLANS].sort(() => r() - 0.5).slice(0, count);
    chosen.forEach((p, i) => {
      if (m.course === 'LCM' && p.distance === 100 && p.stroke === 'IM') return;
      const progress = 1 - m.daysAgo / 760;
      const curve = Math.pow(progress, 0.8);
      let t = p.from - (p.from - p.to) * curve;
      t *= 1 + (r() - 0.45) * 0.035; // forme du jour
      if (m.course === 'LCM') t *= 1.035; // virages en moins
      const day = Math.min(m.days - 1, Math.floor(i / 2));
      const hour = 9 + ((i * 47) % 8);
      const dsq = r() < 0.04;
      const round: Round = 'TIM';
      swims.push({
        id: uid(),
        swimmerId: swimmer.id,
        meetId: meet.id,
        context: 'competition',
        date: addDays(start, day),
        startTime: `${String(hour).padStart(2, '0')}:${i % 2 ? '30' : '05'}`,
        distance: p.distance,
        stroke: p.stroke,
        course: m.course,
        timeCs: dsq ? null : Math.round(t),
        status: dsq ? 'DSQ' : 'OK',
        round,
        eventNo: 3 + i * 4 + mi,
        heat: 1 + Math.floor(r() * 4),
        lane: 1 + Math.floor(r() * 6),
        place: r() < 0.25 ? 1 + Math.floor(r() * 3) : 4 + Math.floor(r() * 12),
        timing: 'electronic',
        source: 'manual',
        createdAt: now + mi * 100 + i,
        updatedAt: now,
      });
    });
  });

  // Compétition à venir avec inscriptions (programme)
  const next: Meet = {
    id: uid(),
    name: 'Meeting d’hiver',
    city: 'Liège',
    nation: 'BEL',
    startDate: addDays(today, 12),
    endDate: addDays(today, 13),
    course: 'SCM',
    createdAt: now,
  };
  meets.push(next);
  const program: [number, Stroke, number, string, number, number][] = [
    [18, 'FLY', 50, '11:35', 2, 2],
    [20, 'IM', 100, '12:10', 2, 3],
    [27, 'BACK', 50, '15:35', 2, 1],
    [29, 'FREE', 100, '15:55', 3, 2],
  ];
  program.forEach(([no, stroke, distance, time, heat, lane], i) =>
    swims.push({
      id: uid(),
      swimmerId: swimmer.id,
      meetId: next.id,
      context: 'competition',
      date: next.startDate,
      startTime: time,
      distance,
      stroke,
      course: 'SCM',
      timeCs: null,
      status: 'OK',
      round: 'TIM',
      eventNo: no,
      heat,
      lane,
      source: 'manual',
      createdAt: now + 5000 + i,
      updatedAt: now,
    }),
  );

  // Quelques entraînements chronométrés
  for (let i = 0; i < 4; i++) {
    swims.push({
      id: uid(),
      swimmerId: swimmer.id,
      context: 'training',
      date: addDays(today, -60 + i * 14),
      distance: 50,
      stroke: 'FREE',
      course: 'SCM',
      timeCs: Math.round(3780 - i * 25 + r() * 40),
      status: 'OK',
      round: 'TIM',
      timing: 'manual',
      source: 'manual',
      notes: 'Chrono pris au bord du bassin',
      createdAt: now + 9000 + i,
      updatedAt: now,
    });
  }

  return {
    version: 1,
    swimmers: [swimmer],
    meets,
    swims,
    goals: [
      {
        id: uid(),
        swimmerId: swimmer.id,
        distance: 100,
        stroke: 'FREE',
        course: 'SCM',
        targetCs: 7900,
        label: 'Temps limite Championnat francophone',
        deadline: addDays(today, 150),
        createdAt: now,
      },
      {
        id: uid(),
        swimmerId: swimmer.id,
        distance: 50,
        stroke: 'BACK',
        course: 'SCM',
        targetCs: 4200,
        label: 'Passer sous les 42 secondes',
        createdAt: now,
      },
    ],
    settings: {
      theme: 'auto',
      includeTraining: false,
      defaultCourse: 'SCM',
      onboarded: true,
      celebrate: true,
      selectedSwimmerId: swimmer.id,
    },
  };
}
