import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { withTenant } from '../db/pool.js';
import { refreshRouteStatus } from '../services/routeStatus.js';

export const visitsRouter = Router();
visitsRouter.use(requireAuth);

const checkinSchema = z.object({
  clientId: z.string().uuid(), // gerado no app, garante idempotência (ver docs/ARCHITECTURE.md)
  routePdvId: z.string().uuid(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  precisaoM: z.number().optional(),
  checkinEm: z.string().datetime().optional(), // permite registrar o horário real do dispositivo, mesmo sincronizando depois
});

// Check-in — idempotente por clientId: reenviar o mesmo check-in (retry offline) nunca duplica.
visitsRouter.post('/visits/checkin', asyncHandler(async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const parsed = checkinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const visit = await withTenant(tenantId, async (client) => {
    const routePdv = await client.query(
      'SELECT pdv_id, route_id FROM app.route_pdvs WHERE id = $1',
      [d.routePdvId],
    );
    if (!routePdv.rows[0]) return null;
    const { pdv_id: pdvId, route_id: routeId } = routePdv.rows[0];

    await client.query('BEGIN');
    try {
      // ON CONFLICT DO NOTHING em vez de "SELECT existe? senão INSERT": aquele
      // padrão tem uma race condition real entre a checagem e a inserção — duas
      // requisições com o mesmo clientId (ex.: o efeito de sincronização disparando
      // duas vezes em StrictMode, ou um retry de rede genuíno) podem passar pelo
      // SELECT ao mesmo tempo e uma delas quebra com "duplicate key" (23505),
      // virando um 500 espúrio para um check-in que na prática já tinha sido salvo.
      // Reproduzido de verdade num teste de fila offline — ver docs/RISKS.md.
      const inserted = await client.query(
        `INSERT INTO app.visits (
           tenant_id, client_id, route_pdv_id, pdv_id, promotor_id,
           checkin_em, checkin_lat, checkin_lng, checkin_precisao_m, checkin_distancia_m
         ) VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamptz, now()), $7, $8, $9,
           CASE WHEN $7::double precision IS NOT NULL AND $8::double precision IS NOT NULL THEN (
             SELECT ST_Distance(geom, ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography)
             FROM app.pdvs WHERE id = $4
           ) END)
         ON CONFLICT (client_id) DO NOTHING
         RETURNING id, checkin_em, checkin_distancia_m`,
        [tenantId, d.clientId, d.routePdvId, pdvId, userId, d.checkinEm, d.latitude, d.longitude, d.precisaoM],
      );

      let row = inserted.rows[0];
      if (row) {
        await client.query(
          `UPDATE app.route_pdvs SET status = 'em_atendimento' WHERE id = $1 AND status = 'pendente'`,
          [d.routePdvId],
        );
        await refreshRouteStatus(client, routeId);
      } else {
        // Conflito: já existia um check-in com este clientId — retorna o existente
        // em vez de duplicar ou falhar (é exatamente o resultado que o cliente
        // espera de um retry idempotente).
        const existing = await client.query(
          'SELECT id, checkin_em, checkin_distancia_m FROM app.visits WHERE client_id = $1',
          [d.clientId],
        );
        row = existing.rows[0];
      }
      await client.query('COMMIT');
      return row;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });

  if (!visit) return res.status(404).json({ error: 'route_pdv_not_found' });
  res.status(201).json(visit);
}));

const checkoutSchema = z.object({
  visitId: z.string().uuid(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  justificativa: z.string().optional(),
  checkoutEm: z.string().datetime().optional(),
});

visitsRouter.post('/visits/checkout', asyncHandler(async (req, res) => {
  const { tenantId } = req.auth!;
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  const d = parsed.data;

  const visit = await withTenant(tenantId, async (client) => {
    await client.query('BEGIN');
    try {
      const result = await client.query(
        `UPDATE app.visits SET
           checkout_em = COALESCE($2::timestamptz, now()),
           checkout_lat = $3, checkout_lng = $4, justificativa = $5,
           duracao_segundos = EXTRACT(EPOCH FROM (COALESCE($2::timestamptz, now()) - checkin_em))::int
         WHERE id = $1 AND checkout_em IS NULL
         RETURNING id, route_pdv_id, checkin_em, checkout_em, duracao_segundos`,
        [d.visitId, d.checkoutEm, d.latitude, d.longitude, d.justificativa],
      );
      const row = result.rows[0];
      if (row) {
        const routePdv = await client.query(
          `UPDATE app.route_pdvs SET status = 'concluido' WHERE id = $1 RETURNING route_id`,
          [row.route_pdv_id],
        );
        await refreshRouteStatus(client, routePdv.rows[0].route_id);
      }
      await client.query('COMMIT');
      return row;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });

  if (!visit) return res.status(409).json({ error: 'visit_not_found_or_already_checked_out' });
  res.json(visit);
}));
