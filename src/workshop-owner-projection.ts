import type { ProviderId } from './providers';

// The immediate receipt has no join cutoff. The canonical outbox may fill it
// later at the same generation, but cannot change a newer or different action.
export async function applyWorkshopOwnerProjection(db: D1Database, provider: ProviderId,
  workshopId: string, action: 'hide' | 'restore', generation: number, cutoff?: number) {
  const state = action === 'hide' ? 'hidden_by_owner' : 'visible';
  await db.prepare(`UPDATE workshops SET owner_state=?,owner_reason=NULL,
    owner_action_generation=?,protected_join_cutoff_seq=COALESCE(?,protected_join_cutoff_seq),updated_at=?
    WHERE id=? AND provider=? AND (owner_action_generation<? OR
      (owner_action_generation=? AND ? IS NOT NULL AND owner_state=?))`)
    .bind(state,generation,cutoff??null,Date.now(),workshopId,provider,generation,generation,cutoff??null,state).run();
}
