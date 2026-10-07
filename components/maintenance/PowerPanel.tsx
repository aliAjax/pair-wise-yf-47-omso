"use client";

import { useMemo, useState } from "react";
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Timeline, message } from "antd";
import { format } from "date-fns";
import { useMaintenanceStore, type PowerRecord, type PowerStatus } from "../../store/maintenance";
import type { ColumnsType } from "antd/es/table";

const powerColor: Record<PowerStatus, string> = { 停电: "red", 待复电: "orange", 已复电: "green" };

export function PowerPanel({ role }: { role: string }) {
  const sections = useMaintenanceStore((state) => state.sections);
  const powerLog = useMaintenanceStore((state) => state.powerLog);
  const tickets = useMaintenanceStore((state) => state.tickets);
  const grounds = useMaintenanceStore((state) => state.grounds);
  const people = useMaintenanceStore((state) => state.people);
  const eventClosed = useMaintenanceStore((state) => state.eventClosed);
  const powerOutage = useMaintenanceStore((state) => state.powerOutage);
  const closeEvent = useMaintenanceStore((state) => state.closeEvent);
  const [outageOpen, setOutageOpen] = useState(false);
  const [sectionId, setSectionId] = useState<string>();
  const [note, setNote] = useState("");

  const sectionName = useMemo(() => new Map(sections.map((s) => [s.id, s.name])), [sections]);

  // 事件收尾前的全区间对账概览
  const overview = useMemo(() => {
    return sections.map((section) => {
      const active = tickets.filter((t) => t.sectionId === section.id && t.status === "有效").length;
      const hung = grounds.filter((g) => g.sectionId === section.id && g.status === "已挂设").length;
      const onSite = people.filter((p) => p.sectionId === section.id && p.status === "在场").length;
      const done = section.powerStatus === "已复电" && active === 0 && hung === 0 && onSite === 0;
      return { section, active, hung, onSite, done };
    });
  }, [sections, tickets, grounds, people]);

  const allDone = overview.every((item) => item.done);

  const submitOutage = () => {
    if (!sectionId) {
      message.warning("请选择停电区间");
      return;
    }
    powerOutage(sectionId, role, note || undefined);
    message.success("已记录停电");
    setOutageOpen(false);
    setSectionId(undefined);
    setNote("");
  };

  const columns: ColumnsType<PowerRecord> = [
    { title: "时间", dataIndex: "time", render: (v: string) => format(new Date(v), "MM-dd HH:mm:ss") },
    { title: "作业区间", dataIndex: "sectionId", render: (v: string) => sectionName.get(v) ?? v },
    { title: "类型", dataIndex: "type", render: (v: string) => <Tag color={v === "复电" ? "green" : "red"}>{v}</Tag> },
    { title: "操作人", dataIndex: "operator" },
    { title: "说明", dataIndex: "note", render: (v?: string) => v ?? "—" }
  ];

  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <Card title="停电记录" extra={<Button type="primary" danger onClick={() => setOutageOpen(true)}>登记停电</Button>}>
        <Table rowKey="id" size="small" pagination={false} dataSource={powerLog} columns={columns} />
      </Card>

      <Card
        title="事件收尾"
        extra={
          <Button
            type="primary"
            disabled={!allDone || eventClosed}
            onClick={() => {
              Modal.confirm({
                title: "确认事件收尾",
                content: "所有区间均已复电、票证核销、接地拆除、人员离场。确认收尾本事件？",
                okText: "确认收尾",
                cancelText: "取消",
                onOk: () => {
                  closeEvent();
                  message.success("事件已收尾，安全账封存");
                }
              });
            }}
          >
            {eventClosed ? "事件已收尾" : "收尾事件"}
          </Button>
        }
      >
        {eventClosed && <Alert type="success" showIcon style={{ marginBottom: 12 }} message="本事件已收尾，安全账封存归档。" />}
        <Timeline
          items={overview.map((item) => ({
            color: item.done ? "green" : "red",
            children: (
              <Space wrap>
                <Tag color={powerColor[item.section.powerStatus]}>{item.section.powerStatus}</Tag>
                <b>{item.section.name}</b>
                <span>有效票 {item.active}</span>
                <span>挂设接地 {item.hung}</span>
                <span>在场人员 {item.onSite}</span>
                {item.done ? <Tag color="green">账清</Tag> : <Tag color="red">未清</Tag>}
              </Space>
            )
          }))}
        />
        {!allDone && !eventClosed && (
          <Alert type="warning" showIcon message="存在未清区间，全部区间复电且票证、接地、人员清零后方可收尾。" />
        )}
      </Card>

      <Modal title="登记停电" open={outageOpen} onCancel={() => setOutageOpen(false)} onOk={submitOutage} okText="确认停电">
        <Form layout="vertical">
          <Form.Item label="停电区间" required>
            <Select value={sectionId} onChange={setSectionId} placeholder="选择区间" options={sections.map((s) => ({ value: s.id, label: s.name }))} />
          </Form.Item>
          <Form.Item label="说明">
            <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="停电原因、配合事项" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
