// app.js — サイト表示速度チェッカー
const STORAGE_KEY = 'site-speed-checker';
let state = { history: [], theme: 'dark' };

function init() { loadState(); applyTheme(); bindEvents(); renderHistory(); }
function loadState() { try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); if(s) state = {...state, ...s}; } catch{} }
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  document.getElementById('theme-toggle').textContent = state.theme === 'dark' ? '☀️' : '🌙';
}

function bindEvents() {
  document.getElementById('theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); saveState();
  });
  document.getElementById('speed-form').addEventListener('submit', handleAnalyze);
}

async function handleAnalyze(e) {
  e.preventDefault();
  const urlEl = document.getElementById('target-url');
  let targetUrl = urlEl.value.trim();
  if(!targetUrl) return;
  if(!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }
  
  urlEl.value = targetUrl;
  
  const btn = document.getElementById('analyze-btn');
  btn.disabled = true;
  btn.querySelector('.btn-text').style.display = 'none';
  btn.querySelector('.btn-loading').style.display = 'inline';
  
  try {
    // 注: APIキーなしの場合、並列実行するとRate Limit (HTTP 429) エラーになりやすいため直列実行に変更し、意図的に数秒のウェイトを入れる
    const mobileRes = await fetchPSI(targetUrl, 'mobile');
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2秒待機して制限回避
    const desktopRes = await fetchPSI(targetUrl, 'desktop');
    
    const result = {
      id: Date.now().toString(),
      url: targetUrl,
      date: new Date().toISOString(),
      mobile: parsePSIResult(mobileRes),
      desktop: parsePSIResult(desktopRes),
      opportunities: extractOpportunities(mobileRes)
    };
    
    state.history.unshift(result);
    if(state.history.length > 20) state.history.pop();
    saveState();
    
    renderResult(result);
    renderHistory();
    
  } catch(err) {
    if (err.message.includes('429')) {
      alert('【アクセス制限のお知らせ】\nGoogle APIの無料枠制限（回線状況による共有制限を含む）にかかっているため、UI動作確認用の「疑似データ（デモ結果）」を表示します！');
      
      const dummyResult = generateDummyData(targetUrl);
      state.history.unshift(dummyResult);
      if(state.history.length > 20) state.history.pop();
      saveState();
      
      renderResult(dummyResult);
      renderHistory();
    } else {
      alert('測定に失敗しました。URLが正しいか確認してください。\nエラー: ' + err.message);
    }
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').style.display = 'inline';
    btn.querySelector('.btn-loading').style.display = 'none';
  }
}

async function fetchPSI(url, strategy) {
  // 注: APIキーなしの場合IP制限に引っかかりやすいため注意が必要
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}`;
  const res = await fetch(endpoint);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function parsePSIResult(data) {
  const lighthouse = data.lighthouseResult;
  if(!lighthouse) throw new Error('No Lighthouse Result');
  
  const score = Math.round(lighthouse.categories.performance.score * 100);
  const audits = lighthouse.audits;
  
  return {
    score,
    lcp: audits['largest-contentful-paint']?.displayValue || '-',
    fid: audits['max-potential-fid']?.displayValue || audits['total-blocking-time']?.displayValue || '-',
    cls: audits['cumulative-layout-shift']?.displayValue || '-'
  };
}

function extractOpportunities(data) {
  if (data.isDummy) return data.dummyOpportunities; // デモデータ用
  const audits = data.lighthouseResult?.audits || {};
  const opps = [];
  
  Object.values(audits).forEach(audit => {
    if(audit.details?.type === 'opportunity' && audit.score !== null && audit.score < 1) {
      if(audit.details.overallSavingsMs > 50) {
        opps.push({
          title: audit.title,
          desc: audit.description,
          saving: `最大 ${(audit.details.overallSavingsMs / 1000).toFixed(2)}秒 削減可能`,
          score: audit.score
        });
      }
    }
  });
  return opps.sort((a,b) => a.score - b.score).slice(0, 5); // 最悪な順に5つ
}

function renderResult(res) {
  document.getElementById('result-section').style.display = 'block';
  document.getElementById('current-url').textContent = res.isDummy ? `${res.url} (※デモ表示)` : res.url;
  
  updateScoreCard('mobile', res.mobile);
  updateScoreCard('desktop', res.desktop);
  
  const oppList = document.getElementById('opp-list');
  if(res.opportunities.length === 0) {
    oppList.innerHTML = '<p style="color:var(--score-good)">🎉 特に改善が必要な大きな問題は見つかりませんでした。</p>';
  } else {
    oppList.innerHTML = res.opportunities.map(o => `
      <div class="opp-item">
        <div class="opp-header">
          <div class="opp-title">${o.title}</div>
          <div class="opp-saving">${o.saving}</div>
        </div>
        <div class="opp-desc">${formatDesc(o.desc)}</div>
      </div>
    `).join('');
  }
}

function updateScoreCard(device, data) {
  const card = document.querySelector(`.${device}-card`);
  card.className = `score-card ${device}-card`;
  
  let ratingClass = 'poor';
  if(data.score >= 90) ratingClass = 'good';
  else if(data.score >= 50) ratingClass = 'avg';
  
  card.classList.add(ratingClass);
  
  document.getElementById(`${device}-score`).textContent = data.score;
  document.getElementById(`${device}-lcp`).textContent = data.lcp;
  document.getElementById(`${device}-fid`).textContent = data.fid;
  document.getElementById(`${device}-cls`).textContent = data.cls;
  
  const circ = document.getElementById(`${device}-progress`);
  const offset = 283 - (283 * data.score / 100);
  circ.style.strokeDashoffset = 283; // reset animation
  setTimeout(() => circ.style.strokeDashoffset = offset, 50);
}

function renderHistory() {
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  if(state.history.length === 0) {
    empty.style.display = 'block'; list.innerHTML = ''; return;
  }
  
  empty.style.display = 'none';
  list.innerHTML = state.history.map(h => {
    const m = h.mobile.score, d = h.desktop.score;
    const mClass = m>=90?'good':m>=50?'avg':'poor';
    const dClass = d>=90?'good':d>=50?'avg':'poor';
    
    return `
      <div class="history-item" onclick="loadHistory('${h.id}')">
        <div>
          <div class="hist-url">${h.url}</div>
          <div class="hist-date">${formatDate(h.date)}</div>
        </div>
        <div class="hist-scores">
          <div class="hist-score ${mClass}">📱 ${m}</div>
          <div class="hist-score ${dClass}">💻 ${d}</div>
        </div>
      </div>
    `;
  }).join('');
}

window.loadHistory = function(id) {
  const h = state.history.find(x => x.id === id);
  if(h) renderResult(h);
};

function formatDesc(md) {
  if (!md) return '';
  // PageSpeedのマークダウンリンクを簡易的に除去
  return md.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// 429エラー時のUI表示用ダミーデータ生成器
function generateDummyData(url) {
  const mScore = Math.floor(Math.random() * 40) + 40; // 40~79
  const dScore = Math.floor(Math.random() * 30) + 65; // 65~94
  
  return {
    id: Date.now().toString(),
    url: url,
    date: new Date().toISOString(),
    isDummy: true,
    mobile: {
      score: mScore,
      lcp: (2.5 + Math.random() * 2).toFixed(1) + ' s',
      fid: Math.floor(Math.random() * 100) + ' ms',
      cls: (Math.random() * 0.2).toFixed(3)
    },
    desktop: {
      score: dScore,
      lcp: (1.0 + Math.random() * 1.5).toFixed(1) + ' s',
      fid: Math.floor(Math.random() * 50) + ' ms',
      cls: (Math.random() * 0.1).toFixed(3)
    },
    opportunities: [
      { title: '次世代フォーマットでの画像の配信', saving: '最大 1.20秒 削減可能', desc: 'WebP などの画像フォーマットは PNG や JPEG より圧縮率が高く、ダウンロード時間が短縮されます。' },
      { title: 'レンダリングを妨げるリソースの除外', saving: '最大 0.85秒 削減可能', desc: 'ページの初回ペイントをブロックしているリソースがあります。重要な JS/CSS はインライン化し、それ以外は遅延読み込みを検討してください。' },
      { title: '使用していない JavaScript の削減', saving: '最大 0.60秒 削減可能', desc: '使用していない JavaScript を削減し、スクリプトが必要になるまで読み込みを遅延させると、ネットワーク通信量を減らすことができます。' }
    ]
  };
}

document.addEventListener('DOMContentLoaded', init);
