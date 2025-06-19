# Marching Band Score Dashboard (Pure Web Version)

This branch has been simplified into a **100 % client-side Web App** – no Python, servers, or build tools required. Just open `webapp/index.html` in any modern browser.

Upload a CSV of your competition scores and the dashboard will, entirely inside your browser:

* Plot trend lines of your *Overall* score across competitions.
* Highlight the three weakest sub-captions (lowest average scores).
* Suggest focus areas based on those weaknesses.

All analysis happens with JavaScript (+[PapaParse](https://github.com/mholt/PapaParse) & [Chart.js](https://www.chartjs.org/)); your data never leaves your machine.

## 1. Usage

1. Export your spreadsheet as **CSV**. Include, at minimum, these columns (exact names matter):

```
CompetitionDate, CompetitionName, BandName, Overall, <any caption columns>
```

2. Open `webapp/index.html` (double-clicking is fine).
3. Click **"Upload Scores CSV"** and select your file.

• OR drag-&-drop your adjudication PDF score sheets via **"Or upload UMEA PDF score sheets"**. Name each file `YYYY-MM-DD CompetitionName.pdf` so the date and competition can be picked up automatically. The dashboard scans every page, finds the row that contains "Orem High" / "Orem City", and extracts the first four numeric values (Overall, Music, Visual, Percussion).

### What about Excel / PDF?

The current version only supports CSV. You can convert Excel sheets to CSV from Excel, Google Sheets, or LibreOffice in seconds. PDF parsing is outside the scope of this web-only edition.

## 2. Development Notes

* Zero build step – plain HTML/CSS/JS.
* External libraries loaded via CDN:
  * Chart.js 4
  * PapaParse 5
* Tested in the latest versions of Chrome, Firefox, and Edge.

Pull requests welcome for feature improvements (e.g. caption-specific charts, XLSX support). 