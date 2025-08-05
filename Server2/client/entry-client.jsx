import React from "react";
import { hydrateRoot } from "react-dom/client";
import App from "./components/App.jsx";
import "./base.css";

hydrateRoot(document.getElementById("root"), <App />);
