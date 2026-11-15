import type { Meet, Swim, Swimmer } from '../store/types';
import { eventLabel, ROUND_LABEL } from './events';
import { formatTime } from './time';

/**
 * Génère un fichier calendrier (.ics) avec le programme d'une compétition :
 * une alarme 30 min avant chaque course (rappel sur le téléphone).
 */
export function buildMeetCalendar(meet: Meet, swims: Swim[], swimmers: Swimmer[]): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ESN Natation//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const byId = new Map(swimmers.map((s) => [s.id, s]));
  const place = [meet.city, meet.nation].filter(Boolean).join(', ');

  const timed = swims.filter((s) => s.startTime);
  if (!timed.length) {
    // Événement « journée entière »
    const end = new Date(`${meet.endDate ?? meet.startDate}T00:00:00`);
    end.setDate(end.getDate() + 1);
    const endStr = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}${String(end.getDate()).padStart(2, '0')}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${meet.id}@nageo`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${meet.startDate.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${endStr}`,
      `SUMMARY:${esc(`🏊 ${meet.name}`)}`,
      place ? `LOCATION:${esc(place)}` : '',
      'END:VEVENT',
    );
  }
  for (const s of timed) {
    const sw = byId.get(s.swimmerId);
    const [h, m] = s.startTime!.split(':').map(Number);
    const start = `${s.date.replace(/-/g, '')}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
    const endDate = new Date(2000, 0, 1, h, m + 15);
    const end = `${s.date.replace(/-/g, '')}T${String(endDate.getHours()).padStart(2, '0')}${String(endDate.getMinutes()).padStart(2, '0')}00`;
    const details = [
      s.eventNo ? `Épreuve ${s.eventNo}` : '',
      s.heat ? `Série ${s.heat}` : '',
      s.lane != null ? `Ligne ${s.lane}` : '',
      ROUND_LABEL[s.round],
      s.entryCs ? `Engagement ${formatTime(s.entryCs)}` : 'Engagement NT',
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.id}@nageo`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${esc(`${sw ? sw.firstName + ' – ' : ''}${eventLabel(s.distance, s.stroke)}`)}`,
      `DESCRIPTION:${esc(`${meet.name}\n${details}`)}`,
      place ? `LOCATION:${esc(place)}` : '',
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(`${sw?.firstName ?? ''} nage le ${eventLabel(s.distance, s.stroke)} dans 30 min`)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).join('\r\n');
}

export function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
