const weekdayMap = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function dateAtUtc(dateText) {
  return new Date(`${dateText}T00:00:00.000Z`);
}

export function addDays(dateText, days) {
  const date = dateAtUtc(dateText);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function chinaClockParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    isoWeekday: weekdayMap[parts.weekday] ?? 1,
  };
}

export function isoWeekStart(dateText, isoWeekday) {
  return addDays(dateText, 1 - isoWeekday);
}

function timeValue(value) {
  return String(value ?? "").slice(0, 5);
}

export function dueReportTypes(preference, clock) {
  const due = [];
  if (
    preference.daily_enabled &&
    clock.time >= timeValue(preference.daily_time)
  ) {
    due.push("daily");
  }
  const weeklyDay = Number(preference.weekly_day ?? 5);
  const weeklyTimeReached = clock.isoWeekday > weeklyDay ||
    (
      clock.isoWeekday === weeklyDay &&
      clock.time >= timeValue(preference.weekly_time)
    );
  if (preference.weekly_enabled && weeklyTimeReached) due.push("weekly");
  return due;
}

function activityLabel(value) {
  return {
    call: "电话沟通",
    meeting: "会议",
    visit: "客户拜访",
    proposal: "方案推进",
    task: "任务推进",
    note: "工作记录",
    stage_change: "阶段推进",
  }[value] ?? "工作推进";
}

export function buildWorkAnalysisFallback({
  displayName,
  reportType,
  periodLabel,
  entries,
  projects,
  salespeople,
}) {
  const salesName = new Map(
    salespeople.map((person) => [person.id, person.display_name]),
  );
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const grouped = new Map();
  for (const entry of entries) {
    const name = salesName.get(entry.salesperson_id) ?? "销售团队";
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(entry);
  }
  const teamSections = [...grouped.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, reportType === "weekly" ? 8 : 5)
    .map(([name, items]) => {
      const highlights = items.slice(0, 3).map((item) => {
        const project = projectMap.get(item.project_id);
        const projectName = project?.name ? `${project.name}：` : "";
        return `${projectName}${activityLabel(item.activity_type)}—${item.content}`;
      });
      return `- **${name}**：${highlights.join("；")}`;
    });
  const touchedProjectIds = new Set(entries.map((entry) => entry.project_id));
  const nextMoves = projects
    .filter((project) =>
      touchedProjectIds.has(project.id) &&
      (project.next_action || project.risk)
    )
    .slice(0, 4)
    .map((project, index) => {
      const action = project.next_action ||
        `围绕“${project.risk}”明确解决动作`;
      const date = project.next_action_date
        ? `（${project.next_action_date}）`
        : "";
      return `${index + 1}. ${project.name}：${action}${date}`;
    });
  const title = reportType === "weekly"
    ? `AI 工作周报｜${periodLabel}`
    : `AI 工作日报｜${periodLabel}`;
  const summary = entries.length
    ? `本期形成 ${entries.length} 项客户与项目推进动作，工作重心集中在${
      [...new Set(
        entries.slice(0, 6).map((entry) =>
          projectMap.get(entry.project_id)?.name
        ).filter(Boolean),
      )].slice(0, 3).join("、") || "重点项目推进"
    }。`
    : "近期工作应继续围绕重点项目转化、客户关键人沟通和下一步行动闭环展开。";
  return {
    title,
    content: [
      `## ${title}`,
      "",
      `**管理结论**：${summary}`,
      "",
      `**${reportType === "weekly" ? "本周工作分析" : "工作推进分析"}**`,
      ...(teamSections.length
        ? teamSections
        : ["- 聚焦高优项目，持续推动客户沟通结果转化为明确行动。"]),
      "",
      "**下一步管理动作**",
      ...(nextMoves.length
        ? nextMoves
        : [
          "1. 围绕重点项目逐一明确下一次客户触点、责任人和完成时间。",
          "2. 对已形成方案或商务沟通的项目，推动客户给出可验证反馈。",
        ]),
      "",
      `${displayName}可直接回复机器人追问具体销售或项目，Agent 将继续按管理权限展开分析。`,
    ].join("\n"),
  };
}
