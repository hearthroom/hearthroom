import { describe, expect, it } from "vitest";
import { mergeTurn, parseTurn, speakerOf } from "@/game/zz-parse";

const WELCOME = `<zzt>导览|身份登记|什亭之匣启动</zzt>

什亭之匣进入档案登记模式。

画面切换到早濑优香。她把数份身份档案并排放在桌上。
“首先决定自己是谁。”

【开局配置1】【开局配置2】【开局样式1】【开局引擎1】
<ba-opening-v1>

<zzhud>
[主角]
名字=未登记
立绘代码=
身份=未登记
便签=当前处于档案创建前；仅以玩家提交的资料为准
[场景]
时间=未设定
当前轮次=1
地点=未设定
当前目标=通过什亭之匣开局面板自主建立身份与故事起点
[行动]
选项1短=创建身份
选项1=打开角色创建面板，自主填写姓名、身份、所属、外貌与能力。
选项2短=选择开局
选项2=查看自由开局与主线剧本，选择希望故事开始的时间、地点和情境。
</zzhud>
<zzroles>
[角色1]
名字=早濑优香
身份=千年科技学园二年级 / 研讨会会计
好感度=25
心理活动=录制导览时专注确认身份登记项目没有遗漏
[角色2]
名字=生盐诺亚
身份=千年科技学园二年级 / 研讨会书记
好感度=30
心理活动=着重区分通用说明与玩家尚未提交的个人事实
</zzroles>`;

describe("parseTurn", () => {
  it("splits title, prose, hud, actions and roles out of one reply", () => {
    const t = parseTurn(WELCOME);
    expect(t.title).toEqual(["导览", "身份登记", "什亭之匣启动"]);
    expect(t.prose).toContain("什亭之匣进入档案登记模式");
    expect(t.prose).toContain("“首先决定自己是谁。”");
    // 開局面板的觸發標記與未知標籤不屬於敘事
    expect(t.prose).not.toMatch(/开局配置|开局样式|开局引擎|ba-opening|zzhud|zzroles/);
    expect(t.hero.名字).toBe("未登记");
    expect(t.hero.便签).toBe("当前处于档案创建前；仅以玩家提交的资料为准");
    expect(t.scene.当前轮次).toBe("1");
    expect(t.scene.当前目标).toMatch(/^通过什亭之匣/);
    expect(t.actions).toEqual([
      { short: "创建身份", full: "打开角色创建面板，自主填写姓名、身份、所属、外貌与能力。" },
      { short: "选择开局", full: "查看自由开局与主线剧本，选择希望故事开始的时间、地点和情境。" },
    ]);
    expect(t.roles.map((r) => [r.name, r.affection])).toEqual([["早濑优香", 25], ["生盐诺亚", 30]]);
    expect(t.roles[0].fields.心理活动).toMatch(/^录制导览/);
  });

  it("keeps the prose readable while a block is still streaming in", () => {
    const partial = WELCOME.slice(0, WELCOME.indexOf("[场景]"));
    const t = parseTurn(partial);
    expect(t.prose).toContain("首先决定自己是谁");
    expect(t.prose).not.toContain("zzhud");
    expect(t.prose).not.toContain("名字=");
    expect(t.actions).toEqual([]);
  });

  it("handles a reply that carries no structured blocks", () => {
    const t = parseTurn("只是一句普通的回覆。");
    expect(t.prose).toBe("只是一句普通的回覆。");
    expect(t.roles).toEqual([]);
    expect(t.title).toEqual([]);
  });
});

describe("mergeTurn", () => {
  it("keeps what the new turn did not mention and updates what it did", () => {
    const prev = parseTurn(WELCOME);
    const next = parseTurn(`<zzhud>
[场景]
当前轮次=2
地点=千年科技学园·研讨会办公室
[行动]
选项1短=问诺亚
选项1=问生盐诺亚会议记录里少了什么。
</zzhud>
<zzroles>
[角色1]
名字=生盐诺亚
好感度=35
</zzroles>`);
    const m = mergeTurn(prev, next);
    expect(m.hero.名字).toBe("未登记");
    expect(m.scene.当前轮次).toBe("2");
    expect(m.scene.当前目标).toMatch(/^通过什亭之匣/);
    expect(m.actions.map((a) => a.short)).toEqual(["问诺亚"]);
    // 沒被提到的角色留在台上，被提到的更新
    expect(m.roles.map((r) => [r.name, r.affection])).toEqual([["早濑优香", 25], ["生盐诺亚", 35]]);
    expect(m.roles[1].fields.身份).toBe("千年科技学园二年级 / 研讨会书记");
  });
});

describe("speakerOf", () => {
  it("picks the character named closest to the end of the prose", () => {
    const names = ["早濑优香", "生盐诺亚", "阿罗娜"];
    expect(speakerOf("早濑优香看了一眼。生盐诺亚翻开记录本：“……”", names)).toBe("生盐诺亚");
    expect(speakerOf("什么人都没有。", names)).toBe("");
  });
});
