import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const App = (): React.ReactElement => (
  <main className="shell">
    <section className="masthead">
      <p className="eyebrow">Stage 1 Foundation</p>
      <h1>Nepal Football Simulation</h1>
      <p>
        Desktop shell is intentionally thin. Simulation, database access, football rules, and import
        validation live in workspace packages and can run headlessly.
      </p>
    </section>
    <section className="status-grid" aria-label="Foundation boundaries">
      <article>
        <h2>Local Saves</h2>
        <p>SQLite save architecture with schema migrations and metadata.</p>
      </article>
      <article>
        <h2>Headless World</h2>
        <p>Day-by-day simulation services run without React or Tauri.</p>
      </article>
      <article>
        <h2>Nepal-first Data</h2>
        <p>Import pipeline is ready for researched records with provenance.</p>
      </article>
    </section>
  </main>
);

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
