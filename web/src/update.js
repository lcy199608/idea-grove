const button = document.querySelector('#update-app');
const status = document.querySelector('#update-status');

function waitForState(worker, accepts) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer); worker.removeEventListener('statechange', check);
      error ? reject(error) : resolve();
    };
    const check = () => {
      if (accepts.includes(worker.state)) finish();
      else if (worker.state === 'redundant') finish(new Error('新版文件未能完整下载。请检查网络后重试，本机资料未改动。'));
    };
    const timer = setTimeout(() => finish(new Error('更新等待超时，请重试；本机资料未改动。')), 45000);
    worker.addEventListener('statechange', check); check();
  });
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    if (!navigator.onLine) throw new Error('请连接网络后再更新。');
    if (!('serviceWorker' in navigator) || !navigator.locks) throw new Error('请通过 HTTPS 在支持安全存储的现代浏览器中打开此页面。');
    await navigator.locks.request('shinian-active-editor', { ifAvailable: true }, async lock => {
      if (!lock) throw new Error('还有拾念编辑窗口开着。请先保存内容并关闭其它拾念窗口，再点击更新。');
      status.textContent = '正在下载新版应用，本机资料保留中…';
      const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      await registration.update();
      if (registration.installing) await waitForState(registration.installing, ['installed', 'activated']);
      const waiting = registration.waiting;
      if (waiting) {
        status.textContent = '新版已下载，正在启用…';
        const activated = waitForState(waiting, ['activated']);
        waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
        await activated;
      } else if (registration.active && registration.active.state !== 'activated') {
        await waitForState(registration.active, ['activated']);
      }
      if (!registration.active || registration.active.state !== 'activated') throw new Error('新版尚未就绪，请稍后重试。');
      status.textContent = '应用已更新，本机资料已保留。正在返回拾念…';
      // A navigation outside the old cache key also avoids an old cached index.
      location.replace('./?updated=' + Date.now());
    });
  } catch (error) {
    status.textContent = error.message || '更新未完成，请重试。本机资料未改动。';
  } finally { button.disabled = false; }
});
