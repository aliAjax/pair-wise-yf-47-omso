// 接触网检修复电「安全账」领域模型
// 纯函数 + 显式时钟，不依赖 React / 存储，便于逐规则测试。

export type 停电状态 = "已送电" | "已停电";
export type 票状态 = "排队中" | "有效" | "已完工" | "已作废";
export type 接地状态 = "已挂设" | "已拆除";
export type 出入方向 = "进入" | "离开";
export type 补录状态 = "待补录" | "已补全";

export interface 区间 {
  id: string;
  名称: string;
}

export interface 班次 {
  id: string;
  名称: string;
  开始时刻: string;
}

export interface 事件 {
  id: string;
  标题: string;
  区间id: string;
  停电状态: 停电状态;
  当前班次id: string;
  开工时刻: string;
  收尾时刻?: string;
}

export interface 停电令 {
  票号: string; // 区间停电令号
  区间id: string;
  停电时刻: string;
  复电时刻?: string;
}

export interface 检修票必填 {
  票号: string;
  区间id: string;
  作业内容: string;
  作业负责人: string;
  班组: string;
  班次id: string;
  有效起: string;
  有效止: string;
  排队序号?: number;
}

export interface 检修票 extends 检修票必填 {
  状态: 票状态;
  创建时刻: string;
  激活时刻?: string;
  完工时刻?: string;
  作废时刻?: string;
  作废原因?: string;
  离线?: boolean;
  补录: 补录状态;
  缺失字段: string[];
  上传次数: number;
}

export interface 接地记录 {
  id: string;
  票号: string;
  区间id: string;
  位置: string;
  状态: 接地状态;
  挂设时刻: string;
  拆除时刻?: string;
  操作人: string;
}

export interface 人员记录 {
  id: string;
  票号: string;
  区间id: string;
  姓名: string;
  工种: string;
  方向: 出入方向;
  时刻: string;
}

export interface 对账项 {
  代码:
    | "事件未收尾"
    | "停电令缺失"
    | "票况"
    | "存在票外作业"
    | "接地线未拆净"
    | "人员未离场";
  通过: boolean;
  说明: string;
}

export interface 放行结论 {
  放行: boolean;
  时刻: string;
  对账: 对账项[];
}

export interface 离线传票 {
  raw: Partial<检修票必填>;
  本地时刻: string;
  设备: string;
}

export interface 合并报告项 {
  票号: string;
  结果: "新增" | "重复忽略" | "缺项待补";
  缺失字段: string[];
}

export interface 安全账状态 {
  时钟: string;
  在线: boolean;
  区间表: 区间[];
  班次表: 班次[];
  事件?: 事件;
  停电令: 停电令[];
  检修票: 检修票[];
  接地: 接地记录[];
  人员: 人员记录[];
  待补: 检修票[];
  离线队列: 离线传票[];
}
