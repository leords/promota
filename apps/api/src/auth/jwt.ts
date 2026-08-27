import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export type UserRole = 'admin' | 'gerente' | 'supervisor' | 'promotor';

export interface AuthClaims {
  userId: string;
  tenantId: string;
  role: UserRole;
}

export function signToken(claims: AuthClaims): string {
  const options: jwt.SignOptions = { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] };
  return jwt.sign(claims, env.jwtSecret, options);
}

export function verifyToken(token: string): AuthClaims {
  return jwt.verify(token, env.jwtSecret) as AuthClaims;
}
