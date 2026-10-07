"use client";

import { useMemo, useState } from "react";
import { Alert, Button, Card, Descriptions, Modal, Space, Statistic, Tag, Timeline, message } from "antd";
import { CheckCircleFilled, CloseCircleFilled, SafetyCertificateOutlined } from "@ant-design/icons";
import { format } from "date-fns";
import { reconcileSection, useMaintenanceStore, type PowerStatus, type Section } from "../../store/maintenance";

const powerColor: Record<PowerStatus, string> = { 停电: "red", 待复电: "orange", 已复电: "green" };

export function SafetyLedger({ online, role }: { online: boolean; role: string }) {
  const sections = useMaintenanceStore((state) => state.sections);
  const tickets = useMaintenanceStore((state) => state.tickets);
  const grounds = useMaintenanceStore((state) => state.grounds);
  const people = useMaintenanceStore((state) => state.people);
  const reconciliations = useMaintenanceStore((state) => state.reconciliations);
  const powerRestore = useMaintenanceStore((state) => state.powerRestore);
  const shiftChange = useMaintenanceStore((state) => state.shiftChange);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const results = useMemo(() => {
    const map: Record<string, ReturnType<typeof reconcileSection>> = {};
    for (const section of sections) {
      map[section.id] = reconcileSection(section.id, { tickets, grounds, people });
    }
    return map;
  }, [sections, tickets, grounds, people]);

  const onRestore = (section: Section) => {
    const result = powerRestore(section.id, role);
    if (result.canRestore) {
      message.success(`${section.name} 对账通过，已准予复电`);
    } else {
      message.error(`${section.name} 对账未通过，${result.items.filter((item) => !item.pass).length} 项不放行`);
    }
  };

  const onShiftChange = (section: Section) => {
    Modal.confirm({
      title: "换班并作废原票",
      content: `换班后 ${section.name} 当前有效票将失效，排队的下一张票自动重算生效。确认换班？`,
      okText: "确认换班",
      cancelText: "取消",
      onOk: () => {
        shiftChange(section.id);
        message.info(`${section.name} 已换班，原票失效，队列已重算`);
      }
    });
  };

  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      {!online && (
        <Alert type="warning" showIcon message="弱网降级：安全账基于本地缓存数据，复电操作将在回网后补传并重新对账。" />
      )}
      {sections.map((section) => {
        const result = results[section.id];
        const last = reconciliations[section.id];
        const blockers = result.items.filter((item) => !item.pass);
        return (
          <Card
            key={section.id}
            size="small"
            title={
              <Space>
                <SafetyCertificateOutlined />
                <span>{section.name}</span>
                <Tag color={powerColor[section.powerStatus]}>{section.powerStatus}</Tag>
                {section.powerStatus === "已复电" && <Tag color="green">已复电</Tag>}
              </Space>
            }
            extra={
              <Space>
                <Button size="small" onClick={() => onShiftChange(section)} disabled={section.powerStatus === "已复电"}>
                  换班
                </Button>
                <Button
                  size="small"
                  type="primary"
                  danger={section.powerStatus !== "已复电"}
                  disabled={section.powerStatus === "已复电"}
                  onClick={() => onRestore(section)}
                >
                  复电对账
                </Button>
              </Space>
            }
          >
            <Space wrap size={16} style={{ marginBottom: 12 }}>
              <Statistic title="有效票" value={tickets.filter((t) => t.sectionId === section.id && t.status === "有效").length} suffix="张" />
              <Statistic title="挂设接地" value={grounds.filter((g) => g.sectionId === section.id && g.status === "已挂设").length} suffix="组" />
              <Statistic title="在场人员" value={people.filter((p) => p.sectionId === section.id && p.status === "在场").length} suffix="人" />
              <Statistic
                title="对账状态"
                value={result.canRestore ? "可复电" : "不放行"}
                valueStyle={{ color: result.canRestore ? "#18a566" : "#e5484d", fontSize: 18 }}
              />
            </Space>
            <Timeline
              items={result.items.map((item) => ({
                color: item.pass ? "green" : "red",
                children: (
                  <Space>
                    {item.pass ? <CheckCircleFilled style={{ color: "#18a566" }} /> : <CloseCircleFilled style={{ color: "#e5484d" }} />}
                    <b>{item.label}</b>
                    <span style={{ color: item.pass ? "#59667b" : "#e5484d" }}>{item.detail}</span>
                  </Space>
                )
              }))}
            />
            {last && (
              <Alert
                style={{ marginTop: 8 }}
                type={last.canRestore ? "success" : "error"}
                showIcon
                message={`上次对账：${last.canRestore ? "通过" : "未通过"} · ${format(new Date(last.checkedAt), "MM-dd HH:mm:ss")}`}
                description={
                  !last.canRestore ? (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {last.items.filter((item) => !item.pass).map((item) => (
                        <li key={item.key}>{item.label}：{item.detail}</li>
                      ))}
                    </ul>
                  ) : undefined
                }
              />
            )}
            <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setActiveSection(activeSection === section.id ? null : section.id)}>
              {activeSection === section.id ? "收起明细" : "展开明细"}
            </Button>
            {activeSection === section.id && (
              <Descriptions size="small" column={1} bordered style={{ marginTop: 8 }}>
                <Descriptions.Item label="有效票">
                  {tickets.filter((t) => t.sectionId === section.id && t.status === "有效").map((t) => (
                    <Tag key={t.id} color="blue">{t.ticketNo} · {t.shift} · {t.scope}</Tag>
                  )) || "无"}
                </Descriptions.Item>
                <Descriptions.Item label="待生效（排队）">
                  {tickets.filter((t) => t.sectionId === section.id && t.status === "待生效").map((t, i) => (
                    <Tag key={t.id} color="default">队列 {i + 1} · {t.ticketNo} · {t.shift}{t.syncStatus === "待补" ? "（待补）" : ""}</Tag>
                  )) || "无"}
                </Descriptions.Item>
                <Descriptions.Item label="挂设接地">
                  {grounds.filter((g) => g.sectionId === section.id && g.status === "已挂设").map((g) => (
                    <Tag key={g.id} color="orange">{g.rodNo} · {g.location}</Tag>
                  )) || "无"}
                </Descriptions.Item>
                <Descriptions.Item label="在场人员">
                  {people.filter((p) => p.sectionId === section.id && p.status === "在场").map((p) => (
                    <Tag key={p.id} color="red">{p.name} · {p.badge}</Tag>
                  )) || "无"}
                </Descriptions.Item>
              </Descriptions>
            )}
          </Card>
        );
      })}
    </Space>
  );
}
