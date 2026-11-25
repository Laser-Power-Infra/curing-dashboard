// Read-only access to Google Sheets with a signed-in Google account's token (no SDK: two HTTPS calls).
// GOOGLE_TOKEN_JSON in .env holds the contents of the token.json that Google's OAuth quickstarts write:
// { client_id, client_secret, refresh_token, … }.
// The account only needs to be a Viewer on the sheet; the token needs the spreadsheets.readonly scope.
let access: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (access && access.expires > Date.now() + 60_000) return access.token;
  let t: { client_id?: string; client_secret?: string; refresh_token?: string };
  try {
    t = JSON.parse(process.env.GOOGLE_TOKEN_JSON ?? "");
  } catch {
    throw new Error("GOOGLE_TOKEN_JSON is missing from .env or is not JSON. It holds the contents of token.json.");
  }
  if (!t.client_id || !t.client_secret || !t.refresh_token) throw new Error("GOOGLE_TOKEN_JSON needs client_id, client_secret and refresh_token.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: t.client_id, client_secret: t.client_secret, refresh_token: t.refresh_token, grant_type: "refresh_token" }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google sign-in failed: ${j.error_description ?? j.error ?? res.status}. The token may be revoked – create it again and update GOOGLE_TOKEN_JSON.`);
  access = { token: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return access.token;
}

/** Every cell of one tab as the text the sheet shows (dates and times formatted as on screen). */
export async function readTab(spreadsheetId: string, tab: string): Promise<string[][]> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${tab}'`)}`, {
    headers: { authorization: `Bearer ${await accessToken()}` },
  });
  const j = (await res.json()) as { values?: unknown[][]; error?: { message?: string } };
  if (!res.ok) throw new Error(`Could not read the "${tab}" tab: ${j.error?.message ?? res.status}. Is the account a Viewer on the sheet, and does the token have the Sheets scope?`);
  return (j.values ?? []).map((r) => r.map((c) => String(c ?? "")));
}
