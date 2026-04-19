import { createHmac, timingSafeEqual } from 'node:crypto';

export interface GiteaPushPayload {
  ref: string; // e.g. "refs/heads/main"
  after: string; // SHA
  repository: { full_name: string; clone_url: string };
  head_commit?: { id: string; message: string; author?: { name?: string; username?: string } };
  pusher?: { login?: string };
}

export function verifyGiteaSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const computed = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expected = Buffer.from(computed);
  let provided: Buffer;
  try {
    provided = Buffer.from(signature.replace(/^sha256=/, ''));
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export function refToBranch(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}
