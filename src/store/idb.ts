/**
 * Accès minimal à IndexedDB : une base, une table clé → valeur.
 *
 * IndexedDB remplace localStorage pour les données de l'application : sur
 * iPhone, localStorage est limité à environ 5 millions de caractères, ce que
 * l'historique complet du club finirait par dépasser ; IndexedDB offre bien
 * plus de place. Les valeurs sont enregistrées telles quelles (copie
 * structurée), sans conversion en texte.
 */

const DB_NAME = 'esn-competition';
const DB_VERSION = 1;
const TABLE = 'kv';

/** Ouvre la base ; null si IndexedDB est absent ou refusé (navigation privée ancienne, etc.). */
export function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(TABLE)) req.result.createObjectStore(TABLE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(TABLE, 'readonly').objectStore(TABLE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Enregistre une valeur. La copie est faite au moment de l'appel (les
 * modifications suivantes ne s'y mêlent pas) ; la promesse se résout quand
 * l'écriture est terminée sur le disque.
 */
export function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TABLE, 'readwrite');
    tx.objectStore(TABLE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Écriture annulée'));
  });
}
