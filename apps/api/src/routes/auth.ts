import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { withoutTenant, withTenant } from '../db/pool.js';
import { signToken, type UserRole } from '../auth/jwt.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const authRouter = Router();

const loginSchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/auth/login', asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  }
  const { tenantSlug, email, password } = parsed.data;

  const tenant = await withoutTenant(async (client) => {
    const result = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM platform.tenants WHERE slug = $1',
      [tenantSlug],
    );
    return result.rows[0];
  });

  if (!tenant || tenant.status !== 'ativo') {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const user = await withTenant(tenant.id, async (client) => {
    const result = await client.query<{
      id: string;
      senha_hash: string;
      role: UserRole;
      ativo: boolean;
    }>('SELECT id, senha_hash, role, ativo FROM app.users WHERE email = $1', [email]);
    return result.rows[0];
  });

  if (!user || !user.ativo) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const passwordMatches = await bcrypt.compare(password, user.senha_hash);
  if (!passwordMatches) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const token = signToken({ userId: user.id, tenantId: tenant.id, role: user.role });
  res.json({ token });
}));
