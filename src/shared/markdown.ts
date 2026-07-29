import type { Session } from './types';

const formatPlatformName = (platform: string): string => {
  switch (platform.toLowerCase()) {
    case 'chatgpt': return 'ChatGPT';
    case 'claude': return 'Claude';
    case 'gemini': return 'Gemini';
    case 'perplexity': return 'Perplexity';
    default: return platform.charAt(0).toUpperCase() + platform.slice(1);
  }
};

export const generateMarkdown = (session: Session): string => {
  let md = `# ${session.title}\n`;
  const platform = formatPlatformName(session.platform || 'unknown');
  md += `_Captured from ${platform} · ${session.messageCount} messages · ${session.imageCount} images · ${session.fileCount} files_\n`;
  md += `_Verbatim · full conversation, nothing summarized_\n\n`;
  md += `---\n\n`;

  session.messages.forEach((msg) => {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    md += `## ${roleLabel}\n\n`;
    
    if (msg.files && msg.files.length > 0) {
      const images = msg.files.filter(f => f.type.startsWith('image/'));
      const docs = msg.files.filter(f => !f.type.startsWith('image/'));

      if (images.length > 0) {
        images.forEach(img => {
          md += `![${img.name}](images/${img.name})\n\n`;
        });
      }

      if (docs.length > 0) {
        md += `*Attachments:*\n`;
        docs.forEach(doc => {
          md += `- **File:** ${doc.name} (${doc.type})`;
          if (doc.size) {
            md += ` - ${Math.round(doc.size / 1024)} KB`;
          }
          md += `\n`;
        });
        md += `\n`;
      }
    }

    md += `${msg.content}\n\n`;
  });

  return md.trim() + '\n';
};

