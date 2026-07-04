const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const HISTORY_KEY = "land_calc_history_v2";
const DISCLAIMER = "本工具僅供初步估算參考，實際金額與申請條件請以主管機關核定為準。";

let currentMode = "feedback";
let currentResult = null;
let currentImageBlob = null;

const modeTitles = {
  feedback: "土地變更回饋金試算",
  solar: "屋頂太陽能收益試算",
  utility: "廠區水電需求試算",
  bridge: "架橋規費試算"
};

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits }).format(value);
}

function currency(value) {
  return `NT$ ${formatNumber(Math.round(value), 0)}`;
}

function positiveNumber(input) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeNumber(input) {
  if (input.value.trim() === "") return 0;
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function showError(message, inputs = []) {
  const error = $("#formError");
  error.textContent = message;
  error.classList.remove("hidden");
  $$("input.invalid").forEach((input) => input.classList.remove("invalid"));
  inputs.forEach((input) => input?.classList.add("invalid"));
  inputs[0]?.focus();
}

function clearError() {
  $("#formError").classList.add("hidden");
  $$("input.invalid").forEach((input) => input.classList.remove("invalid"));
}

function addParcel(values = {}) {
  const node = $("#parcelTemplate").content.firstElementChild.cloneNode(true);
  $(".parcel-land-no", node).value = values.landNo || "";
  $(".parcel-area", node).value = values.area || "";
  $(".parcel-value", node).value = values.presentValue || "";
  $("#parcelList").append(node);
  updateParcelNumbers();
}

function updateParcelNumbers() {
  const cards = $$(".parcel-card");
  cards.forEach((card, index) => {
    $(".parcel-number", card).textContent = index + 1;
    $(".remove-parcel", card).disabled = cards.length === 1;
  });
}

function getFeedbackRate() {
  const selected = $('input[name="feedbackRate"]:checked').value;
  return selected === "custom" ? positiveNumber($("#feedbackCustomRate")) : Number(selected);
}

function calculateFeedback() {
  const cards = $$(".parcel-card");
  const rate = getFeedbackRate();
  if (!rate || rate > 100) {
    showError("請輸入 0 至 100 之間的回饋金比例。", [$("#feedbackCustomRate")]);
    return null;
  }
  const parcels = [];
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const landNoInput = $(".parcel-land-no", card);
    const areaInput = $(".parcel-area", card);
    const valueInput = $(".parcel-value", card);
    const landNo = landNoInput.value.trim();
    const area = positiveNumber(areaInput);
    const presentValue = positiveNumber(valueInput);
    const invalid = [];
    if (!landNo) invalid.push(landNoInput);
    if (!area) invalid.push(areaInput);
    if (!presentValue) invalid.push(valueInput);
    if (invalid.length) {
      showError(`請完整填寫第 ${index + 1} 筆地號、土地面積與公告現值，數值必須大於 0。`, invalid);
      return null;
    }
    const landValue = area * presentValue;
    const fee = Math.round(landValue * rate / 100);
    parcels.push({ landNo, area, ping: area * 0.3025, presentValue, landValue, fee });
  }
  const totalArea = parcels.reduce((sum, item) => sum + item.area, 0);
  const totalPing = parcels.reduce((sum, item) => sum + item.ping, 0);
  const totalFee = parcels.reduce((sum, item) => sum + item.fee, 0);
  return {
    mode: "feedback",
    title: modeTitles.feedback,
    date: today(),
    customer: $("#feedbackCustomer").value.trim(),
    meta: [`地號筆數：${parcels.length} 筆`, `回饋比例：${formatNumber(rate)}%`],
    parcels,
    details: [
      ["土地總面積", `${formatNumber(totalArea)} ㎡（約 ${formatNumber(totalPing)} 坪）`]
    ],
    totalLabel: "預估回饋金總額",
    totalText: currency(totalFee),
    totalValue: totalFee,
    rate
  };
}

function calculateSolar() {
  const pingInput = $("#solarPing");
  const sunInput = $("#sunHours");
  const fitInput = $("#fitRate");
  const rateInput = $("#solarRate");
  const ping = positiveNumber(pingInput);
  const sunHours = positiveNumber(sunInput);
  const fitRate = positiveNumber(fitInput);
  const shareRate = positiveNumber(rateInput);
  const invalid = [[ping, pingInput], [sunHours, sunInput], [fitRate, fitInput], [shareRate, rateInput]].filter(([value]) => !value).map(([, input]) => input);
  if (invalid.length || shareRate > 100) {
    showError("屋頂坪數、日照時間、收購費率與分潤比例皆須大於 0，比例不可超過 100%。", invalid.length ? invalid : [rateInput]);
    return null;
  }
  const capacity = ping / 2;
  const annualRent = Math.round(capacity * sunHours * 365 * fitRate * shareRate / 100);
  return {
    mode: "solar", title: modeTitles.solar, date: today(),
    customer: $("#solarCustomer").value.trim(), landNo: $("#solarLandNo").value.trim(),
    meta: $("#solarLandNo").value.trim() ? [`地段地號：${$("#solarLandNo").value.trim()}`] : [],
    details: [
      ["屋頂可建坪數", `${formatNumber(ping)} 坪`],
      ["預估發電容量", `${formatNumber(capacity)} KW`],
      ["平均日照時間", `${formatNumber(sunHours)} 小時/天`],
      ["台電收購費率", `${formatNumber(fitRate, 4)} 元/度`],
      ["租金分潤比例", `${formatNumber(shareRate)}%`]
    ],
    totalLabel: "預估年租金", totalText: `${currency(annualRent)} / 年`, totalValue: annualRent
  };
}

function calculateUtility() {
  const hpInput = $("#horsepower");
  const peopleInput = $("#people");
  const hp = nonNegativeNumber(hpInput);
  const people = nonNegativeNumber(peopleInput);
  if (hp === null || people === null || (hp === 0 && people === 0) || !Number.isInteger(people)) {
    showError("馬力數與人數至少填寫一項；不可為負數，人數須為整數。", [hp === null ? hpInput : null, people === null || !Number.isInteger(people) ? peopleInput : null].filter(Boolean));
    return null;
  }
  const kw = hp * 0.75;
  const water = ((people * 150) / 4) / 1000;
  return {
    mode: "utility", title: modeTitles.utility, date: today(), customer: "", meta: [],
    details: [
      ["設備總馬力", `${formatNumber(hp)} HP`],
      ["換算電力需求", `${formatNumber(kw)} KW`],
      ["評估人數", `${formatNumber(people, 0)} 人`],
      ["預估日用水量", `${formatNumber(water)} 立方公尺/日`]
    ],
    totalLabel: "水電需求摘要", totalText: `${formatNumber(kw)} KW / ${formatNumber(water)} CMD`,
    totalValue: `${formatNumber(kw)} KW / ${formatNumber(water)} CMD`
  };
}

function calculateBridge() {
  const lengthInput = $("#bridgeLength");
  const widthInput = $("#bridgeWidth");
  const valueInput = $("#bridgeValue");
  const length = positiveNumber(lengthInput);
  const width = positiveNumber(widthInput);
  const presentValue = positiveNumber(valueInput);
  const invalid = [[length, lengthInput], [width, widthInput], [presentValue, valueInput]].filter(([value]) => !value).map(([, input]) => input);
  if (invalid.length) {
    showError("架橋長度、寬度與渠道公告現值皆須完整填寫且大於 0。", invalid);
    return null;
  }
  const years = Number($('input[name="bridgeYears"]:checked').value);
  const area = length * width;
  const annualFee = Math.round(area * presentValue * 0.05);
  const totalFee = annualFee * years;
  return {
    mode: "bridge", title: modeTitles.bridge, date: today(),
    customer: $("#bridgeCustomer").value.trim(), landNo: $("#bridgeLandNo").value.trim(),
    meta: $("#bridgeLandNo").value.trim() ? [`地段地號：${$("#bridgeLandNo").value.trim()}`] : [],
    details: [
      ["架橋尺寸", `${formatNumber(length)} × ${formatNumber(width)} 公尺`],
      ["使用面積", `${formatNumber(area)} ㎡`],
      ["渠道公告現值", `${currency(presentValue)} / ㎡`],
      ["每年規費（5%）", `${currency(annualFee)} / 年`],
      ["計費年期", years === 25 ? "既設 25 年（含追繳 5 年）" : "新設 20 年"]
    ],
    totalLabel: "預估應繳總額", totalText: currency(totalFee), totalValue: totalFee
  };
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function renderResult(result) {
  $("#resultTitle").textContent = result.title;
  const meta = [`產出日期：${result.date}`];
  if (result.customer) meta.push(`客戶名稱：${result.customer}`);
  meta.push(...result.meta);
  $("#resultMeta").innerHTML = meta.map((item) => `<div>${escapeHtml(item)}</div>`).join("");
  const details = $("#resultDetails");
  if (result.mode === "feedback") {
    details.innerHTML = result.parcels.map((parcel, index) => `
      <article class="parcel-result">
        <h3>${index + 1}. ${escapeHtml(parcel.landNo)}</h3>
        ${detailRow("土地面積", `${formatNumber(parcel.area)} ㎡（約 ${formatNumber(parcel.ping)} 坪）`)}
        ${detailRow("公告現值", `${currency(parcel.presentValue)} / ㎡`)}
        ${detailRow("本筆回饋金", currency(parcel.fee))}
      </article>`).join("") + result.details.map(([label, value]) => detailRow(label, value)).join("");
  } else {
    details.innerHTML = result.details.map(([label, value]) => detailRow(label, value)).join("");
  }
  $("#resultTotalLabel").textContent = result.totalLabel;
  $("#resultTotal").textContent = result.totalText;
  $("#resultSection").classList.remove("hidden");
  $("#shareStatus").textContent = "";
  currentImageBlob = null;
  $("#resultSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

function detailRow(label, value) {
  return `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

function saveHistory(result) {
  const history = readHistory();
  history.unshift({
    mode: result.mode, title: result.title, date: result.date,
    customer: result.customer || "", label: result.customer || result.landNo || (result.parcels?.[0]?.landNo) || result.title,
    totalText: result.totalText
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 10)));
  renderHistory();
}

function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function renderHistory() {
  const history = readHistory();
  $("#historyList").innerHTML = history.length
    ? history.map((item) => `<div class="history-item"><div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.title)} · ${escapeHtml(item.date)}</span></div><b>${escapeHtml(item.totalText)}</b></div>`).join("")
    : '<div class="empty">尚無試算紀錄</div>';
  $("#clearHistory").classList.toggle("hidden", history.length === 0);
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const character of String(text)) {
    const test = line + character;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = character;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function canvasRows(result) {
  const rows = [];
  if (result.mode === "feedback") {
    result.parcels.forEach((parcel, index) => {
      rows.push({ heading: `${index + 1}. ${parcel.landNo}` });
      rows.push({ label: "土地面積", value: `${formatNumber(parcel.area)} ㎡（約 ${formatNumber(parcel.ping)} 坪）` });
      rows.push({ label: "公告現值", value: `${currency(parcel.presentValue)} / ㎡` });
      rows.push({ label: "本筆回饋金", value: currency(parcel.fee) });
    });
  }
  result.details.forEach(([label, value]) => rows.push({ label, value }));
  return rows;
}

async function createResultImage(result) {
  if (currentImageBlob) return currentImageBlob;
  await document.fonts?.ready;
  const width = 1200;
  const margin = 82;
  const contentWidth = width - margin * 2;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = '32px "Microsoft JhengHei", sans-serif';
  const meta = [`產出日期：${result.date}`];
  if (result.customer) meta.push(`客戶名稱：${result.customer}`);
  meta.push(...result.meta);
  const rows = canvasRows(result);
  let measuredHeight = 250 + meta.length * 48;
  rows.forEach((row) => {
    if (row.heading) {
      ctx.font = 'bold 31px "Microsoft JhengHei", sans-serif';
      measuredHeight += 42 + wrapText(ctx, row.heading, contentWidth).length * 42;
    } else {
      ctx.font = '30px "Microsoft JhengHei", sans-serif';
      measuredHeight += Math.max(wrapText(ctx, row.label, 340).length, wrapText(ctx, row.value, 600).length) * 40 + 34;
    }
  });
  measuredHeight += 330;
  canvas.width = width;
  canvas.height = Math.max(1100, measuredHeight);
  ctx.fillStyle = "#f1f6f3";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 34, 34, width - 68, canvas.height - 68, 28);
  ctx.fill();
  ctx.fillStyle = "#245c4f";
  ctx.fillRect(34, 34, width - 68, 16);
  let y = 112;
  ctx.fillStyle = "#245c4f";
  ctx.font = 'bold 24px "Microsoft JhengHei", sans-serif';
  ctx.fillText("土地開發試算報告", margin, y);
  y += 66;
  ctx.fillStyle = "#17211e";
  ctx.font = 'bold 48px "Microsoft JhengHei", sans-serif';
  wrapText(ctx, result.title, contentWidth).forEach((line) => { ctx.fillText(line, margin, y); y += 58; });
  y += 12;
  ctx.font = '27px "Microsoft JhengHei", sans-serif';
  ctx.fillStyle = "#66736e";
  meta.forEach((item) => {
    wrapText(ctx, item, contentWidth).forEach((line) => { ctx.fillText(line, margin, y); y += 42; });
  });
  y += 18;
  ctx.strokeStyle = "#d9e0dc";
  ctx.lineWidth = 2;
  drawLine(ctx, margin, y, width - margin, y);
  y += 38;
  rows.forEach((row) => {
    if (row.heading) {
      y += 16;
      ctx.font = 'bold 31px "Microsoft JhengHei", sans-serif';
      ctx.fillStyle = "#245c4f";
      wrapText(ctx, row.heading, contentWidth).forEach((line) => { ctx.fillText(line, margin, y); y += 42; });
      y += 8;
      return;
    }
    ctx.font = '27px "Microsoft JhengHei", sans-serif';
    ctx.fillStyle = "#66736e";
    const labelLines = wrapText(ctx, row.label, 340);
    ctx.fillStyle = "#17211e";
    ctx.font = 'bold 29px "Microsoft JhengHei", sans-serif';
    const valueLines = wrapText(ctx, row.value, 600);
    const lineCount = Math.max(labelLines.length, valueLines.length);
    ctx.font = '27px "Microsoft JhengHei", sans-serif';
    ctx.fillStyle = "#66736e";
    labelLines.forEach((line, i) => ctx.fillText(line, margin, y + i * 40));
    ctx.font = 'bold 29px "Microsoft JhengHei", sans-serif';
    ctx.fillStyle = "#17211e";
    valueLines.forEach((line, i) => {
      const lineWidth = ctx.measureText(line).width;
      ctx.fillText(line, width - margin - lineWidth, y + i * 40);
    });
    y += lineCount * 40 + 22;
    ctx.strokeStyle = "#edf0ee";
    drawLine(ctx, margin, y, width - margin, y);
    y += 32;
  });
  ctx.fillStyle = "#e8f1ed";
  roundRect(ctx, margin, y, contentWidth, 132, 18);
  ctx.fill();
  ctx.fillStyle = "#3e514a";
  ctx.font = 'bold 25px "Microsoft JhengHei", sans-serif';
  ctx.fillText(result.totalLabel, margin + 28, y + 48);
  ctx.fillStyle = "#17483d";
  ctx.font = 'bold 40px "Microsoft JhengHei", sans-serif';
  const totalLines = wrapText(ctx, result.totalText, contentWidth - 56);
  totalLines.forEach((line, index) => ctx.fillText(line, margin + 28, y + 98 + index * 46));
  y += 172 + Math.max(0, totalLines.length - 1) * 46;
  ctx.fillStyle = "#7a8581";
  ctx.font = '22px "Microsoft JhengHei", sans-serif';
  wrapText(ctx, DISCLAIMER, contentWidth).forEach((line) => { ctx.fillText(line, margin, y); y += 34; });
  currentImageBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return currentImageBlob;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawLine(ctx, x1, y1, x2, y2) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function imageFileName() {
  const stamp = new Date().toISOString().slice(0, 10);
  return `土地開發試算_${currentResult.mode}_${stamp}.png`;
}

async function downloadImage() {
  if (!currentResult) return;
  const blob = await createResultImage(currentResult);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = imageFileName();
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("#shareStatus").textContent = "結果圖片已儲存。";
}

async function shareImage() {
  if (!currentResult) return;
  const blob = await createResultImage(currentResult);
  const file = new File([blob], imageFileName(), { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title: currentResult.title, text: "土地開發試算結果", files: [file] });
      $("#shareStatus").textContent = "已開啟分享選單。";
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  await downloadImage();
  $("#shareStatus").textContent = "此裝置無法直接分享，圖片已改為儲存，請從 LINE 選取傳送。";
}

function switchMode(mode) {
  currentMode = mode;
  $$(".tab").forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active);
  });
  $$("[data-section]").forEach((section) => section.classList.toggle("hidden", section.dataset.section !== mode));
  $("#resultSection").classList.add("hidden");
  clearError();
}

$("#addParcel").addEventListener("click", () => addParcel());
$("#parcelList").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-parcel");
  if (!button || $$(".parcel-card").length === 1) return;
  button.closest(".parcel-card").remove();
  updateParcelNumbers();
});
$("#parcelList").addEventListener("input", (event) => {
  if (!event.target.matches(".parcel-area")) return;
  const area = Number.parseFloat(event.target.value);
  $(".parcel-ping", event.target.closest(".parcel-card")).textContent = Number.isFinite(area) && area > 0 ? `約 ${formatNumber(area * 0.3025)} 坪` : "約 0.00 坪";
});
$$('input[name="feedbackRate"]').forEach((input) => input.addEventListener("change", () => {
  $("#feedbackCustomWrap").classList.toggle("hidden", input.value !== "custom" || !input.checked);
}));
$("#solarPing").addEventListener("input", () => {
  const ping = Number.parseFloat($("#solarPing").value);
  $("#solarKwHint").textContent = Number.isFinite(ping) && ping > 0 ? `預估容量 ${formatNumber(ping / 2)} KW` : "預估容量 0.00 KW";
});
$$(".tab").forEach((tab) => tab.addEventListener("click", () => switchMode(tab.dataset.mode)));

$("#calculatorForm").addEventListener("submit", (event) => {
  event.preventDefault();
  clearError();
  const calculators = { feedback: calculateFeedback, solar: calculateSolar, utility: calculateUtility, bridge: calculateBridge };
  const result = calculators[currentMode]();
  if (!result) return;
  currentResult = result;
  renderResult(result);
  saveHistory(result);
});

$("#historyToggle").addEventListener("click", () => {
  const panel = $("#historyPanel");
  const open = panel.classList.toggle("hidden") === false;
  $("#historyToggle").setAttribute("aria-expanded", open);
});
$("#clearHistory").addEventListener("click", () => {
  if (!window.confirm("確定清除這台裝置上的所有試算紀錄？")) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});
$("#downloadImage").addEventListener("click", downloadImage);
$("#shareImage").addEventListener("click", shareImage);

addParcel();
renderHistory();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
