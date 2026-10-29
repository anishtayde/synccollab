import type { Awareness } from "y-protocols/awareness";

export const COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#008080", "#9a6324"];

// y-monaco gives each remote user CSS classes ending in their client id.
// We generate a style rule per user so each cursor has a color and name label.
export function watchCursorStyles(awareness: Awareness) {
  const style = document.createElement("style");
  document.head.appendChild(style);

  const render = () => {
    let css = "";
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.clientID || !state.user) return;
      const { name, color } = state.user as { name: string; color: string };
      css += `
        .yRemoteSelection-${clientId} { background-color: ${color}44; }
        .yRemoteSelectionHead-${clientId} {
          position: relative;
          border-left: 2px solid ${color};
        }
        .yRemoteSelectionHead-${clientId}::after {
          content: ${JSON.stringify(name)};
          position: absolute;
          top: -1.4em;
          left: -2px;
          background: ${color};
          color: white;
          font-size: 11px;
          padding: 0 4px;
          border-radius: 3px;
          white-space: nowrap;
        }
      `;
    });
    style.textContent = css;
  };

  awareness.on("change", render);
  render();

  return () => {
    awareness.off("change", render);
    style.remove();
  };
}