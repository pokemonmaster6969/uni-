
export interface ProjectMetadata {
  projectID: string;
  clientName: string;
  institute: string;
  organism: string;
  genomeBuild: string;
  platform: string;
  date: string;
  serviceType: string;
  sampleType: string;
  shippingCondition: string;
}

export interface ProjectStats {
  totalSamples: number;
  totalDataGB: number;
  readLength: string;
  mappingRate: string;
  mergedTranscripts: number;
  novelIsoforms: number;
}

export interface EnrichmentTerm {
  term: string;
  count: number;
  pAdjust: number;
  category?: string; // e.g., "Biological Process"
}

export interface ComparisonStats {
  total: number;
  up: number;
  down: number;
  sigUp: number;
  sigDown: number;
  sigTotal: number;
}

export interface TranscriptStat {
  name: string;
  count: number;
  totalLen: number;
  meanLen: number;
  maxLen: number;
}

export interface ComparisonData {
  id: string; // e.g., "C1"
  name: string; // e.g., "Comparison 1"
  description: string; // e.g., "Treatment vs Control"
  sigCount: number;
  stats?: ComparisonStats; // Detailed stats
  // Plot Data
  maPoints: { x: number; y: number; sig: boolean; label: string }[];
  volcanoPoints: { x: number; y: number; sig: boolean; label: string }[];
  // Enrichment Data
  goTerms: EnrichmentTerm[];
  keggPathways: EnrichmentTerm[];
}

export interface ProcessedData {
  dataStatsTable: string[][]; // Rows of cells
  mappingStatsTable: string[][];
  transcriptStats: TranscriptStat[];
  dgeSummaryTable: {
    comp: string;
    desc: string;
    total: number;
    downTotal: number;
    upTotal: number;
    sigDown: number;
    sigUp: number;
    sig: number;
  }[];
  comparisons: Record<string, ComparisonData>;
  deliverablesTree: string;
}

export enum Step {
  METADATA = 0,
  STATS = 1,
  UPLOADS = 2,
  DELIVERABLES = 3,
  GENERATE = 4
}

export interface FileUploadStatus {
  id: string;
  name: string;
  type: 'stats' | 'mapping' | 'dge_summary' | 'comparison_dge' | 'comparison_go' | 'comparison_kegg' | 'template' | 'gtf_novel' | 'gtf_merged' | 'deliverable_only';
  assignedTo?: string; // e.g., "C1"
  status: 'pending' | 'success' | 'error';
  message?: string;
}
