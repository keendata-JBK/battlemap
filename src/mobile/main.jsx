import React from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "../auth/AuthProvider.jsx";
import { MobileSalesAgent } from "./MobileSalesAgent.jsx";
import "./mobile.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider><MobileSalesAgent /></AuthProvider>
  </React.StrictMode>,
);
