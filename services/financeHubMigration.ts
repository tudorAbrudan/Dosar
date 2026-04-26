import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from './db';
import { getVisibleEntityTypes, setVisibleEntityTypes } from './settings';

const KEY_FINANCE_HUB_MIGRATED = 'settings_finance_hub_migrated_v1';
const FINANCE_HUB_SENTINEL_ID = '__finance_hub__';

/**
 * Pentru utilizatorii existenți: înainte hub-ul „Gestiune financiară" apărea
 * întotdeauna în lista de entități, indiferent de `visibleEntityTypes`.
 * După această migrație, hub-ul e gated pe `'financial_account'` din settings.
 *
 * Dacă utilizatorul a folosit deja hub-ul (are conturi financiare sau sentinelul
 * apare în `entity_order`), îl adăugăm tăcut în `visibleEntityTypes` ca să nu
 * piardă accesul. Rulează o singură dată per device (marker în AsyncStorage).
 */
export async function migrateFinanceHubVisibility(): Promise<void> {
  const done = await AsyncStorage.getItem(KEY_FINANCE_HUB_MIGRATED);
  if (done === 'true') return;

  const current = await getVisibleEntityTypes();

  if (current.includes('financial_account')) {
    await AsyncStorage.setItem(KEY_FINANCE_HUB_MIGRATED, 'true');
    return;
  }

  let hadHub = false;

  try {
    const orderRow = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM entity_order WHERE entity_id = ?',
      [FINANCE_HUB_SENTINEL_ID]
    );
    if ((orderRow?.count ?? 0) > 0) hadHub = true;
  } catch {
    /* tabel inexistent (instalare nouă) — ignor */
  }

  if (!hadHub) {
    try {
      const accountsRow = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM financial_accounts'
      );
      if ((accountsRow?.count ?? 0) > 0) hadHub = true;
    } catch {
      /* tabel inexistent (instalare nouă) — ignor */
    }
  }

  if (hadHub) {
    await setVisibleEntityTypes([...current, 'financial_account']);
  }

  await AsyncStorage.setItem(KEY_FINANCE_HUB_MIGRATED, 'true');
}
