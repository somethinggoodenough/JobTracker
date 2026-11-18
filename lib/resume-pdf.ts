import { ResumeInputError } from "./resume-types";
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_RESUME_REQUEST_BYTES = MAX_PDF_BYTES + 512 * 1024;

export async function validateResumePdf(file: File): Promise<ArrayBuffer> {
  if (!/\.pdf$/i.test(file.name) || !["", "application/pdf", "application/octet-stream"].includes(file.type))
    throw new ResumeInputError("请选择 PDF 文件");
  if (file.size > MAX_PDF_BYTES) throw new ResumeInputError("PDF 文件不能超过 10 MB");
  const bytes = await file.arrayBuffer(), data = new Uint8Array(bytes);
  const header = new TextDecoder().decode(data.slice(0, 8)), tail = new TextDecoder().decode(data.slice(-2048));
  if (!/^%PDF-(1\.\d|2\.0)/.test(header) || !tail.includes("%%EOF")) throw new ResumeInputError("文件不是有效的 PDF，或内容不完整");
  return bytes;
}
export function pdfFileName(name: string): string {
  return name.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200) || "resume.pdf";
}

// Limit the actual stream as well as Content-Length before parsing multipart input.
export async function readResumeRequest(request: Request): Promise<{ payload: unknown; pdf?: File | null }> {
  if (Number(request.headers.get("content-length")) > MAX_RESUME_REQUEST_BYTES) throw new ResumeInputError("上传内容过大，PDF 最大 10 MB");
  const reader = request.body?.getReader();
  if (!reader) throw new ResumeInputError("简历资料格式无效");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_RESUME_REQUEST_BYTES) { await reader.cancel(); throw new ResumeInputError("上传内容过大，PDF 最大 10 MB"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return { payload: JSON.parse(new TextDecoder().decode(body)) };
    const form = await new Response(body, { headers: { "content-type": request.headers.get("content-type")! } }).formData();
    for (const key of form.keys()) if (!["data", "pdf", "remove_pdf"].includes(key) || form.getAll(key).length !== 1) throw new ResumeInputError("简历上传字段无效");
    const data = form.get("data"), pdf = form.get("pdf"), remove = form.get("remove_pdf");
    if (typeof data !== "string" || pdf !== null && typeof pdf === "string" || remove !== null && remove !== "true" || pdf && remove)
      throw new ResumeInputError("简历上传字段无效");
    return { payload: JSON.parse(data), pdf: pdf as File | undefined ?? (remove ? null : undefined) };
  } catch (error) { if (error instanceof ResumeInputError) throw error; throw new ResumeInputError("简历资料格式无效"); }
}
