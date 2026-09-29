const DB_NAME = 'shinian-idea-vault';
let dbPromise;
function db() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state');
      if (!request.result.objectStoreNames.contains('credentials')) request.result.createObjectStore('credentials');
    };
    request.onblocked = () => reject(new Error('请关闭其他拾念窗口后刷新，以完成本地登录存储升级。'));
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); dbPromise = undefined; };
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('无法打开本地资料库。请允许浏览器存储后重试。'));
  });
  return dbPromise;
}
export async function get(key) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('state', 'readonly').objectStore('state').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function set(key, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('state', 'readwrite');
    transaction.objectStore('state').put(value, key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error('本地保存失败，存储空间可能不足。请导出备份。'));
    transaction.onabort = () => reject(new Error('本地保存被中断。请保留当前页面并导出备份。'));
  });
}
export const emptyWorkspace = () => ({ files: {}, base: {}, head: null, syncedAt: null, activity: [] });
export const workspaceKey = config => config?.owner && config?.repo ? `repo:${config.owner.toLowerCase()}/${config.repo.toLowerCase()}@${config.branch}` : 'local';

// Repository-scoped credentials live outside all workspace records and exports.
const credentialKey = config => `${config.owner.toLowerCase()}/${config.repo.toLowerCase()}`;
export async function getCredential(config) {
  if (!config?.owner || !config?.repo) return '';
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('credentials', 'readonly').objectStore('credentials').get(credentialKey(config));
    request.onsuccess = () => resolve(request.result?.token || '');
    request.onerror = () => reject(new Error('无法读取此设备保存的登录。请重试，原凭据未被清除。'));
  });
}
export async function saveConnection(config, token) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['state', 'credentials'], 'readwrite');
    transaction.objectStore('credentials').put({ token }, credentialKey(config));
    transaction.objectStore('state').put(config, 'config');
    // Once upgraded, old tab session tokens must never resurrect a cleared login.
    transaction.objectStore('state').put(true, 'auth:legacy-retired');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error('登录保存失败，请重试。'));
    transaction.onabort = () => reject(new Error('登录保存被中断，请重试。'));
  });
}
export async function clearCredentials() {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['state', 'credentials'], 'readwrite');
    transaction.objectStore('credentials').clear();
    transaction.objectStore('state').put(true, 'auth:legacy-retired');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error('登录未能清除，请重试。'));
    transaction.onabort = () => reject(new Error('清除登录被中断，请重试。'));
  });
}
