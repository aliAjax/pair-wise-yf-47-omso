"use client";

import { useMemo, useState } from "react";
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import { CloudSyncOutlined, PlusOutlined } from "@ant-design/icons";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { format } from "date-fns";
import { useMaintenanceStore, type TicketInput, type TicketStatus, type SyncStatus } from "../../store/maintenance";
import type { ColumnsType } from "antd/es/table";

const ticketSchema = z.object({
  ticketNo: z.string().min(2, "票号至少 2 位"),
  sectionId: z.string().min(1, "请选择作业区间"),
  type: z.string().min(1, "请选择作业类型"),
  shift: z.string().min(1, "请选择班组"),
  scope: z.string().min(2, "作业范围至少 2 字"),
  workItems: z.array(z.string()).min(1, "至少填一项作业内容"),
  validFrom: z.string().min(1, "请选择开始时间"),
  validTo: z.string().min(1, "请选择截止时间")
});
type TicketForm = z.infer<typeof ticketSchema>;

const statusColor: Record<TicketStatus, string> = { 待生效: "default", 有效: "green", 已过期: "red", 已核销: "blue", 已注销: "default" };
const syncColor: Record<SyncStatus, string> = { 已同步: "green", 待上传: "orange", 待补: "red", 重复: "default" };

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function TicketPanel({ online, role }: { online: boolean; role: string }) {
  const tickets = useMaintenanceStore((state) => state.tickets);
  const sections = useMaintenanceStore((state) => state.sections);
  const addTicket = useMaintenanceStore((state) => state.addTicket);
  const verifyTicket = useMaintenanceStore((state) => state.verifyTicket);
  const cancelTicket = useMaintenanceStore((state) => state.cancelTicket);
  const supplementTicket = useMaintenanceStore((state) => state.supplementTicket);
  const syncTickets = useMaintenanceStore((state) => state.syncTickets);
  const [modalOpen, setModalOpen] = useState(false);
  const [supplementTarget, setSupplementTarget] = useState<string | null>(null);
  const [form] = Form.useForm();

  const { control, handleSubmit, reset, formState: { errors } } = useForm<TicketForm>({
    defaultValues: {
      ticketNo: `JX-20261007-${String(tickets.length + 1).padStart(2, "0")}`,
      sectionId: "sec1",
      type: "接触网检修",
      shift: "甲班",
      scope: "",
      workItems: ["接触网检修"],
      validFrom: toLocalInput(new Date().toISOString()),
      validTo: toLocalInput(new Date(Date.now() + 2 * 3600000).toISOString())
    }
  });

  const sectionName = useMemo(() => new Map(sections.map((s) => [s.id, s.name])), [sections]);
  const waitingRank = useMemo(() => {
    const map = new Map<string, number>();
    for (const section of sections) {
      tickets
        .filter((t) => t.sectionId === section.id && t.status === "待生效")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .forEach((t, i) => map.set(t.id, i + 1));
    }
    return map;
  }, [tickets, sections]);

  const submit = (values: TicketForm) => {
    const parsed = ticketSchema.safeParse(values);
    if (!parsed.success) return;
    const payload: TicketInput = {
      ...parsed.data,
      validFrom: new Date(parsed.data.validFrom).toISOString(),
      validTo: new Date(parsed.data.validTo).toISOString()
    };
    addTicket(payload, online);
    message.success(online ? "检修票已开具并同步" : "检修票已存现场（待上传）");
    setModalOpen(false);
    reset();
  };

  const onSync = () => {
    syncTickets();
    message.success("已按票号合并上传，重复票只认一次，缺项留在待补");
  };

  const columns: ColumnsType<(typeof tickets)[number]> = [
    { title: "票号", dataIndex: "ticketNo", render: (v: string, record) => <Space>{v}{record.syncStatus === "重复" && <Tag color="default">重复</Tag>}</Space> },
    { title: "作业区间", dataIndex: "sectionId", render: (v: string) => sectionName.get(v) ?? v },
    { title: "类型", dataIndex: "type" },
    { title: "班组", dataIndex: "shift" },
    { title: "作业范围", dataIndex: "scope", render: (v: string) => v || <Tag color="red">缺项</Tag> },
    { title: "作业内容", dataIndex: "workItems", render: (v: string[]) => v.map((item) => <Tag key={item}>{item}</Tag>) },
    { title: "有效期", render: (_, record) => `${format(new Date(record.validFrom), "MM-dd HH:mm")} ~ ${format(new Date(record.validTo), "HH:mm")}` },
    {
      title: "状态",
      dataIndex: "status",
      render: (v: TicketStatus, record) => (
        <Space direction="vertical" size={2}>
          <Tag color={statusColor[v]}>{v}{v === "待生效" && waitingRank.get(record.id) ? `（队列 ${waitingRank.get(record.id)}）` : ""}</Tag>
          <Tag color={syncColor[record.syncStatus]}>{record.syncStatus}{record.missingFields.length ? `：${record.missingFields.join("、")}` : ""}</Tag>
        </Space>
      )
    },
    {
      title: "操作",
      render: (_, record) => (
        <Space>
          {record.syncStatus === "待补" && (
            <Button size="small" type="primary" onClick={() => setSupplementTarget(record.id)}>补全</Button>
          )}
          {record.status === "有效" && <Button size="small" onClick={() => verifyTicket(record.id)}>核销</Button>}
          {(record.status === "待生效" || record.status === "有效") && (
            <Button size="small" danger onClick={() => cancelTicket(record.id)}>注销</Button>
          )}
        </Space>
      )
    }
  ];

  return (
    <Card
      title="检修票"
      extra={
        <Space>
          <Button icon={<CloudSyncOutlined />} onClick={onSync} disabled={online && !tickets.some((t) => t.syncStatus === "待上传" || t.syncStatus === "待补")}>
            回网合并上传
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>新开票</Button>
        </Space>
      }
    >
      {!online && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="弱网模式：新票先存现场本地队列，恢复连接后按票号合并上传。" />}
      <Table rowKey="id" size="small" pagination={false} dataSource={tickets} columns={columns} scroll={{ x: 1100 }} />
      <Modal title="新开检修票" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSubmit(submit)} okText="开票">
        <Form layout="vertical" form={form}>
          <Form.Item label="票号" validateStatus={errors.ticketNo ? "error" : ""} help={errors.ticketNo?.message}>
            <Controller name="ticketNo" control={control} render={({ field }) => <Input {...field} />} />
          </Form.Item>
          <Space>
            <Form.Item label="作业区间" validateStatus={errors.sectionId ? "error" : ""} help={errors.sectionId?.message}>
              <Controller name="sectionId" control={control} render={({ field }) => <Select {...field} style={{ width: 200 }} options={sections.map((s) => ({ value: s.id, label: s.name }))} />} />
            </Form.Item>
            <Form.Item label="作业类型" validateStatus={errors.type ? "error" : ""} help={errors.type?.message}>
              <Controller name="type" control={control} render={({ field }) => <Select {...field} style={{ width: 150 }} options={["接触网检修", "接触网巡视", "应急抢修"].map((v) => ({ value: v, label: v }))} />} />
            </Form.Item>
            <Form.Item label="班组" validateStatus={errors.shift ? "error" : ""} help={errors.shift?.message}>
              <Controller name="shift" control={control} render={({ field }) => <Select {...field} style={{ width: 120 }} options={["甲班", "乙班", "丙班"].map((v) => ({ value: v, label: v }))} />} />
            </Form.Item>
          </Space>
          <Form.Item label="作业范围" validateStatus={errors.scope ? "error" : ""} help={errors.scope?.message}>
            <Controller name="scope" control={control} render={({ field }) => <Input {...field} placeholder="如：中心站至滨江站上行接触网" />} />
          </Form.Item>
          <Form.Item label="作业内容" validateStatus={errors.workItems ? "error" : ""} help={errors.workItems?.message}>
            <Controller name="workItems" control={control} render={({ field }) => <Select {...field} mode="tags" style={{ width: "100%" }} placeholder="输入后回车" options={["绝缘子清扫", "导线接头检查", "磨耗测量", "定位器调整", "设备巡检", "接地极检查"].map((v) => ({ value: v, label: v }))} />} />
          </Form.Item>
          <Space>
            <Form.Item label="开始时间" validateStatus={errors.validFrom ? "error" : ""} help={errors.validFrom?.message}>
              <Controller name="validFrom" control={control} render={({ field }) => <Input type="datetime-local" {...field} />} />
            </Form.Item>
            <Form.Item label="截止时间" validateStatus={errors.validTo ? "error" : ""} help={errors.validTo?.message}>
              <Controller name="validTo" control={control} render={({ field }) => <Input type="datetime-local" {...field} />} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
      <SupplementModal
        target={supplementTarget}
        onClose={() => setSupplementTarget(null)}
        onSubmit={(fields) => {
          if (supplementTarget) supplementTicket(supplementTarget, fields);
          setSupplementTarget(null);
          message.success("缺项已补全，重新进入队列");
        }}
      />
    </Card>
  );
}

function SupplementModal({ target, onClose, onSubmit }: { target: string | null; onClose: () => void; onSubmit: (fields: Partial<TicketInput>) => void }) {
  const ticket = useMaintenanceStore((state) => state.tickets.find((t) => t.id === target));
  const [scope, setScope] = useState("");
  if (!ticket) return <></>;
  const missing = ticket.missingFields;
  return (
    <Modal title="补全缺项" open={!!target} onCancel={onClose} onOk={() => onSubmit({ scope: scope || undefined })} okText="补全">
      <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`票号 ${ticket.ticketNo} 缺项：${missing.join("、")}，补全后重新排队。`} />
      {missing.includes("作业范围") && (
        <Form layout="vertical">
          <Form.Item label="作业范围" required>
            <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="如：中心站至滨江站上行接触网" />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
