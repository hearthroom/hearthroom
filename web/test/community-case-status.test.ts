import { expect, it } from "vitest";
import { communityCaseStatus } from "../src/lib/community";

it("preserves the actual resolution instead of flattening every closed case", () => {
  const c = {state:"closed", category:"review", archived:true, locked:true, resolution:"not_adopted"};
  expect(communityCaseStatus(c)).toBe("not_adopted");
  expect(communityCaseStatus({...c,resolution:"passed"})).toBe("passed");
  expect(communityCaseStatus({...c,resolution:null})).toBe("closed");
});
it("matches the problem and feedback pause rules without treating ordinary archival as resolution", () => {
  const c = {state:"in_progress",category:"bug",locked:true,archived:false,resolution:null};
  expect(communityCaseStatus(c)).toBe("in_progress");
  expect(communityCaseStatus({...c,archived:true})).toBe("paused");
  expect(communityCaseStatus({...c,category:"review"})).toBe("paused");
  expect(communityCaseStatus({...c,category:"card_report"})).toBe("paused");
  expect(communityCaseStatus({...c,locked:false,archived:true})).toBe("in_progress");
  expect(communityCaseStatus({...c,state:"under_discussion",category:"review",locked:false})).toBe("under_discussion");
});
