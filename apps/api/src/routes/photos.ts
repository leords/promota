import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';

// ATENÇÃO: disco local é só para desenvolvimento. O provedor definitivo (S3/R2/etc)
// ainda não foi decidido com o usuário — ver docs/DECISIONS.md. Não promover isto a
// produção sem trocar por armazenamento externo (disco de container não é durável).
const upload = multer({
  storage: multer.diskStorage({
    destination: path.resolve(process.cwd(), 'uploads'),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const photosRouter = Router();
photosRouter.use(requireAuth);

const metadataSchema = z.object({
  clientId: z.string().uuid(),
  visitId: z.string().uuid(),
  categoria: z.enum(['antes', 'depois', 'gondola', 'ponto_extra', 'merchandising', 'ruptura', 'livre']),
});

photosRouter.post('/photos', upload.single('file'), asyncHandler(async (req, res) => {
  const { tenantId, userId } = req.auth!;
  if (!req.file) return res.status(400).json({ error: 'missing_file' });

  const parsed = metadataSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const photo = await withTenant(tenantId, async (client) => {
    const visit = await client.query('SELECT pdv_id FROM app.visits WHERE id = $1', [d.visitId]);
    if (!visit.rows[0]) return null;

    // ON CONFLICT DO NOTHING em vez de SELECT-então-INSERT — mesma race condition de
    // idempotência corrigida em visits.ts, ver comentário lá e docs/RISKS.md.
    const inserted = await client.query(
      `INSERT INTO app.photos (tenant_id, client_id, visit_id, pdv_id, promotor_id, categoria, storage_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (client_id) DO NOTHING
       RETURNING id, categoria, storage_key`,
      [tenantId, d.clientId, d.visitId, visit.rows[0].pdv_id, userId, d.categoria, req.file!.filename],
    );
    if (inserted.rows[0]) return inserted.rows[0];

    const existing = await client.query(
      'SELECT id, categoria, storage_key FROM app.photos WHERE client_id = $1',
      [d.clientId],
    );
    return existing.rows[0];
  });

  if (!photo) return res.status(404).json({ error: 'visit_not_found' });
  res.status(201).json(photo);
}));

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

// Serve o arquivo em si, autenticado e restrito ao tenant — NUNCA expor /uploads
// como estático público. Descoberto num teste real: um <img src> público não manda
// o header Authorization, então qualquer rota estática exigindo auth quebra a
// imagem; a "solução" errada seria tornar /uploads público, o que vazaria fotos de
// um tenant para qualquer pessoa com a URL, violando a regra central do projeto de
// isolamento por tenant. Esta rota faz o lookup em app.photos (RLS aplica o filtro
// de tenant) antes de servir o arquivo, então só quem tem um token válido do tenant
// dono da foto consegue baixá-la. O frontend busca isso autenticado e monta um blob
// URL (ver apps/web/src/api/admin.ts `fetchPhotoBlobUrl`), não um <img src> direto.
photosRouter.get('/photos/:id/file', asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const photo = await withTenant(tenantId, async (client) => {
    const result = await client.query('SELECT storage_key FROM app.photos WHERE id = $1', [req.params.id]);
    return result.rows[0];
  });
  if (!photo) return res.status(404).json({ error: 'photo_not_found' });
  res.sendFile(path.join(UPLOADS_DIR, photo.storage_key));
}));

photosRouter.get('/photos', asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const { visitId, pdvId } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [tenantId];
  if (visitId) { params.push(visitId); conditions.push(`visit_id = $${params.length}`); }
  if (pdvId) { params.push(pdvId); conditions.push(`pdv_id = $${params.length}`); }
  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

  const rows = await withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT id, categoria, storage_key, criado_em FROM app.photos
       WHERE tenant_id = $1 ${where} ORDER BY criado_em DESC`,
      params,
    );
    return result.rows;
  });
  res.json(rows);
}));
