import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TicketStatus = "待生效" | "有效" | "已过期" | "已核销" | "已注销";
export type PowerStatus = "停电" | "待复电" | "已复电";
export type GroundStatus = "已挂设" | "已拆除";
export type PersonStatus = "在场" | "已离场";
export type SyncStatus = "已同步" | "待上传" | "待补" | "重复";

export interface Section {
  id: string;
  name: string;
  powerStatus: PowerStatus;
}

export interface WorkTicket {
  id: string;
  ticketNo: string;
  sectionId: string;
  type: string;
  shift: string;
  scope: string;
  workItems: string[];
  validFrom: string;
  validTo: string;
  status: TicketStatus;
  syncStatus: SyncStatus;
  missingFields: string[];
  createdAt: string;
}

export interface GroundRecord {
  id: string;
  ticketId: string;
  ticketNo: string;
  sectionId: string;
  rodNo: string;
  location: string;
  hungAt: string;
  removedAt?: string;
  status: GroundStatus;
}

export interface PersonRecord {
  id: string;
  ticketId: string;
  ticketNo: string;
  sectionId: string;
  name: string;
  badge: string;
  enteredAt: string;
  exitedAt?: string;
  status: PersonStatus;
}

export interface PowerRecord {
  id: string;
  sectionId: string;
  type: "停电" | "复电";
  time: string;
  operator: string;
  note?: string;
}

export interface CheckItem {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface ReconcileResult {
  sectionId: string;
  canRestore: boolean;
  items: CheckItem[];
  checkedAt: string;
}

export interface TicketInput {
  ticketNo: string;
  sectionId: string;
  type: string;
  shift: string;
  scope: string;
  workItems: string[];
  validFrom: string;
  validTo: string;
}

interface MaintenanceState {
  sections: Section[];
  tickets: WorkTicket[];
  grounds: GroundRecord[];
  people: PersonRecord[];
  powerLog: PowerRecord[];
  reconciliations: Record<string, ReconcileResult>;
  eventClosed: boolean;
  addTicket: (input: TicketInput, online: boolean) => void;
  verifyTicket: (id: string) => void;
  cancelTicket: (id: string) => void;
  shiftChange: (sectionId: string) => void;
  supplementTicket: (id: string, fields: Partial<TicketInput>) => void;
  syncTickets: () => void;
  addGround: (input: Omit<GroundRecord, "id" | "status" | "hungAt" | "removedAt">) => void;
  removeGround: (id: string) => void;
  addPerson: (input: Omit<PersonRecord, "id" | "status" | "enteredAt" | "exitedAt">) => void;
  exitPerson: (id: string) => void;
  powerOutage: (sectionId: string, operator: string, note?: string) => void;
  powerRestore: (sectionId: string, operator: string) => ReconcileResult;
  closeEvent: () => void;
}

const now = () => new Date().toISOString();
const min = (m: number) => new Date(Date.now() - m * 60000).toISOString();
const ahead = (m: number) => new Date(Date.now() + m * 60000).toISOString();

const REQUIRED_FIELDS: { key: keyof TicketInput; label: string }[] = [
  { key: "ticketNo", label: "票号" },
  { key: "sectionId", label: "作业区间" },
  { key: "type", label: "作业类型" },
  { key: "shift", label: "班组" },
  { key: "scope", label: "作业范围" },
  { key: "validTo", label: "截止时间" }
];

export function computeMissing(input: Partial<TicketInput>): string[] {
  return REQUIRED_FIELDS.filter(({ key }) => {
    const value = input[key];
    return value === undefined || value === null || value === "";
  }).map((item) => item.label);
}

/** 同一区间只允许一张有效票：有效票核销/注销/换班后，排队的第一张待生效票自动生效。 */
function activateNext(tickets: WorkTicket[], sectionId: string): WorkTicket[] {
  const hasActive = tickets.some((ticket) => ticket.sectionId === sectionId && ticket.status === "有效");
  if (hasActive) return tickets;
  const waiting = tickets
    .filter((ticket) => ticket.sectionId === sectionId && ticket.status === "待生效" && ticket.syncStatus !== "待补")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!waiting.length) return tickets;
  const next = waiting[0];
  return tickets.map((ticket) => (ticket.id === next.id ? { ...ticket, status: "有效" } : ticket));
}

/** 复电前逐项对账：票过期、票外作业、接地线未拆、人员未离场、缺项待补，任一不通过即不放行。 */
export function reconcileSection(sectionId: string, data: {
  tickets: WorkTicket[];
  grounds: GroundRecord[];
  people: PersonRecord[];
}): ReconcileResult {
  const items: CheckItem[] = [];
  const ticketMap = new Map(data.tickets.map((ticket) => [ticket.id, ticket]));
  const sectionTickets = data.tickets.filter((ticket) => ticket.sectionId === sectionId);

  const activeTickets = sectionTickets.filter((ticket) => ticket.status === "有效");
  items.push({
    key: "ticket",
    label: "检修票已核销",
    pass: activeTickets.length === 0,
    detail: activeTickets.length
      ? `仍有 ${activeTickets.length} 张有效票未核销：${activeTickets.map((ticket) => ticket.ticketNo).join("、")}`
      : "区间内无有效票，检修均已收尾"
  });

  const expired = sectionTickets.filter((ticket) => ticket.status === "有效" && new Date(ticket.validTo).getTime() < Date.now());
  items.push({
    key: "expired",
    label: "无过期票",
    pass: expired.length === 0,
    detail: expired.length
      ? `${expired.length} 张票已过期仍未核销：${expired.map((ticket) => ticket.ticketNo).join("、")}`
      : "无过期票"
  });

  const illegalGround = data.grounds.filter(
    (ground) =>
      ground.sectionId === sectionId &&
      ground.status === "已挂设" &&
      (() => {
        const ticket = ticketMap.get(ground.ticketId);
        return !ticket || (ticket.status !== "有效" && ticket.status !== "已核销");
      })()
  );
  const illegalPeople = data.people.filter(
    (person) =>
      person.sectionId === sectionId &&
      person.status === "在场" &&
      (() => {
        const ticket = ticketMap.get(person.ticketId);
        return !ticket || (ticket.status !== "有效" && ticket.status !== "已核销");
      })()
  );
  items.push({
    key: "illegal",
    label: "无票外作业",
    pass: illegalGround.length === 0 && illegalPeople.length === 0,
    detail:
      illegalGround.length || illegalPeople.length
        ? `票外挂设接地线 ${illegalGround.length} 处、票外进场 ${illegalPeople.length} 人`
        : "接地与人员均凭票作业"
  });

  const hungGrounds = data.grounds.filter((ground) => ground.sectionId === sectionId && ground.status === "已挂设");
  items.push({
    key: "ground",
    label: "接地线已全部拆除",
    pass: hungGrounds.length === 0,
    detail: hungGrounds.length
      ? `仍有 ${hungGrounds.length} 组接地线未拆除：${hungGrounds.map((ground) => ground.rodNo).join("、")}`
      : "接地线均已拆除并记录"
  });

  const onSite = data.people.filter((person) => person.sectionId === sectionId && person.status === "在场");
  items.push({
    key: "people",
    label: "人员已全部离场",
    pass: onSite.length === 0,
    detail: onSite.length
      ? `仍有 ${onSite.length} 人未离场：${onSite.map((person) => person.name).join("、")}`
      : "现场人员均已离场"
  });

  const pendingSupplement = sectionTickets.filter((ticket) => ticket.syncStatus === "待补");
  items.push({
    key: "supplement",
    label: "无待补缺项",
    pass: pendingSupplement.length === 0,
    detail: pendingSupplement.length
      ? `${pendingSupplement.length} 张票缺项待补：${pendingSupplement.map((ticket) => ticket.ticketNo).join("、")}`
      : "票证资料齐全"
  });

  return { sectionId, canRestore: items.every((item) => item.pass), items, checkedAt: now() };
}

const seedSections: Section[] = [
  { id: "sec1", name: "中心—滨江 供电臂", powerStatus: "停电" },
  { id: "sec2", name: "会展—滨江 供电臂", powerStatus: "停电" },
  { id: "sec3", name: "滨江—东港 供电臂", powerStatus: "已复电" }
];

const seedTickets: WorkTicket[] = [
  {
    id: "tk1",
    ticketNo: "JX-20261007-01",
    sectionId: "sec1",
    type: "接触网检修",
    shift: "甲班",
    scope: "中心站至滨江站上行接触网",
    workItems: ["绝缘子清扫", "导线接头检查"],
    validFrom: min(30),
    validTo: ahead(90),
    status: "有效",
    syncStatus: "已同步",
    missingFields: [],
    createdAt: min(31)
  },
  {
    id: "tk2",
    ticketNo: "JX-20261007-02",
    sectionId: "sec1",
    type: "接触网检修",
    shift: "乙班",
    scope: "中心站至滨江站下行接触网",
    workItems: ["磨耗测量"],
    validFrom: ahead(90),
    validTo: ahead(200),
    status: "待生效",
    syncStatus: "已同步",
    missingFields: [],
    createdAt: min(20)
  },
  {
    id: "tk3",
    ticketNo: "JX-20261007-03",
    sectionId: "sec2",
    type: "接触网检修",
    shift: "甲班",
    scope: "会展站至滨江站接触网",
    workItems: ["定位器调整"],
    validFrom: min(25),
    validTo: ahead(95),
    status: "有效",
    syncStatus: "已同步",
    missingFields: [],
    createdAt: min(26)
  },
  {
    id: "tk4",
    ticketNo: "JX-20261007-04",
    sectionId: "sec3",
    type: "接触网检修",
    shift: "甲班",
    scope: "滨江站至东港站接触网",
    workItems: ["设备巡检"],
    validFrom: min(200),
    validTo: min(10),
    status: "已核销",
    syncStatus: "已同步",
    missingFields: [],
    createdAt: min(210)
  },
  {
    id: "tk5",
    ticketNo: "JX-20261007-05",
    sectionId: "sec1",
    type: "接触网检修",
    shift: "乙班",
    scope: "",
    workItems: ["接地极检查"],
    validFrom: ahead(200),
    validTo: ahead(300),
    status: "待生效",
    syncStatus: "待补",
    missingFields: ["作业范围"],
    createdAt: min(15)
  }
];

const seedGrounds: GroundRecord[] = [
  { id: "gr1", ticketId: "tk1", ticketNo: "JX-20261007-01", sectionId: "sec1", rodNo: "JD-01", location: "K12+300 上行", hungAt: min(28), status: "已挂设" },
  { id: "gr2", ticketId: "tk1", ticketNo: "JX-20261007-01", sectionId: "sec1", rodNo: "JD-02", location: "K12+800 上行", hungAt: min(27), status: "已挂设" },
  { id: "gr3", ticketId: "tk3", ticketNo: "JX-20261007-03", sectionId: "sec2", rodNo: "JD-03", location: "K15+100", hungAt: min(24), status: "已挂设" }
];

const seedPeople: PersonRecord[] = [
  { id: "pe1", ticketId: "tk1", ticketNo: "JX-20261007-01", sectionId: "sec1", name: "张建国", badge: "GD-1023", enteredAt: min(29), status: "在场" },
  { id: "pe2", ticketId: "tk1", ticketNo: "JX-20261007-01", sectionId: "sec1", name: "李伟", badge: "GD-1045", enteredAt: min(29), status: "在场" },
  { id: "pe3", ticketId: "tk3", ticketNo: "JX-20261007-03", sectionId: "sec2", name: "王强", badge: "GD-1067", enteredAt: min(23), status: "在场" }
];

const seedPowerLog: PowerRecord[] = [
  { id: "pw1", sectionId: "sec3", type: "复电", time: min(12), operator: "调度员", note: "检修完成，对账通过" },
  { id: "pw2", sectionId: "sec1", type: "停电", time: min(32), operator: "调度员", note: "滨江站区间积水停运，配合接触网检修" },
  { id: "pw3", sectionId: "sec2", type: "停电", time: min(30), operator: "调度员" }
];

export const useMaintenanceStore = create<MaintenanceState>()(
  persist(
    (set, get) => ({
      sections: seedSections,
      tickets: seedTickets,
      grounds: seedGrounds,
      people: seedPeople,
      powerLog: seedPowerLog,
      reconciliations: {},
      eventClosed: false,

      addTicket: (input, online) => {
        const missingFields = computeMissing(input);
        const ticket: WorkTicket = {
          ...input,
          id: crypto.randomUUID(),
          status: "待生效",
          syncStatus: missingFields.length ? "待补" : online ? "已同步" : "待上传",
          missingFields,
          createdAt: now()
        };
        set((state) => ({ tickets: activateNext([...state.tickets, ticket], ticket.sectionId) }));
      },

      verifyTicket: (id) => {
        const ticket = get().tickets.find((item) => item.id === id);
        if (!ticket) return;
        set((state) => ({
          tickets: activateNext(
            state.tickets.map((item) => (item.id === id ? { ...item, status: "已核销" as TicketStatus } : item)),
            ticket.sectionId
          )
        }));
      },

      cancelTicket: (id) => {
        const ticket = get().tickets.find((item) => item.id === id);
        if (!ticket) return;
        set((state) => ({
          tickets: activateNext(
            state.tickets.map((item) => (item.id === id ? { ...item, status: "已注销" as TicketStatus } : item)),
            ticket.sectionId
          )
        }));
      },

      shiftChange: (sectionId) => {
        // 换班后原票失效，排队的下一张票重算生效
        set((state) => ({
          tickets: activateNext(
            state.tickets.map((ticket) =>
              ticket.sectionId === sectionId && ticket.status === "有效" ? { ...ticket, status: "已注销" as TicketStatus } : ticket
            ),
            sectionId
          )
        }));
      },

      supplementTicket: (id, fields) => {
        const ticket = get().tickets.find((item) => item.id === id);
        if (!ticket) return;
        const merged: TicketInput = {
          ticketNo: fields.ticketNo ?? ticket.ticketNo,
          sectionId: fields.sectionId ?? ticket.sectionId,
          type: fields.type ?? ticket.type,
          shift: fields.shift ?? ticket.shift,
          scope: fields.scope ?? ticket.scope,
          workItems: fields.workItems ?? ticket.workItems,
          validFrom: fields.validFrom ?? ticket.validFrom,
          validTo: fields.validTo ?? ticket.validTo
        };
        const missingFields = computeMissing(merged);
        set((state) => ({
          tickets: activateNext(
            state.tickets.map((item) =>
              item.id === id
                ? {
                    ...item,
                    ...merged,
                    status: item.status,
                    syncStatus: missingFields.length ? ("待补" as SyncStatus) : ("待上传" as SyncStatus),
                    missingFields
                  }
                : item
            ),
            merged.sectionId
          )
        }));
      },

      syncTickets: () => {
        // 回网按票号合并：已同步的票号先去重，重复上传只认一次，缺项留在待补
        set((state) => {
          const seen = new Set(state.tickets.filter((ticket) => ticket.syncStatus === "已同步").map((ticket) => ticket.ticketNo));
          const tickets = state.tickets.map((ticket) => {
            if (ticket.syncStatus === "已同步" || ticket.syncStatus === "待补") return ticket;
            if (ticket.syncStatus === "重复") return ticket;
            if (seen.has(ticket.ticketNo)) return { ...ticket, syncStatus: "重复" as SyncStatus };
            seen.add(ticket.ticketNo);
            return { ...ticket, syncStatus: "已同步" as SyncStatus };
          });
          return { tickets };
        });
      },

      addGround: (input) =>
        set((state) => ({
          grounds: [
            { ...input, id: crypto.randomUUID(), status: "已挂设" as GroundStatus, hungAt: now() },
            ...state.grounds
          ]
        })),

      removeGround: (id) =>
        set((state) => ({
          grounds: state.grounds.map((ground) =>
            ground.id === id ? { ...ground, status: "已拆除" as GroundStatus, removedAt: now() } : ground
          )
        })),

      addPerson: (input) =>
        set((state) => ({
          people: [
            { ...input, id: crypto.randomUUID(), status: "在场" as PersonStatus, enteredAt: now() },
            ...state.people
          ]
        })),

      exitPerson: (id) =>
        set((state) => ({
          people: state.people.map((person) =>
            person.id === id ? { ...person, status: "已离场" as PersonStatus, exitedAt: now() } : person
          )
        })),

      powerOutage: (sectionId, operator, note) =>
        set((state) => ({
          sections: state.sections.map((section) =>
            section.id === sectionId ? { ...section, powerStatus: "停电" as PowerStatus } : section
          ),
          powerLog: [
            { id: crypto.randomUUID(), sectionId, type: "停电", time: now(), operator, note },
            ...state.powerLog
          ]
        })),

      powerRestore: (sectionId, operator) => {
        const result = reconcileSection(sectionId, get());
        set((state) => ({
          reconciliations: { ...state.reconciliations, [sectionId]: result },
          sections: result.canRestore
            ? state.sections.map((section) =>
                section.id === sectionId ? { ...section, powerStatus: "已复电" as PowerStatus } : section
              )
            : state.sections,
          powerLog: result.canRestore
            ? [
                { id: crypto.randomUUID(), sectionId, type: "复电", time: now(), operator, note: "对账通过，准予复电" },
                ...state.powerLog
              ]
            : state.powerLog
        }));
        return result;
      },

      closeEvent: () => set({ eventClosed: true })
    }),
    { name: "pair-wise-yf-47/maintenance" }
  )
);
