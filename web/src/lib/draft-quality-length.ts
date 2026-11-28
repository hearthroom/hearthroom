import { cardQualityLength } from '../../../shared/card-quality-length';
import type { RoleDraft, WorldbookEntryDraft } from './role-draft';

/*
 * 編輯器裡「列表上的篇幅」：把目前的草稿交給公開列表用的同一份 cardQualityLength，
 * 作者在這裡看到的數字，就是這一版過審上榜後磚上會寫的數字（同樣取整）。
 * 只給編輯器匯入：計數帶著 markdown-it，跟送審字數（draft-review-length）一樣不進主包。
 * 瀏覽器沒有 Intl.Segmenter 時算不出來，回 null，編輯器就不顯示。
 */
type DraftText = Pick<RoleDraft, 'roleDetailDesc' | 'jailbreak' | 'roleOutputContract' | 'talkExample' | 'roleWelcome' | 'alternates' | 'prologue' | 'world'>;

export function draftQualityLength(draft: DraftText, entries: readonly WorldbookEntryDraft[]): number | null {
  try {
    return cardQualityLength({
      document: {
        roleDetailDesc: draft.roleDetailDesc,
        jailbreak: draft.jailbreak,
        roleOutputContract: draft.roleOutputContract,
        talkExample: draft.talkExample,
        world: draft.world,
      },
      greetings: { welcome: draft.roleWelcome, alternates: draft.alternates, prologue: draft.prologue },
      worldbooks: [{ entries }],
    }).total;
  } catch {
    return null;
  }
}
