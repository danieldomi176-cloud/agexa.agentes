export interface AccessEnv {
  ACCESS_TEAM?: string;
  ACCESS_AUD?: string;
  CEO_SUBJECTS?: string;
}
const decode = (v: string) =>
  Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export async function authorized(request: Request, env: AccessEnv): Promise<boolean> {
  try {
    if (
      !env.ACCESS_TEAM ||
      !/^[a-z0-9-]+$/.test(env.ACCESS_TEAM) ||
      !env.ACCESS_AUD ||
      !env.CEO_SUBJECTS
    )
      return false;
    const token =
      request.headers.get('Cf-Access-Jwt-Assertion') ??
      request.headers.get('cookie')?.match(/(?:^|; )CF_Authorization=([^;]+)/)?.[1];
    if (!token || token.length > 16000) return false;
    const [h, p, s, ...extra] = token.split('.');
    if (extra.length || !s) return false;
    const header = JSON.parse(new TextDecoder().decode(decode(h))),
      claims = JSON.parse(new TextDecoder().decode(decode(p)));
    const issuer = `https://${env.ACCESS_TEAM}.cloudflareaccess.com`;
    const now = Date.now() / 1000;
    if (
      header.alg !== 'RS256' ||
      claims.iss !== issuer ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= now ||
      claims.iat > now + 30 ||
      claims.nbf > now ||
      !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(env.ACCESS_AUD) ||
      !env.CEO_SUBJECTS.split(',').includes(claims.sub)
    )
      return false;
    const response = await fetch(issuer + '/cdn-cgi/access/certs', {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const keys = (await response.json()) as { keys: (JsonWebKey & { kid: string })[] };
    const jwk = keys.keys.find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      decode(s),
      new TextEncoder().encode(h + '.' + p),
    );
  } catch {
    return false;
  }
}
