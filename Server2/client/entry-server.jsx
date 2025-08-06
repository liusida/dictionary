// import React from "react";
import App from "./components/App.jsx";
import { renderToString } from "react-dom/server";
import "./base.css";

export function render() {
  return { html: renderToString(<App />) };
}
