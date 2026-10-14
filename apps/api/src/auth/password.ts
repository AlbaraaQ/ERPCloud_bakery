import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw);
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
