function addText(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = String(text ?? "");
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}

function addListSection(root, title, items, render) {
  const section = document.createElement("section");
  addText(section, "h2", title);
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) addText(section, "p", "暂无记录", "empty");
  rows.forEach((item) => {
    const row = document.createElement("div");
    row.className = "report-row";
    render(row, item ?? {});
    section.appendChild(row);
  });
  root.appendChild(section);
}

export async function downloadSalesReportPdf(report) {
  if (!report?.content) throw new Error("报告尚未生成完成");
  const content = report.content;
  const metrics = content.metrics ?? {};
  const root = document.createElement("article");
  root.className = "sales-report-pdf";
  root.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;padding:56px 64px;background:#fff;color:#17233c;font-family:Inter,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.65;z-index:-1";
  const style = document.createElement("style");
  style.textContent = `.sales-report-pdf h1{font-size:28px;margin:0 0 8px}.sales-report-pdf h2{font-size:18px;margin:26px 0 12px;padding-bottom:7px;border-bottom:1px solid #dce6f4}.sales-report-pdf .meta{font-size:12px;color:#6d7b91}.sales-report-pdf .summary{margin:22px 0;padding:16px 18px;background:#f3f7fd;border-left:4px solid #1677ff}.sales-report-pdf .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.sales-report-pdf .metric{padding:12px;border:1px solid #dfe7f1;border-radius:8px}.sales-report-pdf .metric b{display:block;font-size:20px;color:#1263c9}.sales-report-pdf .metric span{font-size:11px;color:#6d7b91}.sales-report-pdf .report-row{padding:10px 0;border-bottom:1px solid #edf1f6}.sales-report-pdf .report-row strong{display:block;font-size:14px}.sales-report-pdf .report-row p{margin:3px 0;font-size:12px}.sales-report-pdf .empty{color:#8a98ac}.sales-report-pdf .suggestion{margin:6px 0;padding-left:16px}`;
  root.appendChild(style);
  addText(root, "h1", report.title);
  addText(root, "p", `${report.dataScope} · ${report.periodStart} 至 ${report.periodEnd} · 销售 Agent（By Keenclaw）`, "meta");
  addText(root, "p", content.executiveSummary || "暂无管理摘要", "summary");

  const metricGrid = document.createElement("div");
  metricGrid.className = "metrics";
  [
    ["项目数", metrics.projectCount ?? report.projectCount ?? 0],
    ["商机总额（万元）", metrics.totalAmount ?? 0],
    ["加权管道（万元）", metrics.weightedPipeline ?? 0],
    ["客户行动", metrics.actionCount ?? 0],
    ["赢单", metrics.wonCount ?? 0],
    ["丢单", metrics.lostCount ?? 0],
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "metric";
    addText(item, "b", value);
    addText(item, "span", label);
    metricGrid.appendChild(item);
  });
  root.appendChild(metricGrid);

  addListSection(root, "当前项目行动", content.currentActions, (row, item) => {
    addText(row, "strong", item.projectName || "未命名项目");
    addText(row, "p", `${item.action || "未填写行动"}${item.owner ? ` · ${item.owner}` : ""}${item.date ? ` · ${item.date}` : ""}`);
  });
  addListSection(root, "项目问题", content.projectIssues, (row, item) => {
    addText(row, "strong", item.projectName || "未命名项目");
    addText(row, "p", `${item.issue || "未填写问题"}${item.impact ? `；影响：${item.impact}` : ""}`);
  });
  addListSection(root, "热项目", content.hotProjects, (row, item) => {
    addText(row, "strong", `${item.projectName || "未命名项目"}${item.amount ? ` · ${item.amount} 万元` : ""}`);
    addText(row, "p", item.reason || "暂无判断说明");
  });
  addListSection(root, "冷项目", content.coldProjects, (row, item) => {
    addText(row, "strong", `${item.projectName || "未命名项目"}${item.amount ? ` · ${item.amount} 万元` : ""}`);
    addText(row, "p", item.reason || "暂无判断说明");
  });
  const analysis = document.createElement("section");
  addText(analysis, "h2", "Agent 分析");
  addText(analysis, "p", content.agentAnalysis || "暂无分析");
  root.appendChild(analysis);
  const suggestions = document.createElement("section");
  addText(suggestions, "h2", "下一步建议");
  (content.nextSuggestions ?? []).forEach((item, index) => addText(suggestions, "p", `${index + 1}. ${item}`, "suggestion"));
  root.appendChild(suggestions);
  document.body.appendChild(root);

  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
    const canvas = await html2canvas(root, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const margin = 10;
    const pageWidth = 210 - margin * 2;
    const pageHeight = 297 - margin * 2;
    const imageHeight = canvas.height * pageWidth / canvas.width;
    const image = canvas.toDataURL("image/png", 1);
    let offset = 0;
    pdf.addImage(image, "PNG", margin, margin, pageWidth, imageHeight);
    while (imageHeight - offset > pageHeight) {
      offset += pageHeight;
      pdf.addPage();
      pdf.addImage(image, "PNG", margin, margin - offset, pageWidth, imageHeight);
    }
    pdf.save(`${report.title.replace(/[\\/:*?"<>|]/g, "-")}.pdf`);
  } finally {
    root.remove();
  }
}
