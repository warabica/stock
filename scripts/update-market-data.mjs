import { mkdir, writeFile } from "node:fs/promises";

const NAVER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Referer: "https://finance.naver.com/",
};

const instruments = [
  { symbol: "KOSPI", code: "KOSPI", name: "코스피", market: "KOSPI", type: "index" },
  { symbol: "KOSDAQ", code: "KOSDAQ", name: "코스닥", market: "KOSDAQ", type: "index" },
  { symbol: "005930", code: "005930", name: "삼성전자", market: "KOSPI", type: "equity" },
  { symbol: "000660", code: "000660", name: "SK하이닉스", market: "KOSPI", type: "equity" },
  { symbol: "087010", code: "087010", name: "펩트론", market: "KOSDAQ", type: "equity" },
  { symbol: "469150", code: "469150", name: "ACE AI반도체TOP3Plus", market: "ETF", type: "etf" },
  { symbol: "0162Z0", code: "0162Z0", name: "RISE 삼성전자SK하이닉스채권혼합50", market: "ETF", type: "etf" },
  { symbol: "229200", code: "229200", name: "KODEX 코스닥150", market: "ETF", type: "etf" },
];

function yyyymmdd(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
}

function isoDate(yyyymmddText) {
  return `${yyyymmddText.slice(0, 4)}-${yyyymmddText.slice(4, 6)}-${yyyymmddText.slice(6, 8)}`;
}

function numberFromText(value) {
  if (typeof value === "number") return value;
  return Number(String(value || "").replace(/,/g, ""));
}

async function fetchText(url, headers = NAVER_HEADERS) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

async function fetchJson(url, headers = NAVER_HEADERS) {
  const text = await fetchText(url, headers);
  if (!text.trim()) throw new Error(`Empty response: ${url}`);
  return JSON.parse(text);
}

function parseSiseRows(text) {
  const rows = [];
  const pattern =
    /\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\]/g;
  let match = pattern.exec(text);
  while (match) {
    rows.push({
      date: isoDate(match[1]),
      open: Number(match[2]),
      high: Number(match[3]),
      low: Number(match[4]),
      close: Number(match[5]),
      volume: Number(match[6]),
      foreignRatio: Number(match[7]),
    });
    match = pattern.exec(text);
  }
  return rows;
}

async function fetchDailyChart(code) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 60);
  const params = new URLSearchParams({
    symbol: code,
    requestType: "1",
    startTime: yyyymmdd(start),
    endTime: yyyymmdd(end),
    timeframe: "day",
  });
  const text = await fetchText(`https://api.finance.naver.com/siseJson.naver?${params}`);
  return parseSiseRows(text).slice(-30);
}

function signedChange(summary) {
  const diff = numberFromText(summary.diff);
  const rate = numberFromText(summary.rate);
  const falling = String(summary.risefall) === "5";
  return {
    change: falling ? -Math.abs(diff) : Math.abs(diff),
    percent: falling ? -Math.abs(rate) : Math.abs(rate),
  };
}

async function fetchInstrument(item) {
  const chart = await fetchDailyChart(item.code);
  const latest = chart.at(-1);
  const previous = chart.at(-2);

  if (item.type === "index") {
    const price = latest?.close ?? 0;
    const previousClose = previous?.close ?? price;
    const change = price - previousClose;
    const percent = previousClose ? (change / previousClose) * 100 : 0;
    return {
      ...item,
      price,
      previousClose,
      change,
      percent,
      chart,
      source: "네이버 금융",
      updatedAt: latest?.date,
    };
  }

  const summary = await fetchJson(`https://api.finance.naver.com/service/itemSummary.nhn?itemcode=${item.code}`);
  const price = numberFromText(summary.now);
  const { change, percent } = signedChange(summary);
  return {
    ...item,
    price,
    previousClose: price - change,
    change,
    percent,
    high: numberFromText(summary.high),
    low: numberFromText(summary.low),
    volume: numberFromText(summary.quant),
    amount: numberFromText(summary.amount),
    chart,
    source: "네이버 금융",
    updatedAt: latest?.date,
  };
}

async function fetchExchange() {
  const data = await fetchJson(
    "https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_USDKRW",
    {
      ...NAVER_HEADERS,
      Referer: "https://m.stock.naver.com/",
    },
  );
  const result = data.result || {};
  const price = numberFromText(result.closePrice || result.calcPrice);
  const change = numberFromText(result.fluctuations);
  const percent = numberFromText(result.fluctuationsRatio);
  return {
    symbol: "USD/KRW",
    price,
    previousClose: price - change,
    change,
    percent,
    source: "네이버 금융",
    updatedAt: result.localTradedAt || null,
  };
}

const settledInstruments = await Promise.allSettled(instruments.map(fetchInstrument));
const successfulInstruments = settledInstruments
  .map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    console.warn(`${instruments[index].name} failed: ${result.reason?.message || result.reason}`);
    return null;
  })
  .filter(Boolean);

if (successfulInstruments.length < instruments.length) {
  throw new Error(`Only ${successfulInstruments.length}/${instruments.length} instruments were fetched`);
}

const payload = {
  generatedAt: new Date().toISOString(),
  source: "네이버 금융",
  exchange: await fetchExchange(),
  instruments: successfulInstruments,
};

await mkdir("data", { recursive: true });
await writeFile("data/market.json", `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote data/market.json with ${payload.instruments.length} instruments`);
