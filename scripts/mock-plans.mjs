/**
 * 假的 Harbor 月卡（期間方案），給本機開發、ui-sim-test 與 QA 走查用。
 * 形狀照 docs/openapi.json 的 Plans；規則只做到畫面需要的程度，不是 Harbor 的實作。
 *
 * 切換情境：GET /__plans?state=<名稱>，或 POST /__plans {state}。
 *   none        沒卡，從沒買過（首次購買會加倍）
 *   used        沒卡，買過了（第二張起每天 500）
 *   holder      持卡（第一張期間），今天還沒領：簽到時代領
 *   claimed     持卡，今天已領
 *   second      持卡，第二張起（沒有加贈）、今天還沒領
 *   last        持卡，今天最後一天
 *   unavailable 持卡，簽到時代領失敗（periodPlan: unavailable），之後手動領可以成功
 *   retryFail   同上，但領取端點也一直失敗（看「剛才沒領到」與按鈕）
 *   revoked     今天的額度隨退款收回
 *   limit       持卡，疊到上限，不能再買
 *   paused      停售（沒卡的人看不到入口）
 *   empty       從沒設定過方案（清單是空的）
 *   fail        /me/plans 讀不到（503）
 */
const DAY = 86_400_000;
const tpe = (ms) => new Date(ms + 8 * 3600e3);
const businessDay = (ms) => tpe(ms - 4 * 3600e3).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(day) + n * DAY).toISOString().slice(0, 10);
const nextReset = (ms) => new Date(Date.parse(`${addDays(businessDay(ms), 1)}T04:00:00+08:00`)).toISOString();

const OFFER = { id: "month", onSale: true, priceMicro: 5_000_000, currency: "USD", credits: 30000, days: 30, dailyCredits: 500, firstBonusDailyCredits: 500, maxDays: 180, makeupPerMonth: 3, purchaseUrl: "https://console.harperharbor.com/me/billing?plan=month" };
const S = { state: "none", claimedDay: null, records: [] };

export function setPlanState(state) {
  S.state = state;
  S.claimedDay = state === "claimed" ? businessDay(Date.now()) : null;
  S.records = [];
}
const holding = () => ["holder", "claimed", "second", "last", "unavailable", "retryFail", "limit"].includes(S.state);
const first = () => ["holder", "claimed", "last", "unavailable", "retryFail", "limit"].includes(S.state);
const today = (now) => ({ credits: OFFER.dailyCredits + (first() ? OFFER.firstBonusDailyCredits : 0), bonusCredits: first() ? OFFER.firstBonusDailyCredits : 0, day: businessDay(now) });

function mine(now) {
  const day = businessDay(now);
  const remaining = S.state === "last" ? 1 : S.state === "limit" ? 160 : holding() ? 23 : 0;
  const t = today(now);
  const status = S.state === "revoked" ? "revoked" : !holding() ? "none" : S.claimedDay === day ? "claimed" : "claimable";
  const bonus = first() ? "active" : S.state === "none" ? "available" : "used";
  return {
    id: "month", businessDay: day, nextResetAt: nextReset(now), active: holding(), endsOn: holding() ? addDays(day, remaining - 1) : null, remainingDays: remaining,
    today: { status, credits: status === "none" || status === "revoked" ? 0 : t.credits, bonusCredits: status === "none" || status === "revoked" ? 0 : t.bonusCredits },
    canPurchase: S.state !== "limit" && S.state !== "paused", purchaseBlockedReason: S.state === "limit" ? "plan_limit" : S.state === "paused" ? "not_on_sale" : null,
    firstBonus: { status: bonus, dailyCredits: bonus === "active" ? OFFER.firstBonusDailyCredits : 0 }, firstBonusDailyCredits: OFFER.firstBonusDailyCredits,
    makeupPerMonth: holding() ? 3 : 1, ...(holding() ? { badge: "plan_month" } : {}),
  };
}

function grant(now, channel) {
  const t = today(now);
  const replayed = S.claimedDay === t.day;
  if (!replayed) {
    S.claimedDay = t.day;
    const at = new Date(now).toISOString();
    S.records.unshift({ id: 900000 + S.records.length * 2, record: "plan", recordType: "add", score: OFFER.dailyCredits, createTime: at, planKind: "daily" });
    if (t.bonusCredits) S.records.unshift({ id: 900001 + S.records.length * 2, record: "plan", recordType: "add", score: t.bonusCredits, createTime: at, planKind: "bonus" });
  }
  return { status: "granted", day: t.day, credits: t.credits, bonusCredits: t.bonusCredits, replayed, channel };
}

/** 簽到時代領的結果：mock-rewards 在簽到的每一種回應附上它。 */
export function periodPlanForCheckin(now) {
  if (S.state === "revoked") return { status: "revoked", day: businessDay(now) };
  if (!holding()) return { status: "none" };
  if (S.state === "unavailable" || S.state === "retryFail") return { status: "unavailable" };
  const { channel: _c, ...out } = grant(now, "checkin");
  return out;
}

/** 積分記錄裡月卡的列（每日、首購加贈；revoked 另附退回列）。 */
export function planRecords() {
  if (S.state !== "revoked") return S.records;
  const at = new Date(Date.now() - 3600e3).toISOString();
  return [
    { id: 900103, record: "refund", recordType: "sub", score: 500, createTime: at, planKind: "bonus" },
    { id: 900102, record: "refund", recordType: "sub", score: 500, createTime: at, planKind: "daily" },
    { id: 900101, record: "plan", recordType: "add", score: 500, createTime: new Date(Date.now() - 7200e3).toISOString(), planKind: "bonus" },
    { id: 900100, record: "plan", recordType: "add", score: 500, createTime: new Date(Date.now() - 7200e3).toISOString(), planKind: "daily" },
  ];
}

/** 回傳 true 表示這支處理了請求。/open/v1/plans 免登入，其餘要 token（由呼叫端先擋）。 */
export function handlePlans({ m, path, url, body, json, res }) {
  const now = Date.now();
  if (path === "/__plans") { setPlanState(url.searchParams.get("state") || body.state || "none"); json(res, 200, { state: S.state }); return true; }
  if (path === "/open/v1/plans") { json(res, 200, { list: S.state === "empty" ? [] : [{ ...OFFER, onSale: S.state !== "paused" }] }); return true; }
  if (m === "GET" && path === "/open/v1/me/plans") {
    if (S.state === "fail") { json(res, 503, { error: "temporarily_unavailable" }); return true; }
    json(res, 200, { serverNow: new Date(now).toISOString(), list: S.state === "empty" ? [] : [mine(now)] }); return true;
  }
  if (m === "POST" && path === "/open/v1/me/plans/month/claim") {
    if (!body.requestId) { json(res, 400, { error: "invalid_request" }); return true; }
    if (S.state === "retryFail") { json(res, 503, { error: "temporarily_unavailable" }); return true; }
    if (!holding()) { json(res, 422, { error: "not_eligible", reason: "no_active_plan" }); return true; }
    if (S.state === "unavailable") S.state = "holder";
    const { channel: _c, ...out } = grant(now, "app");
    json(res, 200, out); return true;
  }
  return false;
}
