import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Selecția modelului local — modul separat, fără `llama.rn`, ca `aiProvider`
 * s-o poată citi la fiecare `getAiConfig` fără să încarce runtime-ul de inferență.
 * Validarea față de catalog (model scos între versiuni) rămâne în
 * `localModel.getSelectedModelId`.
 */
export const LOCAL_MODEL_SELECTED_KEY = 'local_model_selected';

export async function getStoredLocalModelId(): Promise<string | null> {
  return AsyncStorage.getItem(LOCAL_MODEL_SELECTED_KEY);
}
