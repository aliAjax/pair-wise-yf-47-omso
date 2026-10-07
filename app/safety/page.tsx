"use client";

import { useMemo, useState } from "react";
import {
  App as AntApp, Alert, AutoComplete, Badge, Button, Card, Descriptions, Form, Input, Modal,
  Segmented, Select, Space, Statistic, Table, Tag, Tooltip,
} from "antd";
import { format } from "date-fns";
import type { ColumnsType } from "antd/es/table";
import {
  useSafetyStore, 演示区间, 甲班, 乙班,
} from "../../store/safety";
import type { 检修票, 检修票必填, 接地记录, 人员记录, 票状态 } from "../../lib/safety/types";
import { 当前停电令, 有效票, 排队, 在场人员, 未拆接地 } from "../../lib/safety/rules";

const fmt = (v?: string) => (v ? format(new Date(v), "MM-dd HH:mm") : "—");
const hm = (v?: string) => (v ? format(new Date(v), "HH:mm") : "—");
// datetime-local 值补齐为秒，保证字符串比较口径一致
const toIso = (v: string) => (v?.length === 16 ? `${v}:00` : v);

const 票状态色: Record<票状态, string> = { 排队中: "gold", 有效: "green", 已完工: "default", 已作废: "red" };

export default function SafetyPage() {
  const { message, modal } = AntApp.useApp();
  const s = useSafetyStore();
  const 账 = s.账;
  const 区间 = 演示区间.id;

  const [票表单] = Form.useForm();
  const [补表单] = Form.useForm();
  const [接地表单] = Form.useForm();
  const [人员表单] = Form.useForm();
  const [开新票, set开新票] = useState(false);
  const [补票号, set补票号] = useState<string | null>(null);
  const [开接地, set开接地] = useState(false);
  const [开人员, set开人员] = useState(false);

  const 停电令 = 当前停电令(账, 区间);
  const 有效 = 有效票(账, 区间);
  const 队列 = 排队(账, 区间);
  const 在场 = 在场人员(账, 区间);
  const 未拆 = 未拆接地(账, 区间);
  const 结论 = useMemo(() => s.对账(), [账]); // eslint-disable-line react-hooks/exhaustive-deps

  const 所有票号 = [...账.检修票, ...账.待补].map((x) => x.票号);
  const 票号选项 = 所有票号.map((v) => ({ value: v, label: v }));

  const 提交票 = () => 票表单.validateFields().then((v) => {
    const raw: Partial<检修票必填> = {
      票号: v.票号, 区间id: 区间, 作业内容: v.作业内容, 作业负责人: v.作业负责人,
      班组: v.班组, 班次id: 账.事件?.当前班次id ?? 甲班.id,
      有效起: toIso(v.有效起), 有效止: toIso(v.有效止),
    };
    if (v.离线) {
      s.离线存(raw, v.设备 || "手持终端-07");
      message.success(`票 ${v.票号} 已存现场（${v.设备 || "手持终端-07"}），回网后按票号合并`);
    } else {
      const r = s.传票(raw);
      if (r.重复) message.warning(`票 ${v.票号} 已存在，重复上传只认第一次`);
      else if (r.缺项) message.warning(`票 ${v.票号} 缺项，已留在待补`);
      else message.success(`票 ${v.票号} 已入账并进入排队（第 ${r.票?.排队序号} 位）`);
    }
    set开新票(false);
    票表单.resetFields();
  });

  const 提交补录 = () => 补表单.validateFields().then((v) => {
    s.补录(补票号!, {
      作业内容: v.作业内容 || undefined, 作业负责人: v.作业负责人 || undefined,
      班组: v.班组 || undefined,
      有效起: v.有效起 ? toIso(v.有效起) : undefined,
      有效止: v.有效止 ? toIso(v.有效止) : undefined,
    });
    message.success("已补录，若必填项补齐将自动并入排队");
    set补票号(null);
    补表单.resetFields();
  });

  const 提交接地 = () => 接地表单.validateFields().then((v) => {
    s.挂接地({ 票号: v.票号, 区间id: 区间, 位置: v.位置, 操作人: v.操作人 });
    message.success(`已登记挂设：${v.位置}`);
    set开接地(false);
    接地表单.resetFields();
  });

  const 提交人员 = () => 人员表单.validateFields().then((v) => {
    s.登记人员({ 票号: v.票号, 区间id: 区间, 姓名: v.姓名, 工种: v.工种 }, v.方向);
    message.success(`${v.姓名} ${v.方向} 已登记`);
    set开人员(false);
    人员表单.resetFields();
  });

  const 申请复电 = () => {
    const r = s.复电();
    if (r.结论.放行) message.success("逐项对账通过，已执行复电，有效票自动完工");
    else modal.error({
      title: "复电被拦截",
      width: 520,
      content: <Space direction="vertical" style={{ marginTop: 8 }}>
        {r.结论.对账.filter((x) => !x.通过).map((x) => <Tag key={x.代码} color="red">{x.代码}：{x.说明}</Tag>)}
      </Space>,
    });
  };

  const 票列: ColumnsType<检修票> = [
    { title: "票号", dataIndex: "票号", width: 110, render: (v, r) => <Space direction="vertical" size={0}><b>{v}</b>{r.离线 && <Tag color="cyan">离线回传</Tag>}</Space> },
    { title: "作业内容 / 负责人", render: (_, r) => <Space direction="vertical" size={0}><span>{r.作业内容 || "—"}</span><small>{r.作业负责人 || "缺负责人"} · {r.班组 || "缺班组"}</small></Space> },
    { title: "排队", dataIndex: "排队序号", width: 64, render: (v, r) => r.状态 === "排队中" ? <Tag color="gold">第 {v} 位</Tag> : "—" },
    { title: "有效期", render: (_, r) => r.有效起 ? <small>{hm(r.有效起)}–{hm(r.有效止)}</small> : <small>缺</small> },
    { title: "状态", dataIndex: "状态", width: 90, render: (v: 票状态) => <Tag color={票状态色[v]}>{v}</Tag> },
    {
      title: "操作", width: 170, render: (_, r) => <Space>
        {r.状态 === "排队中" && <Button size="small" type="primary" onClick={() => { const x = s.激活(r.票号); if (!x.成功) message.warning(x.原因 ?? "无法激活"); else message.success(`票 ${r.票号} 激活，成为该区间唯一有效票`); }}>激活</Button>}
        {r.状态 === "有效" && <Button size="small" onClick={() => { s.完工(r.票号); message.success(`票 ${r.票号} 已完工`); }}>完工</Button>}
        {r.状态 === "已作废" && <Tooltip title={r.作废原因}><Tag color="red">已失效</Tag></Tooltip>}
      </Space>,
    },
  ];

  return <div style={{ padding: "22px 26px 60px", maxWidth: 1280, margin: "0 auto" }}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div>
        <Space><a href="/">← 应急协同台</a><Tag color="blue">配电室 × 接触网检修</Tag></Space>
        <h1 style={{ margin: "6px 0 2px", fontSize: 26 }}>复电安全账 · {演示区间.名称}</h1>
        <small style={{ color: "#68758c" }}>{账.事件?.id} · 开工 {fmt(账.事件?.开工时刻)} · 当前班次：{账.班次表.find((b) => b.id === 账.事件?.当前班次id)?.名称}</small>
      </div>
      <Space direction="vertical" align="end">
        <Segmented value={账.在线} onChange={(v) => s.设在线(Boolean(v))} options={[{ label: "在线", value: true }, { label: "断网（现场模式）", value: false }]} />
        <Space>
          <Button size="small" onClick={() => s.推进分钟(-30)}>-30 分</Button>
          <Tag color="geekblue" style={{ fontSize: 14, padding: "2px 10px" }}>模拟时钟 {fmt(账.时钟)}</Tag>
          <Button size="small" onClick={() => s.推进分钟(30)}>+30 分</Button>
          <Button size="small" onClick={() => s.推进分钟(60)}>+1 小时</Button>
          <Button size="small" type="link" danger onClick={s.重置}>重置演示</Button>
        </Space>
      </Space>
    </header>

    <Space style={{ margin: "14px 0" }} wrap>
      <Button onClick={() => { if (停电令) message.warning("停电令已在档"); else { s.停电(); message.success("已下区间停电令 TD-20261007-11"); } }}>① 下区间停电令</Button>
      <Button disabled={!账.事件 || Boolean(账.事件.收尾时刻)} onClick={() => { s.收尾(); message.success("事件已收尾"); }}>② 事件收尾</Button>
      <Button type="primary" ghost onClick={() => set开新票(true)}>开检修票</Button>
      <Button onClick={() => set开接地(true)}>挂接地线</Button>
      <Button onClick={() => set开人员(true)}>人员进/离场</Button>
      <Button disabled={!账.离线队列.length} type="primary" onClick={() => { const r = s.回网(); const 新增 = r.报告.filter((x) => x.结果 === "新增").length; const 重复 = r.报告.filter((x) => x.结果 === "重复忽略").length; const 缺 = r.报告.filter((x) => x.结果 === "缺项待补").length; message.info(`回网合并完成：新增 ${新增}，重复忽略 ${重复}，缺项待补 ${缺}`); }}>回网同步（{账.离线队列.length}）</Button>
      <Button danger ghost onClick={() => s.换班(账.事件?.当前班次id === 甲班.id ? 乙班 : 甲班)}>换班（原票失效并重算排队）</Button>
    </Space>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
      <Card><Statistic title="区间供电" value={停电令 ? "停电中" : "已送电"} valueStyle={{ color: 停电令 ? "#cf1322" : "#3f8600", fontSize: 20 }} /></Card>
      <Card><Statistic title="有效检修票" value={有效 ? 1 : 0} suffix="张" valueStyle={{ color: 有效 ? "#3f8600" : undefined, fontSize: 20 }} formatter={() => 有效 ? 有效.票号 : "无"} /></Card>
      <Card><Statistic title="排队票" value={队列.length} suffix="张" valueStyle={{ fontSize: 20 }} /></Card>
      <Card><Statistic title="在场人员" value={在场.length} suffix="人" valueStyle={{ color: 在场.length ? "#cf1322" : undefined, fontSize: 20 }} /></Card>
      <Card><Statistic title="未拆接地线" value={未拆.length} suffix="组" valueStyle={{ color: 未拆.length ? "#cf1322" : undefined, fontSize: 20 }} /></Card>
    </div>

    {!账.在线 && <Alert style={{ marginBottom: 16 }} type="warning" showIcon
      message="断网现场模式：新票先存本机，不参与排队与对账"
      description={`离线队列 ${账.离线队列.length} 张（含同一票号的重复上传）。回网后按票号合并：重复只认第一次，缺项留在待补。`} />}

    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.55fr) minmax(300px, 1fr)", gap: 16 }}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card title={<Space><Badge status={结论.放行 ? "success" : "error"} /><b>复电前逐项对账</b><Tag color={结论.放行 ? "green" : "red"}>{结论.放行 ? "全部通过，可复电" : "有未闭环项，禁止复电"}</Tag></Space>}
          extra={<Button type="primary" danger disabled={结论.放行} onClick={申请复电}>申请配电室复电</Button>}>
          <Descriptions column={1} size="small" bordered>
            {结论.对账.map((x) => <Descriptions.Item key={x.代码} label={<Tag color={x.通过 ? "green" : "red"} style={{ width: 96, textAlign: "center" }}>{x.代码}</Tag>}>
              <Space><Badge status={x.通过 ? "success" : "error"} text={x.说明} /></Space>
            </Descriptions.Item>)}
          </Descriptions>
          {!结论.放行 && <Alert style={{ marginTop: 12 }} type="error" showIcon message="任一项不通过都不放行：票过期、票外作业、人员未离场、接地线未拆净、事件未收尾。" />}
        </Card>

        <Card title={<Space><b>检修票台账</b><span style={{ color: "#999" }}>同一区间同时只允许一张「有效」票</span></Space>}>
          <Table rowKey="票号" size="small" pagination={false} dataSource={账.检修票} columns={票列} />
          {!!账.待补.length && <Card size="small" type="inner" title={<Tag color="orange">待补（{账.待补.length}）</Tag>} style={{ marginTop: 10 }}>
            {账.待补.map((t) => <Space key={t.票号} style={{ display: "flex", marginBottom: 6 }} wrap>
              <b>{t.票号}</b><Tag color="orange">缺：{t.缺失字段.join("、")}</Tag>
              <Button size="small" onClick={() => { set补票号(t.票号); 补表单.setFieldsValue({ 作业内容: t.作业内容, 作业负责人: t.作业负责人, 班组: t.班组, 有效起: t.有效起?.slice(0, 16), 有效止: t.有效止?.slice(0, 16) }); }}>补录</Button>
            </Space>)}
          </Card>}
        </Card>
      </Space>

      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card title="接地线记录" size="small">
          <Table rowKey="id" size="small" pagination={false} dataSource={账.接地} columns={[
            { title: "位置", dataIndex: "位置" },
            { title: "凭票", dataIndex: "票号", render: (v) => <Tag>{v}</Tag> },
            { title: "挂/拆", render: (_, r: 接地记录) => r.状态 === "已挂设" ? <Tag color="red">挂 {hm(r.挂设时刻)}</Tag> : <Tag color="green">拆 {hm(r.拆除时刻)}</Tag> },
            { title: "操作", render: (_, r) => r.状态 === "已挂设" ? <Button size="small" danger onClick={() => s.拆接地(r.id)}>拆除</Button> : "—" },
          ]} />
        </Card>
        <Card title={`人员进出（在场 ${在场.length} 人）`} size="small">
          <Space wrap style={{ marginBottom: 8 }}>{在场.length ? 在场.map((n) => <Tag key={n} color="red">{n} 在区间</Tag>) : <Tag color="green">已全部离场</Tag>}</Space>
          <Table rowKey="id" size="small" pagination={false} dataSource={[...账.人员].reverse().slice(0, 8)} columns={[
            { title: "姓名", dataIndex: "姓名" }, { title: "工种", dataIndex: "工种" },
            { title: "凭票", dataIndex: "票号", render: (v) => <Tag>{v}</Tag> },
            { title: "方向", dataIndex: "方向", render: (v) => <Tag color={v === "进入" ? "blue" : "default"}>{v}</Tag> },
            { title: "时刻", dataIndex: "时刻", render: (v) => hm(v) },
          ]} />
        </Card>
        {s.最近报告 && <Card size="small" title="最近一次回网合并报告">
          {s.最近报告.map((r, i) => <div key={i} style={{ marginBottom: 4 }}>
            <Tag color={r.结果 === "新增" ? "green" : r.结果 === "重复忽略" ? "default" : "orange"}>{r.结果}</Tag>
            <b>{r.票号}</b>{!!r.缺失字段.length && <small> · 缺 {r.缺失字段.join("、")}</small>}
          </div>)}
        </Card>}
      </Space>
    </div>

    {/* 新开票 */}
    <Modal title="开检修票" open={开新票} onCancel={() => set开新票(false)} onOk={提交票} okText="提交">
      <Form form={票表单} layout="vertical" initialValues={{ 有效起: "2026-10-07T02:30", 有效止: "2026-10-07T05:30", 作业内容: "接触网悬挂检调", 班组: "网电工班甲班" }}>
        <Form.Item name="票号" label="票号（同票号重复上传只认一次）" rules={[{ required: true }]}><Input placeholder="如 JX-20261007-21" /></Form.Item>
        <Form.Item name="作业内容" label="作业内容" rules={[{ required: true }]}><Input /></Form.Item>
        <Space>
          <Form.Item name="作业负责人" label="负责人" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="班组" label="班组" rules={[{ required: true }]}><Input /></Form.Item>
        </Space>
        <Space>
          <Form.Item name="有效起" label="有效起" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
          <Form.Item name="有效止" label="有效止（过期票复电被拦）" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
        </Space>
        <Form.Item name="离线" valuePropName="checked" label={<Space>断网先存现场（回网后按票号合并）</Space>}><input type="checkbox" /></Form.Item>
        <Form.Item noStyle shouldUpdate={(p, c) => p.离线 !== c.离线}>{({ getFieldValue }) => getFieldValue("离线") ? <Form.Item name="设备" label="现场设备"><Input placeholder="手持终端-07" /></Form.Item> : null}</Form.Item>
      </Form>
    </Modal>

    {/* 补录 */}
    <Modal title={`补录检修票 ${补票号 ?? ""}`} open={Boolean(补票号)} onCancel={() => set补票号(null)} onOk={提交补录} okText="补录并入账">
      <Form form={补表单} layout="vertical">
        <Form.Item name="作业内容" label="作业内容"><Input /></Form.Item>
        <Space>
          <Form.Item name="作业负责人" label="负责人"><Input /></Form.Item>
          <Form.Item name="班组" label="班组"><Input /></Form.Item>
        </Space>
        <Space>
          <Form.Item name="有效起" label="有效起"><Input type="datetime-local" /></Form.Item>
          <Form.Item name="有效止" label="有效止"><Input type="datetime-local" /></Form.Item>
        </Space>
      </Form>
    </Modal>

    {/* 挂接地 */}
    <Modal title="挂接地线" open={开接地} onCancel={() => set开接地(false)} onOk={提交接地} okText="登记挂设">
      <Form form={接地表单} layout="vertical">
        <Form.Item name="票号" label="所凭检修票号（挂在票外即票外作业）" rules={[{ required: true }]}><AutoComplete options={票号选项} placeholder="选择或输入票号" /></Form.Item>
        <Form.Item name="位置" label="挂设位置" rules={[{ required: true }]}><Input placeholder="如 K12+300 下行" /></Form.Item>
        <Form.Item name="操作人" label="操作人" rules={[{ required: true }]}><Input /></Form.Item>
      </Form>
    </Modal>

    {/* 人员 */}
    <Modal title="人员进 / 离场登记" open={开人员} onCancel={() => set开人员(false)} onOk={提交人员} okText="登记">
      <Form form={人员表单} layout="vertical" initialValues={{ 方向: "进入" }}>
        <Space>
          <Form.Item name="姓名" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="工种" label="工种" rules={[{ required: true }]}><Input placeholder="接触网工 / 防护员" /></Form.Item>
        </Space>
        <Form.Item name="票号" label="所凭检修票号" rules={[{ required: true }]}><AutoComplete options={票号选项} placeholder="选择或输入票号" /></Form.Item>
        <Form.Item name="方向" label="方向"><Select options={[{ value: "进入", label: "进入区间" }, { value: "离开", label: "离开区间" }]} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
