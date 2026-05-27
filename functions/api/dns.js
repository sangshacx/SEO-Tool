export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const domain = url.searchParams.get('domain');
  if (!domain) return new Response(JSON.stringify({ error: 'missing domain' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  try {
    const [aResp, nsResp, mxResp, txtResp] = await Promise.all([
      fetch(`https://dns.google/resolve?name=${domain}&type=A`),
      fetch(`https://dns.google/resolve?name=${domain}&type=NS`),
      fetch(`https://dns.google/resolve?name=${domain}&type=MX`),
      fetch(`https://dns.google/resolve?name=${domain}&type=TXT`)
    ]);
    const [a, ns, mx, txt] = await Promise.all([aResp.json(), nsResp.json(), mxResp.json(), txtResp.json()]);
    return new Response(JSON.stringify({ a, ns, mx, txt }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
