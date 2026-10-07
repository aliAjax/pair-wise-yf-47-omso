"use client";

import { useMemo, useState } from "react";
import { Button, Card, Form, Input, Modal, Select, Table, Tag, message } from "antd";
import { format } from "date-fns";
import { useMaintenanceStore, type GroundRecord, type GroundStatus } from "../../store/maintenance";
import type { ColumnsType } from "antd/es/table";

const groundColor: Record<GroundStatus, string> = { 已挂设: "orange", 已拆除: "green" };

export function GroundPanel() {
  const grounds = useMaintenanceStore((state) => state.grounds);
  const tickets = useMaintenanceStore((state) => state.tickets);
  const sections = useMaintenanceStore((state) => state.sections);
  const addGround = useMaintenanceStore((state) => state.addGround);
  const removeGround = useMaintenanceStore((state) => state.removeGround);
  const [open, setOpen] = useState(false);
  const [ticketId, setTicketId] = useState<string>();
  const [rodNo, setRodNo] = useState("");
  const [location, setLocation] = useState("");

  const sectionName = useMemo(() => new Map(sections.map((s) => [s.id, s.name])), [sections]);
  // 只有有效票才能挂接地线（凭票作业）
  const writableTickets = tickets.filter((t) => t.status === "有效");

  const submit = () => {
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket || !rodNo.trim() || !location.trim()) {
      message.warning("请完整填写票号、接地杆号和位置");
      return;
    }
    addGround({ ticketId: ticket.id, ticketNo: ticket.ticketNo, sectionId: ticket.sectionId, rodNo: rodNo.trim(), location: location.trim() });
    message.success("接地线已挂设并记录");
    setOpen(false);
    setTicketId(undefined);
    setRodNo("");
    setLocation("");
  };

  const columns: ColumnsType<GroundRecord> = [
    { title: "票号", dataIndex: "ticketNo" },
    { title: "作业区间", dataIndex: "sectionId", render: (v: string) => sectionName.get(v) ?? v },
    { title: "接地杆号", dataIndex: "rodNo" },
    { title: "挂设位置", dataIndex: "location" },
    { title: "挂设时间", dataIndex: "hungAt", render: (v: string) => format(new Date(v), "MM-dd HH:mm:ss") },
    { title: "拆除时间", dataIndex: "removedAt", render: (v?: string) => (v ? format(new Date(v), "MM-dd HH:mm:ss") : "—") },
    { title: "状态", dataIndex: "status", render: (v: GroundStatus) => <Tag color={groundColor[v]}>{v}</Tag> },
    {
      title: "操作",
      render: (_, record) =>
        record.status === "已挂设" ? (
          <Button size="small" onClick={() => { removeGround(record.id); message.success("接地线已拆除并记录"); }}>拆除</Button>
        ) : (
          <Tag color="green">已拆除</Tag>
        )
    }
  ];

  return (
    <Card
      title="接地记录"
      extra={<Button type="primary" onClick={() => setOpen(true)}>挂设接地</Button>}
    >
      <Table rowKey="id" size="small" pagination={false} dataSource={grounds} columns={columns} scroll={{ x: 900 }} />
      <Modal title="挂设接地线" open={open} onCancel={() => setOpen(false)} onOk={submit} okText="挂设">
        <Form layout="vertical">
          <Form.Item label="凭票号" required>
            <Select
              value={ticketId}
              onChange={setTicketId}
              placeholder="选择有效检修票"
              options={writableTickets.map((t) => ({ value: t.id, label: `${t.ticketNo} · ${sectionName.get(t.sectionId)}` }))}
            />
          </Form.Item>
          <Form.Item label="接地杆号" required>
            <Input value={rodNo} onChange={(e) => setRodNo(e.target.value)} placeholder="如：JD-04" />
          </Form.Item>
          <Form.Item label="挂设位置" required>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="如：K12+300 上行" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
