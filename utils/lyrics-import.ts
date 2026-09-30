/** Read locally; importing never saves or calls a generation provider. */
export async function readLyricsFile(file: Pick<File, 'name' | 'size' | 'text'>): Promise<string> {
  if (!/\.txt$/i.test(file.name)) throw new Error('Please choose a TXT file. For DOCX or PDF, copy and paste the text.');
  if (file.size > 1024 * 1024) throw new Error('Please choose a TXT file smaller than 1 MB.');
  const text = (await file.text()).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new Error('This file is empty. Please choose a file containing lyrics.');
  if (/[\u0000\uFFFD]/.test(text)) throw new Error('This file could not be read as text. Save it as UTF-8 TXT and try again.');
  return text;
}
