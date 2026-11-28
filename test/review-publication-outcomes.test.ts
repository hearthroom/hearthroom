import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { syncCardQualityPlay } from '../src/card-quality-play-sync';
import { weekStart } from '../src/review-stats';

const DAY = 86_400_000;
const matureWeek = weekStart(Date.now() - 8 * DAY) - 7 * DAY;
const observationWeek = matureWeek - 7 * DAY;
const published = observationWeek + DAY;

async function publish(cardId: number, source: 'ai' | 'human', at = published, kind: 'first' | 're' = 'first') {
  const version = `version-${cardId}`;
  const role = `00000000-0000-4000-8000-${String(cardId).padStart(12, '0')}`;
  const sid = `submission-${cardId}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO cards(id,provider,source_role_id,author_num_id,author_name,status,registered_at,last_synced_at,approved_version_id)
      VALUES (?,'harbor',?,11,'Fixture','approved',?,?,?)`).bind(cardId, role, at, at, version),
    env.DB.prepare(`INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at,decided_at)
      VALUES (?,?,'harbor',?,?,'approved',?,?)`).bind(sid, cardId, role, kind, at - DAY, at - DAY),
    env.DB.prepare(`INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,card_id,submission_id,state,created_at,published_at)
      VALUES (?,?,'fixture-author',?,?,'harbor',?,?,'approved',?,?)`).bind(version, version, version, role, cardId, sid, at - DAY, at),
    env.DB.prepare(`INSERT INTO review_events(event_key,spec_version,submission_id,card_id,at,action,to_state,actor_kind)
      VALUES (?,1,?,?,?,'first_decision','approved','system')`).bind(`first:${sid}`, sid, cardId, at - DAY),
    env.DB.prepare(`INSERT INTO review_events(event_key,spec_version,submission_id,card_id,at,action,actor_kind,final_source)
      VALUES (?,1,?,?,?,'approve',?,?)`).bind(`stamp:${sid}`, sid, cardId, at - DAY, source === 'ai' ? 'system' : 'reviewer',
      source === 'ai' ? 'ai_fast_track' : null),
  ]);
  return { version, role, sid };
}

it('freezes the first eligible day-seven observation and separates underpowered and missing samples', async () => {
  const ai = await publish(190001, 'ai');
  const human = await publish(190002, 'human');
  await publish(190003, 'human');
  let time = published + 7 * DAY - 1;
  let reached = 11;
  const deps = {
    now: () => time,
    read: async (roles: string[]) => Object.fromEntries(roles.map(role => [role, role === ai.role
      ? { players: 20, reached, medianTurns: 5 }
      : role === human.role ? { players: 19, reached: 7, medianTurns: 3 } : null])),
  };
  const observed = () => env.DB.prepare(
    'SELECT version_id, observed_at, rate_percent FROM review_publication_day7 ORDER BY version_id',
  ).all();
  await syncCardQualityPlay(env, deps);
  expect((await observed()).results).toEqual([]);
  time++;
  await syncCardQualityPlay(env, deps);
  time++;
  reached = 18;
  await syncCardQualityPlay(env, deps);
  expect((await observed()).results).toEqual([
    { version_id: ai.version, observed_at: published + 7 * DAY, rate_percent: 55 },
    { version_id: human.version, observed_at: published + 7 * DAY, rate_percent: null },
  ]);
  const { results } = await env.DB.prepare(`SELECT approval_source, cards, observed, underpowered, missing, rate_40_59
    FROM review_publication_outcomes_weekly WHERE week_start=? ORDER BY approval_source`).bind(observationWeek).all();
  expect(results).toEqual([
    { approval_source: 'ai', cards: 1, observed: 1, underpowered: 0, missing: 0, rate_40_59: 1 },
    { approval_source: 'human', cards: 2, observed: 1, underpowered: 1, missing: 1, rate_40_59: 0 },
  ]);
});

it('attributes confirmed removals to the published version and uses the actual publication week', async () => {
  const ai = await publish(190011, 'ai', matureWeek + 100);
  const human = await publish(190012, 'human', matureWeek + 100);
  await publish(190013, 'ai', matureWeek + 7 * DAY + 100);
  const action = (card: { version: string; role: string }, id: string, version: string, status: string, at: number) =>
    env.DB.prepare(`INSERT INTO moderation_cases(id,provider,source_role_id,version_id,title,author_member_id,action,reason,
      created_by,operation_id,created_at,decided_at,card_number,rating,public_evidence,status)
      VALUES (?,'harbor',?,?,'Fixture','fixture-author','delist','Synthetic','fixture-reviewer',?,?,?,1,'G','{}',?)`)
      .bind(id, card.role, version, id, at, at, status);
  await env.DB.batch([
    action(ai, 'confirmed-removal', ai.version, 'confirmed', matureWeek + 2 * DAY),
    action(ai, 'confirmed-repeat', ai.version, 'confirmed', matureWeek + 3 * DAY),
    action(human, 'wrong-version', 'prior-version', 'confirmed', matureWeek + 2 * DAY),
    action(human, 'ineffective-proposal', human.version, 'dismissed', matureWeek + 2 * DAY),
    action(human, 'late-removal', human.version, 'confirmed', matureWeek + 7 * DAY + 101),
  ]);
  const { results } = await env.DB.prepare(`SELECT approval_source, cards, removed_within_7d, removed_as_of
    FROM review_publication_outcomes_weekly WHERE week_start=? ORDER BY approval_source`).bind(matureWeek).all();
  expect(results).toEqual([
    { approval_source: 'ai', cards: 1, removed_within_7d: 1, removed_as_of: 1 },
    { approval_source: 'human', cards: 1, removed_within_7d: 0, removed_as_of: 1 },
  ]);
});

it('does not sample an obsolete published version or a first observation after day seven', async () => {
  const prior = await publish(190021, 'human', published - DAY, 're');
  const update = await publish(190022, 'human', published, 're');
  const { results } = await env.DB.prepare(`SELECT approval_source, kind, cards, missing
    FROM review_publication_outcomes_weekly WHERE week_start=? AND kind='re'`).bind(observationWeek).all();
  expect(results).toEqual([{ approval_source: 'human', kind: 're', cards: 2, missing: 2 }]);
  const snapshot = { players: 20, reached: 14, medianTurns: 6 };
  await syncCardQualityPlay(env, {
    now: () => published + 7 * DAY,
    read: async roles => {
      await env.DB.prepare('UPDATE cards SET approved_version_id=NULL WHERE id=190022').run();
      return Object.fromEntries(roles.map(role => [role, role === prior.role || role === update.role ? snapshot : null]));
    },
  });
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM review_publication_day7 WHERE version_id IN (?,?)')
    .bind(prior.version, update.version).first()).toEqual({ n: 0 });
});
