const QUOTE_ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart/";

const instruments = [
  { symbol: "^KS11", name: "코스피", market: "KOSPI", fallback: 2650 },
  { symbol: "^KQ11", name: "코스닥", market: "KOSDAQ", fallback: 845 },
  { symbol: "005930.KS", name: "삼성전자", market: "KOSPI", fallback: 76000 },
  { symbol: "000660.KS", name: "SK하이닉스", market: "KOSPI", fallback: 178000 },
  { symbol: "087010.KQ", name: "펩트론", market: "KOSDAQ", fallback: 72000 },
  { symbol: "469150.KS", name: "ACE AI반도체TOP3Plus", market: "ETF", fallback: 15300 },
  { symbol: "447620.KS", name: "RISE 삼성전자SK하이닉스채권혼합50", market: "ETF", fallback: 11100 },
  { symbol: "229200.KS", name: "KODEX 코스닥150", market: "ETF", fallback: 13700 },
];

const fallbackRates = {
  "KRW=X": { price: 1368.4, previousClose: 1362.2 },
};

let selectedSymbol = "005930.KS";
let quoteMap = new Map();
let chartData = [];

const formatter = new Intl.NumberFormat("ko-KR");
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

async function fetchChart(symbol, range = "1d", interval = "1m") {
  const url = `${QUOTE_ENDPOINT}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${symbol} quote failed`);
  const data = await response.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error(`${symbol} quote missing`);

  const quote = result.indicators?.quote?.[0] || {};
  const closes = (quote.close || []).filter((value) => Number.isFinite(value));
  const currentPrice = result.meta?.regularMarketPrice ?? closes.at(-1);
  const previousClose = result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? closes.at(0);

  return {
    symbol,
    currency: result.meta?.currency || "KRW",
    timestamp: result.timestamp || [],
    close: quote.close || [],
    price: Number(currentPrice),
    previousClose: Number(previousClose),
    regularMarketTime: result.meta?.regularMarketTime,
  };
}

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
    currency: item.symbol.startsWith("^") ? "KRW" : "KRW",
    timestamp: series.map((point) => Math.floor(point.date.getTime() / 1000)),
    close: series.map((point) => point.close),
    price: series.at(-1).close,
    previousClose: series.at(-2).close,
    regularMarketTime: Math.floor(Date.now() / 1000),
    isFallback: true,
  };
}

async function loadQuotes() {
  const requests = instruments.map(async (item) => {
    try {
      return [item.symbol, await fetchChart(item.symbol)];
    } catch {
      return [item.symbol, fallbackQuote(item)];
    }
  });
  quoteMap = new Map(await Promise.all(requests));

  try {
    const exchange = await fetchChart("KRW=X");
    fallbackRates["KRW=X"] = exchange;
  } catch {
    fallbackRates["KRW=X"].isFallback = true;
  }
}

async function loadSelectedChart() {
  const item = instruments.find((entry) => entry.symbol === selectedSymbol) || instruments[2];
  try {
    const data = await fetchChart(selectedSymbol, "1mo", "1d");
    chartData = data.timestamp
      .map((timestamp, index) => ({
        date: new Date(timestamp * 1000),
        close: data.close[index],
      }))
      .filter((point) => Number.isFinite(point.close));
  } catch {
    chartData = syntheticSeries(item.fallback);
  }
}

function changeInfo(quote) {
  const price = Number(quote.price);
  const previous = Number(quote.previousClose);
  const change = price - previous;
  const percent = previous ? (change / previous) * 100 : 0;
  return { price, change, percent };
}

function priceText(quote, symbol) {
  const value = Number(quote.price);
  if (!Number.isFinite(value)) return "-";
  if (symbol === "KRW=X") return `${formatter.format(value.toFixed(2))}원`;
  if (symbol.startsWith("^")) return formatter.format(value.toFixed(2));
  return `${formatter.format(Math.round(value))}원`;
}

function renderSummary() {
  const exchange = fallbackRates["KRW=X"];
  const kospi = quoteMap.get("^KS11");
  const kosdaq = quoteMap.get("^KQ11");
  const marketScores = [kospi, kosdaq].filter(Boolean).map((quote) => changeInfo(quote).percent);
  const average = marketScores.reduce((sum, value) => sum + value, 0) / Math.max(1, marketScores.length);
  const mood = average > 0.35 ? "위험선호" : average < -0.35 ? "방어적" : "중립";
  const latestTime = Math.max(
    ...[...quoteMap.values(), exchange].map((quote) => quote?.regularMarketTime || 0),
  );
  const base = latestTime ? new Date(latestTime * 1000) : new Date();

  els.exchangeRate.textContent = priceText(exchange, "KRW=X");
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
          <span class="stock-symbol">${item.symbol.replace(".KS", "").replace(".KQ", "")}</span>
          <span class="stock-name">${item.name}</span>
        </div>
        <span class="stock-market">${item.market}</span>
      </div>
      <div class="stock-price">${priceText(quote, item.symbol)}</div>
      <div class="stock-change ${direction}">
        ${sign}${formatter.format(info.change.toFixed(item.symbol.startsWith("^") ? 2 : 0))}
        (${sign}${percentFormatter.format(info.percent)}%)
      </div>
      <div class="stock-meta">${quote.isFallback ? "대체 데이터 표시 중" : "Yahoo Finance"}</div>
    `;

    button.addEventListener("click", async () => {
      selectedSymbol = item.symbol;
      renderWatchlist();
      await loadSelectedChart();
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
    context.fillText(formatter.format(Math.round(value)), 8, y + 4);
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
  els.statusText.textContent = "시세를 갱신하는 중입니다.";

  await loadQuotes();
  await loadSelectedChart();
  renderSummary();
  renderWatchlist();
  renderChart();

  const hasFallback = [...quoteMap.values(), fallbackRates["KRW=X"]].some((quote) => quote?.isFallback);
  els.statusText.textContent = hasFallback
    ? "일부 항목은 네트워크 제한으로 대체 데이터를 표시 중입니다."
    : "최신 시세가 반영되었습니다.";
  els.refreshButton.disabled = false;
  els.refreshButton.classList.remove("is-loading");
}

els.refreshButton.addEventListener("click", refresh);
window.addEventListener("resize", renderChart);

refresh();
