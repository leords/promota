export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3334';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}

/**
 * Baixa um arquivo autenticado (ex.: CSV de relatório) — um `<a href>` normal não
 * manda o header Authorization, então buscamos com fetch e disparamos o download via
 * um link temporário com blob URL (mesmo motivo de `fetchPhotoBlobUrl` em
 * api/admin.ts).
 */
export async function downloadAuthenticated(path: string, token: string | null, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, undefined);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Como apiFetch, mas envia multipart/form-data — usado só para upload de arquivo (fotos). */
export async function apiUpload<T>(
  path: string,
  options: { token?: string | null; fields: Record<string, string>; file: Blob; fileFieldName?: string },
): Promise<T> {
  const formData = new FormData();
  for (const [key, value] of Object.entries(options.fields)) {
    formData.append(key, value);
  }
  formData.append(options.fileFieldName ?? 'file', options.file);

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: options.token ? { Authorization: `Bearer ${options.token}` } : undefined,
    body: formData,
  });

  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}
