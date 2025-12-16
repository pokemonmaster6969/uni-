
import * as XLSX from 'xlsx';
import { ComparisonData, EnrichmentTerm, ComparisonStats, TranscriptStat } from '../types';

// Helper to read file as ArrayBuffer
export const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) resolve(e.target.result as ArrayBuffer);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};

// Helper: Smartly convert sheet to JSON by finding the header row
const smartSheetToJson = (sheet: XLSX.WorkSheet, keywords: string[]): any[] => {
    // Get all data as array of arrays
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    if (rawData.length === 0) return [];

    // Find header row index
    let headerRowIndex = 0;
    // Scan first 20 rows
    for (let i = 0; i < Math.min(rawData.length, 20); i++) {
        const rowStr = rawData[i].join(' ').toLowerCase();
        // Check if row contains enough target keywords to be the header
        const matchCount = keywords.filter(k => rowStr.includes(k.toLowerCase())).length;
        if (matchCount >= 1) { // Threshold: at least 1 keyword found
            headerRowIndex = i;
            break;
        }
    }

    // Convert to objects using the found header row
    const headers = rawData[headerRowIndex].map(h => String(h).trim());
    const result: any[] = [];
    
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length === 0) continue;
        
        const obj: any = {};
        headers.forEach((h, idx) => {
            obj[h] = row[idx];
        });
        result.push(obj);
    }
    
    return result;
};

// Parse standard tabular data (Data Stats, Mapping Stats)
export const parseTableData = async (file: File): Promise<string[][]> => {
  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const firstSheet = workbook.Sheets[firstSheetName];
  // For simple stats tables, we assume standard layout (header row 0) or just data
  const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as string[][];
  return jsonData.filter(row => row.length > 0 && row.some(cell => !!cell)); // Remove empty rows
};

// Parse DGE Summary Table
export const parseDGESummary = async (file: File): Promise<any[]> => {
  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  
  const firstSheet = workbook.Sheets[firstSheetName];
  // Expanded keywords to catch various formats including "Significant Upregulated" etc.
  return smartSheetToJson(firstSheet, ['comparison', 'total', 'up', 'down', 'sig', 'regulated']);
};

// Parse GTF File to count unique transcripts and calculate length stats
export const parseGTF = async (file: File): Promise<TranscriptStat> => {
    const text = await file.text();
    const lines = text.split('\n');
    
    const transcriptLengths: Record<string, number> = {};
    
    // Naive GTF parsing: Look for 'exon' lines and 'transcript_id'
    // Sum lengths of exons for each transcript
    
    for (const line of lines) {
        if (!line || line.startsWith('#')) continue;
        
        const parts = line.split('\t');
        if (parts.length < 9) continue;
        
        const featureType = parts[2];
        if (featureType !== 'exon') continue;
        
        const start = parseInt(parts[3]);
        const end = parseInt(parts[4]);
        const attributes = parts[8];
        
        const match = attributes.match(/transcript_id\s+"([^"]+)";/);
        if (match) {
            const transcriptId = match[1];
            const length = end - start + 1;
            
            if (!transcriptLengths[transcriptId]) {
                transcriptLengths[transcriptId] = 0;
            }
            transcriptLengths[transcriptId] += length;
        }
    }

    const lengths = Object.values(transcriptLengths);
    const count = lengths.length;
    
    if (count === 0) {
        // Fallback if parsing failed (e.g. not GTF format or regex mismatch)
        return {
            name: file.name,
            count: 0,
            totalLen: 0,
            meanLen: 0,
            maxLen: 0
        };
    }

    const totalLen = lengths.reduce((a, b) => a + b, 0);
    const maxLen = Math.max(...lengths);
    const meanLen = Math.round(totalLen / count);

    return {
        name: file.name,
        count,
        totalLen,
        meanLen,
        maxLen
    };
};

// Parse Detailed Comparison File (Volcano/MA Data)
export const parseComparisonDGE = async (file: File): Promise<{ sigCount: number, stats: ComparisonStats, maPoints: any[], volcanoPoints: any[] }> => {
  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { sigCount: 0, stats: { total:0, up:0, down:0, sigUp:0, sigDown:0, sigTotal:0 }, maPoints: [], volcanoPoints: [] };
  
  const firstSheet = workbook.Sheets[firstSheetName];
  
  // Use smart parser to find headers like logFC, FDR, PValue
  const jsonData = smartSheetToJson(firstSheet, ['logfc', 'fdr', 'pvalue', 'padj', 'foldchange']);

  if (jsonData.length === 0) return { sigCount: 0, stats: { total:0, up:0, down:0, sigUp:0, sigDown:0, sigTotal:0 }, maPoints: [], volcanoPoints: [] };

  // Smart Column Detection
  const row0 = jsonData[0];
  const keys = Object.keys(row0);
  
  const logFCKey = keys.find(k => /log2?fc|foldchange|log2_fold_change/i.test(k)) || keys[1];
  const fdrKey = keys.find(k => /fdr|padj|adj\.?p|q_?value/i.test(k)) || keys[keys.length - 1];
  const cpmKey = keys.find(k => /logcpm|log2?cpm|cpm/i.test(k)); 
  // Detect ID/Name column
  const idKey = keys.find(k => /gene|transcript|id|symbol|name|target_id/i.test(k)) || keys[0];

  const stats = { total: 0, up: 0, down: 0, sigUp: 0, sigDown: 0, sigTotal: 0 };
  const sigPoints: any[] = [];
  const nonSigPoints: any[] = [];
  const MAX_POINTS = 5000; // Increased limit

  jsonData.forEach((row) => {
    const fc = parseFloat(row[logFCKey]);
    const fdr = parseFloat(row[fdrKey]);
    const cpm = cpmKey ? parseFloat(row[cpmKey]) : 0;
    const label = String(row[idKey] || 'Unknown');
    
    if (isNaN(fc) || isNaN(fdr)) return;

    stats.total++;
    if (fc > 0) stats.up++;
    else if (fc < 0) stats.down++;

    // Significance Threshold: FDR < 0.05 & |logFC| > 1
    const isSig = fdr < 0.05 && Math.abs(fc) > 1; 
    
    if (isSig) {
        stats.sigTotal++;
        if (fc > 0) stats.sigUp++;
        else stats.sigDown++;
    }

    // Cap -log10(FDR) at 50 to prevent infinite/squashed charts
    const negLogFdr = fdr === 0 ? 50 : Math.min(-Math.log10(fdr), 50);

    const point = {
      x: parseFloat(fc.toFixed(3)), // Volcano X (logFC)
      y: parseFloat(negLogFdr.toFixed(3)), // Volcano Y (-log10 FDR)
      maX: cpmKey ? parseFloat(cpm.toFixed(3)) : parseFloat(fc.toFixed(3)), 
      sig: isSig,
      label: label
    };

    if (isSig) {
      sigPoints.push(point);
    } else {
      nonSigPoints.push(point);
    }
  });

  // --- Smart Downsampling Logic ---
  const SIG_LIMIT = 3000;
  let finalPoints: any[] = [];
  
  if (sigPoints.length <= SIG_LIMIT) {
      finalPoints = [...sigPoints];
  } else {
      // Too many sig points? Take the top most significant ones (highest -logFDR)
      sigPoints.sort((a,b) => b.y - a.y);
      finalPoints = sigPoints.slice(0, SIG_LIMIT);
  }

  const slotsLeft = MAX_POINTS - finalPoints.length;
  
  if (slotsLeft > 0 && nonSigPoints.length > 0) {
      // Uniformly sample non-significant points
      const step = Math.max(1, Math.floor(nonSigPoints.length / slotsLeft));
      for (let i = 0; i < nonSigPoints.length; i += step) {
          if (finalPoints.length >= MAX_POINTS) break;
          finalPoints.push(nonSigPoints[i]);
      }
  }

  // Format for Chart.js
  const volcanoData = finalPoints.map(p => ({ x: p.x, y: p.y, sig: p.sig, label: p.label }));
  const maData = finalPoints.map(p => ({ x: p.maX, y: p.x, sig: p.sig, label: p.label })); 

  return {
    sigCount: stats.sigTotal,
    stats,
    volcanoPoints: volcanoData,
    maPoints: maData
  };
};

// Parse Enrichment Files (GO/KEGG)
export const parseEnrichment = async (file: File): Promise<EnrichmentTerm[]> => {
    const buffer = await readFileAsArrayBuffer(file);
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    
    const firstSheet = workbook.Sheets[firstSheetName];
    // Use smart parser looking for keywords. Include 'significant' for TopGO and 'p-value' variants.
    const jsonData = smartSheetToJson(firstSheet, [
        'term', 'description', 'pathway', 'id', 
        'count', 'significant', 'n', 
        'pvalue', 'p-value', 'p.adjust', 'fdr', 'qvalue', 'q-value'
    ]);

    if (jsonData.length === 0) return [];

    const keys = Object.keys(jsonData[0]);
    
    // 1. Detect Term Column (Description preferred over ID)
    let termKey = keys.find(k => /description/i.test(k));
    if (!termKey) termKey = keys.find(k => /term/i.test(k));
    if (!termKey) termKey = keys.find(k => /pathway/i.test(k));
    if (!termKey) termKey = keys.find(k => /id/i.test(k)); // Fallback to ID
    if (!termKey) termKey = keys[0];

    // 2. Detect Count Column
    let countKey = keys.find(k => /^count/i.test(k)); 
    if (!countKey) countKey = keys.find(k => /significant/i.test(k));
    if (!countKey) countKey = keys.find(k => /^n$/i.test(k));
    if (!countKey) countKey = keys.find(k => /gene_?count/i.test(k));
    
    // 3. Detect Category Column (for GO)
    // Looking for "ontology", "category", "namespace"
    const catKey = keys.find(k => /ontology|category|namespace|type/i.test(k));

    // 4. Detect P-Value / FDR
    const pKey = keys.find(k => /p[-_.]?val|p[-_.]?adj|fdr|q[-_.]?val/i.test(k));

    return jsonData.slice(0, 50).map(row => {
        const term = row[termKey] || 'Unknown';
        
        // Clean Count
        let count = 0;
        if (countKey && row[countKey] !== undefined) {
             const parsed = parseInt(String(row[countKey]));
             if(!isNaN(parsed)) count = parsed;
        }

        // Clean P-Value
        let pVal = 0;
        if (pKey && row[pKey] !== undefined) {
            const parsed = parseFloat(String(row[pKey]));
            if(!isNaN(parsed)) pVal = parsed;
        }
        
        const category = catKey ? String(row[catKey]) : undefined;

        return {
            term: String(term),
            count: count,
            pAdjust: pVal,
            category
        };
    });
};
