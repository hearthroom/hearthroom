/**
 * 待機動作：呼吸、隨機眨眼、輕微搖晃、看向游標、說話時嘴巴開合。
 * 每一格把參數寫進 Rig，再讓物理算頭髮、裙擺、骰子。
 */
import type { Rig } from "./puppet";

export interface DriverState {
  /** 看向的點（-1..1，相對於她的臉）；null＝自己發呆 */
  look: [number, number] | null;
  talking: boolean;
}

export class Driver {
  t = 0;
  private nextBlink = 2;
  private blinkT = -1;
  private look = [0, 0];
  private wander = [0, 0];
  private wanderAt = 0;
  readonly state: DriverState = { look: null, talking: false };
  constructor(readonly rig: Rig, private rand: () => number = Math.random) {}

  update(dt: number) {
    const p = this.rig.params;
    this.t += dt;
    const t = this.t;
    // 呼吸：約 3.6 秒一次
    p.Breath = (Math.sin((t * Math.PI * 2) / 3.6) + 1) / 2;
    // 身體與手臂的小幅搖晃
    p.BodyZ = Math.sin(t * 0.9) * 1.6;
    p.ArmR = Math.sin(t * 0.9 + 0.6) * 1.5;
    p.ArmL = -Math.sin(t * 0.9 + 0.6) * 1.5;
    // 視線：有目標就看目標，沒有就每幾秒換一個發呆的方向
    if (!this.state.look && t > this.wanderAt) {
      this.wander = [(this.rand() - 0.5) * 1.2, (this.rand() - 0.5) * 0.6];
      this.wanderAt = t + 2 + this.rand() * 3;
    }
    const target = this.state.look ?? this.wander;
    const k = 1 - Math.exp(-dt * 6);
    this.look[0] += (target[0] - this.look[0]) * k;
    this.look[1] += (target[1] - this.look[1]) * k;
    p.AngleX = this.look[0];
    p.AngleY = this.look[1];
    p.AngleZ = this.look[0] * -4 + Math.sin(t * 0.7) * 1.2;
    p.EyeX = this.look[0];
    p.EyeY = this.look[1];
    // 眨眼：每 2–6 秒一次，閉 0.12 秒；偶爾連眨兩下
    if (this.blinkT < 0 && t > this.nextBlink) this.blinkT = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const b = this.blinkT / 0.14;
      p.EyeOpen = b < 0.5 ? 1 - b * 2 : Math.min(1, (b - 0.5) * 2);
      if (b >= 1) {
        this.blinkT = -1;
        this.nextBlink = t + (this.rand() < 0.15 ? 0.25 : 2 + this.rand() * 4);
      }
    } else p.EyeOpen = 1;
    // 說話：嘴巴不規則開合
    p.MouthOpen = this.state.talking ? Math.max(0, Math.sin(t * 17) * 0.6 + Math.sin(t * 7.3) * 0.4) : 0;
    this.rig.step(dt);
  }
}
