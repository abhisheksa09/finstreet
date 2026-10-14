// Where the app finds the API:
//   finstreet.pages.dev (production) → the finstreet Worker
//   *.workers.dev (Worker serving the app itself) → same origin
//   local static server on :5173 → local `npm run dev` in worker/ (use the port wrangler prints)
const WORKER_API = "https://finstreet.nse-scanner.workers.dev";
const host = location.hostname;

window.APP_CONFIG = {
  apiBase: location.port === "5173" ? "http://127.0.0.1:8788"
         : host.endsWith(".workers.dev") ? ""
         : WORKER_API,
  contactEmail: "abhisheksa.09@gmail.com",
  contactWhatsApp: "31622223698", // international format, digits only (for wa.me links)
};
