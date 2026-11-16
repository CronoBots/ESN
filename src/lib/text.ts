/** « de Léa » / « d’Emma » / « d’Hugo » : élision devant une voyelle ou un h muet. */
export function deName(name: string): string {
  return /^[aeiouyhàâäéèêëîïôöùûüœæ]/i.test(name.trim()) ? `d’${name}` : `de ${name}`;
}

/** « 11e place », « 1re place » (espaces insécables). */
export function placeLabel(place: number): string {
  return `${place}${place === 1 ? 're' : 'e'}\u00a0place`;
}

/** « samedi 14 novembre » → « Samedi 14 novembre » */
export const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
