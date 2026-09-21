let modulePromise: Promise<typeof import('moonstage/stage')> | null = null;

/** 只載入靜態程式；不安裝宿主，也不使用玩家憑證。 */
export function preloadStage(): Promise<typeof import('moonstage/stage')> {
  if (!modulePromise) {
    modulePromise = Promise.all([import('moonstage/stage'), import('moonstage/stage.css'), import('@/styles/stage.css')])
      .then(([stage]) => stage);
    modulePromise.catch(() => { modulePromise = null; });
  }
  return modulePromise;
}
