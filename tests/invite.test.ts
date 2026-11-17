import { describe, expect, it } from 'vitest';
import { codeFromText } from '../src/lib/invite';

describe('lien d’invitation', () => {
  it('retrouve le code dans un lien, un message ou seul', () => {
    expect(codeFromText('https://exemple.github.io/ESN/#/club?code=ESN-7KQ4-M2XP')).toBe('ESN-7KQ4-M2XP');
    expect(codeFromText('https://exemple.github.io/ESN/#/club?code=ESN-7KQ4-M2XP&x=1')).toBe('ESN-7KQ4-M2XP');
    expect(codeFromText('Ouvre ce lien : https://exemple.github.io/ESN/#/club?code=esn-7kq4-m2xp à bientôt')).toBe('ESN-7KQ4-M2XP');
    expect(codeFromText('Le code : ESN-7KQ4-M2XP')).toBe('ESN-7KQ4-M2XP');
    expect(codeFromText('  esn 7kq4 m2xp ')).toBe('ESN 7KQ4 M2XP');
  });

  it('ne trouve rien dans un texte sans code', () => {
    expect(codeFromText('Bonjour, rendez-vous samedi à la piscine')).toBeNull();
    expect(codeFromText('')).toBeNull();
  });
});
