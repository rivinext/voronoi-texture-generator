const tileCanvas = document.querySelector("#tile");
const repeatCanvas = document.querySelector("#repeat");
const tileContext = tileCanvas.getContext("2d", { willReadFrequently: true });
const repeatContext = repeatCanvas.getContext("2d");

const fields = {
  seed: document.querySelector("#seed"),
  width: document.querySelector("#width"),
  height: document.querySelector("#height"),
  style: document.querySelector("#style"),
  cellCount: document.querySelector("#cellCount"),
  jitter: document.querySelector("#jitter"),
  edgeWidth: document.querySelector("#edgeWidth"),
  rounding: document.querySelector("#rounding"),
  relief: document.querySelector("#relief"),
  palette: document.querySelector("#palette"),
  guides: document.querySelector("#guides"),
  invertEdges: document.querySelector("#invertEdges"),
  colorizeEdges: document.querySelector("#colorizeEdges"),
};

const readouts = {
  cellCount: document.querySelector("#cellCountText"),
  jitter: document.querySelector("#jitterText"),
  edgeWidth: document.querySelector("#edgeText"),
  rounding: document.querySelector("#roundingText"),
  relief: document.querySelector("#reliefText"),
};

const status = document.querySelector("#status");
const controls = document.querySelector(".controls");
const reroll = document.querySelector("#reroll");
const download = document.querySelector("#download");
const swatches = document.querySelector("#swatches");
const addColor = document.querySelector("#addColor");

const palettes = {
  mineral: [
    [205, 217, 203],
    [117, 164, 153],
    [69, 101, 110],
    [189, 151, 91],
    [62, 67, 61],
  ],
  mosaic: [
    [222, 99, 79],
    [229, 190, 78],
    [68, 174, 160],
    [68, 117, 187],
    [232, 224, 198],
  ],
  lava: [
    [246, 205, 117],
    [217, 92, 49],
    [133, 40, 44],
    [72, 56, 62],
    [31, 28, 29],
  ],
  mono: [
    [234, 237, 226],
    [191, 199, 190],
    [137, 146, 143],
    [83, 91, 92],
    [36, 41, 43],
  ],
};

let scheduledFrame = 0;
let settledRenderTimer = 0;
let customColors = palettes.mineral.map(rgbToHex);
const DISPLAY_MAX_SIZE = 1024;
const INTERACTIVE_MAX_SIZE = 256;

function hashText(text) {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function makeRandom(seedText) {
  let state = hashText(seedText) || 1;

  return () => {
    state += 0x6d2b79f5;
    let result = Math.imul(state ^ (state >>> 15), state | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function smoothstep(low, high, value) {
  const amount = clamp((value - low) / (high - low), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function mixColor(a, b, amount) {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);

  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(color) {
  return `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function syncSwatchesFromPalette() {
  const palette = palettes[fields.palette.value];

  if (!palette) {
    return;
  }

  customColors = palette.map(rgbToHex);
  renderSwatches();
}

function useCustomPalette(preview = true) {
  fields.palette.value = "custom";
  scheduleTexture(preview);
}

async function pickScreenColor(index, input) {
  if (!window.EyeDropper) {
    status.textContent = "このブラウザはスポイトに対応していません";
    return;
  }

  try {
    const eyeDropper = new EyeDropper();
    const result = await eyeDropper.open();
    customColors[index] = result.sRGBHex;
    input.value = result.sRGBHex;
    useCustomPalette(false);
  } catch (error) {
    status.textContent = "スポイトをキャンセルしました";
  }
}

function renderSwatches() {
  swatches.innerHTML = "";
  addColor.disabled = customColors.length >= 12;

  customColors.forEach((color, index) => {
    const label = document.createElement("label");
    const text = document.createElement("span");
    const input = document.createElement("input");
    const pick = document.createElement("button");
    const remove = document.createElement("button");

    label.className = "swatch";
    text.textContent = `色${index + 1}`;
    input.type = "color";
    input.value = color;
    pick.className = "pick-color";
    pick.type = "button";
    pick.textContent = "スポイト";
    pick.title = "画面上から色を拾う";
    pick.disabled = !window.EyeDropper;
    remove.className = "remove-color";
    remove.type = "button";
    remove.textContent = "x";
    remove.title = "この色を削除";
    remove.disabled = customColors.length <= 1;

    input.addEventListener("input", () => {
      customColors[index] = input.value;
      useCustomPalette(true);
    });
    input.addEventListener("change", () => {
      customColors[index] = input.value;
      useCustomPalette(false);
    });
    pick.addEventListener("click", () => pickScreenColor(index, input));
    remove.addEventListener("click", () => {
      if (customColors.length <= 1) {
        return;
      }

      customColors.splice(index, 1);
      renderSwatches();
      useCustomPalette(false);
    });

    label.append(text, input, pick, remove);
    swatches.append(label);
  });
}

function resolvePalette(settings) {
  if (settings.palette === "custom") {
    return settings.customColors.length > 0 ? settings.customColors : palettes.mineral;
  }

  return palettes[settings.palette] || palettes.mineral;
}

function readDimension(field) {
  return Math.round(clamp(Number(field.value) || 512, 64, 8192));
}

function readSettings() {
  return {
    seed: fields.seed.value.trim() || "voronoi",
    width: readDimension(fields.width),
    height: readDimension(fields.height),
    style: fields.style.value,
    cellCount: Math.round(Number(fields.cellCount.value)),
    jitter: Number(fields.jitter.value),
    edgeWidth: Number(fields.edgeWidth.value),
    rounding: Number(fields.rounding.value),
    relief: Number(fields.relief.value),
    palette: fields.palette.value,
    customColors: customColors.map((color) => hexToRgb(color)),
    guides: fields.guides.checked,
    invertEdges: fields.invertEdges.checked,
    colorizeEdges: fields.colorizeEdges.checked,
  };
}

function updateReadouts() {
  readouts.cellCount.value = fields.cellCount.value;
  readouts.jitter.value = Number(fields.jitter.value).toFixed(2);
  readouts.edgeWidth.value = Number(fields.edgeWidth.value).toFixed(2);
  readouts.rounding.value = Number(fields.rounding.value).toFixed(2);
  readouts.relief.value = Number(fields.relief.value).toFixed(2);
}

function torusDelta(value, siteValue) {
  let delta = value - siteValue;

  if (delta > 0.5) {
    delta -= 1;
  } else if (delta < -0.5) {
    delta += 1;
  }

  return delta;
}

function getAspectScale(settings) {
  const base = Math.sqrt(settings.width * settings.height);

  return {
    x: settings.width / base,
    y: settings.height / base,
  };
}

function scaledTorusVector(settings, x, y, site) {
  const scale = settings.aspectScale || getAspectScale(settings);

  return {
    dx: torusDelta(x, site.x) * scale.x,
    dy: torusDelta(y, site.y) * scale.y,
  };
}

function neighborDistanceSquared(settings, a, b) {
  const vector = scaledTorusVector(settings, a.x, a.y, b);

  return vector.dx * vector.dx + vector.dy * vector.dy;
}

function buildSites(settings, palette) {
  const random = makeRandom(`${settings.seed}:${settings.cellCount}:${settings.jitter}`);
  const aspect = settings.width / settings.height;
  const columns = Math.max(1, Math.ceil(Math.sqrt(settings.cellCount * aspect)));
  const rows = Math.ceil(settings.cellCount / columns);
  const sites = [];

  for (let index = 0; index < settings.cellCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const rangeX = 0.48 * settings.jitter;
    const rangeY = 0.48 * settings.jitter;
    const x = (column + 0.5 + (random() * 2 - 1) * rangeX) / columns;
    const y = (row + 0.5 + (random() * 2 - 1) * rangeY) / rows;

    sites.push({
      id: index,
      x,
      y,
      shade: random(),
      colorIndex: Math.floor(random() * palette.length),
      neighbors: [],
    });
  }

  const neighborCount = Math.min(12, sites.length - 1);

  for (const site of sites) {
    site.neighbors = sites
      .filter((candidate) => candidate !== site)
      .sort((a, b) => neighborDistanceSquared(settings, site, a) - neighborDistanceSquared(settings, site, b))
      .slice(0, neighborCount);
  }

  return sites;
}

function boundaryDistance(
  firstDistance,
  closestDx,
  closestDy,
  competitorDistance,
  competitorDx,
  competitorDy,
) {
  const siteSpacing = Math.hypot(competitorDx - closestDx, competitorDy - closestDy);

  return siteSpacing === 0 ? 1 : (competitorDistance - firstDistance) / (2 * siteSpacing);
}

function nearbyBoundaryDistances(settings, x, y, closestSite, closestDx, closestDy, firstDistance) {
  let edgeDistance = Number.POSITIVE_INFINITY;
  let nextEdgeDistance = Number.POSITIVE_INFINITY;
  const scale = settings.aspectScale || getAspectScale(settings);

  for (const site of closestSite.neighbors) {
    const competitorDx = torusDelta(x, site.x) * scale.x;
    const competitorDy = torusDelta(y, site.y) * scale.y;
    const competitorDistance = competitorDx * competitorDx + competitorDy * competitorDy;
    const distance = boundaryDistance(
      firstDistance,
      closestDx,
      closestDy,
      competitorDistance,
      competitorDx,
      competitorDy,
    );

    if (distance < edgeDistance) {
      nextEdgeDistance = edgeDistance;
      edgeDistance = distance;
    } else if (distance < nextEdgeDistance) {
      nextEdgeDistance = distance;
    }
  }

  return { edgeDistance, nextEdgeDistance };
}

function roundIslandCorner(settings, firstEdgeDistance, nextEdgeDistance) {
  if (
    settings.style !== "edges" ||
    settings.rounding === 0 ||
    !Number.isFinite(nextEdgeDistance)
  ) {
    return firstEdgeDistance;
  }

  const softness = settings.rounding / Math.sqrt(settings.cellCount);
  const blend = 1 + Math.exp(-(nextEdgeDistance - firstEdgeDistance) / softness);

  return Math.max(0, firstEdgeDistance - softness * Math.log(blend));
}

function renderPixel(settings, palette, site, firstDistance, secondDistance, edgeDistance, edgeWidth) {
  const radius = 1 / Math.sqrt(settings.cellCount);
  const near = Math.sqrt(firstDistance) / radius;
  const gap = (Math.sqrt(secondDistance) - Math.sqrt(firstDistance)) / radius;
  const edgeSoftness = settings.style === "surface" ? Math.min(0.08, settings.edgeWidth * 0.35) : settings.edgeWidth;
  const edge = 1 - smoothstep(0, edgeSoftness, gap);
  const centerLight = clamp(1 - near, 0, 1) * settings.relief;
  const base = palette[site.colorIndex];
  const tint = mixColor(base, [247, 243, 219], centerLight * (0.25 + site.shade * 0.22));
  const trenchStrength =
    settings.style === "surface"
      ? edge * (0.26 + settings.relief * 0.08)
      : edge * (0.72 + settings.relief * 0.12);
  const trench = mixColor(tint, [10, 13, 14], trenchStrength);

  if (settings.style === "cells") {
    return mixColor(base, [255, 250, 226], site.shade * 0.12 + centerLight * 0.1);
  }

  if (settings.style === "edges") {
    const normalizedEdgeDistance = edgeDistance / radius;
    const isEdge = normalizedEdgeDistance <= edgeWidth;
    if (settings.colorizeEdges) {
      if (settings.invertEdges) {
        return isEdge ? [255, 255, 255] : base;
      }

      return isEdge ? [0, 0, 0] : base;
    }

    const level = settings.invertEdges ? (isEdge ? 255 : 0) : (isEdge ? 0 : 255);
    return [level, level, level];
  }

  if (settings.style === "distance") {
    const level = 255 * (1 - smoothstep(0, 1.18, near));
    return [level, level, level];
  }

  return trench;
}

function drawTexture(settings, targetCanvas = tileCanvas, drawPreview = true) {
  settings.aspectScale = getAspectScale(settings);
  const scale = settings.aspectScale;
  const palette = resolvePalette(settings);
  const sites = buildSites(settings, palette);
  const targetContext = targetCanvas.getContext("2d", { willReadFrequently: true });
  const image = targetContext.createImageData(settings.width, settings.height);
  const pixels = image.data;

  targetCanvas.width = settings.width;
  targetCanvas.height = settings.height;

  for (let y = 0; y < settings.height; y += 1) {
    const sampleY = (y + 0.5) / settings.height;

    for (let x = 0; x < settings.width; x += 1) {
      const sampleX = (x + 0.5) / settings.width;
      let firstDistance = Number.POSITIVE_INFINITY;
      let secondDistance = Number.POSITIVE_INFINITY;
      let closestSite = sites[0];
      let closestDx = 0;
      let closestDy = 0;
      let secondDx = 0;
      let secondDy = 0;

      for (const site of sites) {
        const dx = torusDelta(sampleX, site.x) * scale.x;
        const dy = torusDelta(sampleY, site.y) * scale.y;
        const distance = dx * dx + dy * dy;

        if (distance < firstDistance) {
          secondDistance = firstDistance;
          secondDx = closestDx;
          secondDy = closestDy;
          firstDistance = distance;
          closestSite = site;
          closestDx = dx;
          closestDy = dy;
        } else if (distance < secondDistance) {
          secondDistance = distance;
          secondDx = dx;
          secondDy = dy;
        }
      }

      let edgeDistance = boundaryDistance(
        firstDistance,
        closestDx,
        closestDy,
        secondDistance,
        secondDx,
        secondDy,
      );
      let nextEdgeDistance = Number.POSITIVE_INFINITY;

      if (settings.style === "edges") {
        ({ edgeDistance, nextEdgeDistance } = nearbyBoundaryDistances(
          settings,
          sampleX,
          sampleY,
          closestSite,
          closestDx,
          closestDy,
          firstDistance,
        ));
      }

      const roundedEdgeDistance = roundIslandCorner(
        settings,
        edgeDistance,
        nextEdgeDistance,
      );
      const color = renderPixel(
        settings,
        palette,
        closestSite,
        firstDistance,
        secondDistance,
        roundedEdgeDistance,
        settings.edgeWidth,
      );
      const pixel = (y * settings.width + x) * 4;
      pixels[pixel] = color[0];
      pixels[pixel + 1] = color[1];
      pixels[pixel + 2] = color[2];
      pixels[pixel + 3] = 255;
    }
  }

  targetContext.putImageData(image, 0, 0);

  if (drawPreview) {
    drawRepeatPreview(settings);
  }
}

function drawRepeatPreview(settings) {
  const previewScale = 256 / Math.max(settings.width, settings.height);
  const tileWidth = Math.max(1, Math.round(settings.width * previewScale));
  const tileHeight = Math.max(1, Math.round(settings.height * previewScale));
  const width = tileWidth * 3;
  const height = tileHeight * 3;

  repeatCanvas.width = width;
  repeatCanvas.height = height;
  repeatContext.imageSmoothingEnabled = false;
  repeatContext.clearRect(0, 0, width, height);
  repeatContext.fillStyle = "#080a0b";
  repeatContext.fillRect(0, 0, width, height);

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      repeatContext.drawImage(
        tileCanvas,
        column * tileWidth,
        row * tileHeight,
        tileWidth,
        tileHeight,
      );
    }
  }

  if (!settings.guides) {
    return;
  }

  repeatContext.strokeStyle = "rgba(246, 205, 117, 0.76)";
  repeatContext.lineWidth = 2;
  repeatContext.setLineDash([8, 8]);

  for (let mark = 1; mark < 3; mark += 1) {
    repeatContext.beginPath();
    repeatContext.moveTo(mark * tileWidth, 0);
    repeatContext.lineTo(mark * tileWidth, height);
    repeatContext.stroke();
    repeatContext.beginPath();
    repeatContext.moveTo(0, mark * tileHeight);
    repeatContext.lineTo(width, mark * tileHeight);
    repeatContext.stroke();
  }

  repeatContext.setLineDash([]);
}

function scheduleTexture(preview = false) {
  updateReadouts();
  cancelAnimationFrame(scheduledFrame);
  clearTimeout(settledRenderTimer);
  status.textContent = "生成中...";

  scheduledFrame = requestAnimationFrame(() => {
    const settings = readSettings();
    const maxPreviewSize = preview ? INTERACTIVE_MAX_SIZE : DISPLAY_MAX_SIZE;
    const previewScale = Math.min(1, maxPreviewSize / Math.max(settings.width, settings.height));
    const renderSettings = {
      ...settings,
      width: Math.max(1, Math.round(settings.width * previewScale)),
      height: Math.max(1, Math.round(settings.height * previewScale)),
    };
    const start = performance.now();
    drawTexture(renderSettings);
    const elapsed = Math.round(performance.now() - start);
    const previewLabel =
      renderSettings.width === settings.width && renderSettings.height === settings.height
        ? ""
        : " preview";
    status.textContent =
      `${renderSettings.width}x${renderSettings.height}px${previewLabel} / ` +
      `${settings.cellCount} cells / ${elapsed} ms`;

    if (renderSettings.width !== settings.width || renderSettings.height !== settings.height) {
      settledRenderTimer = setTimeout(() => scheduleTexture(false), 180);
    }
  });
}

function randomSeed() {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `tile-${bytes[0].toString(36)}-${bytes[1].toString(36)}`;
}

function downloadTile() {
  const settings = readSettings();
  const exportCanvas = document.createElement("canvas");

  status.textContent = `PNG生成中... ${settings.width}x${settings.height}px`;
  drawTexture(settings, exportCanvas, false);

  exportCanvas.toBlob((blob) => {
    if (!blob) {
      status.textContent = "PNGを書き出せませんでした";
      return;
    }

    const anchor = document.createElement("a");
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download =
      `tileable-voronoi-${settings.width}x${settings.height}-` +
      `${settings.seed.replace(/[^a-z0-9_-]+/gi, "-")}.png`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status.textContent = `PNGを書き出しました ${settings.width}x${settings.height}px`;
  }, "image/png");
}

controls.addEventListener("submit", (event) => event.preventDefault());

for (const field of Object.values(fields)) {
  field.addEventListener("input", () => scheduleTexture(true));
  field.addEventListener("change", () => scheduleTexture(false));
}

fields.palette.addEventListener("change", () => {
  syncSwatchesFromPalette();
  scheduleTexture(false);
});

addColor.addEventListener("click", () => {
  if (customColors.length >= 12) {
    return;
  }

  const source = customColors[customColors.length - 1] || "#cdd9cb";
  customColors.push(source);
  renderSwatches();
  useCustomPalette(false);
});

reroll.addEventListener("click", () => {
  fields.seed.value = randomSeed();
  scheduleTexture();
});

download.addEventListener("click", downloadTile);

renderSwatches();
scheduleTexture();
