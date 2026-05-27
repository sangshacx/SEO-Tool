export async function onRequestPost(context) {
  const { request, params } = context;

  const login = request.headers.get('login');
  const password = request.headers.get('password');

  if (!login || !password) {
    return new Response(JSON.stringify({ error: '缺少 API 登录信息' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiPath = params.path ? params.path.join('/') : '';
  const url = `https://api.dataforseo.com/v3/${apiPath}`;
  const auth = btoa(`${login}:${password}`);
  const body = await request.text();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
