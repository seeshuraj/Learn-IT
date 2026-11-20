/**
 * TLS settings for the Postgres connection.
 *
 * Traffic to Supabase is always encrypted. With DATABASE_CA_CERT set (the
 * Supabase root CA from Dashboard → Database → SSL configuration, PEM), the
 * server's certificate is also verified, which stops a man-in-the-middle
 * presenting its own certificate. Without it the link is encrypted but not
 * verified — kept as the fallback so a missing secret can't take the API down.
 *
 * DATABASE_SSL=disable is only for a local database (CI e2e) and is refused
 * in production.
 */
export type DbSsl = false | { rejectUnauthorized: boolean; ca?: string };

type Env = Partial<Record<'DATABASE_CA_CERT' | 'DATABASE_SSL' | 'NODE_ENV', string>>;

export function dbSslConfig(env: Env = process.env): DbSsl {
  if (env.DATABASE_SSL === 'disable') {
    if (env.NODE_ENV === 'production') {
      throw new Error('DATABASE_SSL=disable is not allowed in production');
    }
    return false;
  }

  const raw = env.DATABASE_CA_CERT?.trim();
  if (!raw) return { rejectUnauthorized: false };

  const ca = raw.replace(/\\n/g, '\n');
  if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(ca)) {
    throw new Error('DATABASE_CA_CERT is set but is not a PEM certificate');
  }
  return { ca, rejectUnauthorized: true };
}

/** True when the database certificate is checked, for the startup log. */
export const dbCertVerified = (ssl: DbSsl) => ssl !== false && ssl.rejectUnauthorized;
