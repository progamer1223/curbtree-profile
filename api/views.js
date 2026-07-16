// /api/views.js
//
// Small serverless proxy in front of Vercel's Web Analytics API.
//
// Why this exists: Vercel's Web Analytics "count" endpoint
// (https://api.vercel.com/v1/query/web-analytics/visits/count) requires a
// personal/team access token in an Authorization header. That token can
// never be shipped to the browser — anyone viewing page source could steal
// it and use it against your whole Vercel account. So this route holds the
// token as a server-side environment variable and just forwards back the
// one number (pageviews) the front-end actually needs.
//
// ── ONE-TIME SETUP (in your Vercel project) ─────────────────────────────
// 1. Create an access token: https://vercel.com/account/tokens
//    (scope it to this project if you can, and treat it like a password).
// 2. In your Vercel project → Settings → Environment Variables, add:
//      VERCEL_TOKEN       = the token from step 1
//      VERCEL_PROJECT_ID  = this project's ID (Settings → General → Project ID)
//      VERCEL_TEAM_ID     = your team ID (ONLY if this project lives under a
//                           team, not a personal account — omit otherwise)
// 3. Make sure Web Analytics is enabled for the project (Analytics tab in
//    the dashboard) — it already looks enabled since /_vercel/insights is
//    wired up in curbtree.html.
// 4. Redeploy after adding the env vars (Vercel only picks them up on a
//    fresh deployment).
//
// The front-end calls GET /api/views?path=/some-page and gets back
// { pageviews: 1234, visitors: 980 }.

export default async function handler(req, res) {
  try {
    const token = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;
    const teamId = process.env.VERCEL_TEAM_ID; // optional — only for team-owned projects

    if (!token || !projectId) {
      res.status(500).json({
        error: 'Missing VERCEL_TOKEN or VERCEL_PROJECT_ID environment variable. See the setup comment at the top of api/views.js.'
      });
      return;
    }

    const path = (req.query && req.query.path) || '/';

    const params = new URLSearchParams({
      projectId,
      filter: `requestPath eq '${path}'`
    });
    if (teamId) params.set('teamId', teamId);

    const apiUrl = `https://api.vercel.com/v1/query/web-analytics/visits/count?${params.toString()}`;

    const upstream = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(upstream.status).json({ error: `Vercel API error: ${text}` });
      return;
    }

    const json = await upstream.json();

    // Cache for 5 minutes at the edge/CDN so we're not hammering the Vercel
    // API (and eating rate limits) on every single page load.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    res.status(200).json({
      pageviews: (json.data && json.data.pageviews) || 0,
      visitors: (json.data && json.data.visitors) || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
}
