//
// Diferența față de `setup.ts`: NU mock-uim `expo-sqlite` la nivel global.
// Testele de caracterizare folosesc `jest.mock('expo-sqlite', () => ...)` local
// per fișier (cu wrapper-ul `better-sqlite3` din `__tests__/helpers/testDb.ts`).
//
// Cauza pentru care e nevoie de un setup separat:
// `setup.ts` definește `jest.mock('expo-sqlite', ...)` cu stub no-op. Când rulează
// în paralel mai multe fișiere în același worker, mock-ul global câștigă uneori
// cursa împotriva mock-ului local — `services/db.ts` capătă instanța no-op în loc
// de instanța better-sqlite3. Rezultat: ~10-20% flake pe testele de constraints
// (UNIQUE/CHECK nu se aplică pentru că db.runAsync e jest.fn()).
//
// Restul mock-urilor sunt copiate identic din `setup.ts` (mulțimea minimă necesară
// pentru a încărca `services/backup.ts`, `services/cloudSync.ts`, etc.).

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///test/Documents/',
  cacheDirectory: 'file:///test/Cache/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  readAsStringAsync: jest.fn().mockResolvedValue(''),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  moveAsync: jest.fn().mockResolvedValue(undefined),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false, isDirectory: false }),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
  createDownloadResumable: jest.fn(() => ({
    downloadAsync: jest.fn().mockResolvedValue({ uri: 'file:///test/Documents/models/test.gguf' }),
    pauseAsync: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
    getAllKeys: jest.fn().mockResolvedValue([]),
    multiGet: jest.fn().mockResolvedValue([]),
    multiSet: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  },
}));

// Note: NO expo-sqlite mock here. Per-file jest.mock takes over.

jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn(() => ({})),
  requireOptionalNativeModule: jest.fn(() => null),
  requireNativeViewManager: jest.fn(() => () => null),
  NativeModulesProxy: {},
  EventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(),
    removeAllListeners: jest.fn(),
  })),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
  getStringAsync: jest.fn().mockResolvedValue(''),
  hasStringAsync: jest.fn().mockResolvedValue(false),
}));

jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn().mockResolvedValue('mock-hash'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  randomUUID: jest.fn(() => 'mock-uuid'),
  getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array(16)),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-native-ml-kit/text-recognition', () => ({
  default: { recognize: jest.fn().mockResolvedValue({ blocks: [] }) },
}));

jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('mock-id'),
  cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  setNotificationHandler: jest.fn(),
  AndroidImportance: { MAX: 5 },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-calendar', () => ({
  requestCalendarPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  createEventAsync: jest.fn().mockResolvedValue('mock-event-id'),
  getDefaultCalendarAsync: jest.fn().mockResolvedValue({ id: 'mock-cal' }),
}));

jest.mock('expo-local-authentication', () => ({
  authenticateAsync: jest.fn().mockResolvedValue({ success: false }),
  hasHardwareAsync: jest.fn().mockResolvedValue(false),
  isEnrolledAsync: jest.fn().mockResolvedValue(false),
}));

jest.mock('expo-device', () => ({
  totalMemory: 5905580032,
  modelName: 'iPhone 14 Pro',
}));

jest.mock('llama.rn', () => ({
  initLlama: jest.fn().mockResolvedValue({
    completion: jest.fn().mockResolvedValue({ text: 'răspuns mock' }),
    release: jest.fn().mockResolvedValue(undefined),
  }),
}));
