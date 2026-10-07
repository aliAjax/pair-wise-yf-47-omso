import { describe, it, expect } from "vitest";
import {
  建账, 走钟, 开事件, 事件收尾, 下停电令, 当前停电令,
  收票, 补票, 存离线票, 回网同步, 激活票, 排队, 有效票, 完工票, 换班,
  记接地, 拆接地, 未拆接地, 记人员, 在场人员, 复电对账, 执行复电,
} from "../lib/safety/rules";
import type { 安全账状态, 检修票必填, 班次 } from "../lib/safety/types";

const Q = "Q1"; // 滨江-会展区间
const B1: 班次 = { id: "banci-a", 名称: "甲班 02:00-06:00", 开始时刻: "2026-10-07T02:00:00" };
const B2: 班次 = { id: "banci-b", 名称: "乙班 06:00-10:00", 开始时刻: "2026-10-07T06:00:00" };

function 全套账(t = "2026-10-07T03:00:00"): 安全账状态 {
  let s = 建账(t, true);
  s = 开事件(s, { id: "INC-1", 标题: "滨江站积水停运", 区间id: Q, 当前班次id: B1.id, 开工时刻: "2026-10-07T02:20:00" });
  s = { ...s, 班次表: [B1] };
  return s;
}

const 全票 = (票号: string, 覆盖: Partial<检修票必填> = {}): 检修票必填 => ({
  票号,
  区间id: Q,
  作业内容: "接触网悬挂检调",
  作业负责人: "王军",
  班组: "网电工班甲班",
  班次id: B1.id,
  有效起: "2026-10-07T02:30:00",
  有效止: "2026-10-07T05:30:00",
  ...覆盖,
});

/** 走到放行前最后一步：票已激活、作业进行过但未做收尾动作 */
function 待复电账() {
  let s = 全套账("2026-10-07T03:00:00");
  s = 下停电令(s, { 票号: "TD-1", 区间id: Q, 停电时刻: "2026-10-07T02:30:00" });
  s = 收票(s, 全票("JX-1001")).state;
  expect(激活票(s, "JX-1001").成功).toBe(true);
  s = 激活票(s, "JX-1001").state;
  s = 走钟(s, "2026-10-07T03:05:00");
  s = 记接地(s, { 票号: "JX-1001", 区间id: Q, 位置: "K12+300 下行", 操作人: "李强" });
  s = 记人员(s, { 票号: "JX-1001", 区间id: Q, 姓名: "张伟", 工种: "接触网工" }, "进入");
  return s;
}

describe("完整闭环：复电前逐项对账，全绿才放行", () => {
  it("未收尾/有接地/有人/票未完工时一律不放行", () => {
    let s = 待复电账();
    let c = 复电对账(s, Q);
    expect(c.放行).toBe(false);
    expect(c.对账.find((x) => x.代码 === "事件未收尾")?.通过).toBe(false);
    expect(c.对账.find((x) => x.代码 === "接地线未拆净")?.通过).toBe(false);
    expect(c.对账.find((x) => x.代码 === "人员未离场")?.通过).toBe(false);
    // 执行复电必须被拒绝，且不得写复电时刻
    const 拒绝 = 执行复电(s, Q);
    expect(拒绝.结论.放行).toBe(false);
    expect(当前停电令(s, Q)?.复电时刻).toBeUndefined();
  });

  it("人员离场、接地拆除、票完工、事件收尾后放行并复电", () => {
    let s = 待复电账();
    s = 记人员(s, { 票号: "JX-1001", 区间id: Q, 姓名: "张伟", 工种: "接触网工" }, "离开");
    s = 拆接地(s, s.接地[0].id);
    s = 完工票(s, "JX-1001");
    s = 事件收尾(s);
    const c = 复电对账(s, Q);
    expect(c.放行).toBe(true);
    expect(c.对账.find((x) => x.代码 === "票况")?.说明).toContain("票账闭环");
    expect(c.对账.find((x) => x.代码 === "接地线未拆净")?.通过).toBe(true);
    expect(c.对账.find((x) => x.代码 === "人员未离场")?.通过).toBe(true);
  });

  it("票未完工时即使现场清零也不放行，完工后自动闭环", () => {
    let s = 待复电账();
    s = 记人员(s, { 票号: "JX-1001", 区间id: Q, 姓名: "张伟", 工种: "接触网工" }, "离开");
    s = 拆接地(s, s.接地[0].id);
    s = 事件收尾(s);
    const 未完工 = 复电对账(s, Q);
    expect(未完工.放行).toBe(false);
    expect(未完工.对账.find((x) => x.代码 === "票况")?.说明).toContain("尚未完工");

    s = 完工票(s, "JX-1001");
    const r = 执行复电(s, Q);
    expect(r.结论.放行).toBe(true);
    expect(当前停电令(r.state, Q)).toBeUndefined();
    expect(r.state.事件?.停电状态).toBe("已送电");
    // 复电不重复执行：停电令已销
    const 再次 = 执行复电(r.state, Q);
    expect(再次.结论.放行).toBe(false);
    expect(再次.结论.对账.find((x) => x.代码 === "停电令缺失")?.通过).toBe(false);
  });
});

describe("票过期不放行", () => {
  it("超过有效止的票激活被拒；已激活后过期则对账拦截", () => {
    let s = 全套账("2026-10-07T05:40:00");
    s = 下停电令(s, { 票号: "TD-1", 区间id: Q, 停电时刻: "2026-10-07T02:30:00" });
    s = 收票(s, 全票("JX-2001")).state;
    const a = 激活票(s, "JX-2001");
    expect(a.成功).toBe(false);
    expect(a.原因).toContain("过期");

    // 提前激活，再走到过期时点
    let s2 = 走钟(全套账("2026-10-07T03:00:00"), "2026-10-07T03:00:00");
    s2 = 下停电令(s2, { 票号: "TD-1", 区间id: Q, 停电时刻: "2026-10-07T02:30:00" });
    s2 = 收票(s2, 全票("JX-2002")).state;
    s2 = 激活票(s2, "JX-2002").state;
    s2 = 走钟(s2, "2026-10-07T05:40:00");
    const c = 复电对账(s2, Q);
    expect(c.对账.find((x) => x.代码 === "票况")?.说明).toContain("过期");
    expect(c.放行).toBe(false);
  });
});

describe("票外作业不放行", () => {
  it("有人持未入账/作废票进区间，即使人走了也按遗留接地证据识别为票外", () => {
    let s = 待复电账();
    // 另一组人凭一张没有激活（排队）的票挂了一组接地
    s = 收票(s, 全票("JX-1099", { 作业内容: "附加导线检查" })).state;
    s = 走钟(s, "2026-10-07T03:20:00");
    s = 记接地(s, { 票号: "JX-1099", 区间id: Q, 位置: "K13+050 上行", 操作人: "赵磊" });
    // 正常作业闭环
    s = 记人员(s, { 票号: "JX-1001", 区间id: Q, 姓名: "张伟", 工种: "接触网工" }, "离开");
    s = 拆接地(s, s.接地.find((x) => x.票号 === "JX-1001")!.id);
    s = 完工票(s, "JX-1001");
    s = 事件收尾(s);
    const c = 复电对账(s, Q);
    expect(c.对账.find((x) => x.代码 === "存在票外作业")?.通过).toBe(false);
    expect(c.放行).toBe(false);
  });

  it("持作废票的人员仍在场，换班后复电被拦", () => {
    let s = 待复电账();
    s = 换班(s, B2); // 原票 JX-1001 失效，但张伟还没出来
    const c = 复电对账(s, Q);
    expect(c.对账.find((x) => x.代码 === "人员未离场")?.通过).toBe(false);
    expect(c.对账.find((x) => x.代码 === "存在票外作业")?.通过).toBe(false); // 凭的是已作废票
    expect(c.放行).toBe(false);
  });
});

describe("人员未离场不放行", () => {
  it("进出轧差计数：进入两人离开一人仍拦", () => {
    let s = 待复电账();
    s = 记人员(s, { 票号: "JX-1001", 区间id: Q, 姓名: "陈敏", 工种: "防护员" }, "进入");
    s = 记人员(s, { 票号: "JX-1001", 区间id: Q, 姓名: "陈敏", 工种: "防护员" }, "离开");
    s = 记人员(s, { 票号: "JX-1001", 区间id: Q, 姓名: "周涛", 工种: "接触网工" }, "进入");
    expect([...在场人员(s, Q)].sort((a, b) => a.localeCompare(b))).toEqual(["周涛", "张伟"].sort((a, b) => a.localeCompare(b)));
    expect(复电对账(s, Q).对账.find((x) => x.代码 === "人员未离场")?.通过).toBe(false);
  });
});

describe("同一区间只允许一张有效票", () => {
  it("已有有效票时，第二张不能激活；排队按序，完工后才能补位", () => {
    let s = 全套账("2026-10-07T03:00:00");
    s = 下停电令(s, { 票号: "TD-1", 区间id: Q, 停电时刻: "2026-10-07T02:30:00" });
    s = 收票(s, 全票("JX-A", { 作业负责人: "A组" })).state;
    s = 走钟(s, "2026-10-07T03:01:00");
    s = 收票(s, 全票("JX-B", { 作业负责人: "B组" })).state;
    s = 走钟(s, "2026-10-07T03:02:00");
    s = 收票(s, 全票("JX-C", { 作业负责人: "C组" })).state;
    s = 走钟(s, "2026-10-07T03:03:00");
    expect(排队(s, Q).map((x) => x.票号)).toEqual(["JX-A", "JX-B", "JX-C"]);

    // 队首张不能越位激活
    expect(激活票(s, "JX-B").成功).toBe(false);
    s = 激活票(s, "JX-A").state;
    expect(有效票(s, Q)?.票号).toBe("JX-A");
    expect(激活票(s, "JX-B").原因).toContain("已有一张有效票");

    s = 完工票(s, "JX-A");
    expect(有效票(s, Q)).toBeUndefined();
    expect(排队(s, Q).map((x) => x.票号)).toEqual(["JX-B", "JX-C"]);
    s = 激活票(s, "JX-B").state;
    expect(有效票(s, Q)?.票号).toBe("JX-B");
  });

  it("未停电区间不能激活票", () => {
    let s = 全套账();
    s = 收票(s, 全票("JX-X")).state;
    expect(激活票(s, "JX-X").原因).toContain("尚未停电");
  });
});

describe("换班后原票失效并重算排队", () => {
  it("有效票与同班次排队票全部作废，新班次票重新排队", () => {
    let s = 全套账("2026-10-07T05:50:00");
    s = 下停电令(s, { 票号: "TD-1", 区间id: Q, 停电时刻: "2026-10-07T02:30:00" });
    s = 收票(s, 全票("JX-A")).state;
    s = 收票(s, 全票("JX-B")).state;
    s = 激活票(s, "JX-A").state;

    s = 走钟(s, "2026-10-07T06:00:00");
    s = 换班(s, B2);
    const A = s.检修票.find((x) => x.票号 === "JX-A")!;
    const B = s.检修票.find((x) => x.票号 === "JX-B")!;
    expect(A.状态).toBe("已作废");
    expect(A.作废原因).toContain("原票失效");
    expect(B.状态).toBe("已作废");
    expect(有效票(s, Q)).toBeUndefined();
    expect(排队(s, Q)).toHaveLength(0);

    // 乙班重新开票，从队首开始排
    s = 走钟(s, "2026-10-07T06:05:00");
    s = 收票(s, 全票("JX-D", { 班次id: B2.id, 有效起: "2026-10-07T06:00:00", 有效止: "2026-10-07T09:00:00" })).state;
    expect(排队(s, Q).map((x) => x.票号)).toEqual(["JX-D"]);
    s = 激活票(s, "JX-D").state;
    expect(有效票(s, Q)?.票号).toBe("JX-D");
  });
});

describe("断网票：先存现场，回网按票号合并", () => {
  it("离线队列回网后入账、参与排队；同票号重复上传只认一次", () => {
    let s = 全套账("2026-10-07T03:10:00");
    s = { ...s, 在线: false };
    // 现场断网连续开两张票，其中一张被两台终端重复传
    s = 存离线票(s, 全票("JX-O1", { 作业内容: "离线作业1" }), "手持终端-07");
    s = 存离线票(s, 全票("JX-O1", { 作业内容: "离线作业1-被篡改的内容" }), "手持终端-09");
    s = 存离线票(s, 全票("JX-O2", { 作业内容: "离线作业2" }), "手持终端-07");
    expect(s.检修票).toHaveLength(0); // 回网前不参与排队

    s = 下停电令(s, { 票号: "TD-1", 区间id: Q, 停电时刻: "2026-10-07T02:30:00" });
    const { state: synced, 报告 } = 回网同步(s);
    s = synced;
    expect(s.在线).toBe(true);
    expect(s.离线队列).toHaveLength(0);
    expect(报告.map((x) => [x.票号, x.结果])).toEqual([
      ["JX-O1", "新增"],
      ["JX-O1", "重复忽略"],
      ["JX-O2", "新增"],
    ]);
    // 重复上传只认第一次：作业内容不被第二份覆盖，上传次数仍为 1
    const O1 = s.检修票.find((x) => x.票号 === "JX-O1")!;
    expect(O1.作业内容).toBe("离线作业1");
    expect(O1.上传次数).toBe(1);
    // 按现场创建时刻（离线本地时刻）排队，O1 在 O2 前
    expect(排队(s, Q).map((x) => x.票号)).toEqual(["JX-O1", "JX-O2"]);
  });

  it("回网后再次上传同票号仍被忽略", () => {
    let s = 全套账("2026-10-07T03:10:00");
    s = 收票(s, 全票("JX-Z")).state;
    const again = 收票(s, 全票("JX-Z", { 作业负责人: "冒名顶替" }));
    expect(again.重复).toBe(true);
    expect(s.检修票).toHaveLength(1);
    expect(s.检修票[0].作业负责人).toBe("王军");
  });

  it("缺项票留在待补，补齐后并入队列；重复缺项票不产生副本", () => {
    let s = 全套账("2026-10-07T03:10:00");
    const 缺 = 全票("JX-M");
    // 模拟断网终端只录了部分字段
    s = { ...s, 在线: false };
    s = 存离线票(s, { 票号: "JX-M", 区间id: Q, 作业内容: "支柱检修" }, "终端-03");
    const r1 = 回网同步(s);
    s = r1.state;
    expect(r1.报告[0].结果).toBe("缺项待补");
    expect(r1.报告[0].缺失字段).toEqual(expect.arrayContaining(["作业负责人", "班组", "班次id", "有效起", "有效止"]));
    expect(s.待补).toHaveLength(1);
    expect(s.检修票).toHaveLength(0);

    // 同一缺票重复回传：只认一次，不建副本
    const dup = 收票(s, { 票号: "JX-M", 区间id: Q });
    expect(dup.重复).toBe(true);
    expect(s.待补).toHaveLength(1);

    // 逐项补齐
    s = 补票(s, "JX-M", { 作业负责人: "王军", 班组: "网电工班甲班", 班次id: B1.id });
    expect(s.待补).toHaveLength(1);
    s = 补票(s, "JX-M", { 有效起: "2026-10-07T03:20:00", 有效止: "2026-10-07T05:00:00" });
    expect(s.待补).toHaveLength(0);
    expect(s.检修票.map((x) => x.票号)).toEqual(["JX-M"]);
    expect(s.检修票[0].补录).toBe("已补全");
  });
});

describe("接地线台账", () => {
  it("拆除后不再计入未拆；反复拆同一条幂等", () => {
    let s = 待复电账();
    expect(未拆接地(s, Q)).toHaveLength(1);
    const id = s.接地[0].id;
    s = 拆接地(s, id);
    s = 拆接地(s, id);
    expect(未拆接地(s, Q)).toHaveLength(0);
  });
});
