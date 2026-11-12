import http from "node:http";

const targetPort = Number(process.env.POSTGREST_PORT || 54322);
const listenPort = Number(process.env.PROXY_PORT || 54321);

const server = http.createServer((request, response) => {
  const original = request.url || "/";
  const path = original.startsWith("/rest/v1") ? original.slice("/rest/v1".length) || "/" : original;
  const headers = { ...request.headers, host: `127.0.0.1:${targetPort}` };
  const upstream = http.request(
    { hostname: "127.0.0.1", port: targetPort, path, method: request.method, headers },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 500, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", (error) => {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: error.message }));
  });
  request.pipe(upstream);
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`REST proxy on http://127.0.0.1:${listenPort}/rest/v1 -> PostgREST :${targetPort}`);
});
