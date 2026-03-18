import {
  AGENT_VERTEX_SHADER,
  FULLSCREEN_VERTEX_SHADER,
  createShaderSources,
} from "../gl/shader-factory.js";

const AGENT_TEX_SIZE = 512;
const NUM_AGENTS = AGENT_TEX_SIZE * AGENT_TEX_SIZE;
const MAX_TRAIL_DIM = 1920;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    console.error(source.split("\n").map((line, index) => `${index + 1}: ${line}`).join("\n"));
    throw new Error("Shader compile failed");
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

function getUniforms(gl, program, ...names) {
  const uniforms = {};
  for (const name of names) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return uniforms;
}

function createTexture(gl, width, height, internalFormat, format, type, data, filter) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return texture;
}

function createFramebuffer(gl, texture) {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Framebuffer incomplete");
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return framebuffer;
}

function createStateFramebuffer(gl, stateTexture, traitTexture) {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTexture, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, traitTexture, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("State framebuffer incomplete");
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return framebuffer;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function generateFoodData(preset) {
  const size = preset.food.textureSize;
  const data = new Float32Array(size * size * 4);
  const spots = [];

  for (let index = 0; index < preset.food.spots; index += 1) {
    spots.push({
      x: Math.random(),
      y: Math.random(),
      radius: (preset.food.minRadius + Math.random() * (preset.food.maxRadius - preset.food.minRadius)) / size,
      amount: 0.30 + Math.random() * preset.food.amplitude,
      type: Math.random(),
    });
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const uvx = x / (size - 1);
      const uvy = y / (size - 1);
      let amount = preset.food.floor;
      let weightedType = amount * (0.5 + 0.5 * Math.sin((uvx + uvy) * Math.PI * 2.0));

      for (const spot of spots) {
        const dx = uvx - spot.x;
        const dy = uvy - spot.y;
        const falloff = Math.exp(-(dx * dx + dy * dy) / (2 * spot.radius * spot.radius));
        const contribution = spot.amount * falloff;
        amount += contribution;
        weightedType += contribution * spot.type;
      }

      amount = clamp(amount, 0, 1.2);
      const typeValue = amount > 0.0001 ? clamp(weightedType / amount, 0, 1) : 0.5;
      const offset = (y * size + x) * 4;
      data[offset] = amount;
      data[offset + 1] = typeValue;
      data[offset + 2] = 0;
      data[offset + 3] = 1;
    }
  }

  return { size, data, spots };
}

export class PhysarumSimulation {
  constructor({ canvas, presets, initialPresetIndex, onPresetChange, onStatsChange, onThemeChange }) {
    this.canvas = canvas;
    this.presets = presets;
    this.presetIndex = initialPresetIndex;
    this.onPresetChange = onPresetChange;
    this.onStatsChange = onStatsChange;
    this.onThemeChange = onThemeChange;

    this.gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!this.gl) {
      throw new Error("WebGL2 is not available");
    }
    if (!this.gl.getExtension("EXT_color_buffer_float")) {
      throw new Error("EXT_color_buffer_float is not supported");
    }
    this.gl.getExtension("OES_texture_float_linear");

    this.emptyVAO = this.gl.createVertexArray();
    this.mouse = { x: 0, y: 0, active: false };

    this.stateTextures = [null, null];
    this.traitTextures = [null, null];
    this.stateFramebuffers = [null, null];
    this.trailTextures = [null, null];
    this.trailFramebuffers = [null, null];
    this.foodTexture = null;

    this.pingAgent = 0;
    this.pingTrail = 0;
    this.totalSteps = 0;
    this.substeps = 6;
    this.turbo = false;
    this.startTime = performance.now();

    this.buildPrograms();
    this.resize();
    this.reset();
  }

  get preset() {
    return this.presets[this.presetIndex];
  }

  computeSize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(1, MAX_TRAIL_DIM / Math.max(width * dpr, height * dpr));
    this.trailWidth = Math.floor(width * dpr * scale);
    this.trailHeight = Math.floor(height * dpr * scale);
    this.canvas.width = this.trailWidth;
    this.canvas.height = this.trailHeight;
  }

  buildPrograms() {
    const gl = this.gl;
    const sources = createShaderSources(this.preset);

    for (const program of [this.stepProgram, this.depositProgram, this.diffuseProgram, this.displayProgram, this.agentRenderProgram]) {
      if (program) {
        gl.deleteProgram(program);
      }
    }

    this.stepProgram = createProgram(gl, FULLSCREEN_VERTEX_SHADER, sources.stepFragmentShader);
    this.depositProgram = createProgram(gl, AGENT_VERTEX_SHADER, sources.depositFragmentShader);
    this.diffuseProgram = createProgram(gl, FULLSCREEN_VERTEX_SHADER, sources.diffuseFragmentShader);
    this.displayProgram = createProgram(gl, FULLSCREEN_VERTEX_SHADER, sources.displayFragmentShader);
    this.agentRenderProgram = this.preset.pointSize > 0
      ? createProgram(gl, AGENT_VERTEX_SHADER, sources.agentRenderFragmentShader)
      : null;

    this.stepUniforms = getUniforms(gl, this.stepProgram, "uState", "uTraits", "uTrail", "uFood", "uTrailRes", "uFrame");
    this.depositUniforms = getUniforms(gl, this.depositProgram, "uState", "uTraits", "uTrailRes", "uAgentTexSize", "uPointSize");
    this.diffuseUniforms = getUniforms(gl, this.diffuseProgram, "uTrail", "uPixelSize", "uDecay", "uMouse");
    this.displayUniforms = getUniforms(gl, this.displayProgram, "uTrail", "uFood", "uResolution", "uTime");
    this.agentRenderUniforms = this.agentRenderProgram
      ? getUniforms(gl, this.agentRenderProgram, "uState", "uTraits", "uTrailRes", "uAgentTexSize", "uPointSize")
      : null;
  }

  initAgentData() {
    const stateData = new Float32Array(NUM_AGENTS * 4);
    const traitData = new Float32Array(NUM_AGENTS * 4);
    const centerX = this.trailWidth * 0.5;
    const centerY = this.trailHeight * 0.5;
    const radius = Math.min(this.trailWidth, this.trailHeight) * this.preset.seedRadius;
    const spots = this.foodSpots || [];

    for (let index = 0; index < NUM_AGENTS; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      let x = centerX;
      let y = centerY;

      if (spots.length > 0) {
        const spot = spots[Math.floor(Math.random() * spots.length)];
        const spotAngle = Math.random() * Math.PI * 2;
        const spotDistance = Math.sqrt(Math.random()) * spot.radius * Math.min(this.trailWidth, this.trailHeight) * 0.55;
        x = spot.x * this.trailWidth + Math.cos(spotAngle) * spotDistance;
        y = spot.y * this.trailHeight + Math.sin(spotAngle) * spotDistance;
      } else {
        const distance = 12 + Math.sqrt(Math.random()) * radius;
        x = centerX + Math.cos(angle) * distance;
        y = centerY + Math.sin(angle) * distance;
      }

      const stateOffset = index * 4;
      stateData[stateOffset] = clamp(x, 0, this.trailWidth - 1);
      stateData[stateOffset + 1] = clamp(y, 0, this.trailHeight - 1);
      stateData[stateOffset + 2] = Math.random() * Math.PI * 2;
      stateData[stateOffset + 3] = 0.55 + Math.random() * 0.45;

      traitData[stateOffset] = Math.random();
      traitData[stateOffset + 1] = Math.random();
      traitData[stateOffset + 2] = Math.random();
      traitData[stateOffset + 3] = Math.random();
    }

    return { stateData, traitData };
  }

  buildResources() {
    const gl = this.gl;

    for (let index = 0; index < 2; index += 1) {
      if (this.stateTextures[index]) gl.deleteTexture(this.stateTextures[index]);
      if (this.traitTextures[index]) gl.deleteTexture(this.traitTextures[index]);
      if (this.stateFramebuffers[index]) gl.deleteFramebuffer(this.stateFramebuffers[index]);
      if (this.trailTextures[index]) gl.deleteTexture(this.trailTextures[index]);
      if (this.trailFramebuffers[index]) gl.deleteFramebuffer(this.trailFramebuffers[index]);
    }

    if (this.foodTexture) {
      gl.deleteTexture(this.foodTexture);
    }

    const food = generateFoodData(this.preset);
    this.foodSpots = food.spots;
    const { stateData, traitData } = this.initAgentData();

    for (let index = 0; index < 2; index += 1) {
      this.stateTextures[index] = createTexture(gl, AGENT_TEX_SIZE, AGENT_TEX_SIZE, gl.RGBA32F, gl.RGBA, gl.FLOAT, index === 0 ? stateData : null, gl.NEAREST);
      this.traitTextures[index] = createTexture(gl, AGENT_TEX_SIZE, AGENT_TEX_SIZE, gl.RGBA32F, gl.RGBA, gl.FLOAT, index === 0 ? traitData : null, gl.NEAREST);
      this.stateFramebuffers[index] = createStateFramebuffer(gl, this.stateTextures[index], this.traitTextures[index]);
    }

    for (let index = 0; index < 2; index += 1) {
      this.trailTextures[index] = createTexture(gl, this.trailWidth, this.trailHeight, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.LINEAR);
      this.trailFramebuffers[index] = createFramebuffer(gl, this.trailTextures[index]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[index]);
      gl.viewport(0, 0, this.trailWidth, this.trailHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    this.foodSize = food.size;
    this.foodTexture = createTexture(gl, food.size, food.size, gl.RGBA32F, gl.RGBA, gl.FLOAT, food.data, gl.LINEAR);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.pingAgent = 0;
    this.pingTrail = 0;
  }

  setPreset(index) {
    this.presetIndex = index;
    this.substeps = this.turbo ? 64 : 6;
    this.buildPrograms();
    this.computeSize();
    this.buildResources();
    this.totalSteps = 0;
    this.emitState();
  }

  reset() {
    this.buildResources();
    this.totalSteps = 0;
    this.emitState();
  }

  resize() {
    this.computeSize();
  }

  setSpeed(delta) {
    this.turbo = false;
    this.substeps = Math.max(1, Math.min(32, this.substeps + delta));
    this.emitState();
  }

  toggleTurbo() {
    this.turbo = !this.turbo;
    this.substeps = this.turbo ? 64 : 6;
    this.emitState();
  }

  setMousePosition(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * this.trailWidth;
    this.mouse.y = (1 - (clientY - rect.top) / rect.height) * this.trailHeight;
    this.mouse.active = true;
  }

  setMouseActive(active) {
    this.mouse.active = active;
  }

  emitState() {
    if (this.onPresetChange) {
      this.onPresetChange(this.preset);
    }
    if (this.onStatsChange) {
      this.onStatsChange({ speed: this.substeps, generation: this.totalSteps });
    }
    if (this.onThemeChange) {
      this.onThemeChange(this.preset.uiTheme);
    }
  }

  step() {
    const gl = this.gl;
    const readAgent = this.pingAgent;
    const writeAgent = 1 - this.pingAgent;
    const readTrail = this.pingTrail;
    const writeTrail = 1 - this.pingTrail;

    this.totalSteps += 1;

    gl.bindVertexArray(this.emptyVAO);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFramebuffers[writeAgent]);
    gl.viewport(0, 0, AGENT_TEX_SIZE, AGENT_TEX_SIZE);
    gl.disable(gl.BLEND);
    gl.useProgram(this.stepProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTextures[readAgent]);
    gl.uniform1i(this.stepUniforms.uState, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.traitTextures[readAgent]);
    gl.uniform1i(this.stepUniforms.uTraits, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTextures[readTrail]);
    gl.uniform1i(this.stepUniforms.uTrail, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.foodTexture);
    gl.uniform1i(this.stepUniforms.uFood, 3);
    gl.uniform2f(this.stepUniforms.uTrailRes, this.trailWidth, this.trailHeight);
    gl.uniform1f(this.stepUniforms.uFrame, this.totalSteps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[writeTrail]);
    gl.viewport(0, 0, this.trailWidth, this.trailHeight);
    gl.disable(gl.BLEND);
    gl.useProgram(this.diffuseProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTextures[readTrail]);
    gl.uniform1i(this.diffuseUniforms.uTrail, 0);
    gl.uniform2f(this.diffuseUniforms.uPixelSize, 1 / this.trailWidth, 1 / this.trailHeight);
    gl.uniform1f(this.diffuseUniforms.uDecay, this.preset.decay);
    gl.uniform3f(this.diffuseUniforms.uMouse, this.mouse.x, this.mouse.y, this.mouse.active ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.depositProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTextures[writeAgent]);
    gl.uniform1i(this.depositUniforms.uState, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.traitTextures[writeAgent]);
    gl.uniform1i(this.depositUniforms.uTraits, 1);
    gl.uniform2f(this.depositUniforms.uTrailRes, this.trailWidth, this.trailHeight);
    gl.uniform1f(this.depositUniforms.uAgentTexSize, AGENT_TEX_SIZE);
    gl.uniform1f(this.depositUniforms.uPointSize, 1.0);
    gl.drawArrays(gl.POINTS, 0, NUM_AGENTS);
    gl.disable(gl.BLEND);

    this.pingAgent = writeAgent;
    this.pingTrail = writeTrail;
  }

  render(now) {
    const gl = this.gl;
    const elapsed = (now - this.startTime) * 0.001;

    for (let index = 0; index < this.substeps; index += 1) {
      this.step();
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.trailWidth, this.trailHeight);
    gl.useProgram(this.displayProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTextures[this.pingTrail]);
    gl.uniform1i(this.displayUniforms.uTrail, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.foodTexture);
    gl.uniform1i(this.displayUniforms.uFood, 1);
    gl.uniform2f(this.displayUniforms.uResolution, this.trailWidth, this.trailHeight);
    gl.uniform1f(this.displayUniforms.uTime, elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (this.agentRenderProgram) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.agentRenderProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.stateTextures[this.pingAgent]);
      gl.uniform1i(this.agentRenderUniforms.uState, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.traitTextures[this.pingAgent]);
      gl.uniform1i(this.agentRenderUniforms.uTraits, 1);
      gl.uniform2f(this.agentRenderUniforms.uTrailRes, this.trailWidth, this.trailHeight);
      gl.uniform1f(this.agentRenderUniforms.uAgentTexSize, AGENT_TEX_SIZE);
      gl.uniform1f(this.agentRenderUniforms.uPointSize, this.preset.pointSize);
      gl.drawArrays(gl.POINTS, 0, NUM_AGENTS);
      gl.disable(gl.BLEND);
    }

    if (this.onStatsChange) {
      this.onStatsChange({ speed: this.substeps, generation: this.totalSteps });
    }
  }
}
