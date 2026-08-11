/**
 * Mock 数据 - 基于真实接口返回数据
 * 考勤实时管理演示场景
 */

(function (global) {
  "use strict";

  // 真实接口返回数据
  var realData = {
    // 场景编码，保持和录制文件名一致
    demonstrationCode: "scene_20260731_191358_j998nk",
    // 演示地图标题
    demonstrationTitle: "考勤实时管理",
    // 演示地图副标题
    demonstrationSubTitle: "保障生产计划完成",
    // 演示地图中间导航标题，显示示例（以>符号分割菜单路径）：制造业>车间人效管理>灵活排班管理
    demonstrationHeaderNavTitle: "制造业>车间人效管理>灵活排班管理",
    // 演示地图模块列表
    moduleList: [
      {
        // 模块标题
        moduleTitle: "企业明确生产计划，规划员工排班",
        // 模块描述
        moduleDesc:
          "采购部获取订单后，生产中心需进行产品评估，明确注塑车间生产计划，为员工规划排班",
        // 模块类型，enterprise：企业端，employee：员工端
        moduleType: "enterprise",
        // 模块步骤列表
        stepList: [
          {
            // 步骤标题
            stepTitle: "为演示员工排班",
            // 步骤引导语
            introduction: {
              // 引导语问题
              question: "薪福通如何辅助制造业企业高效落实生产计划？",
              // 引导语答案
              answer:
                "当采购部收到订单后，生产中心需要快速明确各环节的分工与协作。我们以演示员工为例，演示系统如何辅助排班并精准落实到车间和员工。",
            },
            // 子步骤列表
            subStepList: [
              {
                // 子步骤气泡卡提示标题
                title: "为演示员工排班",
                // 子步骤气泡卡提示内容，可为空
                content: "点击「演示员工」",
                // 子步骤气泡卡提示位置，可选值：top、bottom、left、right
                position: "right",
              },
            ],
          },
          {
            stepTitle: "可为演示员工按周期排班",
            introduction: {
              question: "如何利用车间排班规律，快速为演示员工完成整月排班？",
              answer:
                "制造业车间（如注塑车间）通常有固定的排班模式，例如两班倒或三班倒，系统支持根据预设周期自动生成排班表。",
            },
            subStepList: [
              {
                title: "可为演示员工按周期排班",
                content: "选择周期排班",
                position: "bottom",
              },
              {
                title: "选择预设好的注塑排班周期",
                position: "bottom",
              },
              {
                title: "选择第一天",
                position: "bottom",
              },
              {
                title: "演示员工本月的排班已完成",
                position: "bottom",
              },
            ],
          },
        ],
      },
      {
        moduleTitle: "员工获知出勤安排",
        moduleDesc: "员工实时查看车间排班表，获知具体上下班时间",
        moduleType: "employee",
        stepList: [
          {
            stepTitle: "员工获知出勤安排",
            introduction: {
              question: "当生产计划落实后，员工如何获知自己的排班出勤安排？",
              answer:
                "无需班组长逐一通知，员工只需登录手机App，就可实时获知整月排班出勤安排，和每天的上下班具体时间。",
              isMobileGuide: true,
            },
            subStepList: [
              {
                title: "员工获知出勤安排",
                content: "点击「我的排班-查看今天出勤时间」",
                position: "bottom",
              },
              {
                title: "演示员工随时查看自己的出勤安排",
                position: "bottom",
              },
            ],
          },
        ],
      },
    ],
  };

  // 暴露到全局
  global.MockData = realData;
})(typeof window !== "undefined" ? window : this);
