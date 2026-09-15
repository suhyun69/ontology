import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import "@blueprintjs/datetime/lib/css/blueprint-datetime.css";
import "./app.css";

import { App } from "./App.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("No #root element in index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
