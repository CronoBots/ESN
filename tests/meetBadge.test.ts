import { describe, expect, it } from 'vitest';
import { meetBadge } from '../src/lib/dates';

describe('badge d’une compétition', () => {
  it('« En cours » dès le premier jour, jamais « Hier » pendant une compétition de plusieurs jours', () => {
    // Compétition du vendredi 20 au dimanche 22 : le samedi, elle a commencé « hier »
    expect(meetBadge('2099-11-20', '2099-11-21')).toBe('En cours');
    expect(meetBadge('2099-11-21', '2099-11-21')).toBe('En cours');
    // Pas encore commencée : date relative, avec une majuscule
    expect(meetBadge('2099-11-22', '2099-11-21')).toBe('Demain');
    expect(meetBadge('2099-11-24', '2099-11-21')).toBe('Dans 3 jours');
  });
});
