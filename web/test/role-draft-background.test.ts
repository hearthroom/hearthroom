/**
 * 橫式背景（選填）跟直式背景一樣走 document 欄位：上游詳情有就讀進草稿，改了才送。
 */
import { describe, expect, it } from "vitest";
import { documentPatch, draftFromRoleDetail, makeDraft } from "../src/lib/role-draft";

describe("roleBackgroundLandscape", () => {
  it("上游詳情的橫式背景讀進草稿；沒有就是空字串", () => {
    expect(draftFromRoleDetail({ roleBackgroundLandscape: "https://cdn/l.jpg" }, "en").roleBackgroundLandscape).toBe("https://cdn/l.jpg");
    expect(draftFromRoleDetail({}, "en").roleBackgroundLandscape).toBe("");
  });

  it("只在改過時進 patch", () => {
    const original = makeDraft("en");
    const draft = makeDraft("en");
    expect(documentPatch(draft, original)).not.toHaveProperty("roleBackgroundLandscape");
    draft.roleBackgroundLandscape = "https://cdn/l.jpg";
    expect(documentPatch(draft, original)).toMatchObject({ roleBackgroundLandscape: "https://cdn/l.jpg" });
  });
});

it("uses a portrait first and imports legacy avatars without an independent draft slot",()=>{
 const portrait=draftFromRoleDetail({roleAvatar:"old.png",roleBackground:"portrait.gif"},"en");
 expect(portrait.roleBackground).toBe("portrait.gif");expect(portrait).not.toHaveProperty("roleAvatar");
 const legacy=draftFromRoleDetail({roleAvatar:"old.png"},"en");expect(legacy.roleBackground).toBe("old.png");
 expect(documentPatch(legacy,null)).toMatchObject({roleAvatar:"old.png",roleBackground:"old.png"});
 const cleared={...legacy,roleBackground:""};expect(documentPatch(cleared,legacy)).toEqual({roleBackground:"",roleAvatar:""});
});

describe("roleShareImage", () => {
  it("分享圖（選填）跟橫式背景一樣走 document 欄位：讀進草稿，改了才送，清空也送", () => {
    expect(draftFromRoleDetail({ roleShareImage: "https://cdn/s.jpg" }, "en").roleShareImage).toBe("https://cdn/s.jpg");
    expect(draftFromRoleDetail({}, "en").roleShareImage).toBe("");
    const original = draftFromRoleDetail({ roleShareImage: "https://cdn/s.jpg" }, "en");
    const draft = draftFromRoleDetail({ roleShareImage: "https://cdn/s.jpg" }, "en");
    expect(documentPatch(draft, original)).not.toHaveProperty("roleShareImage");
    draft.roleShareImage = "";
    expect(documentPatch(draft, original)).toMatchObject({ roleShareImage: "" });
  });
});
