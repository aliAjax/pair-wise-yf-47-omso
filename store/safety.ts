"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  建账, 走钟, 开事件, 事件收尾 as 事件收尾fn, 下停电令 as 下停电令fn,
  收票 as 收票fn, 补票 as 补票fn, 存离线票 as 存离线票fn, 回网同步 as 回网同步fn,
  激活票 as 激活票fn, 完工票 as 完工票fn, 换班 as 换班fn,
  记接地 as 记接地fn, 拆接地 as 拆接地fn,
  记人员 as 记人员fn, 复电对账 as 复电对账fn, 执行复电 as 执行复电fn,
  type 收票结果, type 回网结果, type 激活结果,
} from "../lib/safety/rules";
import type {
  安全账状态, 班次, 停电令, 检修票必填, 接地记录, 人员记录, 出入方向, 合并报告项,
} from "../lib/safety/types";

export const 演示区间 = { id: "Q-BJ-HZ", 名称: "滨江—会展中心 下行区间" };
export const 甲班: 班次 = { id: "banci-jia", 名称: "甲班 02:00–06:00", 开始时刻: "2026-10-07T02:00:00" };
export const 乙班: 班次 = { id: "banci-yi", 名称: "乙班 06:00–10:00", 开始时刻: "2026-10-07T06:00:00" };

const 基准 = "2026-10-07T03:10:00";
// 全部时间戳统一用「本地时钟」的 YYYY-MM-DDTHH:mm:ss 字符串，避免与 toISOString 的 UTC 口径混用
const 本地时分秒 = (d: Date) => {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function 初始账(): 安全账状态 {
  let s = 建账(基准, true);
  s = 开事件(s, {
    id: "INC-20261007-02",
    标题: "滨江站积水停运 · 接触网检修",
    区间id: 演示区间.id,
    当前班次id: 甲班.id,
    开工时刻: "2026-10-07T02:20:00",
  });
  s = { ...s, 区间表: [演示区间], 班次表: [甲班] };
  return s;
}

interface SafetyStore {
  账: 安全账状态;
  最近报告: 合并报告项[] | null;
  推进分钟: (n: number) => void;
  设在线: (在线: boolean) => void;
  重置: () => void;

  收尾: () => void;
  停电: () => void;

  传票: (raw: Partial<检修票必填> & { 创建时刻?: string }) => 收票结果;
  补录: (票号: string, 补丁: Partial<检修票必填>) => void;
  离线存: (raw: Partial<检修票必填>, 设备: string) => void;
  回网: () => 回网结果;
  激活: (票号: string) => 激活结果;
  完工: (票号: string) => void;
  换班: (新: 班次) => void;

  挂接地: (r: Omit<接地记录, "id" | "状态" | "拆除时刻" | "挂设时刻">) => void;
  拆接地: (id: string) => void;
  登记人员: (r: Omit<人员记录, "id" | "方向" | "时刻">, 方向: 出入方向) => void;

  对账: () => ReturnType<typeof 复电对账fn>;
  复电: () => ReturnType<typeof 执行复电fn>;
}

const 停电令模板 = (时钟: string): Omit<停电令, "复电时刻"> => ({
  票号: "TD-20261007-11",
  区间id: 演示区间.id,
  停电时刻: 时钟,
});

export const useSafetyStore = create<SafetyStore>()(persist((set, get) => ({
  账: 初始账(),
  最近报告: null,

  推进分钟: (n) => set((s) => ({ 账: 走钟(s.账, 本地时分秒(new Date(new Date(s.账.时钟).getTime() + n * 60000))) })),
  设在线: (在线) => set((s) => ({ 账: 走钟(s.账, s.账.时钟, 在线) })),
  重置: () => set({ 账: 初始账(), 最近报告: null }),

  收尾: () => set((s) => ({ 账: 事件收尾fn(s.账) })),
  停电: () => set((s) => ({ 账: 下停电令fn(s.账, 停电令模板(s.账.时钟)) })),

  传票: (raw) => {
    const r = 收票fn(get().账, raw);
    set({ 账: r.state });
    return r;
  },
  补录: (票号, 补丁) => set((s) => ({ 账: 补票fn(s.账, 票号, 补丁) })),
  离线存: (raw, 设备) => set((s) => ({ 账: 存离线票fn(s.账, raw, 设备) })),
  回网: () => {
    const r = 回网同步fn(get().账);
    set({ 账: r.state, 最近报告: r.报告 });
    return r;
  },
  激活: (票号) => {
    const r = 激活票fn(get().账, 票号);
    if (r.成功) set({ 账: r.state });
    return r;
  },
  完工: (票号) => set((s) => ({ 账: 完工票fn(s.账, 票号) })),
  换班: (新) => set((s) => ({ 账: 换班fn(s.账, 新) })),

  挂接地: (r) => set((s) => ({ 账: 记接地fn(s.账, r) })),
  拆接地: (id) => set((s) => ({ 账: 拆接地fn(s.账, id) })),
  登记人员: (r, 方向) => set((s) => ({ 账: 记人员fn(s.账, r, 方向) })),

  对账: () => 复电对账fn(get().账, 演示区间.id),
  复电: () => {
    const r = 执行复电fn(get().账, 演示区间.id);
    set({ 账: r.state });
    return r;
  },
}), { name: "pair-wise-yf-47/safety-ledger" }));
