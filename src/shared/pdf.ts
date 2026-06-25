import { jsPDF } from 'jspdf';
import type { Session } from './types';

const getImageDimensions = (base64Data: string): Promise<{ width: number; height: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0 });
    };
    img.src = base64Data;
  });
};

const checkPageOverflow = (
  doc: jsPDF,
  y: number,
  neededHeight: number,
  pageHeight: number,
  margin: number
): number => {
  if (y + neededHeight > pageHeight - margin) {
    doc.addPage();
    return 20;
  }
  return y;
};

interface TextToken {
  text: string;
  isBold: boolean;
  isItalic: boolean;
  isCode: boolean;
}

interface WordToken {
  text: string;
  isBold: boolean;
  isItalic: boolean;
  isCode: boolean;
}

const tokenizeParagraph = (text: string): TextToken[] => {
  const tokens: TextToken[] = [];
  let i = 0;
  let isBold = false;
  let isItalic = false;
  let isCode = false;
  let currentText = '';

  const flush = () => {
    if (currentText) {
      tokens.push({ text: currentText, isBold, isItalic, isCode });
      currentText = '';
    }
  };

  while (i < text.length) {
    if (text.startsWith('**', i) || text.startsWith('__', i)) {
      flush();
      isBold = !isBold;
      i += 2;
    } else if (text.startsWith('*', i) || text.startsWith('_', i)) {
      flush();
      isItalic = !isItalic;
      i += 1;
    } else if (text.startsWith('`', i)) {
      flush();
      isCode = !isCode;
      i += 1;
    } else {
      currentText += text[i];
      i += 1;
    }
  }
  flush();
  return tokens;
};

const getWordTokens = (paragraph: string): WordToken[] => {
  const textTokens = tokenizeParagraph(paragraph);
  const wordTokens: WordToken[] = [];
  
  textTokens.forEach(token => {
    // Split by whitespace but keep spaces and newlines
    const parts = token.text.split(/(\s+)/);
    parts.forEach(part => {
      if (part) {
        if (part.includes('\n')) {
          const lines = part.split(/(\n)/);
          lines.forEach(line => {
            if (line === '\n') {
              wordTokens.push({
                text: '\n',
                isBold: token.isBold,
                isItalic: token.isItalic,
                isCode: token.isCode
              });
            } else if (line) {
              wordTokens.push({
                text: line,
                isBold: token.isBold,
                isItalic: token.isItalic,
                isCode: token.isCode
              });
            }
          });
        } else {
          wordTokens.push({
            text: part,
            isBold: token.isBold,
            isItalic: token.isItalic,
            isCode: token.isCode
          });
        }
      }
    });
  });
  
  return wordTokens;
};

const renderLineWithInlineStyles = (
  doc: jsPDF,
  text: string,
  leftMargin: number,
  width: number,
  startY: number,
  lineHeight: number,
  pageHeight: number,
  margin: number,
  baseFontSize = 9.5,
  baseFontStyle = 'normal',
  baseTextColor = [71, 85, 105] // Slate-600 default body
): number => {
  let y = startY;
  let x = leftMargin;
  
  const tokens = getWordTokens(text);
  
  tokens.forEach(token => {
    let fontStyle = 'normal';
    let fontSize = 9.5;
    let textColor = [71, 85, 105];
    let fontName = 'Helvetica';
    
    if (token.isCode) {
      fontName = 'Courier';
      fontStyle = 'normal';
      fontSize = baseFontSize * 0.9;
      textColor = [51, 65, 85]; // Slate-700
    } else if (token.isBold && token.isItalic) {
      fontStyle = 'bolditalic';
      fontSize = baseFontSize;
      textColor = [15, 23, 42]; // Slate-900
    } else if (token.isBold) {
      fontStyle = 'bold';
      fontSize = baseFontSize;
      textColor = [15, 23, 42]; // Slate-900
    } else if (token.isItalic) {
      fontStyle = 'italic';
      fontSize = baseFontSize;
      textColor = [71, 85, 105];
    } else {
      fontStyle = baseFontStyle;
      fontSize = baseFontSize;
      textColor = baseTextColor;
    }
    
    doc.setFont(fontName, fontStyle);
    doc.setFontSize(fontSize);
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    
    const wordWidth = doc.getTextWidth(token.text);
    
    if (x === leftMargin && token.text.trim() === '') {
      return;
    }
    
    if (x + wordWidth > leftMargin + width) {
      y += lineHeight;
      y = checkPageOverflow(doc, y, 0, pageHeight, margin);
      x = leftMargin;
      
      // Re-apply styles in case a new page reset defaults
      doc.setFont(fontName, fontStyle);
      doc.setFontSize(fontSize);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      
      if (token.text.trim() === '') {
        return;
      }
    }
    
    if (token.isCode) {
      doc.setFillColor(241, 245, 249); // slate-100 background
      doc.rect(x - 0.3, y - 3.2, wordWidth + 0.6, 4.2, 'F');
      
      // Restore styles after background drawing
      doc.setFont(fontName, fontStyle);
      doc.setFontSize(fontSize);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    }
    
    doc.text(token.text, x, y);
    x += wordWidth;
  });
  
  return y;
};

const renderTextBlock = (
  doc: jsPDF,
  textBlock: string,
  margin: number,
  contentWidth: number,
  startY: number,
  pageHeight: number
): number => {
  let y = startY;
  
  const paragraphs = textBlock.split('\n\n');
  
  paragraphs.forEach((p, pIdx) => {
    const trimmed = p.trim();
    if (!trimmed) return;
    
    const lines = trimmed.split('\n');
    
    lines.forEach((line) => {
      const lineTrimmed = line.trim();
      if (!lineTrimmed) return;
      
      let isListItem = false;
      let indent = 0;
      let lineText = lineTrimmed;
      
      if (lineTrimmed.startsWith('* ') || lineTrimmed.startsWith('- ')) {
        isListItem = true;
        indent = 5;
        lineText = lineTrimmed.substring(2);
      }
      
      // Check if it is a header
      let isHeader = false;
      let headerLevel = 0;
      if (lineTrimmed.startsWith('#')) {
        let hashes = 0;
        while (hashes < lineTrimmed.length && lineTrimmed[hashes] === '#') {
          hashes++;
        }
        if (hashes > 0 && hashes < 6 && lineTrimmed[hashes] === ' ') {
          isHeader = true;
          headerLevel = hashes;
          lineText = lineTrimmed.substring(hashes + 1).trim();
        }
      }
      
      if (isHeader) {
        let fontSize = 10;
        let lHeight = 5.0;
        
        if (headerLevel === 1) {
          fontSize = 14;
          lHeight = 6.5;
        } else if (headerLevel === 2) {
          fontSize = 12.5;
          lHeight = 5.8;
        } else if (headerLevel === 3) {
          fontSize = 11;
          lHeight = 5.2;
        } else {
          fontSize = 10;
          lHeight = 4.8;
        }
        
        y = checkPageOverflow(doc, y, lHeight + 2, pageHeight, margin);
        
        y = renderLineWithInlineStyles(
          doc,
          lineText,
          margin,
          contentWidth,
          y,
          lHeight,
          pageHeight,
          margin,
          fontSize,
          'bold',
          [15, 23, 42] // Slate-900
        );
        
        y += lHeight + 1.0;
      } else {
        if (isListItem) {
          y = checkPageOverflow(doc, y, 5, pageHeight, margin);
          doc.setFont('Helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(79, 70, 229); // Indigo-600 bullet
          doc.text('•', margin + 1.5, y);
        }
        
        y = renderLineWithInlineStyles(
          doc,
          lineText,
          margin + indent,
          contentWidth - indent,
          y,
          5.0, // Line height
          pageHeight,
          margin
        );
        
        y += 5.0; // Advance by line height!
      }
    });
    
    if (pIdx < paragraphs.length - 1) {
      y += 2.5;
    }
  });
  
  return y;
};

const renderCodeBlock = (
  doc: jsPDF,
  codeText: string,
  lang: string,
  margin: number,
  contentWidth: number,
  startY: number,
  pageHeight: number
): number => {
  let y = startY;
  
  doc.setFont('Courier', 'normal');
  doc.setFontSize(8.0);
  const splitCode = doc.splitTextToSize(codeText, contentWidth - 4);
  
  const lineGap = 4.2;
  const headerHeight = lang ? 5 : 0;
  
  let blockStartY = y - 3;
  
  const drawPageCodeBackground = (startYPos: number, endYPos: number) => {
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.3);
    doc.roundedRect(margin - 2, startYPos, contentWidth + 4, endYPos - startYPos, 1.5, 1.5, 'FD');
    
    doc.setFillColor(148, 163, 184); // Slate-400 Left accent bar
    doc.rect(margin - 2, startYPos, 1.5, endYPos - startYPos, 'F');
  };
  
  if (lang) {
    y = checkPageOverflow(doc, y, headerHeight + 2, pageHeight, margin);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(lang.toUpperCase(), margin, y);
    y += 4;
    blockStartY = y - 3;
  }
  
  doc.setFont('Courier', 'normal');
  doc.setFontSize(8.0);
  doc.setTextColor(51, 65, 85); // slate-700
  
  splitCode.forEach((line: string) => {
    if (y + lineGap > pageHeight - 20) {
      drawPageCodeBackground(blockStartY, y - 1);
      
      doc.addPage();
      y = 20;
      blockStartY = y - 3;
      
      doc.setFont('Courier', 'normal');
      doc.setFontSize(8.0);
      doc.setTextColor(51, 65, 85);
    }
    
    doc.text(line, margin + 2, y);
    y += lineGap;
  });
  
  drawPageCodeBackground(blockStartY, y - 1);
  y += 3;
  
  return y;
};

export const generatePdf = async (session: Session): Promise<Blob> => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });
  
  doc.setProperties({
    title: `MoveChat - ${session.title}`,
    subject: 'Conversation Handoff Transcript',
    creator: 'MoveChat Extension',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);
  let y = 20;

  // Pre-load all image dimensions in parallel
  const imageDimensionsMap = new Map<string, { width: number; height: number }>();
  const imagePromises: Promise<void>[] = [];

  session.messages.forEach(msg => {
    if (msg.files) {
      msg.files.forEach(file => {
        if (file.type.startsWith('image/') && file.content && file.content.startsWith('data:image/')) {
          const content = file.content;
          const promise = getImageDimensions(content).then(dims => {
            imageDimensionsMap.set(content, dims);
          });
          imagePromises.push(promise);
        }
      });
    }
  });

  await Promise.all(imagePromises);

  // Title Header
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42); // Slate-900
  doc.text('MoveChat - Conversation Handoff', margin, y);
  y += 8;

  // Metadata Info Card
  const cardHeight = 24;
  doc.setFillColor(248, 250, 252); // slate-50 background
  doc.setDrawColor(241, 245, 249); // slate-100 border
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentWidth, cardHeight, 2, 2, 'FD');
  
  // Card Contents
  let cardY = y + 5;
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(51, 65, 85); // slate-700
  
  const titleText = `Title: ${session.title}`;
  const splitTitle = doc.splitTextToSize(titleText, contentWidth - 8);
  doc.text(splitTitle[0] + (splitTitle.length > 1 ? '...' : ''), margin + 4, cardY);
  cardY += 5;
  
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(`Platform: ${(session.platform || 'unknown').toUpperCase()}    |    Saved: ${new Date(session.savedAt).toLocaleString()}`, margin + 4, cardY);
  cardY += 5;
  
  doc.text(`Stats: ${session.messageCount} messages    |    ${session.imageCount} images    |    ${session.fileCount} files`, margin + 4, cardY);
  
  y += cardHeight + 8;

  session.messages.forEach((msg) => {
    // Message header (role)
    y = checkPageOverflow(doc, y, 15, pageHeight, margin);
    
    // Draw left accent vertical bar
    if (msg.role === 'user') {
      doc.setFillColor(148, 163, 184); // Slate-400
    } else {
      doc.setFillColor(79, 70, 229); // Indigo-600
    }
    doc.rect(margin, y - 4, 1.5, 5, 'F'); // 1.5mm wide, 5mm tall bar
    
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42); // Slate-900
    doc.text(msg.role === 'user' ? 'User' : 'Assistant', margin + 4, y);
    y += 8;

    // List any attachments in this message (ignoring base64 inline images)
    if (msg.files && msg.files.length > 0) {
      const nonImageFiles = msg.files.filter(file => !(file.type.startsWith('image/') && file.content));
      if (nonImageFiles.length > 0) {
        doc.setFont('Helvetica', 'italic');
        doc.setFontSize(8.5);
        doc.setTextColor(148, 163, 184); // Slate-400
        nonImageFiles.forEach(file => {
          y = checkPageOverflow(doc, y, 5, pageHeight, margin);
          doc.text(`Attachment: ${file.name} (${file.type})${file.size ? ` - ${Math.round(file.size / 1024)}KB` : ''}`, margin + 4, y);
          y += 5;
        });
        y += 2;
      }
    }

    // Parse message body into normal text blocks and code blocks
    const parts = msg.content.split('```');
    
    parts.forEach((part, partIdx) => {
      const isCodeBlock = partIdx % 2 === 1;

      if (isCodeBlock) {
        const lines = part.split('\n');
        let lang = '';
        let codeLines = lines;

        if (lines[0] && lines[0].trim() && !lines[0].includes(' ') && lines[0].trim().length < 15) {
          lang = lines[0].trim();
          codeLines = lines.slice(1);
        }

        const codeText = codeLines.join('\n').trim();
        if (!codeText) return;

        y = renderCodeBlock(doc, codeText, lang, margin, contentWidth, y, pageHeight);
      } else {
        const textBlock = part.trim();
        if (!textBlock) return;

        y = renderTextBlock(doc, textBlock, margin, contentWidth, y, pageHeight);
      }
    });

    y += 3;

    // Embed any image attachments
    if (msg.files) {
      msg.files.forEach(file => {
        if (file.type.startsWith('image/') && file.content && file.content.startsWith('data:image/')) {
          try {
            const formatMatch = file.content.match(/^data:image\/(\w+);base64,/);
            const format = formatMatch ? formatMatch[1].toUpperCase() : 'JPEG';
            
            const dims = imageDimensionsMap.get(file.content) || { width: 0, height: 0 };
            
            let imgWidth = Math.min(120, contentWidth);
            let imgHeight = 70;
            
            if (dims.width > 0 && dims.height > 0) {
              const ratio = dims.width / dims.height;
              const naturalWidthMm = dims.width * 0.264583;
              const naturalHeightMm = dims.height * 0.264583;
              
              const maxWidth = Math.min(140, contentWidth);
              const maxDisplayHeight = pageHeight - (margin * 2) - 10;
              
              imgWidth = naturalWidthMm;
              imgHeight = naturalHeightMm;
              
              if (imgWidth > maxWidth) {
                imgWidth = maxWidth;
                imgHeight = imgWidth / ratio;
              }
              if (imgHeight > maxDisplayHeight) {
                imgHeight = maxDisplayHeight;
                imgWidth = imgHeight * ratio;
              }
            }
            
            y = checkPageOverflow(doc, y, imgHeight + 10, pageHeight, margin);
            doc.addImage(file.content, format, margin, y, imgWidth, imgHeight);
            y += imgHeight + 8;
          } catch (e) {
            console.error("Failed to embed base64 image in PDF:", e);
          }
        }
      });
    }

    // End of message turn divider
    y = checkPageOverflow(doc, y, 10, pageHeight, margin);
    doc.setDrawColor(241, 245, 249); // slate-100
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
  });

  return doc.output('blob');
};
