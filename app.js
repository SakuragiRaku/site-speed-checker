// app.js — サイト表示速度チェッカー
const STORAGE_KEY = 'site-speed-checker';
let state = { history: [], theme: 'dark' };

function init() { loadState(); applyTheme(); bindEvents(); renderHistory(); }
function loadState() { try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (s) state = { ...state, ...s }; } catch { } }
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  document.getElementById('theme-toggle').textContent = state.theme === 'dark' ? '☀️' : '🌙';
}

// トースト通知 (alertの代替)
function showToast(message, type = 'error', duration = 5000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, duration);
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
  if (!targetUrl) return;
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  urlEl.value = targetUrl;

  // APIキー未設定チェック
  if (typeof PSI_API_KEY === 'undefined' || PSI_API_KEY === 'YOUR_API_KEY_HERE') {
    showToast('⚠️ ai-config.js にAPIキーが設定されていません。Google Cloud Console でキーを取得して設定してください。', 'warning', 8000);
    return;
  }

  const btn = document.getElementById('analyze-btn');
  btn.disabled = true;
  btn.querySelector('.btn-text').style.display = 'none';
  btn.querySelector('.btn-loading').style.display = 'inline';

  try {
    // モバイルとデスクトップを順番に実行（並列はAPIレート制限にかかりやすいため直列）
    const mobileRes = await fetchPSI(targetUrl, 'mobile');
    await new Promise(resolve => setTimeout(resolve, 1000));
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
    if (state.history.length > 20) state.history.pop();
    saveState();

    renderResult(result);
    renderHistory();
    showToast('✅ 計測完了しました。', 'success', 3000);

  } catch (err) {
    if (err.message.includes('429')) {
      showToast('⚠️ APIのレート制限に達しました。1〜2分待ってから再試行してください。', 'warning', 8000);
    } else if (err.message.includes('400')) {
      showToast('❌ このサイトはGoogleのクローラーでアクセスできません（Cloudflare保護・robots.txt拒否等の可能性）。', 'error', 6000);
    } else if (err.message.includes('403')) {
      showToast('❌ APIキーが無効か、PageSpeed Insights APIが有効になっていません。Google Cloud Consoleを確認してください。', 'error', 8000);
    } else {
      showToast('❌ 計測に失敗しました: ' + err.message, 'error', 6000);
    }
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').style.display = 'inline';
    btn.querySelector('.btn-loading').style.display = 'none';
  }
}

async function fetchPSI(url, strategy) {
  const apiKey = (typeof PSI_API_KEY !== 'undefined' && PSI_API_KEY !== 'YOUR_API_KEY_HERE') ? PSI_API_KEY : '';
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&key=${apiKey}`;
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function parsePSIResult(data) {
  const lighthouse = data.lighthouseResult;
  if (!lighthouse) throw new Error('No Lighthouse Result');

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
  if (data.isDummy) return data.dummyOpportunities;
  const audits = data.lighthouseResult?.audits || {};
  const opps = [];

  Object.values(audits).forEach(audit => {
    if (audit.details?.type === 'opportunity' && audit.score !== null && audit.score < 1) {
      if (audit.details.overallSavingsMs > 50) {
        opps.push({
          title: audit.title,
          desc: audit.description,
          saving: `最大 ${(audit.details.overallSavingsMs / 1000).toFixed(2)}秒 削減可能`,
          score: audit.score
        });
      }
    }
  });
  return opps.sort((a, b) => a.score - b.score).slice(0, 5);
}

function renderResult(res) {
  document.getElementById('result-section').style.display = 'block';
  document.getElementById('current-url').textContent = res.url;

  updateScoreCard('mobile', res.mobile);
  updateScoreCard('desktop', res.desktop);

  const oppList = document.getElementById('opp-list');
  if (res.opportunities.length === 0) {
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
  if (data.score >= 90) ratingClass = 'good';
  else if (data.score >= 50) ratingClass = 'avg';

  card.classList.add(ratingClass);

  document.getElementById(`${device}-score`).textContent = data.score;
  document.getElementById(`${device}-lcp`).textContent = data.lcp;
  document.getElementById(`${device}-fid`).textContent = data.fid;
  document.getElementById(`${device}-cls`).textContent = data.cls;

  const circ = document.getElementById(`${device}-progress`);
  const offset = 283 - (283 * data.score / 100);
  circ.style.strokeDashoffset = 283;
  setTimeout(() => circ.style.strokeDashoffset = offset, 50);
}

function renderHistory() {
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  if (state.history.length === 0) {
    empty.style.display = 'block'; list.innerHTML = ''; return;
  }

  empty.style.display = 'none';
  list.innerHTML = state.history.map(h => {
    const m = h.mobile.score, d = h.desktop.score;
    const mClass = m >= 90 ? 'good' : m >= 50 ? 'avg' : 'poor';
    const dClass = d >= 90 ? 'good' : d >= 50 ? 'avg' : 'poor';

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

window.loadHistory = function (id) {
  const h = state.history.find(x => x.id === id);
  if (h) renderResult(h);
};

function formatDesc(md) {
  if (!md) return '';
  return md.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', init);
