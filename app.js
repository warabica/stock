const DATA_URL = "data/market.json";

const instruments = [
  { symbol: "KOSPI", code: "KOSPI", name: "코스피", market: "KOSPI", fallback: 2650 },
  { symbol: "KOSDAQ", code: "KOSDAQ", name: "코스닥", market: "KOSDAQ", fallback: 845 },
  { symbol: "005930", code: "005930", name: "삼성전자", market: "KOSPI", fallback: 76000 },
  { symbol: "000660", code: "000660", name: "SK하이닉스", market: "KOSPI", fallback: 178000 },
  { symbol: "087010", code: "087010", name: "펩트론", market: "KOSDAQ", fallback: 72000 },
  { symbol: "469150", code: "469150", name: "ACE AI반도체TOP3Plus", market: "ETF", fallback: 15300 },
  { symbol: "0162Z0", code: "0162Z0", name: "RISE 삼성전자SK하이닉스채권혼합50", market: "ETF", fallback: 11100 },
  { symbol: "229200", code: "229200", name: "KODEX 코스닥150", market: "ETF", fallback: 13700 },
];

let selectedSymbol = "005930";
let quoteMap = new Map();
let exchangeRate = { price: 1470, previousClose: 1475.5, source: "대체 데이터" };
let fearGreed = { score: null, rating: "-", source: "대체 데이터" };
let chartData = [];
let generatedAt = null;
let dataSourceLabel = "대체 데이터";

const formatter = new Intl.NumberFormat("ko-KR");
const priceFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 2,
});
const percentFormatter = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});
const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
});

const els = {
  exchangeRate: document.querySelector("#exchangeRate"),
  fearGreedScore: document.querySelector("#fearGreedScore"),
  fearGreedDetail: document.querySelector("#fearGreedDetail"),
  baseDate: document.querySelector("#baseDate"),
  baseTime: document.querySelector("#baseTime"),
  marketMood: document.querySelector("#marketMood"),
  marketMoodDetail: document.querySelector("#marketMoodDetail"),
  watchlist: document.querySelector("#watchlist"),
  refreshButton: document.querySelector("#refreshButton"),
  statusText: document.querySelector("#statusText"),
  chart: document.querySelector("#priceChart"),
  chartTitle: document.querySelector("#chartTitle"),
  chartSubtitle: document.querySelector("#chartSubtitle"),
};

function syntheticSeries(basePrice) {
  const now = Date.now();
  return Array.from({ length: 30 }, (_, index) => {
    const wave = Math.sin(index / 3.6) * 0.035 + Math.cos(index / 5.2) * 0.018;
    const drift = (index - 14) * 0.0018;
    return {
      date: new Date(now - (29 - index) * 86400000),
      close: Math.max(1, Math.round(basePrice * (1 + wave + drift))),
    };
  });
}

function fallbackQuote(item) {
  const series = syntheticSeries(item.fallback);
  return {
    symbol: item.symbol,
    code: item.code,
    name: item.name,
    market: item.market,
    price: series.at(-1).close,
    previousClose: series.at(-2).close,
    change: series.at(-1).close - series.at(-2).close,
    percent: ((series.at(-1).close - series.at(-2).close) / series.at(-2).close) * 100,
    source: "대체 데이터",
    chart: series.map((point) => ({
      date: point.date.toISOString().slice(0, 10),
      close: point.close,
    })),
    isFallback: true,
  };
}

function normalizePoint(point) {
  return {
    date: new Date(point.date),
    close: Number(point.close),
  };
}

async function loadMarketData() {
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("market data unavailable");
    const data = await response.json();

    generatedAt = data.generatedAt ? new Date(data.generatedAt) : null;
    dataSourceLabel = data.source || "네이버 금융";
    exchangeRate = data.exchange || exchangeRate;
    fearGreed = data.fearGreed || fearGreed;
    quoteMap = new Map(
      instruments.map((item) => {
        const quote = data.instruments?.find((entry) => entry.symbol === item.symbol || entry.code === item.code);
        return [item.symbol, quote ? { ...item, ...quote } : fallbackQuote(item)];
      }),
    );
  } catch {
    generatedAt = new Date();
    dataSourceLabel = "대체 데이터";
    quoteMap = new Map(instruments.map((item) => [item.symbol, fallbackQuote(item)]));
  }
}

function loadSelectedChart() {
  const item = instruments.find((entry) => entry.symbol === selectedSymbol) || instruments[2];
  const quote = quoteMap.get(selectedSymbol) || fallbackQuote(item);
  const sourceChart = Array.isArray(quote.chart) && quote.chart.length ? quote.chart : fallbackQuote(item).chart;
  chartData = sourceChart.map(normalizePoint).filter((point) => Number.isFinite(point.close));
}

function changeInfo(quote) {
  const price = Number(quote.price);
  const previous = Number(quote.previousClose);
  const change = Number.isFinite(Number(quote.change)) ? Number(quote.change) : price - previous;
  const percent = Number.isFinite(Number(quote.percent)) ? Number(quote.percent) : previous ? (change / previous) * 100 : 0;
  return { price, change, percent };
}

function priceText(quote, symbol) {
  const value = Number(quote.price);
  if (!Number.isFinite(value)) return "-";
  if (symbol === "KOSPI" || symbol === "KOSDAQ") return priceFormatter.format(value);
  return `${formatter.format(Math.round(value))}원`;
}

function renderSummary() {
  const kospi = quoteMap.get("KOSPI");
  const kosdaq = quoteMap.get("KOSDAQ");
  const marketScores = [kospi, kosdaq].filter(Boolean).map((quote) => changeInfo(quote).percent);
  const average = marketScores.reduce((sum, value) => sum + value, 0) / Math.max(1, marketScores.length);
  const mood = average > 0.35 ? "위험선호" : average < -0.35 ? "방어적" : "중립";
  const base = generatedAt || new Date();

  els.exchangeRate.textContent = `${priceFormatter.format(Number(exchangeRate.price || 0))}원`;
  els.fearGreedScore.textContent = Number.isFinite(Number(fearGreed.score))
    ? Math.round(Number(fearGreed.score)).toString()
    : "-";
  els.fearGreedDetail.textContent = fearGreed.rating ? `${fearGreed.rating} · ${fearGreed.source || "CNN"}` : "-";
  els.baseDate.textContent = dateFormatter.format(base);
  els.baseTime.textContent = `${timeFormatter.format(base)} 기준`;
  els.marketMood.textContent = mood;
  els.marketMoodDetail.textContent = `코스피/코스닥 평균 ${percentFormatter.format(average)}%`;
}

function renderWatchlist() {
  els.watchlist.innerHTML = "";

  instruments.forEach((item) => {
    const quote = quoteMap.get(item.symbol) || fallbackQuote(item);
    const info = changeInfo(quote);
    const direction = info.change >= 0 ? "up" : "down";
    const sign = info.change >= 0 ? "+" : "";

    const button = document.createElement("button");
    button.type = "button";
    button.className = `stock-card ${item.symbol === selectedSymbol ? "is-active" : ""}`;
    button.dataset.symbol = item.symbol;
    button.innerHTML = `
      <div class="stock-head">
        <div>
          <span class="stock-symbol">${item.code}</span>
          <span class="stock-name">${item.name}</span>
        </div>
        <span class="stock-market">${item.market}</span>
      </div>
      <div class="stock-price">${priceText(quote, item.symbol)}</div>
      <div class="stock-change ${direction}">
        ${sign}${priceFormatter.format(Math.abs(info.change))}
        (${sign}${percentFormatter.format(info.percent)}%)
      </div>
      <div class="stock-meta">${quote.source || dataSourceLabel}</div>
    `;

    button.addEventListener("click", () => {
      selectedSymbol = item.symbol;
      renderWatchlist();
      loadSelectedChart();
      renderChart();
    });

    els.watchlist.appendChild(button);
  });
}

function renderChart() {
  const canvas = els.chart;
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  const item = instruments.find((entry) => entry.symbol === selectedSymbol) || instruments[2];
  const points = chartData.length ? chartData : syntheticSeries(item.fallback);
  const values = points.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const pad = { top: 18, right: 18, bottom: 38, left: 62 };
  const width = rect.width - pad.left - pad.right;
  const height = rect.height - pad.top - pad.bottom;

  els.chartTitle.textContent = `${item.name} 30일 가격`;
  els.chartSubtitle.textContent = `${dateFormatter.format(points[0].date)} - ${dateFormatter.format(points.at(-1).date)}`;

  context.strokeStyle = "#dce4dd";
  context.lineWidth = 1;
  context.font = "12px Inter, system-ui, sans-serif";
  context.fillStyle = "#66756d";

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (height / 4) * i;
    const value = max - (range / 4) * i;
    context.beginPath();
    context.moveTo(pad.left, y);
    context.lineTo(rect.width - pad.right, y);
    context.stroke();
    context.fillText(priceFormatter.format(Math.round(value)), 8, y + 4);
  }

  const xFor = (index) => pad.left + (width * index) / Math.max(1, points.length - 1);
  const yFor = (value) => pad.top + height - ((value - min) / range) * height;

  const gradient = context.createLinearGradient(0, pad.top, 0, rect.height - pad.bottom);
  gradient.addColorStop(0, "rgba(12, 124, 89, 0.26)");
  gradient.addColorStop(1, "rgba(12, 124, 89, 0.02)");

  context.beginPath();
  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.close);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.lineTo(xFor(points.length - 1), rect.height - pad.bottom);
  context.lineTo(xFor(0), rect.height - pad.bottom);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.close);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = "#0c7c59";
  context.lineWidth = 3;
  context.stroke();

  context.fillStyle = "#17211c";
  context.font = "700 12px Inter, system-ui, sans-serif";
  [0, Math.floor(points.length / 2), points.length - 1].forEach((index) => {
    const point = points[index];
    context.fillText(`${point.date.getMonth() + 1}/${point.date.getDate()}`, xFor(index) - 14, rect.height - 12);
  });
}

async function refresh() {
  els.refreshButton.disabled = true;
  els.refreshButton.classList.add("is-loading");
  els.statusText.textContent = "네이버 금융 데이터를 불러오는 중입니다.";

  await loadMarketData();
  loadSelectedChart();
  renderSummary();
  renderWatchlist();
  renderChart();

  els.statusText.textContent =
    dataSourceLabel === "대체 데이터"
      ? "데이터 파일을 찾지 못해 대체 데이터를 표시 중입니다."
      : `${dataSourceLabel} 기준 데이터가 반영되었습니다.`;
  els.refreshButton.disabled = false;
  els.refreshButton.classList.remove("is-loading");
}

els.refreshButton.addEventListener("click", refresh);
window.addEventListener("resize", renderChart);

refresh();
