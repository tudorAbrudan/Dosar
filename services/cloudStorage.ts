import * as FileSystem from 'expo-file-system/legacy';
import { CloudStorage, CloudStorageProvider, CloudStorageScope } from 'react-native-cloud-storage';

/**
 * Wrapper peste `react-native-cloud-storage` pentru iCloud Documents.
 *
 * Toate căile sunt relative la containerul iCloud Documents al aplicației
 * (apelantul include prefixul de folder dorit, ex. `Dosar/...`).
 *
 * Suportă encoding `utf8` (text/JSON) și `base64` (binare). Biblioteca nativă
 * acceptă doar string-uri UTF-8 prin `readFile`/`writeFile`, deci pentru base64
 * folosim un fișier temporar local + `uploadFile`/`downloadFile`.
 */

const cs = new CloudStorage(CloudStorageProvider.ICloud, {
  scope: CloudStorageScope.Documents,
});

function tempUri(): string {
  const rand = Math.random().toString(36).slice(2);
  return `${FileSystem.cacheDirectory}cloudStorage-tmp-${Date.now()}-${rand}.bin`;
}

// Native iOS uploadFile/downloadFile așteaptă POSIX path în `localPath`
// (`URL(fileURLWithPath:)`), NU URI cu schemă `file://` cum returnează
// `FileSystem.cacheDirectory` din Expo. Fără strip, `URL(fileURLWithPath:)`
// produce o cale invalidă și `checkFileExists` aruncă `fileNotFound` —
// niciun fișier binar nu ajunge în iCloud.
function uriToNativePath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

export async function isAvailable(): Promise<boolean> {
  try {
    return await cs.isCloudAvailable();
  } catch {
    return false;
  }
}

export async function writeFile(
  remotePath: string,
  data: string,
  encoding: 'utf8' | 'base64' = 'utf8'
): Promise<void> {
  await ensureParentDir(remotePath);
  if (encoding === 'utf8') {
    await cs.writeFile(remotePath, data);
    return;
  }
  const tmp = tempUri();
  try {
    await FileSystem.writeAsStringAsync(tmp, data, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await cs.uploadFile(remotePath, uriToNativePath(tmp), {
      mimeType: 'application/octet-stream',
    });
  } finally {
    await FileSystem.deleteAsync(tmp, { idempotent: true });
  }
}

export async function readFile(
  remotePath: string,
  encoding: 'utf8' | 'base64' = 'utf8'
): Promise<string> {
  if (encoding === 'utf8') {
    return await cs.readFile(remotePath);
  }
  const tmp = tempUri();
  try {
    await cs.downloadFile(remotePath, uriToNativePath(tmp));
    return await FileSystem.readAsStringAsync(tmp, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } finally {
    await FileSystem.deleteAsync(tmp, { idempotent: true });
  }
}

export async function exists(remotePath: string): Promise<boolean> {
  try {
    return await cs.exists(remotePath);
  } catch {
    return false;
  }
}

export async function deleteFile(remotePath: string): Promise<void> {
  if (!(await exists(remotePath))) return;
  await cs.unlink(remotePath);
}

export async function listDir(remotePath: string): Promise<string[]> {
  try {
    if (!(await cs.exists(remotePath))) return [];
    return await cs.readdir(remotePath);
  } catch {
    return [];
  }
}

export async function ensureParentDir(remotePath: string): Promise<void> {
  // Precondiție: cale relativă, fără `/` la început. Normalizăm trailing `/`
  // ca să nu confundăm directorul însuși cu „părintele unui fișier".
  const normalized = remotePath.endsWith('/') ? remotePath.slice(0, -1) : remotePath;
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return;
  const parent = normalized.slice(0, idx);
  if (await cs.exists(parent)) return;
  try {
    await cs.mkdir(parent);
  } catch {
    // Posibil ca un nivel intermediar să lipsească — încearcă recursiv un nivel mai sus.
    await ensureParentDir(parent);
    await cs.mkdir(parent);
  }
}

export async function fileSize(remotePath: string): Promise<number> {
  try {
    const stat = await cs.stat(remotePath);
    return stat.size ?? 0;
  } catch {
    return 0;
  }
}
