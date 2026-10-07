// Quick logic verification for the maintenance safety ledger.
// Mocks browser globals so the zustand store can run in Node.
import { webcrypto } from "node:crypto";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, v),
  removeItem: (k) => void store.delete(k)
};

const { useMaintenanceStore, reconcileSection, computeMissing } = await import("./store/maintenance");

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ FAIL: ${msg}`); }
}

const state = useMaintenanceStore.getState();

console.log("\n[1] 对账：初始状态 sec1 有有效票+接地+人员，不应放行");
{
  const r = reconcileSection("sec1", state);
  assert(r.canRestore === false, "sec1 不放行");
  const failed = r.items.filter((i) => !i.pass).map((i) => i.key);
  assert(failed.includes("ticket"), "票证检查未通过");
  assert(failed.includes("ground"), "接地检查未通过");
  assert(failed.includes("people"), "人员检查未通过");
}

console.log("\n[2] 对账：sec3 已复电且无有效票/接地/人员，应放行");
{
  const r = reconcileSection("sec3", state);
  assert(r.canRestore === true, "sec3 可复电");
}

console.log("\n[3] 同一区间只允许一张有效票");
{
  const active = state.tickets.filter((t) => t.sectionId === "sec1" && t.status === "有效");
  assert(active.length === 1, `sec1 只有一张有效票（实际 ${active.length}）`);
}

console.log("\n[4] 换班后原票失效，队列重算");
{
  const before = state.tickets.filter((t) => t.sectionId === "sec1" && t.status === "有效").map((t) => t.ticketNo);
  state.shiftChange("sec1");
  const after = useMaintenanceStore.getState().tickets.filter((t) => t.sectionId === "sec1" && t.status === "有效").map((t) => t.ticketNo);
  assert(before[0] === "JX-20261007-01", "换班前有效票为 JX-20261007-01");
  assert(after[0] === "JX-20261007-02", `换班后有效票重算为 JX-20261007-02（实际 ${after[0]}）`);
  const old = useMaintenanceStore.getState().tickets.find((t) => t.ticketNo === "JX-20261007-01");
  assert(old?.status === "已注销", "原票已注销");
}

console.log("\n[5] 票外作业检查：接地/人员必须凭有效票");
{
  // sec2 有效票是 tk3，接地 gr3 挂在 tk3 上 → 合法
  const r = reconcileSection("sec2", useMaintenanceStore.getState());
  const illegal = r.items.find((i) => i.key === "illegal");
  assert(illegal?.pass === true, "sec2 无票外作业");
}

console.log("\n[6] 离线票存现场，回网按票号合并，重复只认一次");
{
  // 模拟离线开两张票：一张新票号，一张与已有重复
  state.addTicket({ ticketNo: "JX-20261007-99", sectionId: "sec3", type: "接触网检修", shift: "甲班", scope: "测试范围", workItems: ["巡检"], validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 3600000).toISOString() }, false);
  state.addTicket({ ticketNo: "JX-20261007-01", sectionId: "sec3", type: "接触网检修", shift: "甲班", scope: "重复票", workItems: ["巡检"], validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 3600000).toISOString() }, false);
  const before = useMaintenanceStore.getState().tickets.filter((t) => t.syncStatus === "待上传").length;
  assert(before === 2, `离线票进入待上传队列（实际 ${before}）`);
  useMaintenanceStore.getState().syncTickets();
  const after = useMaintenanceStore.getState();
  const newTicket = after.tickets.find((t) => t.ticketNo === "JX-20261007-99");
  const dupTicket = after.tickets.find((t) => t.ticketNo === "JX-20261007-01" && t.scope === "重复票");
  assert(newTicket?.syncStatus === "已同步", "新票已同步");
  assert(dupTicket?.syncStatus === "重复", "重复票标记为重复，只认一次");
}

console.log("\n[7] 缺项留在待补");
{
  const r = reconcileSection("sec1", useMaintenanceStore.getState());
  const sup = r.items.find((i) => i.key === "supplement");
  assert(sup?.pass === false, "sec1 存在待补缺项（tk5 缺作业范围）");
  const tk5 = useMaintenanceStore.getState().tickets.find((t) => t.ticketNo === "JX-20261007-05");
  assert(tk5?.syncStatus === "待补", "tk5 标记待补");
}

console.log("\n[8] 补全缺项后重新进入队列");
{
  state.supplementTicket("tk5", { scope: "中心站至滨江站下行接触网" });
  const tk5 = useMaintenanceStore.getState().tickets.find((t) => t.id === "tk5");
  assert(tk5?.syncStatus === "待上传", "补全后转为待上传");
  assert(tk5?.missingFields.length === 0, "缺项已清空");
}

console.log("\n[9] 复电对账通过后才放行复电");
{
  // sec1 当前仍有接地/人员，powerRestore 应拒绝
  const r1 = state.powerRestore("sec1", "调度员");
  assert(r1.canRestore === false, "sec1 对账未通过，拒绝复电");
  const sec1 = useMaintenanceStore.getState().sections.find((s) => s.id === "sec1");
  assert(sec1?.powerStatus === "停电", "sec1 仍停电");
}

console.log("\n[10] computeMissing 缺项检测");
{
  const missing = computeMissing({ ticketNo: "X1", sectionId: "sec1" });
  assert(missing.includes("作业类型"), "缺作业类型");
  assert(missing.includes("班组"), "缺班组");
  assert(missing.includes("作业范围"), "缺作业范围");
  assert(missing.includes("截止时间"), "缺截止时间");
  assert(!missing.includes("票号"), "票号已填不缺");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
