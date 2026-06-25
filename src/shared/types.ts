export interface AttachedFile {
  name: string;
  type: string;
  size?: number;
  content?: string; // base64 for images/binary, text for documents
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  files?: AttachedFile[];
}

export interface Session {
  id: string;
  title: string;
  platform: 'claude' | 'chatgpt' | 'gemini' | 'perplexity';
  messageCount: number;
  imageCount: number;
  fileCount: number;
  startedAt: string;
  savedAt: string;
  messages: Message[];
}

export interface AISummarySettings {
  provider: 'openai' | 'anthropic' | 'gemini';
  apiKey: string;
  model: string;
  summaryTemplate: string;
}

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  autoSend: boolean;
  handoffTemplatePdf: string;
  handoffTemplateMd: string;
  aiSummary: AISummarySettings;
}

export interface PendingHandoff {
  targetPlatform: Session['platform'];
  handoffText: string;
  fileName: string;
  mimeType: string;
  fileContent: string; // Plain text (for MD) or base64 data URL (for PDF)
  attachments?: AttachedFile[]; // Images/files from the original conversation
}
