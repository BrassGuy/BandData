/* eslint-disable no-undef */

/*
 * Client-side marching-band score dashboard v3.0 (Live)
 * -----------------------------------------------------
 * Connects to a local server to receive live data updates
 * from JSON files. All analysis happens in-browser.
 */

// --- STATE MANAGEMENT ---
const state = {
  adjudicationData: null,
  scoreRows: [],
  judgeComments: [],
  historicalJudgeComments: [],
  isDataInitialized: {
    scores: false,
    adjudication: false,
    comments: false,
    historical_comments: false,
  }
};

// --- UTILITY FUNCTIONS ---
const toNum = (v) => (typeof v === 'number' ? v : parseFloat(v));
const META_COLS = new Set(['CompetitionDate', 'CompetitionName', 'BandName', 'Overall']);

// --- UI & TAB NAVIGATION ---
function initTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      const tabId = button.dataset.tab;
      tabContents.forEach(content => {
        content.id === tabId ? content.classList.add('active') : content.classList.remove('active');
      });
    });
  });
}

// --- CHART CREATION ---
function createLineChart(ctx, labels, datasets, options = {}) {
  // Destroy existing chart if it exists
  if (ctx.chart) {
    ctx.chart.destroy();
  }
  const defaultOptions = {
    responsive: true,
    plugins: { legend: { position: 'top', labels: { color: '#E0E0E0' } } },
    scales: {
      x: { ticks: { color: '#E0E0E0' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } },
      y: { ticks: { color: '#E0E0E0' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } },
    },
  };
  ctx.chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: { ...defaultOptions, ...options },
  });
}

function createBarChart(ctx, labels, datasets, options = {}) {
  if (ctx.chart) {
    ctx.chart.destroy();
  }
  const defaultOptions = {
    responsive: true,
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#E0E0E0' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } },
      y: { ticks: { color: '#E0E0E0' }, grid: { color: 'rgba(255, 255, 255, 0.1)' } },
    },
  };
  ctx.chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: { ...defaultOptions, ...options },
  });
}

// --- CORE DATA ANALYSIS (Functions are the same as before) ---
function computeTrend(rows, columnKey = 'Overall') {
    const map = new Map();
    rows.forEach((row) => {
        const dateStr = row.CompetitionDate;
        const val = toNum(row[columnKey]);
        if (!dateStr || Number.isNaN(val)) return;
        if (!map.has(dateStr)) map.set(dateStr, []);
        map.get(dateStr).push(val);
    });
    const sortedDates = [...map.keys()].sort();
    const labels = sortedDates;
    const data = sortedDates.map(d => {
        const arr = map.get(d);
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    });
    return { labels, data };
}

function computeWeaknesses(rows, n = 4) {
    const sums = {};
    const counts = {};
    rows.forEach((row) => {
        Object.entries(row).forEach(([col, val]) => {
            if (META_COLS.has(col) || col === 'BandName') return;
            const num = toNum(val);
            if (Number.isNaN(num)) return;
            if (!sums[col]) {
                sums[col] = 0;
                counts[col] = 0;
            }
            sums[col] += num;
            counts[col] += 1;
        });
    });
    const avgs = Object.entries(sums).map(([col, sum]) => [col, sum / counts[col]]);
    avgs.sort((a, b) => a[1] - b[1]);
    return avgs.slice(0, n);
}

function computeExtremes(rows) {
    let highest = null, lowest = null;
    rows.forEach((row) => {
        const score = toNum(row.Overall);
        if (Number.isNaN(score)) return;
        if (!highest || score > toNum(highest.Overall)) highest = row;
        if (!lowest || score < toNum(lowest.Overall)) lowest = row;
    });
    return { highest, lowest };
}

function generateInsights(rows, weaknesses) {
    const insights = [];
    if (rows.length < 2) return ['Not enough data for trend analysis.'];
    const scores = rows.map(r => toNum(r.Overall)).filter(s => !Number.isNaN(s));
    if (scores.length > 1) {
        const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
        const secondHalf = scores.slice(Math.ceil(scores.length / 2));
        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        if (secondAvg > firstAvg) insights.push('Overall scores show a positive trend.');
        else if (secondAvg < firstAvg) insights.push('Overall scores show a slight downward trend.');
        else insights.push('Overall scores have remained relatively stable.');
    }
    if (weaknesses.length > 0) {
        const reversedWeak = [...weaknesses].reverse();
        insights.push(`Strongest caption appears to be ${reversedWeak[0][0]}.`);
    }
    if (scores.length > 1) {
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const stdDev = Math.sqrt(scores.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / scores.length);
        insights.push(`Score standard deviation is ${stdDev.toFixed(2)}.`);
    }
    return insights;
}

function generateTargetedRecommendations(weaknesses, adjudicationData) {
    if (!adjudicationData) return ['Adjudication criteria not loaded.'];
    const recommendations = [];
    const captionMap = { Music: 'Music Ensemble', Visual: 'Visual Ensemble', Guard: 'Color Guard', Percussion: 'Percussion' };
    weaknesses.forEach(([caption]) => {
        const key = captionMap[caption];
        const criteria = adjudicationData[key];
        if (criteria) {
            const subCriteria = Object.keys(criteria).filter(k => Array.isArray(criteria[k]));
            if (subCriteria.length > 0) {
                let recHtml = `For <strong>${caption}</strong>, focus on:<ul>${subCriteria.map(sc => `<li>${criteria[sc][0]}</li>`).join('')}</ul>`;
                recommendations.push(recHtml);
            }
        }
    });
    return recommendations;
}

function generateDetailedSummary(rows, weaknesses, highest, lowest) {
    if (rows.length === 0) return 'Not enough data for a detailed summary.';

    const insights = generateInsights(rows, weaknesses);
    const years = [...new Set(rows.map(r => r.CompetitionDate.slice(0, 4)))].sort();
    const yearRange = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0] || 'the current season';

    let summary = `This analysis covers the period from ${yearRange}. `;
    
    const overallTrend = insights.find(i => i.includes('Overall scores'));
    if (overallTrend) {
        summary += `${overallTrend} `;
    }

    if (highest) {
        summary += `The highest score achieved was ${toNum(highest.Overall).toFixed(3)} at the ${highest.CompetitionName} competition on ${highest.CompetitionDate}. `;
    }
    if (lowest) {
        summary += `The lowest score was ${toNum(lowest.Overall).toFixed(3)} at the ${lowest.CompetitionName} competition on ${lowest.CompetitionDate}. `;
    }

    const stdDevInsight = insights.find(i => i.includes('standard deviation'));
    if (stdDevInsight) {
        summary += `The scores show a ${stdDevInsight.split('is ')[1].replace('.', '')} standard deviation, indicating the degree of score consistency. `;
    }

    if (weaknesses.length > 0) {
        const reversedWeak = [...weaknesses].reverse();
        summary += `Based on average caption scores, the band's strongest area appears to be ${reversedWeak[0][0]}. `;
    }
    
    const recommendations = generateTargetedRecommendations(weaknesses, state.adjudicationData);
    if (recommendations.length > 0 && !recommendations[0].includes('not loaded')) {
        summary += `To improve, the band can focus on the specific aspects mentioned in the targeted recommendations.`;
    }

    return summary;
}

function analyzeComments(comments) {
    const strengths = [], weaknesses = [], wordCounts = {};
    const strengthKeywords = ['great', 'excellent', 'clean', 'strong', 'effective', 'good', 'solid', 'well'];
    const weaknessKeywords = ['work on', 'needs', 'issues', 'intonation', 'phasing', 'spacing', 'dirty', 'late', 'behind', 'out of tune'];
    const stopWords = new Set(['a', 'an', 'and', 'the', 'is', 'it', 'to', 'in', 'of', 'for', 'on', 'with', 'was', 'are']);
    comments.forEach(c => {
        const comment = (c.comment || '').toLowerCase();
        strengthKeywords.forEach(k => { if (comment.includes(k)) strengths.push(`"${c.comment}" (Judge: ${c.judge}, Caption: ${c.caption})`); });
        weaknessKeywords.forEach(k => { if (comment.includes(k)) weaknesses.push(`"${c.comment}" (Judge: ${c.judge}, Caption: ${c.caption})`); });
        comment.split(/\s+/).forEach(w => {
            const cleanWord = w.replace(/[.,!?:"]/g, '');
            if (cleanWord && !stopWords.has(cleanWord) && !isNaN(cleanWord)) wordCounts[cleanWord] = (wordCounts[cleanWord] || 0) + 1;
        });
    });
    const sortedKeywords = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
    return { strengths: [...new Set(strengths)], weaknesses: [...new Set(weaknesses)], keywords: sortedKeywords };
}


// --- RENDERING FUNCTIONS ---
function renderOverallAnalysis(rows) {
    const { labels, data } = computeTrend(rows);
    createLineChart(document.getElementById('overallChart').getContext('2d'), labels, [{ label: 'Overall Score', data, borderColor: '#00bcd4', tension: 0.1 }]);
    
    const years = [...new Set(rows.map(r => r.CompetitionDate.slice(0, 4)))].sort();
    document.getElementById('trendsYears').textContent = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0] || '';

    const captionContainer = document.getElementById('captionCharts');
    captionContainer.innerHTML = '';
    ['Music', 'Visual', 'Percussion', {key: 'Guard', label: 'Color Guard'}].forEach(cap => {
        const key = typeof cap === 'string' ? cap : cap.key;
        const label = typeof cap === 'string' ? cap : cap.label;
        const trend = computeTrend(rows, key);
        const wrapper = document.createElement('div');
        wrapper.className = 'caption-chart';
        wrapper.innerHTML = `<h3>${label}</h3>`;
        if (trend.data.length === 0) {
            wrapper.innerHTML += '<p>No data available</p>';
        } else {
            const canvas = document.createElement('canvas');
            wrapper.appendChild(canvas);
            createLineChart(canvas.getContext('2d'), trend.labels, [{ label: `${label} Score`, data: trend.data, borderColor: '#4CAF50', tension: 0.1 }]);
        }
        captionContainer.appendChild(wrapper);
    });

    const { highest, lowest } = computeExtremes(rows);
    document.getElementById('highScore').textContent = highest ? `${toNum(highest.Overall).toFixed(3)} on ${highest.CompetitionDate} (${highest.CompetitionName})` : 'N/A';
    document.getElementById('lowScore').textContent = lowest ? `${toNum(lowest.Overall).toFixed(3)} on ${lowest.CompetitionDate} (${lowest.CompetitionName})` : 'N/A';
    
    const weaknesses = computeWeaknesses(rows);
    document.getElementById('insightsList').innerHTML = generateInsights(rows, weaknesses).map(i => `<p>${i}</p>`).join('');
    document.getElementById('recList').innerHTML = generateTargetedRecommendations(weaknesses, state.adjudicationData).map(r => `<div>${r}</div>`).join('');
    document.getElementById('summaryText').textContent = generateDetailedSummary(rows, weaknesses, highest, lowest);
}

function renderSeasonalAnalysis(rows) {
    const container = document.getElementById('seasonalCharts');
    container.innerHTML = '';
    const byYear = rows.reduce((acc, row) => {
        const year = row.CompetitionDate.slice(0, 4);
        if (!acc[year]) acc[year] = [];
        acc[year].push(row);
        return acc;
    }, {});

    Object.keys(byYear).sort().forEach(year => {
        const yearRows = byYear[year];
        const scores = yearRows.map(r => toNum(r.Overall)).filter(s => !Number.isNaN(s));
        if (scores.length === 0) return;
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const max = Math.max(...scores), min = Math.min(...scores);
        const growth = scores.length > 1 ? scores[scores.length - 1] - scores[0] : 0;
        const trend = computeTrend(yearRows);
        const section = document.createElement('div');
        section.className = 'season-card';
        section.innerHTML = `<h3>Season ${year}</h3>
            <div class="season-stats">
                <p>Avg: ${avg.toFixed(2)}</p><p>High: ${max.toFixed(2)}</p>
                <p>Low: ${min.toFixed(2)}</p><p>Growth: <span class="${growth >= 0 ? 'positive' : 'negative'}">${growth.toFixed(2)}</span></p>
            </div>`;
        const canvas = document.createElement('canvas');
        section.appendChild(canvas);
        container.appendChild(section);
        createLineChart(canvas.getContext('2d'), trend.labels, [{ label: `Overall Score ${year}`, data: trend.data, borderColor: '#FFC107', tension: 0.1 }]);
    });
    renderSeasonComparison(rows);
}

function render2025Prep(rows) {
    render2025ScoreTrend(rows);
}

function render2025ScoreTrend(rows) {
    const container = document.getElementById('container-2025-chart');
    const yearRows = rows.filter(r => r.CompetitionDate.slice(0, 4) === '2025');

    if (yearRows.length === 0) {
        container.innerHTML = '<p>No data for the 2025 season has been entered yet. The chart will appear here once scores are available.</p>';
        return;
    }
    
    if (!document.getElementById('chart-2025')) {
        container.innerHTML = '<canvas id="chart-2025"></canvas>';
    }

    const trend = computeTrend(yearRows, 'Overall');
    const ctx = document.getElementById('chart-2025').getContext('2d');
    
    const datasets = [{
        label: '2025 Overall Score',
        data: trend.data,
        borderColor: '#00bcd4',
        tension: 0.1
    }];

    ['Music', 'Visual', 'Percussion', 'Guard'].forEach((cap, i) => {
        const capTrend = computeTrend(yearRows, cap);
        const colors = ['#4CAF50', '#FFC107', '#FF5722', '#8bc34a'];
        if (capTrend.data.length > 0) {
            datasets.push({
                label: `${cap} Score`,
                data: capTrend.data,
                borderColor: colors[i],
                tension: 0.1,
                hidden: true
            });
        }
    });

    createLineChart(ctx, trend.labels, datasets, {
        plugins: {
            title: {
                display: true,
                text: '2025 Score Progression',
                color: '#E0E0E0'
            },
            legend: {
                position: 'top',
                labels: {
                    color: '#E0E0E0'
                }
            }
        }
    });
}

function renderSeasonComparison(rows) {
    const ctx = document.getElementById('comparisonChart').getContext('2d');
    const byYear = rows.reduce((acc, row) => {
        const year = row.CompetitionDate.slice(0, 4);
        if (!acc[year]) acc[year] = [];
        acc[year].push(row);
        return acc;
    }, {});
    let maxCompetitions = 0;
    const datasets = Object.keys(byYear).sort().map((year, i) => {
        const yearRows = byYear[year].sort((a,b) => new Date(a.CompetitionDate) - new Date(b.CompetitionDate));
        const trend = computeTrend(yearRows, 'Overall');
        maxCompetitions = Math.max(maxCompetitions, trend.data.length);
        const colors = ['#00bcd4', '#ffc107', '#8bc34a', '#ff5722', '#673ab7'];
        return { label: year, data: trend.data, borderColor: colors[i % colors.length], tension: 0.1 };
    });
    const labels = Array.from({ length: maxCompetitions }, (_, i) => `Comp ${i + 1}`);
    createLineChart(ctx, labels, datasets, { plugins: { title: { display: true, text: 'Overall Score Progression', color: '#E0E0E0' } } });
}

function renderCommentAnalysisUI(show) {
    document.getElementById('prep-comments').style.display = show ? '' : 'none';
    if (!show) return;
    
    const analysis = analyzeComments(state.judgeComments);
    document.getElementById('strengthsList').innerHTML = analysis.strengths.map(s => `<li>${s}</li>`).join('');
    document.getElementById('weaknessesList').innerHTML = analysis.weaknesses.map(w => `<li>${w}</li>`).join('');
    document.getElementById('keywordFrequency').innerHTML = analysis.keywords.map(([word, count]) => `<p>${word}: ${count}</p>`).join('');
    document.getElementById('commentAnalysisResults').style.display = 'block';
}

function renderHistoricalCommentAnalysis() {
    if (!state.historicalJudgeComments || state.historicalJudgeComments.length === 0) {
        document.getElementById('historical-strengths-list').innerHTML = `<li>This section will list recurring positive feedback from judges across different seasons.</li>`;
        document.getElementById('historical-weaknesses-list').innerHTML = `<li>This section will highlight common areas for improvement pointed out by judges over the years.</li>`;
        document.getElementById('historical-keyword-frequency').innerHTML = `<p>A cloud of frequently used words from all judge comments will be displayed here, showing what terms judges use most often.</p>`;
        document.getElementById('historical-summary-text').textContent = "A summary of long-term trends in judge feedback will be generated here. It will analyze how feedback has evolved over time and identify persistent themes.";
        return;
    }

    const allComments = state.historicalJudgeComments;

    // For simplicity, we'll reuse the existing analyzeComments function.
    // A more advanced version could analyze trends over years.
    const analysis = analyzeComments(allComments);

    document.getElementById('historical-strengths-list').innerHTML = analysis.strengths.map(s => `<li>${s}</li>`).join('') || '<li>None identified</li>';
    document.getElementById('historical-weaknesses-list').innerHTML = analysis.weaknesses.map(w => `<li>${w}</li>`).join('') || '<li>None identified</li>';
    document.getElementById('historical-keyword-frequency').innerHTML = analysis.keywords.map(([word, count]) => `<span>${word} (${count})</span>`).join(', ');

    // Generate a detailed summary
    let summary = `Analysis of ${allComments.length} historical comments reveals several key themes. `;
    if (analysis.strengths.length > analysis.weaknesses.length) {
        summary += 'Overall, judges have focused more on strengths, suggesting a solid foundation. ';
    } else {
        summary += 'The commentary tends to highlight areas for improvement, indicating a focus on growth and refinement. ';
    }
    
    if (analysis.keywords.length > 0) {
        summary += `The most frequently mentioned terms are "${analysis.keywords[0][0]}" and "${analysis.keywords[1][0]}", indicating their importance in judge feedback. `;
    }

    const captions = [...new Set(allComments.map(c => c.caption))];
    summary += `Comments cover captions such as ${captions.join(', ')}. `;
    
    // Trend analysis placeholder
    summary += "Future work could analyze trends year-over-year to see how feedback has evolved.";

    document.getElementById('historical-summary-text').textContent = summary;
}


// --- MAIN PROCESSING & INITIALIZATION ---
function processAllData() {
    console.log('Processing all data with current state:', state);
    if (!state.isDataInitialized.scores || !state.isDataInitialized.adjudication) {
        console.log('Waiting for required data files...');
        return;
    }
    renderOverallAnalysis(state.scoreRows);
    renderSeasonalAnalysis(state.scoreRows);
    render2025Prep(state.scoreRows);
    renderCommentAnalysisUI(state.judgeComments && state.judgeComments.length > 0);
    renderHistoricalCommentAnalysis();
}

function initWebSocket() {
    const ws = new WebSocket(`ws://${window.location.host}`);
    
    ws.onopen = () => console.log('WebSocket connection established.');
    ws.onerror = (err) => console.error('WebSocket error:', err);
    ws.onclose = () => {
        console.log('WebSocket connection closed. Attempting to reconnect in 3 seconds...');
        setTimeout(initWebSocket, 3000);
    };

    ws.onmessage = (event) => {
        try {
            const { type, data } = JSON.parse(event.data);
            console.log(`Received data for: ${type}`);
            
            if (type === 'scores') {
                const oremNames = ['Orem City', 'Orem High', 'Orem High School', 'Orem'];
                const allRows = [];
                data.forEach(comp => {
                    comp.rows.forEach(schoolRow => {
                        const schoolName = schoolRow.school.split('   ')[0].trim();
                        if (oremNames.some(name => schoolName.toLowerCase() === name.toLowerCase())) {
                            const cells = schoolRow.cells;
                            if (cells && cells.length === 24) {
                                allRows.push({
                                    CompetitionDate: comp.dateStr, CompetitionName: comp.compName, BandName: 'Orem',
                                    Overall: cells[22], Music: cells[6], Visual: cells[13],
                                    Percussion: cells[16], Guard: cells[20],
                                });
                            } else {
                                console.warn(`Skipping row for ${schoolName} on ${comp.dateStr}. Reason: Invalid cell count. Expected 24, got ${cells ? cells.length : 'undefined'}.`);
                            }
                        }
                    });
                });
                state.scoreRows = allRows;
                state.isDataInitialized.scores = true;
            } else if (type === 'adjudication') {
                state.adjudicationData = data;
                state.isDataInitialized.adjudication = true;
            } else if (type === 'comments') {
                state.judgeComments = data;
                state.isDataInitialized.comments = true;
            } else if (type === 'historical_comments') {
                state.historicalJudgeComments = data;
                state.isDataInitialized.historical_comments = true;
            }
            
            processAllData();
        } catch (err) {
            console.error('Failed to process message from server:', err);
        }
    };
}

function init() {
    initTabNavigation();
    initWebSocket();
    
    renderCommentAnalysisUI(false);
}

window.addEventListener('DOMContentLoaded', init);