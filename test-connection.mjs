// Password gate for the whole site — runs at the edge BEFORE any page or
// function, so it protects the dashboard AND the /api/* data endpoints.
// Accepts either access code. Codes live here server-side (never sent to the
// browser). A successful code sets a 30-day cookie so you're not re-prompted.
//
// To change/add codes, edit CODES and re-upload this file.
// (Add more in the array to allow several, e.g. ["141530", "353535"].)
const CODES = ["141530"];
const COOKIE = "tsg_gate";

export default async (request, context) => {
  const url = new URL(request.url);

  // Handle the login form submission.
  if (url.pathname === "/__login" && request.method === "POST") {
    let code = "";
    try {
      const form = await request.formData();
      code = (form.get("code") || "").toString().trim();
    } catch {}
    if (CODES.includes(code)) {
      return new Response("", {
        status: 302,
        headers: {
          "set-cookie": `${COOKIE}=1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
          location: "/",
          "cache-control": "no-store",
        },
      });
    }
    return loginPage("That code didn't match. Try again.");
  }

  // Already authenticated? Let the request continue normally.
  const cookie = request.headers.get("cookie") || "";
  const ok = cookie.split(";").some((c) => c.trim() === `${COOKIE}=1`);
  if (ok) return context.next();

  // Otherwise show the login screen.
  return loginPage();
};

function loginPage(error = "") {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Todd's Sporting Goods — Revenue</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#0d0d0d; color:#fff; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .card { background:#1a1a19; border:1px solid rgba(255,255,255,0.10); border-radius:16px;
    padding:32px 28px; width:320px; text-align:center; box-shadow:0 8px 30px rgba(0,0,0,.4); }
  h1 { font-size:17px; margin:0 0 4px; }
  p.sub { color:#898781; font-size:13px; margin:0 0 20px; }
  input { width:100%; padding:12px 14px; font-size:18px; text-align:center; letter-spacing:4px;
    border-radius:10px; border:1px solid rgba(255,255,255,0.15); background:#0d0d0d; color:#fff;
    font-family:inherit; }
  input:focus { outline:none; border-color:#3987e5; }
  button { width:100%; margin-top:14px; padding:12px; font-size:15px; font-weight:600;
    border:0; border-radius:10px; background:#3987e5; color:#fff; cursor:pointer; }
  .err { color:#e66767; font-size:13px; margin-top:14px; min-height:16px; }
</style></head>
<body>
  <form class="card" method="POST" action="/__login" autocomplete="off">
    <h1>Todd's Sporting Goods</h1>
    <p class="sub">Enter access code to view revenue</p>
    <input name="code" type="password" inputmode="numeric" pattern="[0-9]*"
           placeholder="••••••" autofocus aria-label="Access code" />
    <button type="submit">Enter</button>
    <div class="err">${error}</div>
  </form>
</body></html>`;
  return new Response(html, {
    status: error ? 401 : 401,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
