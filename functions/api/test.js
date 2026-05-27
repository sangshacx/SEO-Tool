export async function onRequestGet(context) {
  const { request } = context;

  const login = request.headers.get('login');
  const password = request.headers.get('password');

  if (!login || !password) {
    return new Response(JSON.stringify({ error: '缺少登录信息' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = btoa(`${login}:${password}`);

  try {
    const response = await fetch('https://api.dataforseo.com/v3/appendix/user_data', {
      headers: { 'Authorization': `Basic ${auth}` },
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
