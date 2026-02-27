type PopupRoute = "NO_VAULT" | "LOCKED" | "UNLOCKED";

interface PopupState {
  route: PopupRoute;
}

const state: PopupState = {
  route: "NO_VAULT"
};

const root = document.getElementById("app");
if (!root) {
  throw new Error("Popup root not found");
}

const routeLabels: Record<PopupRoute, string> = {
  NO_VAULT: "No hay vault",
  LOCKED: "Vault bloqueado",
  UNLOCKED: "Vault desbloqueado"
};

const routeBody = (route: PopupRoute): string => {
  switch (route) {
    case "NO_VAULT":
      return `
        <h1>Crear Vault</h1>
        <p class="muted">Todavia no existe un vault. En el siguiente paso conectamos el formulario real.</p>
        <button class="primary" type="button">Crear vault</button>
      `;
    case "LOCKED":
      return `
        <h1>Desbloquear</h1>
        <p class="muted">El vault existe pero esta bloqueado.</p>
        <button class="primary" type="button">Desbloquear</button>
      `;
    case "UNLOCKED":
      return `
        <h1>Entradas</h1>
        <p class="muted">Vault abierto. En los siguientes pasos van lista, buscador y CRUD.</p>
        <button class="primary" type="button">Ver entradas</button>
      `;
    default:
      return "";
  }
};

const isPopupRoute = (value: string): value is PopupRoute => {
  return value === "NO_VAULT" || value === "LOCKED" || value === "UNLOCKED";
};

const render = (): void => {
  root.innerHTML = `
    <main class="popup">
      <header class="row">
        <span class="chip">${routeLabels[state.route]}</span>
      </header>

      <section class="card">
        ${routeBody(state.route)}
      </section>

      <footer class="router">
        <span class="router-label">Demo routing</span>
        <div class="router-actions">
          <button type="button" data-route="NO_VAULT">NO_VAULT</button>
          <button type="button" data-route="LOCKED">LOCKED</button>
          <button type="button" data-route="UNLOCKED">UNLOCKED</button>
        </div>
      </footer>
    </main>
  `;
};

root.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const routeButton = target.closest<HTMLButtonElement>("[data-route]");
  const nextRoute = routeButton?.dataset.route;
  if (!nextRoute || !isPopupRoute(nextRoute)) {
    return;
  }

  state.route = nextRoute;
  render();
});

render();
