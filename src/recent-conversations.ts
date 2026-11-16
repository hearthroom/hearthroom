import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireMember } from './members';
import { HttpError, type Env } from './types';

const valid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const recentConversationRoutes = new Hono<{ Bindings: Env }>();

for (const action of ['hide', 'restore'] as const) {
  recentConversationRoutes.post(`/v1/me/conversations/${action}`, bodyLimit({ maxSize: 2048, onError: c => c.json({ error: 'payload_too_large' }, 413) }), async c => {
    const member = await requireMember(c);
    if (member.provider !== 'harbor') throw new HttpError(401, 'unauthorized');
    const body = await c.req.json().catch(() => null) as { conversationRoleId?: unknown; conversationId?: unknown } | null;
    if (!valid(body?.conversationRoleId) || !valid(body?.conversationId)) throw new HttpError(400, 'invalid_arguments');
    // A projected role may have migrated. The exact conversation pointer still
    // belongs to this member: list visibility needs no Provider content access.
    // Include its pointer aliases, never any other conversation or member.
    if (action === 'hide') {
      const result = await c.env.DB.prepare(`INSERT INTO member_conversation_hides(member_id,provider,role_id,conversation_id,pointer_updated_at)
        SELECT member_id,provider,role_id,conversation_id,updated_at FROM member_conversations
        WHERE member_id=? AND provider=? AND conversation_id=?
        ON CONFLICT(member_id,provider,role_id,conversation_id) DO UPDATE SET pointer_updated_at=excluded.pointer_updated_at`)
        .bind(member.id, member.provider, body.conversationId).run();
      if (!result.meta.changes) throw new HttpError(404, 'not_found');
    } else {
      const pointer = await c.env.DB.prepare('SELECT 1 FROM member_conversations WHERE member_id=? AND provider=? AND conversation_id=? LIMIT 1')
        .bind(member.id, member.provider, body.conversationId).first();
      if (!pointer) throw new HttpError(404, 'not_found');
      // Undo never inserts a pointer or advances its ordering timestamp. It can
      // only reveal the exact still-recorded conversation, not a replacement.
      await c.env.DB.prepare(`DELETE FROM member_conversation_hides WHERE member_id=? AND provider=? AND conversation_id=?
        AND EXISTS(SELECT 1 FROM member_conversations r WHERE r.member_id=member_conversation_hides.member_id
          AND r.provider=member_conversation_hides.provider AND r.role_id=member_conversation_hides.role_id
          AND r.conversation_id=member_conversation_hides.conversation_id AND r.updated_at=member_conversation_hides.pointer_updated_at)`)
        .bind(member.id, member.provider, body.conversationId).run();
    }
    return c.json({ hidden: action === 'hide' });
  });
}
