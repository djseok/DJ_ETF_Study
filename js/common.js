// =========================================================
// 🔧 공통 설정·도구 (모든 js 파일보다 먼저 로드)
// - 데이터 주소는 여기 한 곳에서만 관리합니다. 시트 게시 주소가 바뀌면 이 파일만 고치면 돼요.
// =========================================================

var APP_CONFIG = {
    // 가격 조회 서버 (Apps Script → 야후 파이낸스). MDD·RSI·이평선·개별주식분석·포트폴리오 백테스트가 사용
    PRICE_PROXY_URL: "https://script.google.com/macros/s/AKfycbwClCZ-kZi1Ztcy4YRvVyY3TV7mzpImg4isvPBUqX4nI2lYjGFE8ecp52j-nMKf2XXR/exec",

    // 웹에 게시된 구글 시트(CSV)
    SHEETS: {
        // 관리시트
        MACRO: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=2016694665&single=true&output=csv",
        SIGNAL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=1985460214&single=true&output=csv",
        MASTER: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=223914478&single=true&output=csv",
        DIVIDEND_RULES: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRyotJ2TeefWbfE61uwtnUh68sk-QE4H9HULDkIaKFXbihMYFqNGXL9N2gqSBgxONQze_sTwuo4QgBN/pub?gid=686768122&single=true&output=csv",
        // 동진ETF공부_개인일기장
        PORTFOLIO: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTCTcHadjbIOvs7_Qj7owcNQXi7OE6Lobcr3g0n8UuBZ0k3L0upQOzXcsFBbtq7wowIwAtscyGP46vF/pub?gid=449713965&single=true&output=csv",
        DOLLAR_PORT: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTCTcHadjbIOvs7_Qj7owcNQXi7OE6Lobcr3g0n8UuBZ0k3L0upQOzXcsFBbtq7wowIwAtscyGP46vF/pub?gid=2370013&single=true&output=csv",
        // 동진_웹송출용_마스터시트
        DIVIDEND_DB: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxhI6i-75x1SCVScxYjhb6_6PdpYUhCrP2b4FNu2zxDSUpqETmPSy6JnsIesHhGbikjdG3YCCv6oFh/pub?gid=795942259&single=true&output=csv",
        // $1 프로젝트 마스터
        DOLLAR_MASTER: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTKoSBQw1UoGbpQx22iY5kEbkOWsKXxYhpmUVHLv7a7CWYMjsCdUwh4PccuyZ8p79Ma6IvivG7xT4Lv/pub?gid=0&single=true&output=csv"
    }
};

// 시트 주소 + 캐시 방지용 시각 (페이지를 열 때마다 최신 데이터를 받도록)
var APP_LOAD_TIME = new Date().getTime();
function sheetUrl(key) {
    return APP_CONFIG.SHEETS[key] + "&t=" + APP_LOAD_TIME;
}

// 가격 서버 주소: priceProxyUrl('005930.KS', { range: '5y' })
function priceProxyUrl(ticker, params) {
    var q = "?ticker=" + encodeURIComponent(ticker);
    for (var k in (params || {})) q += "&" + k + "=" + encodeURIComponent(params[k]);
    return APP_CONFIG.PRICE_PROXY_URL + q;
}

// ---------------------------------------------------------
// CSV 파서 (따옴표 안의 쉼표·줄바꿈, "" 이스케이프까지 처리)
// options
//   trim            : 칸 앞뒤 공백 제거 (기본 true)
//   dropBlankLines  : 아무 글자도 없는 줄 제외 (기본 true)
//   dropEmptyRows   : 모든 칸이 빈 줄(",,,") 제외 (기본 false)
// ---------------------------------------------------------
function parseCsv(text, options) {
    var opt = Object.assign({ trim: true, dropBlankLines: true, dropEmptyRows: false }, options || {});
    if (!text) return [];
    text = String(text).replace(/^﻿/, '');

    var rows = [], row = [], cell = '', inQuotes = false, lineHasChars = false;
    var pushCell = function () { row.push(opt.trim ? cell.trim() : cell); cell = ''; };
    var pushRow = function () {
        pushCell();
        var blank = !lineHasChars;
        var empty = row.every(function (v) { return String(v).trim() === ''; });
        if (!(opt.dropBlankLines && blank) && !(opt.dropEmptyRows && empty)) rows.push(row);
        row = []; lineHasChars = false;
    };

    for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; }
                else inQuotes = false;
            } else cell += ch;
            continue;
        }
        if (ch === '"') { inQuotes = true; lineHasChars = true; }
        else if (ch === ',') { pushCell(); lineHasChars = true; }
        else if (ch === '\r' || ch === '\n') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            pushRow();
        } else { cell += ch; if (ch.trim() !== '') lineHasChars = true; else if (!opt.trim) lineHasChars = true; }
    }
    if (cell !== '' || row.length > 0 || lineHasChars) pushRow();
    return rows;
}

// 대시보드 기본 파서: 모든 칸이 빈 줄은 제외
function parseCsvToMatrix(text) {
    return parseCsv(text, { dropEmptyRows: true });
}

// 가격 서버 응답에서 실패 이유 뽑기 (예: "No data found, symbol may be delisted")
function describePriceError(data) {
    if (!data) return '';
    if (data.error) return typeof data.error === 'string' ? data.error : (data.error.description || JSON.stringify(data.error));
    if (data.chart && data.chart.error) return data.chart.error.description || data.chart.error.code || '';
    if (data.chart && data.chart.result && data.chart.result.length === 0) return '데이터 없음';
    return '';
}
