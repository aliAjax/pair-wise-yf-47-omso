"use client";

import { useMemo, useState } from "react";
import { Button, Card, Form, Input, Modal, Select, Table, Tag, message } from "antd";
import { format } from "date-fns";
import { useMaintenanceStore, type PersonRecord, type PersonStatus } from "../../store/maintenance";
import type { ColumnsType } from "antd/es/table";

const personColor: Record<PersonStatus, string> = { 在场: "red", 已离场: "green" };

export function PersonnelPanel() {
  const people = useMaintenanceStore((state) => state.people);
  const tickets = useMaintenanceStore((state) => state.tickets);
  const sections = useMaintenanceStore((state) => state.sections);
  const addPerson = useMaintenanceStore((state) => state.addPerson);
  const exitPerson = useMaintenanceStore((state) => state.exitPerson);
  const [open, setOpen] = useState(false);
  const [ticketId, setTicketId] = useState<string>();
  const [name, setName] = useState("");
  const [badge, setBadge] = useState("");

  const sectionName = useMemo(() => new Map(sections.map((s) => [s.id, s.name])), [sections]);
  const writableTickets = tickets.filter((t) => t.status === "有效");

  const submit = () => {
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket || !name.trim() || !badge.trim()) {
      message.warning("请完整填写票号、姓名和工牌号");
      return;
    }
    addPerson({ ticketId: ticket.id, ticketNo: ticket.ticketNo, sectionId: ticket.sectionId, name: name.trim(), badge: badge.trim() });
    message.success("人员已登记进场");
    setOpen(false);
    setTicketId(undefined);
    setName("");
    setBadge("");
  };

  const columns: ColumnsType<PersonRecord> = [
    { title: "票号", dataIndex: "ticketNo" },
    { title: "作业区间", dataIndex: "sectionId", render: (v: string) => sectionName.get(v) ?? v },
    { title: "姓名", dataIndex: "name" },
    { title: "工牌号", dataIndex: "badge" },
    { title: "进场时间", dataIndex: "enteredAt", render: (v: string) => format(new Date(v), "MM-dd HH:mm:ss") },
    { title: "离场时间", dataIndex: "exitedAt", render: (v?: string) => (v ? format(new Date(v), "MM-dd HH:mm:ss") : "—") },
    { title: "状态", dataIndex: "status", render: (v: PersonStatus) => <Tag color={personColor[v]}>{v}</Tag> },
    {
      title: "操作",
      render: (_, record) =>
        record.status === "在场" ? (
          <Button size="small" onClick={() => { exitPerson(record.id); message.success("人员已登记离场"); }}>离场</Button>
        ) : (
          <Tag color="green">已离场</Tag>
        )
    }
  ];

  return (
    <Card
      title="人员进出"
      extra={<Button type="primary" onClick={() => setOpen(true)}>进场登记</Button>}
    >
      <Table rowKey="id" size="small" pagination={false} dataSource={people} columns={columns} scroll={{ x: 900 }} />
      <Modal title="人员进场登记" open={open} onCancel={() => setOpen(false)} onOk={submit} okText="进场">
        <Form layout="vertical">
          <Form.Item label="凭票号" required>
            <Select
              value={ticketId}
              onChange={setTicketId}
              placeholder="选择有效检修票"
              options={writableTickets.map((t) => ({ value: t.id, label: `${t.ticketNo} · ${sectionName.get(t.sectionId)}` }))}
            />
          </Form.Item>
          <Form.Item label="姓名" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：赵磊" />
          </Form.Item>
          <Form.Item label="工牌号" required>
            <Input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="如：GD-1088" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
