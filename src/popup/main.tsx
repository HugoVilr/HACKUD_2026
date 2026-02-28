import App from "./App.tsx";

const root = document.getElementById("app");
if (root) {
  root.innerHTML = App();
}
