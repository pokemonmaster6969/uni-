
import React, { useState, useEffect, useRef } from 'react';
import { FileText, Upload, Database, Layout, Download, AlertCircle, CheckCircle2, ChevronRight, ChevronLeft, Trash2, FolderTree, RefreshCw, FileCode, Package, BarChart3, ListChecks } from 'lucide-react';
import { StepWizard } from './components/StepWizard';
import { ProjectMetadata, ProjectStats, ProcessedData, Step, FileUploadStatus, ComparisonData } from './types';
import { parseTableData, parseDGESummary, parseComparisonDGE, parseEnrichment, parseGTF } from './utils/excelParser';
import { DEFAULT_TEMPLATE } from './constants';
import * as XLSX from 'xlsx';

// Make XLSX available globally for console debugging
(window as any).XLSX = XLSX;

const INITIAL_METADATA: ProjectMetadata = {
  projectID: 'NGS-240592',
  clientName: 'Dr. Ankita Singh',
  institute: 'ICGA Foundation',
  organism: 'Homo sapiens',
  genomeBuild: 'GRCh38.p14',
  platform: 'Illumina Novaseq X Plus',
  date: new Date().toISOString().split('T')[0],
  serviceType: 'RNA Sequencing',
  sampleType: 'Frozen Tissue',
  shippingCondition: 'Dry Ice'
};

const INITIAL_STATS: ProjectStats = {
  totalSamples: 8,
  totalDataGB: 185.5,
  readLength: '2 X 150 PE',
  mappingRate: '92.5%',
  mergedTranscripts: 653846,
  novelIsoforms: 3096
};

const DEFAULT_TREE = `Deliverables
.
├── 01_Raw_Data
│   ├── Sample_R1.fastq.gz
│   └── Sample_R2.fastq.gz
├── 02_Reference_Genome
│   ├── genome.fa
│   └── genes.gtf
├── 03_Mapping_Assembly
│   ├── mappings.bam
│   └── transcripts.gtf
├── 04_Quantification
│   ├── gene_counts.csv
│   └── tpm_matrix.csv
├── 05_Differential_Expression
│   ├── Comparison1_DGE.xlsx
│   ├── Comparison1_Volcano.pdf
│   └── Comparison1_Heatmap.png
├── 06_Functional_Analysis
│   ├── GO_Enrichment.xlsx
│   └── KEGG_Pathways.xlsx
└── 07_Project_Reports
    └── multiqc_report.html`;

export default function App() {
  const [step, setStep] = useState<Step>(Step.METADATA);
  const [metadata, setMetadata] = useState<ProjectMetadata>(INITIAL_METADATA);
  const [stats, setStats] = useState<ProjectStats>(INITIAL_STATS);
  const [deliverablesTree, setDeliverablesTree] = useState(DEFAULT_TREE);
  
  // Data State
  const [processedData, setProcessedData] = useState<ProcessedData>({
    dataStatsTable: [],
    mappingStatsTable: [],
    transcriptStats: [],
    dgeSummaryTable: [],
    comparisons: {},
    deliverablesTree: DEFAULT_TREE
  });

  const [uploadStatus, setUploadStatus] = useState<FileUploadStatus[]>([]);
  const [customTemplate, setCustomTemplate] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Helper: Detect comparison ID from filename (e.g., "Comparison1" -> "C1", "C2_DGE" -> "C2")
  const detectComparisonId = (filename: string): string | null => {
    // Matches: "Comparison 1", "Comp-1", "C1", "C_1", "Contrast 1", "Group 1", "G1"
    const match = filename.match(/(?:Comparison|Comp|C|Contrast|Group|G)\s*[-_]?\s*(\d+)/i);
    return match ? `C${match[1]}` : null;
  };

  // Helper: Detect file type
  const detectFileType = (filename: string): FileUploadStatus['type'] | 'unknown' => {
    const lower = filename.toLowerCase();
    
    // 0. Non-Parseable / Deliverables Only (Binaries, Raw Data, Images, PDFs)
    if (
        lower.endsWith('.fastq') || lower.endsWith('.fq') || lower.endsWith('.fastq.gz') || lower.endsWith('.fq.gz') || // Raw Data
        lower.endsWith('.bam') || lower.endsWith('.sam') || lower.endsWith('.bai') || // Alignment
        lower.endsWith('.fa') || lower.endsWith('.fasta') || lower.endsWith('.fna') || // Reference
        lower.endsWith('.pdf') || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.svg') // Images/Docs
    ) {
        return 'deliverable_only';
    }

    // 1. Template
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'template';

    // 2. GTF Files
    if (lower.endsWith('.gtf')) {
        // Novel isoforms specific
        if (lower.includes('novel') || lower.includes('isoform')) return 'gtf_novel';
        // General merged transcripts or just default gtf
        return 'gtf_merged';
    }

    // 3. Mapping Stats (Text/Excel based)
    // Must contain stats/summary keywords AND mapping/align keywords
    // Exclude if it looks like a binary file (handled above, but just in case)
    if (
        (lower.includes('mapping') || lower.includes('align') || lower.includes('star') || lower.includes('bowtie') || lower.includes('hisat')) && 
        (lower.includes('stat') || lower.includes('summary') || lower.includes('report') || lower.includes('log') || lower.endsWith('.txt') || lower.endsWith('.csv') || lower.endsWith('.xlsx'))
    ) return 'mapping';

    // 4. Global Stats (Data/QC)
    if (
        lower.includes('multiqc') || 
        ((lower.includes('stat') || lower.includes('report') || lower.includes('summary')) && 
         (lower.includes('data') || lower.includes('raw') || lower.includes('seq') || lower.includes('trim') || lower.includes('qc') || lower.includes('qual')))
    ) return 'stats';

    // 5. DGE Summary (Overview table of all comparisons)
    if ((lower.includes('summary') || lower.includes('overview') || lower.includes('all')) && (lower.includes('dge') || lower.includes('diff') || lower.includes('deg'))) return 'dge_summary';
    
    // 6. Comparison Specific Files
    // GO / Enrichment
    if (
        (lower.includes('go') && (lower.includes('enrich') || lower.includes('term') || lower.includes('result') || lower.includes('_go') || lower.includes('go_'))) || 
        lower.includes('gene_ontology')
    ) return 'comparison_go';

    // Comparison: KEGG
    if (lower.includes('kegg') || lower.includes('pathway')) return 'comparison_kegg';

    // Comparison: DGE (Detailed results for one comparison)
    const dgeKeywords = ['dge', 'diff', 'deg', 'result', 'comp', 'contrast', 'vs', 'change', 'fc', 'volcano', 'ma_plot', 'table', 'output'];
    if (dgeKeywords.some(k => lower.includes(k)) && !lower.includes('summary') && !lower.includes('overview')) {
        return 'comparison_dge';
    }
    
    // Fallback: If it has a comparison ID (e.g. "C1.xlsx") and is an excel/csv/txt file, assume DGE
    if (detectComparisonId(filename) && (lower.endsWith('xlsx') || lower.endsWith('csv') || lower.endsWith('txt') || lower.endsWith('xls'))) {
        return 'comparison_dge';
    }
    
    // Fallback for generic text/excel files that might be stats or something else, default to deliverable only to avoid errors
    if (lower.endsWith('.txt') || lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.tsv')) {
        return 'deliverable_only';
    }

    return 'unknown';
  };

  const updateComparisonDetails = (id: string, field: 'name' | 'description', value: string) => {
    setProcessedData(prev => ({
      ...prev,
      comparisons: {
        ...prev.comparisons,
        [id]: { ...prev.comparisons[id], [field]: value }
      }
    }));
  };

  const handleSmartUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files) as File[];

    for (const file of files) {
        const type = detectFileType(file.name);
        const compId = detectComparisonId(file.name);
        
        const fileId = Math.random().toString(36).substr(2, 9);
        const newStatus: FileUploadStatus = { 
            id: fileId,
            name: file.name, 
            type: type as any, 
            assignedTo: compId || undefined,
            status: 'pending' 
        };

        setUploadStatus(prev => [...prev, newStatus]);

        try {
            if (type === 'unknown') {
                 console.warn(`File ${file.name} type unknown. Added to deliverables list only.`);
                 setUploadStatus(prev => prev.map(s => s.id === fileId ? { ...s, status: 'success', type: 'deliverable_only', message: 'Type unknown, added to tree only' } : s));
                 continue;
            }

            if (type === 'deliverable_only') {
                 setUploadStatus(prev => prev.map(s => s.id === fileId ? { ...s, status: 'success' } : s));
                 continue;
            }

            if (type.startsWith('comparison_') && !compId) {
                 throw new Error(`Detected ${type.replace('comparison_', '').toUpperCase()} file but missing Comparison ID (e.g. 'C1', 'Comp1') in filename.`);
            }

            if (type === 'stats') {
                const table = await parseTableData(file);
                setProcessedData(prev => ({ ...prev, dataStatsTable: table }));
            } 
            else if (type === 'mapping') {
                const table = await parseTableData(file);
                setProcessedData(prev => ({ ...prev, mappingStatsTable: table }));
            } 
            else if (type === 'gtf_novel' || type === 'gtf_merged') {
                const stats = await parseGTF(file);
                
                // If specific type, update global single stats
                if (type === 'gtf_novel') setStats(prev => ({ ...prev, novelIsoforms: stats.count }));
                if (type === 'gtf_merged') setStats(prev => ({ ...prev, mergedTranscripts: stats.count }));

                // Add to detailed transcript stats list
                setProcessedData(prev => ({
                    ...prev,
                    transcriptStats: [...prev.transcriptStats, stats]
                }));
            }
            else if (type === 'dge_summary') {
                const raw = await parseDGESummary(file);
                const summary = raw.map((r: any) => {
                    const keys = Object.keys(r);
                    const findKey = (pattern: RegExp) => keys.find(k => pattern.test(k));
                    
                    const compKey = findKey(/comp/i) || keys[0];
                    const descKey = findKey(/desc/i);
                    const totalKey = findKey(/total.*deg|total.*gene/i) || findKey(/^total$/i);
                    
                    const sigDownKey = findKey(/sig.*down/i) || findKey(/down.*sig/i);
                    const sigUpKey = findKey(/sig.*up/i) || findKey(/up.*sig/i);
                    const sigTotalKey = findKey(/total.*sig/i) || findKey(/^sig/i) || findKey(/#.*sig/i);

                    let downTotalKey = findKey(/^down/i);
                    if (downTotalKey === sigDownKey) downTotalKey = undefined; 
                    
                    let upTotalKey = findKey(/^up/i);
                    if (upTotalKey === sigUpKey) upTotalKey = undefined;

                    return {
                        comp: r[compKey] || 'Unknown',
                        desc: descKey ? r[descKey] : 'Test vs Control',
                        total: Number(r[totalKey] || 0),
                        downTotal: Number(r[downTotalKey] || 0),
                        upTotal: Number(r[upTotalKey] || 0),
                        sigDown: Number(r[sigDownKey] || 0),
                        sigUp: Number(r[sigUpKey] || 0),
                        sig: Number(r[sigTotalKey] || 0)
                    };
                });
                
                setProcessedData(prev => {
                    const nextComparisons = { ...prev.comparisons };
                    summary.forEach(row => {
                         const rowNum = String(row.comp).match(/\d+/)?.[0];
                         if (rowNum) {
                             const targetId = `C${rowNum}`; 
                             if (nextComparisons[targetId]) {
                                 nextComparisons[targetId] = {
                                     ...nextComparisons[targetId],
                                     name: nextComparisons[targetId].name,
                                     description: row.desc || nextComparisons[targetId].description
                                 };
                             } else {
                                 nextComparisons[targetId] = {
                                     id: targetId,
                                     name: `Comparison ${rowNum}`,
                                     description: row.desc || `Test vs Control`,
                                     sigCount: row.sig,
                                     maPoints: [],
                                     volcanoPoints: [],
                                     goTerms: [],
                                     keggPathways: []
                                 };
                             }
                         }
                    });
                    return { ...prev, dgeSummaryTable: summary, comparisons: nextComparisons };
                });
            }
            else if (type === 'template') {
                 const text = await file.text();
                 setCustomTemplate(text);
            }
            else if (compId && (type === 'comparison_dge' || type === 'comparison_go' || type === 'comparison_kegg')) {
                setProcessedData(prev => {
                    const compNum = compId.replace(/\D/g, '');
                    let defaultName = compNum ? `Comparison ${compNum}` : compId; 
                    let defaultDesc = `Test vs Control`;
                    
                    if (prev.dgeSummaryTable.length > 0) {
                        const match = prev.dgeSummaryTable.find(row => 
                            String(row.comp).includes(compNum) || 
                            String(row.comp).toLowerCase().includes(compId.toLowerCase())
                        );
                        if (match && match.desc) defaultDesc = match.desc;
                    }

                    const existing = prev.comparisons[compId] || { 
                        id: compId, 
                        name: defaultName, 
                        description: defaultDesc,
                        sigCount: 0, 
                        maPoints: [], 
                        volcanoPoints: [],
                        goTerms: [],
                        keggPathways: []
                    };
                    return { ...prev, comparisons: { ...prev.comparisons, [compId]: existing } };
                });

                if (type === 'comparison_dge') {
                    const dgeData = await parseComparisonDGE(file);
                    setProcessedData(prev => {
                        const updatedComp = {
                            ...prev.comparisons[compId],
                            sigCount: dgeData.sigCount,
                            stats: dgeData.stats,
                            maPoints: dgeData.maPoints,
                            volcanoPoints: dgeData.volcanoPoints
                        };
                        
                        const newSummaryEntry = {
                            comp: compId,
                            desc: updatedComp.description,
                            total: dgeData.stats.total,
                            downTotal: dgeData.stats.down,
                            upTotal: dgeData.stats.up,
                            sigDown: dgeData.stats.sigDown,
                            sigUp: dgeData.stats.sigUp,
                            sig: dgeData.stats.sigTotal
                        };

                        const existingSummaryIndex = prev.dgeSummaryTable.findIndex(row => row.comp === compId);
                        let newSummaryTable = [...prev.dgeSummaryTable];
                        if (existingSummaryIndex >= 0) {
                            newSummaryTable[existingSummaryIndex] = { ...newSummaryTable[existingSummaryIndex], ...newSummaryEntry };
                        } else {
                            newSummaryTable.push(newSummaryEntry);
                        }
                        
                        newSummaryTable.sort((a,b) => a.comp.localeCompare(b.comp, undefined, {numeric: true}));

                        return {
                            ...prev,
                            dgeSummaryTable: newSummaryTable,
                            comparisons: {
                                ...prev.comparisons,
                                [compId]: updatedComp
                            }
                        };
                    });
                } 
                else if (type === 'comparison_go') {
                    const goData = await parseEnrichment(file);
                    setProcessedData(prev => ({
                        ...prev,
                        comparisons: {
                            ...prev.comparisons,
                            [compId]: { ...prev.comparisons[compId], goTerms: goData }
                        }
                    }));
                }
                else if (type === 'comparison_kegg') {
                    const keggData = await parseEnrichment(file);
                    setProcessedData(prev => ({
                        ...prev,
                        comparisons: {
                            ...prev.comparisons,
                            [compId]: { ...prev.comparisons[compId], keggPathways: keggData }
                        }
                    }));
                }
            } else {
                throw new Error("File processing logic error.");
            }

            setUploadStatus(prev => prev.map(s => s.id === fileId ? { ...s, status: 'success' } : s));
        } catch (error: any) {
            console.error(error);
            setUploadStatus(prev => prev.map(s => s.id === fileId ? { ...s, status: 'error', message: error.message || 'Parsing failed' } : s));
        }
    }
  };

  const removeFile = (id: string) => {
    setUploadStatus(prev => prev.filter(s => s.id !== id));
  };

  const getDeliverablesStructure = () => {
    const categories: Record<string, string[]> = {
        "01_Raw_Data": [], "02_Reference_Genome": [], "03_Mapping_Assembly": [], "04_Quantification": [],
        "05_Differential_Expression": [], "06_Functional_Analysis": [], "07_Project_Reports": [], "08_Supplementary": []
    };
    
    const allFiles = uploadStatus.length > 0 ? uploadStatus : []; 
    
    allFiles.forEach(f => {
        const name = f.name;
        const low = name.toLowerCase();
        const type = f.type;
        if (low.includes('fastq') || low.includes('fq') || low.includes('md5')) categories["01_Raw_Data"].push(name);
        else if (low.includes('genome') || low.includes('gtf') || low.includes('gff') || low.includes('fasta') || low.endsWith('.fa')) categories["02_Reference_Genome"].push(name);
        else if (type === 'mapping' || low.includes('bam') || low.includes('sam') || low.includes('align') || low.includes('stringtie')) categories["03_Mapping_Assembly"].push(name);
        else if (low.includes('count') || low.includes('tpm') || low.includes('fpkm') || low.includes('matrix')) categories["04_Quantification"].push(name);
        else if (type === 'comparison_dge' || type === 'dge_summary' || low.includes('dge') || low.includes('volcano') || low.includes('heatmap')) categories["05_Differential_Expression"].push(name);
        else if (type === 'comparison_go' || type === 'comparison_kegg' || low.includes('go_') || low.includes('kegg')) categories["06_Functional_Analysis"].push(name);
        else if (type === 'stats' || low.includes('report') || low.includes('multiqc')) categories["07_Project_Reports"].push(name);
        else categories["08_Supplementary"].push(name);
    });
    
    return categories;
  };

  const generateTreeFromUploads = () => {
    if (uploadStatus.length === 0) {
      setDeliverablesTree(DEFAULT_TREE);
      return;
    }
    
    const categories = getDeliverablesStructure();
    
    let tree = "Deliverables\n.";
    const sortedKeys = Object.keys(categories).sort();
    const activeCategories = sortedKeys.filter(k => categories[k].length > 0);
    
    activeCategories.forEach((cat, idx) => {
        const isLastFolder = idx === activeCategories.length - 1;
        const prefix = isLastFolder ? "└──" : "├──";
        tree += `\n${prefix} ${cat}`;
        const files = categories[cat].sort();
        files.forEach((file, fIdx) => {
            const isLastFile = fIdx === files.length - 1;
            const filePrefix = isLastFolder ? "    " : "│   ";
            const branch = isLastFile ? "└──" : "├──";
            tree += `\n${filePrefix}${branch} ${file}`;
        });
    });
    setDeliverablesTree(tree);
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      try {
        let html = customTemplate || DEFAULT_TEMPLATE;
        
        // Metadata & Stats Replacement
        html = html.replace(/{{PROJECT_ID}}/g, metadata.projectID);
        html = html.replace(/{{CLIENT}}/g, metadata.clientName);
        html = html.replace(/{{INSTITUTE}}/g, metadata.institute);
        html = html.replace(/{{ORGANISM}}/g, metadata.organism);
        html = html.replace(/{{GENOME_BUILD}}/g, metadata.genomeBuild);
        html = html.replace(/{{PLATFORM}}/g, metadata.platform);
        html = html.replace(/{{DATE}}/g, metadata.date);
        
        html = html.replace(/{{TOTAL_SAMPLES}}/g, stats.totalSamples.toString());
        html = html.replace(/{{TOTAL_DATA_GB}}/g, stats.totalDataGB.toString());
        html = html.replace(/{{READ_LENGTH}}/g, stats.readLength || 'PE150');
        html = html.replace(/{{MAPPING_RATE}}/g, stats.mappingRate);
        html = html.replace(/{{MERGED_TRANSCRIPTS}}/g, stats.mergedTranscripts.toLocaleString());
        html = html.replace(/{{NOVEL_ISOFORMS}}/g, stats.novelIsoforms.toLocaleString());

        html = html.replace(/{{SERVICE_TYPE}}/g, metadata.serviceType);
        html = html.replace(/{{SAMPLE_TYPE}}/g, metadata.sampleType);
        html = html.replace(/{{SHIPPING_CONDITION}}/g, metadata.shippingCondition);

        // Extract Sample Names
        const sampleNames = processedData.dataStatsTable.length > 1 
            ? processedData.dataStatsTable.slice(1).map(row => row[0]).join(', ') 
            : 'Information not available';

        const deliverablesMap = getDeliverablesStructure();
        const deliverablesList = Object.entries(deliverablesMap)
            .filter(([_, files]) => files.length > 0)
            .map(([name, files]) => ({
                name,
                desc: `${files.length} files`,
                files: files 
            }));

        const injectionData = {
          metadata: { ...metadata, sampleNames }, 
          stats: stats,
          dataStats: processedData.dataStatsTable,
          mappingStats: processedData.mappingStatsTable,
          transcriptStats: processedData.transcriptStats,
          dgeSummary: processedData.dgeSummaryTable,
          comparisons: processedData.comparisons,
          deliverables: deliverablesList,
          tree: deliverablesTree
        };

        const scriptInjection = `
        <script>
          window.REPORT_DATA = ${JSON.stringify(injectionData)};
          
          document.addEventListener('DOMContentLoaded', () => {
            const data = window.REPORT_DATA;
            const meta = data.metadata;
            const stats = data.stats;

            // --- 1. Populate Dashboard Tables ---
            const safeText = (id, text) => {
                const el = document.getElementById(id);
                if(el) el.textContent = text;
            };

            safeText('header-project-id', meta.projectID);
            safeText('dashboard-subtitle', \`Project ID: \${meta.projectID} • \${meta.organism} • \${meta.date}\`);
            safeText('meta-sampleType', meta.sampleType);
            safeText('meta-shipping', meta.shippingCondition);
            safeText('meta-sampleNames', meta.sampleNames);
            safeText('stat-samples', stats.totalSamples);
            safeText('stat-data', stats.totalDataGB + ' GB');
            safeText('stat-mapping', stats.mappingRate);
            safeText('stat-transcripts', stats.mergedTranscripts.toLocaleString());
            safeText('novel-count', stats.novelIsoforms.toLocaleString());

            // --- 2. Data & QC Table (Robust Injection) ---
            const dataTable = document.getElementById('dataTable');
            if(dataTable && data.dataStats && data.dataStats.length > 0) {
                const headers = data.dataStats[0];
                const rows = data.dataStats.slice(1);
                dataTable.innerHTML = \`
                    <thead><tr>\${headers.map(h => \`<th>\${h}</th>\`).join('')}</tr></thead>
                    <tbody>\${rows.map(row => \`<tr>\${row.map(c => \`<td>\${c}</td>\`).join('')}</tr>\`).join('')}</tbody>
                \`;
            }

            // --- 3. Mapping Table (Robust Injection) ---
            const mappingTable = document.getElementById('mappingTable');
            if(mappingTable && data.mappingStats && data.mappingStats.length > 0) {
                const headers = data.mappingStats[0];
                const rows = data.mappingStats.slice(1);
                mappingTable.innerHTML = \`
                    <thead><tr>\${headers.map(h => \`<th>\${h}</th>\`).join('')}</tr></thead>
                    <tbody>\${rows.map(row => \`<tr>\${row.map(c => \`<td>\${c}</td>\`).join('')}</tr>\`).join('')}</tbody>
                \`;
            }

            // --- Mapping Chart ---
            const mappingChartCtx = document.getElementById('mappingChart');
            if(mappingChartCtx && data.mappingStats && data.mappingStats.length > 1) {
                // Try to find columns for Sample, Unique %, Total Mapped %
                // Heuristic: Look for "Unique" and "%" or "Total" and "%"
                const headers = data.mappingStats[0].map(h => h.toLowerCase());
                const sampleIdx = 0; // Assume first col is sample
                const uniqueIdx = headers.findIndex(h => h.includes('unique') && h.includes('%'));
                const mappedIdx = headers.findIndex(h => (h.includes('mapped') || h.includes('total')) && h.includes('%'));

                if(uniqueIdx !== -1 && mappedIdx !== -1) {
                    const samples = data.mappingStats.slice(1).map(r => r[sampleIdx]);
                    const uniqueVals = data.mappingStats.slice(1).map(r => parseFloat(r[uniqueIdx]));
                    const mappedVals = data.mappingStats.slice(1).map(r => parseFloat(r[mappedIdx]));

                    new Chart(mappingChartCtx, {
                        type: 'bar',
                        data: {
                            labels: samples,
                            datasets: [
                                {
                                    label: 'Unique Mapped %',
                                    data: uniqueVals,
                                    backgroundColor: '#1E3A8A',
                                },
                                {
                                    label: 'Total Mapped %',
                                    data: mappedVals,
                                    backgroundColor: '#3B82F6',
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { position: 'top' } },
                            scales: { y: { min: 80, max: 100 } } // Adjust scale for visibility
                        }
                    });
                }
            }

            // --- Transcript Stats Table ---
            const transcriptTable = document.getElementById('transcriptTable');
            if(transcriptTable && data.transcriptStats && data.transcriptStats.length > 0) {
                transcriptTable.innerHTML = data.transcriptStats.map(stat => \`
                    <tr>
                        <td>\${stat.name}</td>
                        <td class="cell-num">\${stat.count.toLocaleString()}</td>
                        <td class="cell-num">\${stat.totalLen.toLocaleString()}</td>
                        <td class="cell-num">\${stat.meanLen.toLocaleString()}</td>
                        <td class="cell-num">\${stat.maxLen.toLocaleString()}</td>
                    </tr>
                \`).join('');
            }

            // --- 4. DGE Table & Logic ---
            const dgeTable = document.querySelector('#dgeSummaryTable tbody');
            if(dgeTable && data.dgeSummary) {
                dgeTable.innerHTML = data.dgeSummary.map(r => 
                    \`<tr>
                        <td>\${r.comp}</td>
                        <td class="cell-num">\${r.total}</td>
                        <td class="cell-num">\${r.downTotal}</td>
                        <td class="cell-num">\${r.upTotal}</td>
                        <td><span class="badge badge-danger">\${r.sigDown}</span></td>
                        <td><span class="badge badge-success">\${r.sigUp}</span></td>
                        <td style="font-weight:bold" class="cell-num">\${r.sig}</td>
                    </tr>\`
                ).join('');
            }

            // Overview Chart
            const ctxOverview = document.getElementById('overviewChart');
            if(ctxOverview && window.Chart && data.dgeSummary && data.dgeSummary.length > 0) {
                 new Chart(ctxOverview, {
                    type: 'bar',
                    data: {
                        labels: data.dgeSummary.map(r => r.comp),
                        datasets: [{
                            label: 'Sig Up',
                            data: data.dgeSummary.map(r => r.sigUp),
                            backgroundColor: '#10B981',
                            borderRadius: 4
                        },
                        {
                            label: 'Sig Down',
                            data: data.dgeSummary.map(r => r.sigDown),
                            backgroundColor: '#EF4444',
                            borderRadius: 4
                        }]
                    },
                    options: { 
                        responsive: true, 
                        maintainAspectRatio: false,
                        plugins: { legend: { display: true } },
                        scales: { x: { stacked: true }, y: { beginAtZero: true, stacked: true } }
                    }
                });
            }

            // Comparison Toggles
            const compToggles = document.getElementById('compToggles');
            const compIds = Object.keys(data.comparisons).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
            
            if(compToggles && compIds.length > 0) {
                window.updateDGE = (compId, btn) => {
                     if(btn) {
                        document.querySelectorAll('.comp-btn').forEach(b => {
                            b.classList.remove('active');
                            b.setAttribute('aria-pressed', 'false');
                        });
                        btn.classList.add('active');
                        btn.setAttribute('aria-pressed', 'true');
                     }

                     const comp = data.comparisons[compId];
                     if(!comp) return;

                     const descEl = document.getElementById('comp-desc');
                     if(descEl) descEl.innerText = \`\${comp.name}: \${comp.description} (\${comp.sigCount} Significant)\`;

                     // Charts
                     const commonOptions = {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } }
                     };

                     // Volcano
                     const volChartInstance = Chart.getChart("volcanoPlot");
                     if (volChartInstance) volChartInstance.destroy();
                     if(comp.volcanoPoints && comp.volcanoPoints.length > 0) {
                        const sigPoints = comp.volcanoPoints.filter(p => p.sig);
                        const nsPoints = comp.volcanoPoints.filter(p => !p.sig);
                        new Chart(document.getElementById('volcanoPlot'), {
                            type: 'scatter',
                            data: {
                                datasets: [{
                                    label: 'Significant',
                                    data: sigPoints,
                                    backgroundColor: '#EF4444',
                                    pointRadius: 3
                                }, {
                                    label: 'Non-Significant',
                                    data: nsPoints,
                                    backgroundColor: '#1F2937',
                                    pointRadius: 2
                                }]
                            },
                            options: {
                                ...commonOptions,
                                scales: { x: { title: {display:true, text:'Log2 Fold Change'} }, y: { title: {display:true, text:'-Log10 FDR'} } }
                            }
                        });
                     }

                     // MA
                     const maChartInstance = Chart.getChart("maPlot");
                     if (maChartInstance) maChartInstance.destroy();
                     if(comp.maPoints && comp.maPoints.length > 0) {
                        const sigPoints = comp.maPoints.filter(p => p.sig);
                        const nsPoints = comp.maPoints.filter(p => !p.sig);
                        new Chart(document.getElementById('maPlot'), {
                            type: 'scatter',
                            data: {
                                datasets: [{
                                    label: 'Significant',
                                    data: sigPoints,
                                    backgroundColor: '#EF4444',
                                    pointRadius: 2
                                }, {
                                    label: 'Non-Significant',
                                    data: nsPoints,
                                    backgroundColor: '#1F2937',
                                    pointRadius: 2
                                }]
                            },
                            options: {
                                ...commonOptions,
                                scales: { x: { title: {display:true, text:'Log CPM'} }, y: { title: {display:true, text:'Log2 Fold Change'} } }
                            }
                        });
                     }
                     
                     // --- Functional Update (If this comparison has GO/KEGG) ---
                     // GO Table (New Layout)
                     const goTable = document.querySelector('#goTable tbody');
                     if(goTable && comp.goTerms && comp.goTerms.length > 0) {
                         // Sort by count
                         const sortedGo = [...comp.goTerms].sort((a,b) => b.count - a.count).slice(0, 10);
                         goTable.innerHTML = sortedGo.map(g => 
                            \`<tr>
                                <td>\${g.category || 'BP'}</td>
                                <td class="cell-num">\${g.count}</td>
                                <td>\${g.term}</td>
                            </tr>\`
                         ).join('');
                     }

                     // KEGG Chart (New Layout)
                     const keggChartInstance = Chart.getChart("keggChart");
                     if (keggChartInstance) keggChartInstance.destroy();
                     if(comp.keggPathways && comp.keggPathways.length > 0) {
                        const sortedKegg = [...comp.keggPathways].sort((a,b) => b.count - a.count).slice(0, 8);
                        new Chart(document.getElementById('keggChart'), {
                            type: 'bar',
                            data: {
                                labels: sortedKegg.map(k => k.term),
                                datasets: [{
                                    label: 'Gene Count',
                                    data: sortedKegg.map(k => k.count),
                                    backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6'],
                                }]
                            },
                            options: { 
                                indexAxis: 'y',
                                responsive: true, 
                                maintainAspectRatio: false,
                                plugins: { legend: { display: false } }
                            }
                        });
                     }
                };

                // Inject Toggles into DGE section
                compToggles.innerHTML = compIds.map((id, idx) => 
                    \`<button class="comp-btn \${idx === 0 ? 'active' : ''}" onclick="window.updateDGE('\${id}', this)">\${id}</button>\`
                ).join('');
                
                // Inject Toggles into Functional Section
                const funcToggles = document.getElementById('funcCompToggles');
                if(funcToggles) {
                    funcToggles.innerHTML = compIds.map((id, idx) => 
                        \`<button class="comp-btn \${idx === 0 ? 'active' : ''}" onclick="window.updateDGE('\${id}', this)">\${id}</button>\`
                    ).join('');
                }
                
                // Initialize with first comparison
                window.updateDGE(compIds[0], null);
            }

            // --- 5. Deliverables Grid ---
            const folderGrid = document.getElementById('folder-grid');
            if(folderGrid && data.deliverables) {
                folderGrid.innerHTML = data.deliverables.map(f => 
                    \`<div class="folder">
                        <div class="folder-icon-box">
                            <i data-lucide="folder" width="24" height="24" style="color: #F97316;"></i>
                        </div>
                        <div class="folder-info">
                            <div class="folder-name">\${f.name}</div>
                            <div class="folder-desc">\${f.desc}</div>
                        </div>
                    </div>\`
                ).join('');
            }
            
            // --- 6. Tree View ---
            const treeView = document.getElementById('tree-view');
            if(treeView && data.tree) {
                treeView.textContent = data.tree;
            }
            
            if(window.lucide) window.lucide.createIcons();
          });
        </script>
        `;

        html = html.replace('</body>', `${scriptInjection}</body>`);

        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${metadata.projectID}_Report.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setIsGenerating(false);

      } catch (e) {
        alert("Error generating report: " + e);
        console.error(e);
        setIsGenerating(false);
      }
    }, 1500);
  };

  const nextStep = () => setStep(s => Math.min(s + 1, 4));
  const prevStep = () => setStep(s => Math.max(s - 1, 0));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-brand-blue/20">
      <div className="max-w-[1600px] mx-auto px-6 py-10">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-brand-blue to-blue-600 rounded-lg flex items-center justify-center shadow-lg ring-1 ring-black/5">
              <Database className="text-white" size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Unigenome Builder Pro</h1>
              <p className="text-sm text-slate-500 font-medium">RNA-Seq Report Generator</p>
            </div>
          </div>
          <div className="text-right">
             <div className="text-xs font-bold text-brand-orange uppercase tracking-widest mb-1">Comparisons</div>
             <div className="flex items-center space-x-2 text-sm text-slate-600 bg-white px-3 py-1 rounded-full shadow-sm border border-slate-100">
                <span className={`w-2 h-2 rounded-full ${Object.keys(processedData.comparisons).length > 0 ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></span>
                <span>{Object.keys(processedData.comparisons).length} Loaded</span>
             </div>
          </div>
        </div>

        {/* Wizard Progress */}
        <StepWizard currentStep={step} steps={['Metadata', 'Key Stats', 'Data Upload', 'Deliverables', 'Generate']} />

        {/* Main Content Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden relative min-h-[600px] transition-all duration-300 flex flex-col">
          
          {/* Step 1: Metadata */}
          {step === Step.METADATA && (
            <div className="p-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-xl font-bold mb-6 flex items-center text-slate-800">
                <FileText className="mr-2 text-brand-blue" /> Project Metadata
              </h2>
              <div className="grid grid-cols-2 gap-8">
                {Object.entries(metadata).map(([key, val]) => (
                  <div key={key} className="group">
                    <label className="block text-xs font-bold uppercase text-slate-400 mb-2 group-focus-within:text-brand-blue transition-colors">{key.replace(/([A-Z])/g, ' $1')}</label>
                    <input 
                      type={key === 'date' ? 'date' : 'text'}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue transition-all font-medium text-slate-700"
                      value={val}
                      onChange={e => setMetadata({...metadata, [key]: e.target.value})}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Stats */}
          {step === Step.STATS && (
            <div className="p-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <h2 className="text-xl font-bold mb-6 flex items-center text-slate-800">
                <Layout className="mr-2 text-brand-blue" /> Executive Statistics
              </h2>
              <div className="grid grid-cols-2 gap-6">
                {Object.entries(stats).map(([key, val]) => (
                   <div key={key} className="p-5 border border-slate-100 rounded-xl bg-slate-50 hover:border-brand-blue/30 hover:bg-white hover:shadow-md transition-all group cursor-pointer">
                    <label className="block text-xs font-bold uppercase text-slate-400 mb-2 group-hover:text-brand-blue">{key.replace(/([A-Z])/g, ' $1')}</label>
                    <input 
                      type={typeof val === 'number' ? 'number' : 'text'}
                      className="w-full bg-transparent text-xl font-bold text-slate-800 focus:outline-none"
                      value={val}
                      onChange={e => setStats({...stats, [key]: e.target.type === 'number' ? Number(e.target.value) : e.target.value})}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Uploads */}
          {step === Step.UPLOADS && (
            <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col h-[700px]">
              <div className="flex justify-between items-center mb-6 shrink-0">
                 <h2 className="text-xl font-bold flex items-center text-slate-800">
                    <Upload className="mr-2 text-brand-blue" /> Smart File Upload
                 </h2>
                 <div className="text-xs text-brand-blue font-medium bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                    Auto-detection enabled
                 </div>
              </div>
              
              <div className="grid grid-cols-12 gap-8 h-full min-h-0">
                
                {/* Left: Upload Area */}
                <div className="col-span-4 flex flex-col h-full gap-4">
                  <div className="relative group shrink-0 h-40">
                      <input 
                        type="file" 
                        multiple
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        onChange={handleSmartUpload}
                      />
                      <div className="h-full border-2 border-dashed border-brand-blue/30 rounded-xl flex flex-col items-center justify-center bg-blue-50/30 group-hover:bg-blue-50 group-hover:border-brand-blue group-hover:scale-[1.02] transition-all text-center p-4">
                         <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center mb-3">
                             <Upload className="text-brand-blue" size={24} />
                         </div>
                         <p className="text-sm font-bold text-slate-700">Click or Drag Files Here</p>
                         <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
                             Supports: .xlsx, .csv, .txt, .html, .gtf
                         </p>
                      </div>
                  </div>

                  <div className="bg-slate-900 rounded-xl p-4 text-white flex-1 shadow-inner flex flex-col min-h-0">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3 shrink-0 flex justify-between">
                            <span>Uploaded Files</span>
                            <span className="text-slate-600">{uploadStatus.length}</span>
                        </h3>
                        <div className="overflow-y-auto space-y-2 pr-2">
                            {uploadStatus.length === 0 && <div className="text-slate-600 text-xs italic text-center py-8">No files uploaded yet</div>}
                            {uploadStatus.map((status) => (
                                <div key={status.id} className="flex items-center justify-between text-xs bg-slate-800/50 p-3 rounded-lg border border-slate-700/50 hover:bg-slate-800 transition-colors">
                                    <div className="flex items-center space-x-3 overflow-hidden">
                                        {status.status === 'success' ? <CheckCircle2 className="text-green-400 shrink-0" size={16} /> : 
                                         status.status === 'error' ? <AlertCircle className="text-red-400 shrink-0" size={16} /> :
                                         <div className="w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin shrink-0"></div>}
                                        <div className="flex flex-col min-w-0">
                                            <span className="truncate font-medium text-slate-200">{status.name}</span>
                                            <span className="text-[10px] text-slate-400 capitalize flex items-center gap-1 mt-0.5">
                                                {status.type.replace('_', ' ')}
                                                {status.assignedTo && <span className="px-1.5 py-0.5 bg-brand-blue/30 rounded text-blue-200 border border-brand-blue/20">{status.assignedTo}</span>}
                                            </span>
                                        </div>
                                    </div>
                                    <button onClick={() => removeFile(status.id)} className="text-slate-600 hover:text-red-400 ml-2 p-1 hover:bg-slate-700 rounded transition-colors">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                   </div>
                </div>

                {/* Middle: Checklist & Tracker */}
                <div className="col-span-3 flex flex-col h-full bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-hidden">
                    <div className="flex items-center gap-2 mb-4 shrink-0">
                        <ListChecks size={18} className="text-brand-blue"/>
                        <h3 className="text-sm font-bold text-slate-700">Project Checklist</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                            <div className="text-xs font-bold text-slate-500 uppercase mb-2">Global Data</div>
                            <div className="space-y-2 text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-600">Data Stats</span>
                                    {processedData.dataStatsTable.length > 0 ? <CheckCircle2 size={14} className="text-green-500"/> : <div className="w-3 h-3 rounded-full border border-slate-300"></div>}
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-600">Mapping Stats</span>
                                    {processedData.mappingStatsTable.length > 0 ? <CheckCircle2 size={14} className="text-green-500"/> : <div className="w-3 h-3 rounded-full border border-slate-300"></div>}
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-600">Novel Isoforms</span>
                                    {stats.novelIsoforms > 0 ? <CheckCircle2 size={14} className="text-green-500"/> : <div className="w-3 h-3 rounded-full border border-slate-300"></div>}
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-600">DGE Summary</span>
                                    {processedData.dgeSummaryTable.length > 0 ? <CheckCircle2 size={14} className="text-green-500"/> : <div className="w-3 h-3 rounded-full border border-slate-300"></div>}
                                </div>
                            </div>
                        </div>

                        {/* Comparisons Tracker */}
                        {Object.values(processedData.comparisons).map((comp: ComparisonData) => (
                            <div key={comp.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                                <div className="text-xs font-bold text-slate-800 mb-2 flex justify-between">
                                    <span>{comp.id}</span>
                                    <span className="font-normal text-slate-400 text-[10px]">{comp.name}</span>
                                </div>
                                <div className="space-y-2 text-xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-600">DGE Data</span>
                                        {comp.volcanoPoints.length > 0 ? <CheckCircle2 size={14} className="text-green-500"/> : <div className="w-3 h-3 rounded-full border border-slate-300"></div>}
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-600">GO Terms</span>
                                        {comp.goTerms.length > 0 ? <CheckCircle2 size={14} className="text-green-500"/> : <div className="w-3 h-3 rounded-full border border-slate-300"></div>}
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-600">KEGG Pathways</span>
                                        {comp.keggPathways.length > 0 ? <CheckCircle2 size={14} className="text-green-500"/> : <div className="w-3 h-3 rounded-full border border-slate-300"></div>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right: Detected Comparisons (Detailed View) */}
                <div className="col-span-5 flex flex-col h-full bg-slate-50 border border-slate-200 rounded-xl p-5 overflow-hidden">
                    <div className="flex justify-between items-center mb-4 shrink-0">
                        <div className="flex items-center gap-2">
                            <BarChart3 size={18} className="text-brand-blue"/>
                            <h3 className="text-sm font-bold text-slate-700">Comparisons Detail</h3>
                        </div>
                        {Object.keys(processedData.comparisons).length === 0 && <span className="text-xs text-orange-500 font-medium">Waiting for DGE files...</span>}
                    </div>
                    
                    <div className="overflow-y-auto pr-2 flex-1 space-y-4">
                        {Object.values(processedData.comparisons).map((comp: ComparisonData) => (
                            <div key={comp.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-brand-blue/30 transition-all">
                                <div className="flex justify-between items-center mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="w-8 h-8 rounded-lg bg-brand-blue/10 flex items-center justify-center font-bold text-brand-blue text-xs">{comp.id}</span>
                                        <span className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-500 font-mono">{comp.sigCount} Sig</span>
                                    </div>
                                </div>
                                <div className="space-y-2 mb-3">
                                    <input 
                                        type="text" 
                                        className="w-full text-sm border-b border-transparent hover:border-slate-300 focus:border-brand-blue focus:outline-none text-slate-800 font-semibold truncate bg-transparent pb-1 placeholder-slate-400"
                                        value={comp.name}
                                        onChange={(e) => updateComparisonDetails(comp.id, 'name', e.target.value)}
                                        placeholder="Name (e.g. Comparison 1)"
                                    />
                                    <input 
                                        type="text" 
                                        className="w-full text-xs border-b border-transparent hover:border-slate-300 focus:border-brand-blue focus:outline-none text-slate-600 truncate bg-transparent pb-1 placeholder-slate-400"
                                        value={comp.description}
                                        onChange={(e) => updateComparisonDetails(comp.id, 'description', e.target.value)}
                                        placeholder="Description (e.g. Treatment vs Control)"
                                    />
                                </div>
                                <div className="grid grid-cols-1 gap-1.5">
                                    <div className={`flex items-center text-xs px-2 py-1 rounded ${comp.volcanoPoints.length ? 'bg-green-50 text-green-700' : 'bg-slate-50 text-slate-400'}`}>
                                        <div className={`w-1.5 h-1.5 rounded-full mr-2 ${comp.volcanoPoints.length ? 'bg-green-500' : 'bg-slate-300'}`}></div> {comp.volcanoPoints.length} Points
                                    </div>
                                </div>
                            </div>
                        ))}
                        {Object.keys(processedData.comparisons).length === 0 && (
                            <div className="flex flex-col items-center justify-center text-slate-400 py-12 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                                <Package size={32} className="mb-2 opacity-50"/>
                                <p className="text-sm font-medium">No Comparisons Detected</p>
                                <p className="text-xs mt-1">Upload files like "Comparison1_DGE.xlsx"</p>
                            </div>
                        )}
                    </div>
                </div>

              </div>
            </div>
          )}

          {/* Step 4: Deliverables (NEW STEP) */}
          {step === Step.DELIVERABLES && (
            <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-[600px] flex flex-col">
                 {/* ... existing code for Step 4 ... */}
                 <div className="flex justify-between items-center mb-6">
                     <div>
                        <h2 className="text-xl font-bold flex items-center text-slate-800">
                            <FolderTree className="mr-2 text-brand-blue" /> Deliverables Structure
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">Define the folder structure displayed in the final report.</p>
                     </div>
                     <button 
                        onClick={generateTreeFromUploads}
                        className="flex items-center px-4 py-2 bg-white border border-slate-200 shadow-sm rounded-lg text-sm font-medium text-slate-700 hover:text-brand-blue hover:border-brand-blue transition-colors"
                     >
                        <RefreshCw size={16} className="mr-2" /> Auto-Generate from Uploads
                     </button>
                 </div>

                 <div className="flex-1 bg-slate-900 rounded-xl shadow-inner border border-slate-800 overflow-hidden flex flex-col">
                    <div className="bg-slate-950 px-4 py-2 border-b border-slate-800 flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                        <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                        <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                        <span className="ml-2 text-xs text-slate-500 font-mono">deliverables_tree.txt</span>
                    </div>
                    <div className="flex-1 relative">
                        <textarea 
                            className="absolute inset-0 w-full h-full bg-transparent text-slate-300 font-mono text-sm p-6 focus:outline-none resize-none leading-relaxed"
                            value={deliverablesTree}
                            onChange={(e) => setDeliverablesTree(e.target.value)}
                            spellCheck={false}
                        />
                    </div>
                 </div>
                 
                 <div className="mt-4 flex gap-4 text-xs text-slate-500 bg-blue-50/50 p-3 rounded-lg border border-blue-100">
                    <FileCode size={16} className="text-brand-blue shrink-0" />
                    <p>
                        Use standard tree characters (│, ├──, └──) or indentation to define hierarchy. 
                        Top level items will become collapsible folder cards in the final HTML report.
                    </p>
                 </div>
            </div>
          )}

          {/* Step 5: Generate */}
          {step === Step.GENERATE && (
             <div className="p-8 flex flex-col items-center justify-center h-full min-h-[500px] animate-in fade-in zoom-in-95 duration-500">
                <div className="w-32 h-32 bg-gradient-to-tr from-blue-50 to-orange-50 rounded-full flex items-center justify-center mb-8 relative">
                    <div className="absolute inset-0 rounded-full border-4 border-white shadow-sm"></div>
                    <Download className={`text-brand-orange z-10 ${isGenerating ? 'animate-bounce' : ''}`} size={56} />
                </div>
                
                <h2 className="text-3xl font-bold text-slate-900 mb-2">Ready to Build Report</h2>
                <div className="text-slate-500 max-w-md text-center mb-10 text-sm space-y-2 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <div className="flex justify-between py-1 border-b border-slate-200">
                        <span>Project ID</span>
                        <span className="font-semibold text-slate-800">{metadata.projectID}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-200">
                        <span>Comparisons</span>
                        <span className="font-semibold text-slate-800">{Object.keys(processedData.comparisons).length}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-200">
                        <span>Summary Data</span>
                        <span className={`font-semibold ${processedData.dgeSummaryTable.length > 0 ? 'text-green-600' : 'text-slate-400'}`}>
                            {processedData.dgeSummaryTable.length > 0 ? 'Ready' : 'Not Found'}
                        </span>
                    </div>
                    <div className="pt-2">
                         <span className="text-xs font-semibold text-brand-blue bg-blue-50 px-2 py-1 rounded">
                            {customTemplate ? 'Custom Template Active' : 'Unigenome Pro Template'}
                        </span>
                    </div>
                </div>

                <button 
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="group relative px-10 py-4 bg-brand-blue hover:bg-blue-800 text-white rounded-xl font-bold text-lg shadow-xl shadow-brand-blue/20 transform transition-all hover:-translate-y-1 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-3 overflow-hidden"
                >
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                    {isGenerating ? <span>Compiling HTML...</span> : <><span>Download Report</span><ChevronRight size={20}/></>}
                </button>
             </div>
          )}
          
          {/* Footer Nav */}
          <div className="absolute bottom-0 left-0 right-0 p-6 bg-white/80 backdrop-blur-sm border-t border-slate-100 flex justify-between items-center z-10">
            <button 
                onClick={prevStep} 
                disabled={step === 0}
                className="flex items-center px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
                <ChevronLeft size={16} className="mr-1" /> Back
            </button>
            
            <div className="text-xs font-medium text-slate-300">
                Unigenome Report Builder v2.1
            </div>

             {step < Step.GENERATE && (
                <button 
                    onClick={nextStep}
                    className="flex items-center px-6 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 shadow-lg shadow-slate-900/20 transition-all hover:-translate-y-0.5 active:translate-y-0"
                >
                    Next <ChevronRight size={16} className="ml-1" />
                </button>
             )}
          </div>

        </div>
      </div>
    </div>
  );
}
