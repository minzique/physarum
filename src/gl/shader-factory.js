function f(value, digits = 4) {
  return Number(value).toFixed(digits);
}

function vec3(color) {
  return color.map((value) => f(value, 2)).join(",");
}

const HASH_GLSL = `
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash21b(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.3183);
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.x + p3.y) * p3.z);
}
`;

function spectrumGLSL(palette) {
  return `
vec3 spectrum(float g) {
  vec3 c0 = vec3(${vec3(palette[0])});
  vec3 c1 = vec3(${vec3(palette[1])});
  vec3 c2 = vec3(${vec3(palette[2])});
  vec3 c3 = vec3(${vec3(palette[3])});
  vec3 c4 = vec3(${vec3(palette[4])});
  g = clamp(g, 0.0, 1.0);
  if (g < 0.25) return mix(c0, c1, g * 4.0);
  if (g < 0.50) return mix(c1, c2, (g - 0.25) * 4.0);
  if (g < 0.75) return mix(c2, c3, (g - 0.50) * 4.0);
  return mix(c3, c4, (g - 0.75) * 4.0);
}
`;
}

export const FULLSCREEN_VERTEX_SHADER = `#version 300 es
void main() {
  vec2 vertices[3];
  vertices[0] = vec2(-1.0, -1.0);
  vertices[1] = vec2( 3.0, -1.0);
  vertices[2] = vec2(-1.0,  3.0);
  gl_Position = vec4(vertices[gl_VertexID], 0.0, 1.0);
}
`;

export const AGENT_VERTEX_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uAgents;
uniform vec2 uTrailRes;
uniform float uAgentTexSize;
uniform float uPointSize;

flat out float vGenome;

void main() {
  int id = gl_VertexID;
  int width = int(uAgentTexSize);
  vec4 agent = texelFetch(uAgents, ivec2(id % width, id / width), 0);
  gl_Position = vec4((agent.xy / uTrailRes) * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = uPointSize;
  vGenome = agent.w;
}
`;

export function createShaderSources(preset) {
  const sensorAngle0 = f(preset.phenotype.sensorAngle[0]);
  const sensorAngle1 = f(preset.phenotype.sensorAngle[1]);
  const sensorDistance0 = f(preset.phenotype.sensorDistance[0]);
  const sensorDistance1 = f(preset.phenotype.sensorDistance[1]);
  const turnSpeed0 = f(preset.phenotype.turnSpeed[0]);
  const turnSpeed1 = f(preset.phenotype.turnSpeed[1]);
  const stepSize0 = f(preset.phenotype.stepSize[0]);
  const stepSize1 = f(preset.phenotype.stepSize[1]);

  const stepFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uAgents;
uniform sampler2D uTrail;
uniform vec2 uTrailRes;
uniform float uFrame;

out vec4 outAgent;

const float KIN = ${f(preset.kin)};
const float MUT_MAX = ${f(preset.mutMax, 6)};
const float MUT_MIN = ${f(preset.mutMin, 6)};
const float DRIFT = ${f(preset.drift, 6)};
const float SPLIT = ${f(preset.splitStrength, 6)};
const float RARITY_BOOST = ${f(preset.rarityBoost)};
const float NICHE_SCALE = ${f(preset.nicheScale)};
const float CROWD_START = ${f(preset.crowdingStart)};
const float CROWD_END = ${f(preset.crowdingEnd)};

${HASH_GLSL}

float senseKin(vec2 samplePos, float myGenome) {
  vec2 trail = texture(uTrail, samplePos / uTrailRes).rg;
  float intensity = trail.r;
  if (intensity < 0.0005) {
    return 0.0;
  }
  float avgGenome = clamp(trail.g / intensity, 0.0, 1.0);
  float kinAffinity = max(1.0 - abs(avgGenome - myGenome) * KIN, -0.35);
  float nicheWave = 0.75 + 0.25 * cos((avgGenome - myGenome) * 6.28318 * NICHE_SCALE);
  return intensity * kinAffinity * nicheWave;
}

void main() {
  vec4 agent = texelFetch(uAgents, ivec2(gl_FragCoord.xy), 0);
  vec2 pos = agent.xy;
  float angle = agent.z;
  float genome = agent.w;

  float sensorAngle = mix(${sensorAngle0}, ${sensorAngle1}, genome);
  float sensorDistance = mix(${sensorDistance0}, ${sensorDistance1}, genome);
  float turnSpeed = mix(${turnSpeed0}, ${turnSpeed1}, genome);
  float stepSize = mix(${stepSize0}, ${stepSize1}, genome);

  vec2 dirForward = vec2(cos(angle), sin(angle));
  vec2 dirLeft = vec2(cos(angle + sensorAngle), sin(angle + sensorAngle));
  vec2 dirRight = vec2(cos(angle - sensorAngle), sin(angle - sensorAngle));

  float senseForward = senseKin(pos + dirForward * sensorDistance, genome);
  float senseLeft = senseKin(pos + dirLeft * sensorDistance, genome);
  float senseRight = senseKin(pos + dirRight * sensorDistance, genome);

  float randomTurn = hash21(gl_FragCoord.xy * 317.7 + fract(uFrame * 0.1731));
  float randomMutation = hash21b(gl_FragCoord.xy * 419.3 + fract(uFrame * 0.2917));

  if (senseForward > senseLeft && senseForward > senseRight) {
    angle += (randomTurn - 0.5) * 0.05;
  } else if (senseForward < senseLeft && senseForward < senseRight) {
    angle += (randomTurn > 0.5 ? turnSpeed : -turnSpeed);
  } else if (senseLeft > senseRight) {
    angle += turnSpeed;
  } else {
    angle -= turnSpeed;
  }

  pos += vec2(cos(angle), sin(angle)) * stepSize;
  pos = mod(pos + uTrailRes, uTrailRes);

  vec2 localTrail = texture(uTrail, pos / uTrailRes).rg;
  float wellbeing = clamp(localTrail.r * 4.0, 0.0, 1.0);
  float overcrowding = smoothstep(CROWD_START, CROWD_END, localTrail.r);
  float mutationStrength = mix(MUT_MAX, MUT_MIN, wellbeing) + MUT_MAX * overcrowding;

  genome += (randomMutation - 0.5) * 2.0 * mutationStrength;

  if (localTrail.r > 0.004) {
    float localAvgGenome = clamp(localTrail.g / localTrail.r, 0.0, 1.0);
    float kinSimilarity = max(0.0, 1.0 - abs(localAvgGenome - genome) * 3.0);
    float rarity = abs(localAvgGenome - genome);
    float branchPush = sign(randomMutation - 0.5) * overcrowding * (0.45 + rarity * RARITY_BOOST) * SPLIT;
    genome += (localAvgGenome - genome) * DRIFT * wellbeing * kinSimilarity;
    genome += branchPush;
  }

  genome = clamp(genome, 0.0, 1.0);
  outAgent = vec4(pos, angle, genome);
}
`;

  const depositFragmentShader = `#version 300 es
precision highp float;

flat in float vGenome;
out vec4 fragColor;

void main() {
  fragColor = vec4(${f(preset.deposit)}, ${f(preset.deposit)} * vGenome, 0.0, 1.0);
}
`;

  const diffuseFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uTrail;
uniform vec2 uPixelSize;
uniform float uDecay;
uniform vec3 uMouse;

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy * uPixelSize;
  vec2 sum = vec2(0.0);

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      sum += texture(uTrail, uv + vec2(float(dx), float(dy)) * uPixelSize).rg;
    }
  }

  vec2 result = (sum / 9.0) * uDecay;
  result = min(result, vec2(${f(preset.trailCap)}));

  if (uMouse.z > 0.5) {
    float distanceToMouse = length(gl_FragCoord.xy - uMouse.xy);
    float deposit = exp(-(distanceToMouse * distanceToMouse) / 3200.0) * ${f(preset.mouseDeposit)};
    float localGenome = result.r > 0.001 ? clamp(result.g / result.r, 0.0, 1.0) : 0.5;
    result += vec2(deposit, deposit * localGenome);
  }

  fragColor = vec4(result, 0.0, 1.0);
}
`;

  const spectrum = spectrumGLSL(preset.palette);
  const displayFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uTrail;
uniform vec2 uResolution;
uniform float uTime;

out vec4 fragColor;

${HASH_GLSL}
${spectrum}

vec3 renderDark(vec2 uv, float intensity, float genome) {
  vec3 hue = spectrum(genome);
  float bright = 1.0 - exp(-intensity * ${f(preset.exposure, 1)});
  vec3 color = hue * bright;
  vec2 pixel = 1.0 / uResolution;
  float bloomIntensity = 0.0;
  float bloomGenome = 0.0;
  for (int i = 0; i < 8; i++) {
    float angle = float(i) * 0.7854;
    vec2 trail = texture(uTrail, uv + vec2(cos(angle), sin(angle)) * pixel * 4.0).rg;
    bloomIntensity += trail.r;
    bloomGenome += trail.g;
  }
  bloomIntensity /= 8.0;
  bloomGenome = bloomIntensity > 0.001 ? bloomGenome / 8.0 / bloomIntensity : 0.5;
  color += spectrum(clamp(bloomGenome, 0.0, 1.0)) * (1.0 - exp(-bloomIntensity * ${f(preset.exposure, 1)})) * 0.15;
  vec2 vignette = uv * (1.0 - uv);
  color *= pow(clamp(vignette.x * vignette.y * 18.0, 0.0, 1.0), 0.35);
  return color;
}

vec3 renderDish(vec2 uv, float intensity, float genome) {
  vec3 agar = vec3(0.985, 0.970, 0.915);
  vec3 colony = spectrum(genome);
  float amount = 1.0 - exp(-intensity * ${f(preset.exposure, 1)});
  vec3 color = agar * (1.0 - amount * 0.70) + colony * amount * 0.90;
  color += colony * pow(amount, 1.6) * 0.18;
  vec2 center = (uv - 0.5) * 2.0;
  center.x *= uResolution.x / uResolution.y;
  float dishEdge = 1.0 - smoothstep(0.88, 0.97, length(center));
  vec3 rim = mix(vec3(0.91, 0.89, 0.82), color, dishEdge);
  return rim;
}

vec3 renderScope(vec2 uv, float intensity, float genome) {
  vec3 background = vec3(0.96, 0.94, 0.89);
  vec3 stain = spectrum(genome);
  float amount = 1.0 - exp(-intensity * ${f(preset.exposure, 1)});
  vec3 color = background * (1.0 - amount * 0.82) + stain * amount * 0.38;
  vec2 centered = (uv - 0.5) * 2.0;
  centered.x *= uResolution.x / uResolution.y;
  float eyepiece = 1.0 - smoothstep(0.88, 0.96, length(centered));
  return mix(vec3(0.06), color, eyepiece);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 trail = texture(uTrail, uv).rg;
  float intensity = trail.r;
  float genome = intensity > 0.001 ? clamp(trail.g / intensity, 0.0, 1.0) : 0.5;
  vec3 color;

  if (${preset.displayMode === "dark" ? 1 : 0} == 1) {
    color = renderDark(uv, intensity, genome);
  } else if (${preset.displayMode === "scope" ? 1 : 0} == 1) {
    color = renderScope(uv, intensity, genome);
  } else {
    color = renderDish(uv, intensity, genome);
  }

  color += (hash(uv * 1733.0 + fract(uTime * 1.7)) - 0.5) * 0.012;
  fragColor = vec4(max(color, 0.0), 1.0);
}
`;

  const agentRenderFragmentShader = `#version 300 es
precision highp float;

flat in float vGenome;
out vec4 fragColor;

${spectrum}

void main() {
  vec2 point = gl_PointCoord * 2.0 - 1.0;
  float radius = dot(point, point);
  if (radius > 1.0) {
    discard;
  }
  float alpha = smoothstep(1.0, 0.0, radius) * 0.52;
  fragColor = vec4(spectrum(vGenome) * 0.92, alpha);
}
`;

  return {
    stepFragmentShader,
    depositFragmentShader,
    diffuseFragmentShader,
    displayFragmentShader,
    agentRenderFragmentShader,
  };
}
