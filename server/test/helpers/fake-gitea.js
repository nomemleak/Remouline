// A minimal in-memory Gitea, implementing only the API calls Remouline makes.
import http from 'node:http';

export async function startFakeGitea() {
  const users = new Map();   // login -> { password, prohibit, email }
  const repos = new Map();   // login -> [{ name, updated_at }]
  const deleted = [];        // logins deleted through the admin API

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : {};
    const url = new URL(req.url, 'http://fake');
    const send = (code, obj = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    let m;
    if (url.pathname === '/api/v1/user') {
      const [login, password] = Buffer.from((req.headers.authorization ?? '').replace('Basic ', ''), 'base64').toString().split(':');
      const key = [...users.keys()].find((k) => k.toLowerCase() === login?.toLowerCase());
      const user = users.get(key);
      if (!user || user.password !== password) return send(401, { message: 'unauthorized' });
      if (user.prohibit) return send(403, { message: 'prohibited' });
      return send(200, { login: key });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/admin/users') {
      if (users.has(data.username)) return send(422, { message: 'user already exists' });
      users.set(data.username, { password: data.password, prohibit: false, email: data.email });
      return send(201, { login: data.username });
    }
    if ((m = /^\/api\/v1\/admin\/users\/([^/]+)$/.exec(url.pathname))) {
      const login = decodeURIComponent(m[1]);
      const user = users.get(login);
      if (req.method === 'DELETE') {
        deleted.push(login);
        users.delete(login);
        repos.delete(login);
        return send(204);
      }
      if (!user) return send(404, { message: 'not found' });
      if (data.password) user.password = data.password;
      if (typeof data.prohibit_login === 'boolean') user.prohibit = data.prohibit_login;
      return send(200);
    }
    if ((m = /^\/api\/v1\/users\/([^/]+)\/repos$/.exec(url.pathname))) {
      return send(200, url.searchParams.get('page') === '1' ? repos.get(decodeURIComponent(m[1])) ?? [] : []);
    }
    if ((m = /^\/api\/v1\/users\/([^/]+)$/.exec(url.pathname))) {
      return users.has(decodeURIComponent(m[1])) ? send(200, { prohibit_login: false, created: 'x' }) : send(404);
    }
    if ((m = /^\/api\/v1\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname)) && req.method === 'DELETE') {
      const owner = decodeURIComponent(m[1]);
      repos.set(owner, (repos.get(owner) ?? []).filter((r) => r.name !== decodeURIComponent(m[2])));
      return send(204);
    }
    return send(404, { message: `fake gitea: ${req.method} ${url.pathname}` });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, users, repos, deleted, close: () => server.close() };
}

export async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
