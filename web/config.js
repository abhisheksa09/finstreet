// Deployed: the Worker serves this app and the API from the same origin, so apiBase is "".
// Local dev: the app is served separately (python -m http.server 5173) and the API by
// `npm run dev` in worker/ — set the port to the one wrangler prints ("Ready on …").
const isLocalStaticServer = location.port === "5173";

window.APP_CONFIG = {
  apiBase: isLocalStaticServer ? "http://127.0.0.1:8788" : "",
  contactEmail: "you@example.com",
};
