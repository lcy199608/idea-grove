export async function latestRelease() {
  const url = new URL('../release.json', import.meta.url);
  url.searchParams.set('check', Date.now());
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('暂时无法读取线上版本，请检查网络后重试。');
  const release = await response.json();
  if (!/^\d+\.\d+\.\d+$/.test(release.version) || !/^v\d+$/.test(release.cacheVersion)) throw new Error('线上版本信息不完整，请稍后重试。');
  return release;
}

export function workerRelease(worker) {
  if (!worker) return Promise.resolve(null);
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = value => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(value); };
    const timer = setTimeout(() => finish(null), 3000);
    channel.port1.onmessage = event => finish(event.data?.type === 'SHINIAN_RELEASE' ? event.data : null);
    try { worker.postMessage({ type: 'GET_RELEASE' }, [channel.port2]); } catch { finish(null); }
  });
}
