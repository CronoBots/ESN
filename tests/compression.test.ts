import { describe, expect, it } from 'vitest';
import { decryptHistory, encryptHistory, normalizeCode, type EncryptedRoster } from '../src/lib/roster';

const history = {
  updated: '2026-11-18',
  athletes: Array.from({ length: 40 }, (_, i) => ({
    lastName: 'DUPONT',
    firstName: `Emma${i}`,
    birthYear: 2012,
    text: '100m Libre\t25m\t1:31.08\t171\t11 oct. 2025\tLiège\tMeeting\n'.repeat(30),
  })),
};

/** Ancien format : JSON chiffré sans compression (fichiers publiés avant). */
async function legacyEncrypt(value: unknown, code: string): Promise<EncryptedRoster> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normalizeCode(code)), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value))));
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  return { format: 'esn-history', v: 1, kdf: 'PBKDF2-SHA-256', iterations: 1000, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

describe('données du club compressées', () => {
  it('compresse avant de chiffrer et relit le contenu à l’identique', async () => {
    const enc = await encryptHistory(history, 'ESN-7KQ4-M2XP', 1000);
    expect(enc.zip).toBe('gzip');
    expect(await decryptHistory(enc, 'ESN-7KQ4-M2XP')).toEqual(history);
    // Texte répétitif : bien plus petit qu'en clair
    expect(enc.data.length).toBeLessThan(JSON.stringify(history).length / 5);
  });

  it('relit encore les fichiers publiés sans compression', async () => {
    const old = await legacyEncrypt(history, 'ESN-7KQ4-M2XP');
    expect(old.zip).toBeUndefined();
    expect(await decryptHistory(old, 'ESN-7KQ4-M2XP')).toEqual(history);
  });
});
