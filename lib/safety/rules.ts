// 安全账业务规则：全部为纯函数，状态不可变更新。
import type {
  安全账状态, 事件, 停电令, 检修票, 检修票必填, 接地记录, 人员记录,
  接地状态, 出入方向, 对账项, 放行结论, 班次, 票状态,
  离线传票, 合并报告项,
} from "./types";

let seq = 0;
export const 内部id = (前缀: string) => `${前缀}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const 必填字段: (keyof 检修票必填)[] = [
  "票号", "区间id", "作业内容", "作业负责人", "班组", "班次id", "有效起", "有效止",
];

export function 缺失字段(draft: Partial<检修票必填>): string[] {
  return 必填字段.filter((字段) => {
    const 值 = draft[字段];
    return 值 === undefined || 值 === null || (typeof 值 === "string" && 值.trim() === "");
  });
}

export function 建账(时钟: string, 在线 = true): 安全账状态 {
  return {
    时钟, 在线,
    区间表: [], 班次表: [],
    停电令: [], 检修票: [], 接地: [], 人员: [], 待补: [], 离线队列: [],
  };
}

export function 走钟(state: 安全账状态, 时钟: string, 在线?: boolean): 安全账状态 {
  return { ...state, 时钟, 在线: 在线 ?? state.在线 };
}

// ---------- 事件收尾 ----------
export function 开事件(state: 安全账状态, 事件: Omit<事件, "停电状态">): 安全账状态 {
  return { ...state, 事件: { ...事件, 停电状态: "已送电" } };
}

export function 事件收尾(state: 安全账状态): 安全账状态 {
  if (!state.事件) return state;
  return { ...state, 事件: { ...state.事件, 收尾时刻: state.时钟 } };
}

// ---------- 区间停电 ----------
export function 下停电令(state: 安全账状态, 令: Omit<停电令, "复电时刻">): 安全账状态 {
  return { ...state, 停电令: [...state.停电令.filter((x) => x.区间id !== 令.区间id), { ...令, 复电时刻: undefined }] };
}

export function 当前停电令(state: 安全账状态, 区间id: string): 停电令 | undefined {
  return state.停电令.find((x) => x.区间id === 区间id && !x.复电时刻);
}

// ---------- 检修票排队 / 激活 ----------
const 未终结 = (票: 检修票) => 票.状态 === "有效" || 票.状态 === "排队中";

/** 同区间排队票按创建时刻稳定排序，重算排队序号。 */
export function 重算排队(票表: 检修票[]): 检修票[] {
  const 顺序 = new Map<string, 检修票[]>();
  for (const 票 of 票表) {
    if (票.状态 !== "排队中") continue;
    顺序.set(票.区间id, [...(顺序.get(票.区间id) ?? []), 票]);
  }
  const 序号表 = new Map<string, string[]>();
  for (const [区间id, 列] of 顺序) {
    列.sort((a, b) => a.创建时刻.localeCompare(b.创建时刻) || a.票号.localeCompare(b.票号));
    序号表.set(区间id, 列.map((x) => x.票号));
  }
  return 票表.map((票) => {
    if (票.状态 !== "排队中") return 票;
    const 位 = 序号表.get(票.区间id)?.indexOf(票.票号);
    return 位 === undefined || 位 < 0 ? 票 : { ...票, 排队序号: 位 + 1 };
  });
}

export interface 收票结果 { state: 安全账状态; 票: 检修票 | undefined; 重复: boolean; 缺项: boolean; }

/**
 * 入账一张票（在线即时传 / 回网合并都走这里，保证幂等）：
 * - 按票号合并：票号已存在则重复上传只认一次，不覆盖任何字段；
 * - 缺必填项不进队列，留在「待补」；
 * - 齐全则进区间排队队列并自动重算排队。
 */
export function 收票(state: 安全账状态, raw: Partial<检修票必填> & { 创建时刻?: string }): 收票结果 {
  const 票号 = (raw.票号 ?? "").trim();
  if (!票号) throw new Error("票号为空，无法入账");

  const 已有 = state.检修票.find((x) => x.票号 === 票号) ?? state.待补.find((x) => x.票号 === 票号);
  if (已有) return { state, 票: 已有, 重复: true, 缺项: 已有.补录 === "待补录" };

  const 缺 = 缺失字段(raw);
  const 票: 检修票 = {
    票号,
    区间id: raw.区间id ?? "",
    作业内容: raw.作业内容 ?? "",
    作业负责人: raw.作业负责人 ?? "",
    班组: raw.班组 ?? "",
    班次id: raw.班次id ?? "",
    有效起: raw.有效起 ?? "",
    有效止: raw.有效止 ?? "",
    状态: "排队中",
    创建时刻: raw.创建时刻 ?? state.时钟,
    补录: 缺.length ? "待补录" : "已补全",
    缺失字段: 缺,
    上传次数: 1,
  };

  if (缺.length) {
    return { state: { ...state, 待补: [...state.待补, 票] }, 票, 重复: false, 缺项: true };
  }
  return { state: { ...state, 检修票: 重算排队([...state.检修票, 票]) }, 票, 重复: false, 缺项: false };
}

/** 现场补录缺项；全部补齐后从待补并入正式排队队列（仍按创建时刻排队）。 */
export function 补票(state: 安全账状态, 票号: string, 补丁: Partial<检修票必填>): 安全账状态 {
  const 待补票 = state.待补.find((x) => x.票号 === 票号);
  if (待补票) {
    const 合并稿 = { ...待补票, ...补丁 };
    const 缺 = 缺失字段(合并稿);
    const 新票: 检修票 = { ...合并稿, 缺失字段: 缺, 补录: 缺.length ? "待补录" : "已补全", 上传次数: 待补票.上传次数 + 1 };
    if (缺.length) {
      return { ...state, 待补: state.待补.map((x) => (x.票号 === 票号 ? 新票 : x)) };
    }
    return {
      ...state,
      待补: state.待补.filter((x) => x.票号 !== 票号),
      检修票: 重算排队([...state.检修票, { ...新票, 状态: "排队中" }]),
    };
  }
  return {
    ...state,
    检修票: state.检修票.map((x) => (x.票号 === 票号 ? { ...x, ...补丁, 上传次数: x.上传次数 + 1 } : x)),
  };
}

/** 断网时票先存现场：进入设备本地离线队列，回网前不参与排队/对账。 */
export function 存离线票(state: 安全账状态, raw: Partial<检修票必填>, 设备: string): 安全账状态 {
  const 条: 离线传票 = { raw, 本地时刻: state.时钟, 设备 };
  return { ...state, 离线队列: [...state.离线队列, 条] };
}

export interface 回网结果 { state: 安全账状态; 报告: 合并报告项[] }

/** 回网：按票号把本地队列逐张合并入账；重复上传只认一次，缺项留在待补。 */
export function 回网同步(state: 安全账状态): 回网结果 {
  const 报告: 合并报告项[] = [];
  let 工作 = state;
  // 同一批次内同票号也只认第一次：收票本身按票号幂等，天然丢弃后续重复
  for (const 条 of state.离线队列) {
    const 结果 = 收票(工作, { ...条.raw, 创建时刻: 条.本地时刻 });
    工作 = 结果.state;
    if (结果.重复) {
      报告.push({ 票号: 条.raw.票号 ?? "(空票号)", 结果: "重复忽略", 缺失字段: [] });
    } else if (结果.缺项) {
      报告.push({ 票号: 条.raw.票号 ?? "(空票号)", 结果: "缺项待补", 缺失字段: 结果.票?.缺失字段 ?? [] });
    } else {
      报告.push({ 票号: 条.raw.票号 ?? "", 结果: "新增", 缺失字段: [] });
    }
  }
  return { state: { ...工作, 离线队列: [], 在线: true }, 报告 };
}

export function 排队(state: 安全账状态, 区间id: string): 检修票[] {
  return state.检修票
    .filter((x) => x.区间id === 区间id && x.状态 === "排队中")
    .sort((a, b) => (a.排队序号 ?? 0) - (b.排队序号 ?? 0));
}

export function 有效票(state: 安全账状态, 区间id: string): 检修票 | undefined {
  return state.检修票.find((x) => x.区间id === 区间id && x.状态 === "有效");
}

export function 票是否过期(票: 检修票, 时钟: string): boolean {
  return 时钟 < 票.有效起 || 时钟 > 票.有效止;
}

export interface 激活结果 { state: 安全账状态; 成功: boolean; 原因?: string }

/** 激活队首票：同一区间只允许一张有效票，且必须已停电、票在有效期、字段齐全。 */
export function 激活票(state: 安全账状态, 票号: string): 激活结果 {
  const 票 = state.检修票.find((x) => x.票号 === 票号);
  if (!票) return { state, 成功: false, 原因: "票不存在" };
  if (票.补录 === "待补录") return { state, 成功: false, 原因: `缺项未补：${票.缺失字段.join("、")}` };
  if (票.状态 !== "排队中") return { state, 成功: false, 原因: "该票不在排队队列" };
  if (有效票(state, 票.区间id)) return { state, 成功: false, 原因: "同一区间已有一张有效票" };
  const 队首 = 排队(state, 票.区间id)[0];
  if (队首?.票号 !== 票号) return { state, 成功: false, 原因: `前面还有排队票（队首 ${队首?.票号 ?? "无"}）` };
  if (!当前停电令(state, 票.区间id)) return { state, 成功: false, 原因: "区间尚未停电，禁止开工" };
  if (state.时钟 < 票.有效起) return { state, 成功: false, 原因: `未到票的生效时间（${票.有效起}）` };
  if (state.时钟 > 票.有效止) return { state, 成功: false, 原因: `票已于 ${票.有效止} 过期` };

  const 票表 = state.检修票.map((x) =>
    x.票号 === 票号 ? { ...x, 状态: "有效" as 票状态, 激活时刻: state.时钟 } : x,
  );
  return { state: { ...state, 检修票: 重算排队(票表) }, 成功: true };
}

export function 完工票(state: 安全账状态, 票号: string): 安全账状态 {
  const 票表 = state.检修票.map((x) =>
    x.票号 === 票号 && x.状态 === "有效" ? { ...x, 状态: "已完工" as 票状态, 完工时刻: state.时钟 } : x,
  );
  return { ...state, 检修票: 重算排队(票表) };
}

/**
 * 换班：当前班次下未终结的票（有效 + 排队）一律作废——原票失效；
 * 其余票按区间重算排队。接地、人员记录不随换班消失，继续留在区间账上接受对账。
 */
export function 换班(state: 安全账状态, 新班次: 班次): 安全账状态 {
  const 旧班次id = state.事件?.当前班次id;
  let 票表 = state.检修票.map((票) =>
    未终结(票) && 票.班次id === 旧班次id
      ? { ...票, 状态: "已作废" as 票状态, 作废时刻: state.时钟, 作废原因: `换班至${新班次.名称}，原票失效`, 排队序号: undefined }
      : 票,
  );
  票表 = 重算排队(票表);
  return {
    ...state,
    班次表: state.班次表.some((x) => x.id === 新班次.id) ? state.班次表 : [...state.班次表, 新班次],
    事件: state.事件 ? { ...state.事件, 当前班次id: 新班次.id } : undefined,
    检修票: 票表,
  };
}

// ---------- 接地线 ----------
export function 记接地(state: 安全账状态, 记录: Omit<接地记录, "id" | "状态" | "拆除时刻" | "挂设时刻">): 安全账状态 {
  return { ...state, 接地: [...state.接地, { ...记录, id: 内部id("gd"), 状态: "已挂设", 挂设时刻: state.时钟 }] };
}

export function 拆接地(state: 安全账状态, id: string): 安全账状态 {
  return {
    ...state,
    接地: state.接地.map((x) =>
      x.id === id && x.状态 === "已挂设" ? { ...x, 状态: "已拆除" as 接地状态, 拆除时刻: state.时钟 } : x,
    ),
  };
}

export function 未拆接地(state: 安全账状态, 区间id: string): 接地记录[] {
  return state.接地.filter((x) => x.区间id === 区间id && x.状态 === "已挂设");
}

// ---------- 人员进出 ----------
export function 记人员(state: 安全账状态, 记录: Omit<人员记录, "id" | "方向" | "时刻">, 方向: 出入方向): 安全账状态 {
  return { ...state, 人员: [...state.人员, { ...记录, id: 内部id("ry"), 方向, 时刻: state.时钟 }] };
}

/** 按进入/离开流水轧差，仍在区间内的人员名单。 */
export function 在场人员(state: 安全账状态, 区间id: string): string[] {
  const 计数 = new Map<string, number>();
  for (const r of state.人员.filter((x) => x.区间id === 区间id)) {
    计数.set(r.姓名, (计数.get(r.姓名) ?? 0) + (r.方向 === "进入" ? 1 : -1));
  }
  return [...计数].filter(([, n]) => n > 0).map(([姓名]) => 姓名);
}

// ---------- 复电前逐项对账 ----------
/** 仍挂接地线、仍在场人员所凭的票号——用来识别票外作业。 */
export function 开放证据票号(state: 安全账状态, 区间id: string): Set<string> {
  const 票号 = new Set<string>();
  for (const g of 未拆接地(state, 区间id)) 票号.add(g.票号);
  for (const 姓名 of 在场人员(state, 区间id)) {
    const last = [...state.人员].reverse().find(
      (x) => x.区间id === 区间id && x.姓名 === 姓名 && x.方向 === "进入",
    );
    if (last) 票号.add(last.票号);
  }
  return 票号;
}

export function 复电对账(state: 安全账状态, 区间id: string): 放行结论 {
  const 对账: 对账项[] = [];
  const 事件 = state.事件;
  const 停电令 = 当前停电令(state, 区间id);
  const 票 = 有效票(state, 区间id);
  const 在场 = 在场人员(state, 区间id);
  const 未拆 = 未拆接地(state, 区间id);
  const 证据票号 = 开放证据票号(state, 区间id);
  // 最近一张覆盖本区间、已正式入账的检修票（不限状态），用于说明票账去向
  const 最近票 = [...state.检修票].reverse().find((x) => x.区间id === 区间id);
  const 票外 = [...证据票号].filter((号) => 号 !== 票?.票号);

  对账.push({
    代码: "事件未收尾",
    通过: Boolean(事件?.收尾时刻),
    说明: 事件?.收尾时刻 ? `事件已于 ${事件.收尾时刻.slice(11, 16)} 收尾` : "事件尚未办理收尾",
  });
  对账.push({
    代码: "停电令缺失",
    通过: Boolean(停电令),
    说明: 停电令 ? `停电令 ${停电令.票号} 在档，区间停电中` : "查不到该区间的有效停电令",
  });
  // 票况：有效票过期→拦；有效票未完工→先完工再复电；票已完工/作废且现场清零→可放行
  if (票) {
    if (state.时钟 > 票.有效止) {
      对账.push({ 代码: "票况", 通过: false, 说明: `有效票 ${票.票号} 已于 ${票.有效止.slice(11, 16)} 过期，必须续票后再复电` });
    } else if (state.时钟 < 票.有效起) {
      对账.push({ 代码: "票况", 通过: false, 说明: `有效票 ${票.票号} 要到 ${票.有效起.slice(11, 16)} 才生效` });
    } else {
      对账.push({ 代码: "票况", 通过: false, 说明: `有效票 ${票.票号} 尚未完工，请先办理票完工再申请复电` });
    }
  } else if (最近票?.状态 === "已完工") {
    对账.push({ 代码: "票况", 通过: true, 说明: `检修票 ${最近票.票号} 已完工，票账闭环` });
  } else if (最近票?.状态 === "已作废") {
    对账.push({
      代码: "票况",
      通过: 证据票号.size === 0,
      说明: 证据票号.size
        ? `最近一张票 ${最近票.票号} 已作废，但现场仍有作业证据，按票外作业处理`
        : `检修票 ${最近票.票号} 已作废，现场无遗留`,
    });
  } else {
    对账.push({ 代码: "票况", 通过: 证据票号.size === 0, 说明: 证据票号.size ? "无有效检修票，现场却有作业证据" : "区间内无在途检修票" });
  }
  对账.push({
    代码: "存在票外作业",
    通过: 票外.length === 0,
    说明: 票外.length
      ? `发现凭非有效票的未闭环证据：${[...new Set(票外)].join("、")}（排队票/过期票/作废票遗留均算票外作业）`
      : 证据票号.size
        ? "在途作业全部挂在有效票下"
        : "无票外作业证据",
  });
  对账.push({
    代码: "接地线未拆净",
    通过: 未拆.length === 0,
    说明: 未拆.length
      ? `还有 ${未拆.length} 组接地线未拆除：${未拆.map((x) => `${x.位置}（凭${x.票号}）`).join("、")}`
      : "接地线已全部拆除并复核",
  });
  对账.push({
    代码: "人员未离场",
    通过: 在场.length === 0,
    说明: 在场.length ? `仍有 ${在场.length} 人在区间：${在场.join("、")}` : "人员已全部离场清点完毕",
  });

  return { 放行: 对账.every((x) => x.通过), 时刻: state.时钟, 对账 };
}

/** 只有逐项对账全绿才允许复电：记复电时刻、有效票自动完工、事件回到已送电。 */
export function 执行复电(state: 安全账状态, 区间id: string): { 结论: 放行结论; state: 安全账状态 } {
  const 结论 = 复电对账(state, 区间id);
  if (!结论.放行) return { 结论, state };

  const 票 = 有效票(state, 区间id);
  const 票表 = 票
    ? state.检修票.map((x) =>
        x.票号 === 票.票号
          ? { ...x, 状态: "已完工" as 票状态, 完工时刻: state.时钟, 作废原因: x.作废原因 }
          : x,
      )
    : state.检修票;
  const 停电令 = state.停电令.map((令) =>
    令.区间id === 区间id && !令.复电时刻 ? { ...令, 复电时刻: state.时钟 } : 令,
  );
  return {
    结论,
    state: {
      ...state,
      停电令,
      检修票: 重算排队(票表),
      事件: state.事件 ? { ...state.事件, 停电状态: "已送电" } : undefined,
    },
  };
}
