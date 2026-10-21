/** No staging request can invoke the anchor fetcher, holder or legacy routes. */
export function stagingRouteAllowed(method: string, path: string): boolean {
  if (method === 'GET') {
    return (
      [
        '/mints',
        '/auth/operator/sessions',
        '/ops/backup-status',
        '/ops/recovery/setup',
        '/ops/recovery/connections',
        '/recovery/exports',
      ].includes(path) ||
      /^\/recovery\/exports\/[0-9TZ.:%a-f-]+\.age$/.test(path) ||
      /^\/provisioning\/attempts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        path,
      )
    );
  }
  if (method === 'POST') {
    return (
      [
        '/auth/operator/session',
        '/auth/operator/signout',
        '/auth/operator/revoke',
        '/ops/recovery/pairings',
        '/recovery/claim',
        '/keys/issue',
        '/provisioning/batches',
        '/provisioning/attempts',
      ].includes(path) ||
      /^\/provisioning\/attempts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(bind|record|disposition)$/i.test(
        path,
      )
    );
  }
  if (method === 'DELETE')
    return /^\/ops\/recovery\/connections\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      path,
    );
  return false;
}
