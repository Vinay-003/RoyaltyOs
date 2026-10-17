import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import { AppProvider } from "./lib/context.tsx";
import "./theme.css";

const rootElement = document.getElementById("app");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </React.StrictMode>
  );
}
