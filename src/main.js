import { DEFAULT_PRESET_INDEX, PRESETS } from "./config/presets.js";
import { PhysarumSimulation } from "./sim/simulation.js";

const canvas = document.getElementById("c");
const presetName = document.getElementById("preset-name");
const speed = document.getElementById("speed");
const generation = document.getElementById("gen");

function showError(message) {
  document.body.innerHTML = `<div class="error-msg">${message}</div>`;
}

let simulation;

try {
  simulation = new PhysarumSimulation({
    canvas,
    presets: PRESETS,
    initialPresetIndex: DEFAULT_PRESET_INDEX,
    onPresetChange(preset) {
      presetName.textContent = preset.name;
    },
    onStatsChange(stats) {
      speed.textContent = String(stats.speed);
      generation.textContent = String(stats.generation);
    },
    onThemeChange(theme) {
      const color = theme === "light" ? "rgba(27, 21, 18, 0.38)" : "rgba(255, 255, 255, 0.20)";
      const title = theme === "light" ? "rgba(20, 16, 14, 0.50)" : "rgba(255, 255, 255, 0.28)";
      const gen = theme === "light" ? "rgba(32, 22, 16, 0.48)" : "rgba(255, 255, 255, 0.33)";
      document.documentElement.style.setProperty("--ui-color", color);
      document.documentElement.style.setProperty("--ui-title", title);
      document.documentElement.style.setProperty("--ui-gen", gen);
      document.querySelector(".ui").style.color = color;
      document.querySelector(".title").style.color = title;
      document.querySelector(".gen").style.color = gen;
    },
  });
} catch (error) {
  showError(error.message.includes("EXT_color_buffer_float")
    ? "Float framebuffers are not supported in this browser.<br>Try a recent desktop Chrome or Firefox."
    : "WebGL2 is not available.<br>Please use a modern browser.");
  throw error;
}

function frame(now) {
  simulation.render(now);
  requestAnimationFrame(frame);
}

function handlePointerMove(event) {
  if (event.shiftKey && event.buttons === 1) {
    simulation.pan(event.movementX, event.movementY);
  } else {
    simulation.setMousePosition(event.clientX, event.clientY);
  }
}

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  simulation.zoom(event.deltaY, event.clientX, event.clientY);
}, { passive: false });

canvas.addEventListener("mousemove", handlePointerMove);
canvas.addEventListener("mouseenter", handlePointerMove);
canvas.addEventListener("mouseleave", () => simulation.setMouseActive(false));
canvas.addEventListener("touchmove", (event) => {
  event.preventDefault();
  const touch = event.touches[0];
  simulation.setMousePosition(touch.clientX, touch.clientY);
}, { passive: false });
canvas.addEventListener("touchstart", (event) => {
  event.preventDefault();
  const touch = event.touches[0];
  simulation.setMousePosition(touch.clientX, touch.clientY);
}, { passive: false });
canvas.addEventListener("touchend", () => simulation.setMouseActive(false));

window.addEventListener("keydown", (event) => {
  if (event.key >= "1" && event.key <= String(PRESETS.length)) {
    simulation.setPreset(Number.parseInt(event.key, 10) - 1);
    return;
  }

  switch (event.key) {
    case "ArrowUp":
    case "+":
    case "=":
      simulation.setSpeed(1);
      break;
    case "ArrowDown":
    case "-":
    case "_":
      simulation.setSpeed(-1);
      break;
    case " ":
      event.preventDefault();
      simulation.toggleTurbo();
      break;
    case "r":
    case "R":
      simulation.reset();
      break;
    case "0":
      simulation.resetView();
      break;
  }
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    simulation.resize();
    simulation.reset();
  }, 250);
});

requestAnimationFrame(frame);
