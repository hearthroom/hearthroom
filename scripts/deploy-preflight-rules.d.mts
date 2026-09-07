/** 型別宣告：規則本體在 .mjs（部署殼直接用 node 跑，不經編譯），測試從 TS 匯入要有這份。 */
export interface DeployPreflightState {
  porcelain: string;
  submoduleStatus: string;
  head: string;
  originMain: string;
  stagePinned: string;
  stageHead: string;
  fetchOk: boolean;
  force: boolean;
}
export interface DeployPreflightVerdict {
  ok: boolean;
  forced: boolean;
  reasons: string[];
}
export function assess(s: DeployPreflightState): DeployPreflightVerdict;
