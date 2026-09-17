import { expect, it } from 'vitest';
import { connectionMessage } from '../src/lib/distribution';
import { i18n } from '../src/lib/i18n';
it('keeps an unknown safe error code reportable instead of asking for blind retries',()=>{
 const message=connectionMessage(new Error('sync_target_unverified'));
 expect(message).toContain('sync_target_unverified');
 expect(message).not.toBe(i18n.global.t('linked.error.generic'));
});
it('does not expose arbitrary upstream content as an error code',()=>{
 expect(connectionMessage(new Error('private text token=secret'))).not.toContain('secret');
});
