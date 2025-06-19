/* eslint-disable no-undef */
/*
 * consolidate.js – Builds competition tables for every PDF in ../ScoreSheets/
 * -------------------------------------------------------------------------
 * This script is loaded by DataConsolidate.html. When the user clicks the
 * "Consolidate Score Sheets" button, it will:
 *   1. Iterate over a hard-coded list of PDF score sheets located in
 *      the repository's ScoreSheets folder (relative path from webapp).
 *   2. Parse each PDF using pdf.js to extract the full row for every band.
 *      The parser looks for lines that contain a band name followed by
 *      24 numeric cells (matching the template table structure).
 *   3. Group competitions by season (year) and render a copy of the
 *      template table for each competition – injecting rows dynamically.
 *
 * IMPORTANT:
 * ---------
 * Browsers do not allow directory enumeration for local files. Therefore we
 * rely on a static array of file names that exist in /ScoreSheets. When new
 * files are added, simply update the PDF_FILES list below.
 */

// ---------------------------------------------------------------------------
// 1. Helpers – PDF parsing utilities
// ---------------------------------------------------------------------------

/**
 * Extract all band rows from the concatenated text of a competition PDF.
 * Each row is expected to match:
 *   <Band Name> <24 numeric cells>
 * where numeric cells can be integers or decimals.
 *
 * Returns an array of objects:
 *   { school: string, cells: number[24] }
 */
function extractRowsFromText(text) {
  const rows = [];
  // Regex breakdown:
  //   1. ([^\d\n][^\n]*?) – capture school name (must not start with a digit, and stay on one line)
  //   2. ((?:\d+(?:\.\d{1,4})?\s+){23}\d+(?:\.\d{1,4})?) – capture exactly 24 numeric cells
  const rowRegex = /([^\d\n][^\n]*?)\s+((?:\d+(?:\.\d{1,4})?\s+){23}\d+(?:\.\d{1,4})?)/g;

  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = rowRegex.exec(text)) !== null) {
    const school = match[1].trim();
    const cells = match[2].trim().split(/\s+/).map(Number);

    if (cells.length === 24) {
      rows.push({ school, cells });
    }
  }

  // Fallback: if no rows captured, attempt direct Orem line parsing similar to app.js
  if (!rows.length) {
    const oremMatch = text.match(/Orem(?:\s+(?:High|City|High\s+School))?[\s\S]{0,400}/i);
    if (oremMatch) {
      const nums = (oremMatch[0].match(/\d+(?:\.\d{1,4})?/g) || []).map(Number);
      if (nums.length >= 24) {
        rows.push({ school: 'Orem', cells: nums.slice(0, 24) });
      }
    }
  }

  return rows;
}

/**
 * Parse a competition PDF and return an object describing the competition and
 * all extracted rows.
 */
async function parseCompetitionPdf(url) {
  try {
    // Parameter can be File or File-like object (with arrayBuffer)
    const arrayBuffer = await url.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Concatenate text of all pages, filtering out smaller-font "rank" numbers
    let fullText = '';
    // eslint-disable-next-line no-plusplus
    for (let p = 1; p <= pdf.numPages; p++) {
      // eslint-disable-next-line no-await-in-loop
      const page = await pdf.getPage(p);
      // eslint-disable-next-line no-await-in-loop
      const tc = await page.getTextContent();
      const { items } = tc;

      // Heuristic: identify score/rank font sizes.
      // Assumes scores are the most common, larger font and ranks are the second-most
      // common, smaller font.
      const numberItems = items.filter((it) => /^\d+(\.\d+)?$/.test(it.str));
      const heightCounts = {};
      for (const item of numberItems) {
        const h = item.height.toFixed(2);
        heightCounts[h] = (heightCounts[h] || 0) + 1;
      }
      const sortedHeights = Object.keys(heightCounts).sort((a, b) => heightCounts[b] - heightCounts[a]);

      let rankHeight = -1;
      if (sortedHeights.length >= 2) {
        const h1 = parseFloat(sortedHeights[0]);
        const h2 = parseFloat(sortedHeights[1]);
        // The smaller of the two most common font heights is assumed to be the rank font
        rankHeight = Math.min(h1, h2);
      }

      const rankItems = new Set();
      if (rankHeight > 0) {
        for (const item of numberItems) {
          if (Math.abs(item.height - rankHeight) < 0.01) {
            rankItems.add(item);
          }
        }
      }

      // Reconstruct page text line-by-line, excluding ranks.
      // This preserves layout better than a simple join().
      const lines = {};
      const Y_TOLERANCE = 2;

      for (const item of items) {
        if (rankItems.has(item)) continue;

        // Group items into lines based on Y-coordinate
        const y = Math.round(item.transform[5] / Y_TOLERANCE) * Y_TOLERANCE;
        if (!lines[y]) lines[y] = [];
        lines[y].push(item);
      }

      let pageText = '';
      const sortedLineKeys = Object.keys(lines).map(parseFloat).sort((a, b) => b - a);

      for (const y of sortedLineKeys) {
        const lineItems = lines[y].sort((a, b) => a.transform[4] - b.transform[4]);
        pageText += lineItems.map((item) => item.str).join(' ') + '\n';
      }
      fullText += pageText;
    }

    // Extract all band rows (no longer filtered to a single school)
    const rows = extractRowsFromText(fullText);

    // If we failed to capture any rows, skip this PDF
    if (!rows.length) {
      return null;
    }

    // Derive meta – date + competition name – from file name
    const name = url.name || 'Unknown.pdf';
    const nameMatch = name.match(/(\d{4}-\d{2}-\d{2})\s+(.+)\.pdf$/i);
    const dateStr = nameMatch ? nameMatch[1] : '';
    const compName = nameMatch ? nameMatch[2].replace(/_/g, ' ') : name.replace(/\.pdf$/i, '');

    return { dateStr, compName, rows };
  } catch (err) {
    console.error(err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. DOM utilities – build tables from data
// ---------------------------------------------------------------------------

function buildTable(templateTable, compData) {
  const { compName, dateStr, rows } = compData;

  // Clone the template (deep)
  const table = templateTable.cloneNode(true);
  table.classList.remove('template');

  // Adjust competition-specific heading cells if present
  // (We assume the caption/date lives outside the table; not modifying here)

  // Clear any existing <tbody> rows (except headers)
  const tbody = table.querySelector('tbody');
  if (tbody) tbody.innerHTML = '';

  rows.forEach(({ school, cells }) => {
    // Exclude rows where school name looks like a calculation/rank line
    // Test for names that contain numbers and are mostly non-alphabetic.
    if (/^[-.\d\s\wA-Z]+$/.test(school) && /\d/.test(school) && school.length > 3) {
      const alphaChars = school.replace(/[^a-zA-Z]/g, '');
      if (alphaChars.length / school.length <= 0.5) {
        return; // Skip this row
      }
    }

    const tr = document.createElement('tr');
    const tdSchool = document.createElement('td');
    tdSchool.className = 'school';
    tdSchool.textContent = school;
    tr.appendChild(tdSchool);

    cells.forEach((num) => {
      const td = document.createElement('td');
      td.textContent = Number.isInteger(num) ? num : num.toFixed(3);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  // Wrap table with a header showing competition title/date
  const wrapper = document.createElement('section');
  wrapper.className = 'competition-section';

  const h2 = document.createElement('h2');
  h2.textContent = `${compName} – ${dateStr}`;
  wrapper.appendChild(h2);
  wrapper.appendChild(table);

  return wrapper;
}

function ensureYearSection(year) {
  let sec = document.getElementById(`year-${year}`);
  if (!sec) {
    sec = document.createElement('div');
    sec.id = `year-${year}`;
    const title = document.createElement('h1');
    title.textContent = `Season ${year}`;
    sec.appendChild(title);
    document.body.appendChild(sec);
  }
  return sec;
}

// Global store for consolidated data
let allCompetitionsData = [];

// ---------------------------------------------------------------------------
// 4. Main – button handler to trigger consolidation
// ---------------------------------------------------------------------------

async function consolidateScoreSheets() {
  const btn = document.getElementById('consolidateBtn');
  if (btn) btn.disabled = true;

  // Trigger folder selection
  const folderInput = document.getElementById('pdfFolderInput');
  if (!folderInput) {
    alert('PDF folder input element missing.');
    if (btn) btn.disabled = false;
    return;
  }

  // We'll wrap the async processing inside a one-time change handler
  folderInput.onchange = async (e) => {
    const allFiles = Array.from(e.target.files || []);
    if (!allFiles.length) {
      if (btn) btn.disabled = false;
      return;
    }

    // Filter to pattern YYYY-MM-DD Competition.pdf
    const pdfFiles = allFiles.filter((f) => /^(\d{4}-\d{2}-\d{2})\s+.+\.pdf$/i.test(f.name));

    if (!pdfFiles.length) {
      alert('No PDF files matching the expected naming pattern were selected.');
      if (btn) btn.disabled = false;
      return;
    }

    const templateTable = document.getElementById('scoreTableTemplate');
    if (!templateTable) {
      alert('Template table missing from page.');
      if (btn) btn.disabled = false;
      return;
    }

    // Clear previous results and reset global data store
    document.querySelectorAll('.competition-section, div[id^="year-"]').forEach((el) => el.remove());
    allCompetitionsData = [];

    for (const file of pdfFiles) {
      // eslint-disable-next-line no-await-in-loop
      const compData = await parseCompetitionPdf(file);
      if (compData) {
        allCompetitionsData.push(compData); // Store data for JSON export

        const year = compData.dateStr.slice(0, 4);
        const yearSection = ensureYearSection(year);
        const tableWrapper = buildTable(templateTable, compData);
        yearSection.appendChild(tableWrapper);
      }
    }

    if (btn) btn.disabled = false;

    // Show the JSON button if we have data
    const jsonBtn = document.getElementById('createJsonBtn');
    if (jsonBtn && allCompetitionsData.length > 0) {
      jsonBtn.style.display = 'inline-block';
    }

    // Reset change handler so selecting the same folder again works later
    folderInput.value = '';
    folderInput.onchange = null;
  };

  folderInput.click();
}

/**
 * Creates and triggers a download for a JSON file containing all
 * consolidated competition data.
 */
async function createAndDownloadJson() {
  if (allCompetitionsData.length === 0) {
    alert('No data to export. Please consolidate score sheets first.');
    return;
  }

  const jsonString = JSON.stringify(allCompetitionsData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });

  // Use the File System Access API if available, for a better save experience
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'consolidated_scores.json',
        types: [{
          description: 'JSON Files',
          accept: { 'application/json': ['.json'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // Handle user cancellation or other errors
      if (err.name !== 'AbortError') {
        console.error(err);
      }
      return; // Don't fall back if the user cancels the picker
    }
  }

  // Fallback for older browsers
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'consolidated_scores.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function init() {
  const btn = document.getElementById('consolidateBtn');
  if (btn) {
    btn.addEventListener('click', consolidateScoreSheets);
  }

  const jsonBtn = document.getElementById('createJsonBtn');
  if (jsonBtn) {
    jsonBtn.addEventListener('click', createAndDownloadJson);
  }
}

// Kick off the app
init();

// ---------------------------------------------------------------------------
// 5. Bootstrapping
// ---------------------------------------------------------------------------

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('consolidateBtn');
  if (btn) {
    btn.addEventListener('click', consolidateScoreSheets);
  }
}); 